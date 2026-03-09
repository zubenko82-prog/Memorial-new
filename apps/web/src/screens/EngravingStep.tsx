// src/screens/EngravingStep.tsx
// Шаг «Информация об усопших» (без редактора).
//
// Что меняем для надёжного сохранения «тяжёлых» фото:
// - Автосохранения НЕТ. В драфт пишем только:
//   • по кнопкам «Назад»/«Продолжить»,
//   • при переходах/обновлении/скрытии вкладки (beforeunload/pagehide/hashchange/popstate/visibility:hidden).
// - Перед сохранением в драфт фото всегда сжимаем до «безопасного» размера,
//   причём сжатие делаем сразу при выборе фото (только в локальном state, не в драфт).
//   Это гарантирует, что при переходе запись в localStorage (драфт) не упадёт по квоте.
// - Храним в драфте компактный dataURL (JPEG), достаточный для предпросмотра и TopBar.
// - Если фото пришло как внешний URL (CORS не даёт читать), сохраняем именно URL (без dataURL).
//
// Навигация: липкая. «Компактный вид ☰» — сворачивает все аккордеоны, показывается если > 1 усопшего.
// Эскиз: общий SketchTemplate, передаём peopleBlocks и эпитафии.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import PhotoField, { PhotoValue } from "../components/PhotoField";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, type OrderDraft } from "../lib/order";

/* ===== Types ===== */
type Person = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoUrl?: string | null;
  photoDataUrl?: string | null;
};
type NormalizedPerson = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoPreview: string | null;
};

/* ===== UI helpers ===== */
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm") {
  const pad = { nano: "2px 6px", sm: "8px 12px", md: "12px 18px" } as const;
  return {
    padding: pad[size],
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: "pointer",
    fontSize: size === "nano" ? 12 : 14,
    lineHeight: 1.1,
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 12px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.12)"
  } as React.CSSProperties;
}
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function linkLikeStyle(): React.CSSProperties {
  return {
    color: "#8ab4ff",
    textDecoration: "underline",
    cursor: "pointer",
    background: "transparent"
  };
}

/* ===== Helpers ===== */
function linesFromPerson(p: Person) {
  const l1 = (p.lastName || "").trim();
  const l2 = [p.firstName, p.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
  const l3 = [p.birthDate, p.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
function normalizePersonsForSave(persons: Person[]): NormalizedPerson[] {
  return persons.map((p) => ({
    id: p.id,
    lastName: p.lastName?.trim() || undefined,
    firstName: p.firstName?.trim() || undefined,
    middleName: p.middleName?.trim() || undefined,
    birthDate: p.birthDate?.trim() || undefined,
    deathDate: p.deathDate?.trim() || undefined,
    photoPreview: p.photoDataUrl ?? p.photoUrl ?? null
  }));
}
function draftPersonsToLocal(list?: NormalizedPerson[] | null): Person[] {
  if (!Array.isArray(list)) return [];
  return list.map((d, i) => ({
    id: d.id || `p-${i}`,
    lastName: d.lastName || "",
    firstName: d.firstName || "",
    middleName: d.middleName || "",
    birthDate: d.birthDate || "",
    deathDate: d.deathDate || "",
    photoUrl: d.photoPreview ?? null,
    photoDataUrl: d.photoPreview ?? null
  }));
}
function makeBlankPerson(id?: string): Person {
  return {
    id: id ?? `p-${Date.now()}`,
    lastName: "",
    firstName: "",
    middleName: "",
    birthDate: "",
    deathDate: "",
    photoUrl: null,
    photoDataUrl: null
  };
}

/* ===== Date validation (локально) ===== */
function parseFlexibleDate(input?: string): Date | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/\d+/g);
  if (!m || m.length < 3) return null;
  const d = +m[0], mo = +m[1], y = +m[2];
  if (!d || !mo || !y || y < 100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}
function validateDates(birth?: string, death?: string): string | null {
  const bd = parseFlexibleDate(birth);
  const dd = parseFlexibleDate(death);
  if (!bd && !dd) return null;
  if (birth && !bd) return "Некорректная дата рождения";
  if (death && !dd) return "Некорректная дата смерти";
  if (bd && dd && dd.getTime() < bd.getTime()) return "Дата смерти раньше даты рождения";
  return null;
}

/* ===== Image compression (для безопасного сохранения в localStorage) ===== */
// Целим ~0.6 МБ на фото (достаточно для предпросмотра и укладывается в квоту даже при нескольких людях)
const DRAFT_IMG_MAX_BYTES = 600 * 1024; // 600 KiB
const DRAFT_IMG_MAX_DIM = 1600; // длинная сторона, px
const JPEG_Q_START = 0.9;
const JPEG_Q_MIN = 0.55;
const JPEG_Q_STEP = 0.08;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("read blob"));
    fr.readAsDataURL(blob);
  });
}
async function loadImageFromBlob(b: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(b);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function compressBlobToJpegDataUrl(input: Blob, maxBytes = DRAFT_IMG_MAX_BYTES): Promise<string> {
  const img = await loadImageFromBlob(input);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const r = iw / ih;

  let tw = iw, th = ih;
  if (Math.max(iw, ih) > DRAFT_IMG_MAX_DIM) {
    if (r >= 1) { tw = DRAFT_IMG_MAX_DIM; th = Math.round(DRAFT_IMG_MAX_DIM / r); }
    else { th = DRAFT_IMG_MAX_DIM; tw = Math.round(DRAFT_IMG_MAX_DIM * r); }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(tw));
  canvas.height = Math.max(1, Math.round(th));
  const ctx = canvas.getContext("2d");
  if (!ctx) return await blobToDataUrl(input);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let q = JPEG_Q_START;
  let out: Blob = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
  if (out.size <= maxBytes) return await blobToDataUrl(out);

  while (q > JPEG_Q_MIN && out.size > maxBytes) {
    q = Math.max(JPEG_Q_MIN, q - JPEG_Q_STEP);
    out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
  }
  if (out.size <= maxBytes) return await blobToDataUrl(out);

  // если не уложились — ещё уменьшаем габариты
  let scale = 0.9;
  for (let i = 0; i < 4 && out.size > maxBytes; i++) {
    const nw = Math.max(1, Math.round(canvas.width * scale));
    const nh = Math.max(1, Math.round(canvas.height * scale));
    const c2 = document.createElement("canvas");
    c2.width = nw; c2.height = nh;
    const x2 = c2.getContext("2d");
    if (!x2) break;
    x2.drawImage(canvas, 0, 0, nw, nh);
    canvas.width = nw; canvas.height = nh;
    ctx.drawImage(c2, 0, 0);

    q = JPEG_Q_START;
    out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
    while (q > JPEG_Q_MIN && out.size > maxBytes) {
      q = Math.max(JPEG_Q_MIN, q - JPEG_Q_STEP);
      out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
    }
    scale *= 0.9;
  }
  return await blobToDataUrl(out);
}

/* ===== Component ===== */
type Props = {
  item: any;
  sizeResult?: any;
  initial?:
    | { persons?: Person[]; epitaphs?: string[]; epitaphText?: string; [k: string]: any }
    | null;
  onBack?: () => void;
  onSaveDraft?: (data: any) => void;
  onDone?: (data: any) => void;
};

export default function EngravingStep({ item, sizeResult, initial, onBack, onSaveDraft, onDone }: Props) {
  const [outro, setOutro] = useState(false);

  // Снимок драфта при входе (без лайв-подписок)
  const draftSnapRef = useRef<OrderDraft>(loadOrderDraft());

  // Persons — локально, в драфт пишем при переходах
  const personsFromDraft = draftPersonsToLocal(draftSnapRef.current?.engraving?.persons as any);
  const [persons, setPersons] = useState<Person[]>(
    personsFromDraft.length
      ? personsFromDraft
      : Array.isArray(initial?.persons) && initial!.persons!.length
      ? initial!.persons!.map((p: any, i: number) => ({ id: p.id || `p-${i}`, ...p }))
      : [makeBlankPerson("p-0")]
  );

  // Транзиентные превью (blob:) с ревоком
  const [transientPhotoUrlById, setTransientPhotoUrlById] = useState<Record<string, string | null>>({});
  const setTransientFor = useCallback((id: string, url: string | null) => {
    setTransientPhotoUrlById((prev) => {
      const prevUrl = prev[id];
      if (prevUrl && prevUrl.startsWith("blob:") && prevUrl !== url) {
        try { URL.revokeObjectURL(prevUrl); } catch {}
      }
      return { ...prev, [id]: url ?? null };
    });
  }, []);
  useEffect(() => {
    return () => {
      Object.values(transientPhotoUrlById).forEach((u) => {
        if (u && u.startsWith("blob:")) { try { URL.revokeObjectURL(u); } catch {} }
      });
    };
  }, [transientPhotoUrlById]);

  // Блоки для эскиза
  const peopleBlocks = useMemo(
    () =>
      persons.map((p) => {
        const t = transientPhotoUrlById[p.id];
        const stable = p.photoDataUrl ?? p.photoUrl ?? null;
        return { id: p.id, lines: linesFromPerson(p), photo: t ?? stable };
      }),
    [persons, transientPhotoUrlById]
  );

  // Валидность дат
  const dateErrors = useMemo(() => {
    const errs: Record<string, string | null> = {};
    persons.forEach((p) => (errs[p.id] = validateDates(p.birthDate, p.deathDate)));
    return errs;
  }, [persons]);
  const canContinue = useMemo(() => Object.values(dateErrors).every((e) => !e), [dateErrors]);

  // Открытие/закрытие аккордеонов
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(
    () => Object.fromEntries(persons.map((p) => [p.id, true]))
  );
  useEffect(() => {
    setOpenMap((prev) => {
      const next: Record<string, boolean> = {};
      persons.forEach((p) => { next[p.id] = prev[p.id] ?? true; });
      return next;
    });
  }, [persons]);

  // CRUD
  const updatePerson = (idx: number, patch: Partial<Person>) =>
    setPersons((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const removePerson = (idx: number) =>
    setPersons((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [makeBlankPerson("p-0")];
    });
  const addPerson = () => setPersons((prev) => prev.concat([makeBlankPerson()]));
  const moveUp = (idx: number) =>
    setPersons((prev) => (idx === 0 ? prev : prev.map((x, i) => (i === idx - 1 ? prev[idx] : i === idx ? prev[idx - 1] : x))));
  const moveDown = (idx: number) =>
    setPersons((prev) => (idx === prev.length - 1 ? prev : prev.map((x, i) => (i === idx ? prev[idx + 1] : i === idx + 1 ? prev[idx] : x))));

  /* ===== Фото локально (с безопасным сжатием) ===== */
  const photoSeqByIdRef = useRef<Record<string, number>>({});
  const isBlobUrl = (url?: string | null) => !!url && url.startsWith("blob:");

  const setPersonPhotoById = (personId: string, pv: PhotoValue | null) => {
    const nextSeq = (photoSeqByIdRef.current[personId] || 0) + 1;
    photoSeqByIdRef.current[personId] = nextSeq;
    const isCurrentSeq = () => photoSeqByIdRef.current[personId] === nextSeq;

    const commitLocal = (patch: Partial<Person>) => {
      if (!isCurrentSeq()) return;
      setTransientFor(personId, null);
      setPersons((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
    };

    // Очистка фото
    if (!pv) {
      setTransientFor(personId, null);
      commitLocal({ photoUrl: null, photoDataUrl: null });
      return;
    }

    // Источник: готовый dataUrl
    if ((pv as any)?.dataUrl) {
      const dataUrl = (pv as any).dataUrl as string;
      (async () => {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const safe = await compressBlobToJpegDataUrl(blob, DRAFT_IMG_MAX_BYTES);
          commitLocal({ photoDataUrl: safe, photoUrl: safe });
        } catch {
          // если не смогли сжать — используем как есть (м.б. «лёгкое» фото)
          commitLocal({ photoDataUrl: dataUrl, photoUrl: (pv as any).url ?? dataUrl });
        }
      })();
      return;
    }

    // Источник: File
    const maybeFile: File | undefined = (pv as any)?.file;
    if (maybeFile instanceof File) {
      // Мгновенное превью
      const tempUrl = URL.createObjectURL(maybeFile);
      setTransientFor(personId, tempUrl);
      (async () => {
        try {
          const safe = await compressBlobToJpegDataUrl(maybeFile, DRAFT_IMG_MAX_BYTES);
          try { URL.revokeObjectURL(tempUrl); } catch {}
          commitLocal({ photoDataUrl: safe, photoUrl: safe });
        } catch {
          try { URL.revokeObjectURL(tempUrl); } catch {}
          // Фолбек: используем blob: как prev (не будет сохранён в драфт!), но пользователь видит превью.
          // При сохранении (переходе) фото не попадёт в драфт, если останется только blob:
          // поэтому лучше предложить перезагрузить фото или уменьшить.
          commitLocal({ photoUrl: tempUrl, photoDataUrl: null });
        }
      })();
      return;
    }

    // Источник: url
    if ((pv as any)?.url) {
      const url = (pv as any).url as string;
      if (isBlobUrl(url)) {
        // blob: — превращаем в сжатый dataURL, чтобы можно было сохранить
        setTransientFor(personId, url);
        (async () => {
          try {
            const blob = await (await fetch(url)).blob();
            const safe = await compressBlobToJpegDataUrl(blob, DRAFT_IMG_MAX_BYTES);
            commitLocal({ photoDataUrl: safe, photoUrl: safe });
          } catch {
            // Оставим blob: только как превью (в драфт не пойдёт)
            commitLocal({ photoUrl: url, photoDataUrl: null });
          }
        })();
      } else {
        // внешний URL (в драфт пишем URL, без dataURL — экономим квоту)
        setTransientFor(personId, null);
        commitLocal({ photoUrl: url, photoDataUrl: null });
      }
    }
  };

  /* ===== Навигация / sticky-панель ===== */
  const navRef = useRef<HTMLDivElement | null>(null);
  const navRowRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(56);

  useLayoutEffect(() => {
    const measure = () => {
      const h = navRef.current?.getBoundingClientRect().height || 0;
      setNavH(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const formRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollToForm = (id: string) => {
    const el = formRefs.current[id];
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - (navH + 10)), behavior: "smooth" });
  };
  const previewRef = useRef<HTMLElement | null>(null);
  const scrollToPreview = () => {
    const el = previewRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - (navH + 10)), behavior: "smooth" });
  };

  // Сворачивание всех аккордеонов
  const collapseAll = useCallback(() => {
    setOpenMap(Object.fromEntries(persons.map((p) => [p.id, false])));
    if (persons.length > 0) scrollToForm(persons[0].id);
  }, [persons]);

  // Запись в драфт (ТОЛЬКО по событиям перехода/обновления)
  const flushSaveNow = useCallback(() => {
    const norm = normalizePersonsForSave(persons);
    const stored = saveOrderDraft({ engraving: { persons: norm } }); // ПАТЧ (merge в saveOrderDraft)
    onSaveDraft?.({ persons: norm });
    draftSnapRef.current = stored;
  }, [persons, onSaveDraft]);

  // Сохраняем на переходах/обновлении/скрытии вкладки
  useEffect(() => {
    const saveNow = () => { try { flushSaveNow(); } catch {} };
    const onVisibility = () => { if (document.visibilityState === "hidden") saveNow(); };
    window.addEventListener("beforeunload", saveNow);
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("hashchange", saveNow);
    window.addEventListener("popstate", saveNow);
    window.addEventListener("visibilitychange", onVisibility);
    return () => {
      saveNow();
      window.removeEventListener("beforeunload", saveNow);
      window.removeEventListener("pagehide", saveNow);
      window.removeEventListener("hashchange", saveNow);
      window.removeEventListener("popstate", saveNow);
      window.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushSaveNow]);

  const handleBack = useCallback(() => {
    flushSaveNow();
    setOutro(true);
    setTimeout(() => onBack?.(), 200);
  }, [flushSaveNow, onBack]);

  const [isRendering, setIsRendering] = useState(false);
  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    flushSaveNow();
    setIsRendering(true);
    setIsRendering(false);
    setOutro(true);
    setTimeout(() => onDone?.({ persons, sketchDataUrl: null }), 200);
  }, [canContinue, flushSaveNow, onDone, persons]);

  /* ===== Данные для эскиза из снапшота ===== */
  const selectedGraphics = useMemo(() => (draftSnapRef.current?.graphics || []) as any[], []);
  const selectedCrosses = useMemo(
    () => selectedGraphics.filter((g) => (g.catName || "").toLowerCase().includes("крест") || (g.catSlug || "").toLowerCase().includes("cross")),
    [selectedGraphics]
  );
  const selectedOtherGraphics = useMemo(
    () => selectedGraphics.filter((g) => !((g.catName || "").toLowerCase().includes("крест") || (g.catSlug || "").toLowerCase().includes("cross"))),
    [selectedGraphics]
  );

  // Эпитафии — из драфта (snapshot), иначе из initial
  const epitaphsForPreview = useMemo(() => {
    const engr: any = draftSnapRef.current?.engraving || {};
    if (Array.isArray(engr.epitaphs) && engr.epitaphs.length) return engr.epitaphs.filter(Boolean);
    if (typeof engr.epitaphText === "string" && engr.epitaphText.trim()) {
      return engr.epitaphText.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(initial?.epitaphs)) return (initial!.epitaphs as string[]).filter(Boolean);
    if (typeof initial?.epitaphText === "string" && initial!.epitaphText!.trim()) {
      return initial!.epitaphText!.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    }
    return [];
  }, [initial]);

  /* ===== MAX WIDTH LIMIT ===== */
  const MAX_W = 600;

  return (
    <div
      style={{
        color: "#fff",
        padding: 12,
        opacity: outro ? 0 : 1,
        transition: "opacity 240ms ease",
        backgroundImage: `url(/data/bg.svg)`,
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundAttachment: "fixed"
      }}
    >
      <div style={{ width: "100%", maxWidth: MAX_W, margin: "0 auto" }}>
        <TopBarWithIntro title="Усопшие" />

        {/* Навигация (липкая) */}
        <div
          ref={navRef}
          style={{
            position: "sticky",
            top: "calc(var(--global-stepnav-h, 0px) + 4px + env(safe-area-inset-top, 0px))",
            zIndex: 50,
            paddingTop: "env(safe-area-inset-top)",
            background: "rgba(0,0,0,0.96)",
            borderRadius: 12,
            border: "1px dashed rgba(255, 255, 255, 0.6)",
            marginBottom: 10,
            transform: "translateZ(0)"
          }}
        >
          <div
            ref={navRowRef}
            style={{
              display: "flex",
              gap: 8,
              padding: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "flex-start"
            }}
          >
            {persons.length > 1 && (
              <a href="#" onClick={(e) => { e.preventDefault(); collapseAll(); }} style={linkLikeStyle()} title="Свернуть все — компактный вид">
                Компактный вид ☰
              </a>
            )}

            {persons.map((p) => {
              const name = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
              return (
                <button key={p.id} onClick={() => scrollToForm(p.id)} style={glassButtonStyle("nano")} title={name}>
                  {name}
                </button>
              );
            })}

            <div style={{ flex: 1 }} />
            <button onClick={scrollToPreview} style={glassButtonStyle("nano")}>Эскиз</button>
          </div>
        </div>

        {/* Список персон */}
        <section>
          <h2 style={{ margin: "0 0 8px 0", textAlign: "left" }}>Информация об усопших</h2>

          {persons.length > 1 && (
            <div style={{ margin: "0 0 8px 0", textAlign: "left" }}>
              Для изменения порядка нажмите (▲/▼) напротив имени.{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); collapseAll(); }} style={linkLikeStyle()} title="Свернуть все — компактный вид">
                Компактный вид ☰
              </a>
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {persons.map((p, idx) => {
              const id = p.id;
              const isOpen = openMap[id] ?? true;
              const err = validateDates(p.birthDate, p.deathDate);
              const nameLeft = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
              const hasPhoto = !!(transientPhotoUrlById[p.id] || p.photoDataUrl || p.photoUrl);

              return (
                <div key={id} ref={(el) => (formRefs.current[id] = el)} style={{ ...glassPanelStyle(), padding: 0 }}>
                  <div
                    onClick={() => setOpenMap((prev) => ({ ...prev, [id]: !isOpen }))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      background: "rgba(0,0,0,0.66)",
                      borderRadius: "12px 12px 0 0",
                      cursor: "pointer"
                    }}
                  >
                    <span style={{ opacity: 0.9 }}>{idx + 1} -</span>
                    <div style={{ fontSize: 16, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nameLeft}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveUp(idx); }} disabled={idx === 0} style={{ ...iconBtn(), opacity: idx === 0 ? 0.4 : 1 }} title="Выше">▲</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveDown(idx); }} disabled={idx === persons.length - 1} style={{ ...iconBtn(), opacity: idx === persons.length - 1 ? 0.4 : 1 }} title="Ниже">▼</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removePerson(idx); }} style={iconBtn()} title="Удалить">✖</button>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                          <Field label="Фамилия"><input value={p.lastName ?? ""} onChange={(e) => updatePerson(idx, { lastName: e.target.value })} style={inputStyle()} placeholder="Иванов" /></Field>
                          <Field label="Имя"><input value={p.firstName ?? ""} onChange={(e) => updatePerson(idx, { firstName: e.target.value })} style={inputStyle()} placeholder="Иван" /></Field>
                          <Field label="Отчество"><input value={p.middleName ?? ""} onChange={(e) => updatePerson(idx, { middleName: e.target.value })} style={inputStyle()} placeholder="Иванович" /></Field>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                          <Field label="Дата рождения">
                            <input
                              value={p.birthDate ?? ""}
                              onChange={(e) => updatePerson(idx, { birthDate: e.target.value })}
                              style={{ ...inputStyle(), borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)" }}
                              placeholder="01.01.1950"
                            />
                          </Field>
                          <Field label="Дата смерти">
                            <input
                              value={p.deathDate ?? ""}
                              onChange={(e) => updatePerson(idx, { deathDate: e.target.value })}
                              style={{ ...inputStyle(), borderColor: err && (err.includes("смерти") || err.includes("раньше")) ? "salmon" : "rgba(255,255,255,0.18)" }}
                              placeholder="01.01.2024"
                            />
                          </Field>
                          {!!err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}
                        </div>

                        {/* Фото + подсказка при отсутствии */}
                        <div>
                          {!hasPhoto && (
                            <div style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, opacity: 0.92 }}>
                              Прикрепите фотографию. Она сохранится в заявке.
                            </div>
                          )}
                          <PhotoField
                            label="Фотография"
                            value={{ url: transientPhotoUrlById[p.id] ?? p.photoUrl ?? undefined, dataUrl: p.photoDataUrl ?? undefined }}
                            onChange={(pv) => setPersonPhotoById(p.id, pv)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={addPerson} style={glassButtonStyle("sm")}>Добавить данные ещё одного человека</button>
          </div>
        </section>

        {/* Пояснение */}
        <div style={{ color: "#fff", opacity: 0.9, fontSize: 15, lineHeight: 1.25, margin: "6px 0 8px", textAlign: "center", fontWeight: 400 }}>
          Перед вами визуализация заказа, а не готовый макет для гравировки. Итоговый макет выполнит специалист.
        </div>

        {/* Эскиз */}
        <section ref={previewRef as any} style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <SketchTemplate
            item={item}
            peopleBlocks={peopleBlocks}
            crosses={selectedCrosses}
            others={selectedOtherGraphics}
            epitaphs={epitaphsForPreview}
            carvingOpacity={0.4}
          />
        </section>

        {/* Кнопки */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
          <button
            type="button"
            disabled={!canContinue || isRendering}
            onClick={handleContinue}
            style={{ ...glassButtonStyle("sm"), opacity: canContinue && !isRendering ? 1 : 0.6 }}
            title={isRendering ? "Подождите, формируем изображение…" : undefined}
          >
            {isRendering ? "Формирование…" : "Продолжить"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Form helpers ===== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, width: "100%", boxSizing: "border-box" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
}
function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
    boxSizing: "border-box"
  };
}
function iconBtn(): React.CSSProperties {
  return {
    padding: "2px 6px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  };
}
