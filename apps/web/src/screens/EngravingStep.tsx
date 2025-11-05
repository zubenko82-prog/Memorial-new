// src/screens/EngravingStep.tsx
// Шаг «Информация об усопших» (без редактора).
//
// Вертикальный шаблон (>1 человек):
// - Табличная раскладка на всю ширину: слева портрет (высота 70% строки, 3/4), справа метрика (90% ширины ячейки).
// Горизонтальный шаблон: делим эскиз на N равных долей по числу людей.
// Навигация: пунктирная рамка.
// При «Продолжить» — растрируем эскиз и передаём sketchDataUrl.
//
// Фиксы по фото (чтобы «не прикреплялись через раз»):
// 1) Обновляем фото по ID (не по индексу) и добавляем per-ID защиту от гонок (seq). Старые async-результаты не перетрут новые.
// 2) Для file/blob: сначала мгновенно показываем ObjectURL (без «мигания»), затем конвертируем в dataURL и заменяем; revoke делаем после замены.
// 3) Для url http(s): не требуем dataURL (чтобы не упираться в CORS), сохраняем как есть.
// 4) Стоппер синхронизации драфта: сразу после нашего сохранения игнорируем входящие DRAFT_UPDATED_EVENT/storage ~400мс
//    и применяем данные из драфта только если их updatedAt новее последнего применённого.
//
// Доп. фикс: «сохраняется только один человек»
// - При получении драфта мы НЕ перезаписываем весь список персон целиком.
//   Вместо этого аккуратно совмещаем (merge by id): обновляем/добавляем персон, но НЕ удаляем
//   уже существующих, если драфт пришёл «усечённый» (например, другая вкладка сохранила только одну запись).
// - Удаление выполняется только явным действием пользователя (removePerson).

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
import {
  loadOrderDraft,
  saveOrderDraft,
  DRAFT_UPDATED_EVENT,
  type OrderDraft
} from "../lib/order";

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

const FONT_CENTURY = `"Century Schoolbook", "Century Schoolbook L", "Century Schoolbook Bold", "Times New Roman", serif`;

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
function bottomUnderlayGradient() {
  return {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  } as React.CSSProperties;
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
    photoPreview: p.photoDataUrl || p.photoUrl || null
  }));
}
function draftPersonsToLocal(list?: NormalizedPerson[] | null): Person[] | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((d, i) => ({
    id: d.id || `p-${i}`,
    lastName: d.lastName || "",
    firstName: d.firstName || "",
    middleName: d.middleName || "",
    birthDate: d.birthDate || "",
    deathDate: d.deathDate || "",
    photoUrl: d.photoPreview || null,
    photoDataUrl: d.photoPreview || null
  }));
}
// Слияние персон «по месту» — не удаляем текущих, если драфт пришёл усечённым
function mergePersonsById(current: Person[], incoming: Person[]): Person[] {
  const curMap = new Map(current.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const updated: Person[] = current.map((p) => {
    const inc = incoming.find((x) => x.id === p.id);
    if (!inc) return p; // не удаляем автоматически
    seen.add(p.id);
    return {
      ...p,
      lastName: inc.lastName ?? p.lastName,
      firstName: inc.firstName ?? p.firstName,
      middleName: inc.middleName ?? p.middleName,
      birthDate: inc.birthDate ?? p.birthDate,
      deathDate: inc.deathDate ?? p.deathDate,
      photoUrl: inc.photoUrl ?? p.photoUrl,
      photoDataUrl: inc.photoDataUrl ?? p.photoDataUrl
    };
  });
  // добавляем новых, которых не было
  incoming.forEach((inc) => {
    if (!curMap.has(inc.id)) updated.push(inc);
  });
  return updated;
}

/* ===== Date validation ===== */
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

/* ===== Metric rasterization (HORIZONTAL only) ===== */
type MetricImage = { url: string; w: number; h: number };
function rasterizeMetric(lines: string[], targetWidth: number): MetricImage {
  const DPR = Math.min(2, (window as any).devicePixelRatio || 1.5);
  const W = Math.max(220, Math.round(targetWidth * DPR));
  const base1 = Math.round(W * 0.09);
  const base2 = Math.round(W * 0.08);
  const base3 = Math.round(W * 0.07);
  const pad = Math.round(W * 0.06);
  const lh = (px: number) => Math.round(px * 1.1);
  const H =
    pad + lh(base1) + Math.round(W * 0.02) + lh(base2) + Math.round(W * 0.02) + lh(base3) + pad;

  const cvs = document.createElement("canvas");
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext("2d");
  if (!ctx) return { url: "", w: 0, h: 0 };

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const cx = Math.round(W / 2);

  const [l1, l2, l3] = [
    (lines[0] || "").toUpperCase(),
    (lines[1] || "").toUpperCase(),
    (lines[2] || "").toUpperCase()
  ];

  let y = pad;
  if (l1) { ctx.font = `700 ${base1}px ${FONT_CENTURY}`; ctx.fillText(l1, cx, y); y += lh(base1) + Math.round(W * 0.02); }
  if (l2) { ctx.font = `700 ${base2}px ${FONT_CENTURY}`; ctx.fillText(l2, cx, y); y += lh(base2) + Math.round(W * 0.02); }
  if (l3) { ctx.font = `700 ${base3}px ${FONT_CENTURY}`; ctx.fillText(l3, cx, y); }

  const url = cvs.toDataURL("image/png");
  return { url, w: W, h: H };
}

/* ===== Component ===== */
type Props = {
  item: any;
  sizeResult?: any;
  initial?: { persons?: Person[]; [k: string]: any } | null;
  onBack?: () => void;
  onSaveDraft?: (data: any) => void;
  onDone?: (data: any) => void;
};

export default function EngravingStep({ item, sizeResult, initial, onBack, onSaveDraft, onDone }: Props) {
  const [outro, setOutro] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());

  // Ориентация
  const initialOri = (draft?.size?.orientation as "horizontal" | "vertical") || undefined;
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">(initialOri || "horizontal");

  // Persons
  const personsFromDraft = draftPersonsToLocal(draft.engraving?.persons as any);
  const [persons, setPersons] = useState<Person[]>(
    personsFromDraft && personsFromDraft.length
      ? personsFromDraft
      : Array.isArray(initial?.persons) && initial!.persons!.length
      ? initial!.persons!.map((p: any, i: number) => ({ id: p.id || `p-${i}`, ...p }))
      : [{ id: "p-0", lastName: "", firstName: "", middleName: "", birthDate: "", deathDate: "", photoUrl: null, photoDataUrl: null }]
  );

  // Блоки для эскиза
  const peopleBlocks = useMemo(
    () => persons.map((p) => ({ id: p.id, lines: linesFromPerson(p), photo: p.photoDataUrl || p.photoUrl || null })),
    [persons]
  );

  // Валидность
  const dateErrors = useMemo(() => {
    const errs: Record<string, string | null> = {};
    persons.forEach((p) => (errs[p.id] = validateDates(p.birthDate, p.deathDate)));
    return errs;
  }, [persons]);
  const canContinue = useMemo(() => Object.values(dateErrors).every((e) => !e), [dateErrors]);

  // Аккордеоны
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => Object.fromEntries(persons.map((p) => [p.id, true])));

  // ===== Стоппер синхронизации драфта =====
  const savingGuardRef = useRef(false);
  const savingGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedUpdatedAtRef = useRef<number>(draft?.engraving?.updatedAt || 0);

  const startSavingGuard = useCallback((ms = 400) => {
    savingGuardRef.current = true;
    if (savingGuardTimerRef.current) clearTimeout(savingGuardTimerRef.current);
    savingGuardTimerRef.current = setTimeout(() => {
      savingGuardRef.current = false;
      savingGuardTimerRef.current = null;
    }, ms);
  }, []);

  // Слушаем обновления драфта (другие вкладки/окна) — MERGE, не replace
  useEffect(() => {
    const onDraftUpdated = () => {
      if (savingGuardRef.current) return; // игнорируем собственное сохранение
      const cur = loadOrderDraft();
      setDraft(cur);
      const remoteAt = Number(cur?.engraving?.updatedAt || 0);
      if (remoteAt && remoteAt <= lastAppliedUpdatedAtRef.current) return; // уже применяли или старее

      const next = draftPersonsToLocal(cur.engraving?.persons as any);
      const ori = (cur?.size?.orientation as "horizontal" | "vertical") || orientation;
      if (ori !== orientation) setOrientation(ori);

      if (next && next.length) {
        // Вместо полного replace — слияние по id (не удаляем текущих, если драфт усечён)
        setPersons((prev) => mergePersonsById(prev, next));
      }
      lastAppliedUpdatedAtRef.current = remoteAt || lastAppliedUpdatedAtRef.current;
    };

    window.addEventListener(DRAFT_UPDATED_EVENT, onDraftUpdated as any);
    window.addEventListener("storage", onDraftUpdated);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onDraftUpdated as any);
      window.removeEventListener("storage", onDraftUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation]);

  // Сохранение в драфт при изменениях
  const prevPersonsJsonRef = useRef<string>("");
  useEffect(() => {
    const norm = normalizePersonsForSave(persons);
    const nextJson = JSON.stringify(norm);
    if (nextJson !== prevPersonsJsonRef.current) {
      prevPersonsJsonRef.current = nextJson;
      const prev = loadOrderDraft();
      const updatedAt = Date.now();
      lastAppliedUpdatedAtRef.current = updatedAt;
      startSavingGuard(450);
      saveOrderDraft({ ...prev, item: prev.item || item || null, engraving: { ...(prev.engraving || {}), persons: norm, updatedAt } });
      onSaveDraft?.({ persons: norm });
    }
  }, [persons, item, onSaveDraft, startSavingGuard]);

  // CRUD
  const updatePerson = (idx: number, patch: Partial<Person>) =>
    setPersons((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const removePerson = (idx: number) =>
    setPersons((prev) => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, id: p.id || `p-${i}` })));
  const addPerson = () =>
    setPersons((prev) =>
      prev.concat([{ id: `p-${Date.now()}`, lastName: "", firstName: "", middleName: "", birthDate: "", deathDate: "", photoUrl: null, photoDataUrl: null }])
    );

  /* ===== Фото по ID + защита от гонок + ObjectURL => dataURL ===== */
  const photoSeqByIdRef = useRef<Record<string, number>>({}); // id -> последний seq

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("read error"));
      reader.readAsDataURL(file);
    });

  const isBlobUrl = (url?: string | null) => !!url && url.startsWith("blob:");

  const setPersonPhotoById = (personId: string, pv: PhotoValue | null) => {
    const nextSeq = (photoSeqByIdRef.current[personId] || 0) + 1;
    photoSeqByIdRef.current[personId] = nextSeq;

    const commit = (patch: Partial<Person>) => {
      if (photoSeqByIdRef.current[personId] !== nextSeq) return; // устаревший результат
      setPersons((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
    };

    if (!pv) {
      commit({ photoUrl: null, photoDataUrl: null });
      return;
    }

    if (pv.dataUrl) {
      commit({ photoDataUrl: pv.dataUrl, photoUrl: pv.url || pv.dataUrl });
      return;
    }

    // @ts-ignore (допускаем file в PhotoValue)
    const maybeFile: File | undefined = (pv as any)?.file;
    if (maybeFile instanceof File) {
      const tempUrl = URL.createObjectURL(maybeFile);
      commit({ photoUrl: tempUrl, photoDataUrl: null });
      fileToDataUrl(maybeFile)
        .then((d) => {
          URL.revokeObjectURL(tempUrl);
          commit({ photoDataUrl: d, photoUrl: pv.url || d });
        })
        .catch(() => {
          URL.revokeObjectURL(tempUrl);
          commit({ photoUrl: pv.url || null, photoDataUrl: null });
        });
      return;
    }

    if (pv.url) {
      commit({ photoUrl: pv.url, photoDataUrl: null });
      if (isBlobUrl(pv.url)) {
        fetch(pv.url)
          .then((res) => res.blob())
          .then((blob) => fileToDataUrl(new File([blob], "photo", { type: blob.type || "image/*" })))
          .then((d) => commit({ photoDataUrl: d }))
          .catch(() => {});
      }
      return;
    }
  };

  // Навигация / скролл
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(56);
  useLayoutEffect(() => {
    const measure = () => setNavH(navRef.current?.getBoundingClientRect().height || 0);
    measure();
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const formRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollToForm = (id: string) => {
    const el = formRefs.current[id]; if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - (navH + 10)), behavior: "smooth" });
  };
  const previewRef = useRef<HTMLElement | null>(null);
  const scrollToPreview = () => {
    const el = previewRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + r.top - (navH + 10)), behavior: "smooth" });
  };

  // Сохранить перед уходом
  const saveBeforeLeave = () => {
    const prev = loadOrderDraft();
    const personsNorm = normalizePersonsForSave(persons);
    const updatedAt = Date.now();
    lastAppliedUpdatedAtRef.current = updatedAt;
    startSavingGuard(450);
    saveOrderDraft({ ...prev, item: prev.item || item || null, engraving: { ...(prev.engraving || {}), persons: personsNorm, updatedAt } });
    onSaveDraft?.({ persons: personsNorm });
  };

  // ===== Растрирование эскиза при «Продолжить» =====
  const [isRendering, setIsRendering] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const rasterizeSketch = useCallback(async (): Promise<string | null> => {
    try {
      const cont = containerRef.current;
      const bgImgEl = imgRef.current;
      if (!cont || !bgImgEl || !bgImgEl.naturalWidth || !bgImgEl.naturalHeight) return null;

      const pad = 16;
      const cw = cont.clientWidth;
      const W = Math.max(200, cw - pad);
      const H = Math.round((W * bgImgEl.naturalHeight) / bgImgEl.naturalWidth);
      const outW = W;
      const outH = H;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round((outW + pad) * dpr);
      canvas.height = Math.round((outH + pad) * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.scale(dpr, dpr);

      const grd = ctx.createLinearGradient(0, 0, 0, outH + pad);
      grd.addColorStop(0, "#6e6e6e");
      grd.addColorStop(0.2, "#464545");
      grd.addColorStop(0.4, "#424242");
      grd.addColorStop(0.7, "#888");
      grd.addColorStop(1, "#ffffff");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, outW + pad, outH + pad);

      const loadImg = (src?: string | null) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          if (!src) return resolve(null);
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.decoding = "async";
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = src;
        });

      const bg = await loadImg(item?.url || bgImgEl.src);
      if (bg) ctx.drawImage(bg, pad / 2, pad / 2, outW, outH);
      else {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(pad / 2, pad / 2, outW, outH);
      }

      const n = peopleBlocks.length;
      if (n > 0) {
        const gap = Math.max(8, W * 0.02);
        const cellW = (outW - gap * (n - 1)) / n;
        const cellX = (i: number) => pad / 2 + i * (cellW + gap);
        const midY = pad / 2 + outH * 0.5;

        for (let i = 0; i < n; i++) {
          const mb = peopleBlocks[i];
          const cx = cellX(i);

          const pW = Math.min(cellW * 0.8, 260);
          const pH = pW * (4 / 3);
          const pX = cx + (cellW - pW) / 2;
          const pY = midY - pH * 0.7;

          const pImg = await loadImg(mb.photo || undefined);
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(pX, pY, pW, pH);
          if (pImg) {
            const scale = Math.max(pW / pImg.naturalWidth, pH / pImg.naturalHeight);
            const drawW = pImg.naturalWidth * scale;
            const drawH = pImg.naturalHeight * scale;
            const dx = pX + (pW - drawW) / 2;
            const dy = pY + (pH - drawH) / 2;
            ctx.drawImage(pImg, dx, dy, drawW, drawH);
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.font = "700 12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("нет фото", pX + pW / 2, pY + pH / 2);
          }

          const metrW = Math.min(cellW * 0.9, 300);
          const metrX = cx + (cellW - metrW) / 2;
          const metrY = pY + pH + Math.max(6, outH * 0.02);
          const met = rasterizeMetric(mb.lines, metrW);
          if (met?.url) {
            const mImg = await loadImg(met.url);
            if (mImg) {
              const baseW = mImg.naturalWidth / (window.devicePixelRatio || 1);
              const baseH = mImg.naturalHeight / (window.devicePixelRatio || 1);
              const ratio = metrW / (baseW || metrW);
              ctx.drawImage(mImg, metrX, metrY, metrW, (baseH || 40) * ratio);
            }
          }
        }
      }

      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }, [peopleBlocks, item]);

  const handleBack = () => { saveBeforeLeave(); setOutro(true); setTimeout(() => onBack?.(), 250); };
  const handleContinue = async () => {
    if (!canContinue) return;
    saveBeforeLeave();
    setIsRendering(true);
    const dataUrl = await rasterizeSketch();
    setIsRendering(false);
    setOutro(true);
    setTimeout(() => onDone?.({ persons, sketchDataUrl: dataUrl || null }), 250);
  };

  /* ===== Sketch layout (высота) ===== */
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [sketchH, setSketchH] = useState<number>(540);

  const recalcSketchHeight = useCallback(() => {
    const cont = containerRef.current;
    if (!cont || !imgNatural.w || !imgNatural.h) return;
    const pad = 16;
    const cw = cont.clientWidth;
    const contentW = Math.max(0, cw - pad);
    const imgHeight = contentW > 0 ? (contentW * imgNatural.h) / imgNatural.w : 0;
    setSketchH(Math.max(200, Math.round(imgHeight + pad)));
  }, [imgNatural]);

  useEffect(() => {
    const onResize = () => recalcSketchHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recalcSketchHeight]);

  /* ===== Horizontal (columns + raster metrics) ===== */
  const columnsLayerRef = useRef<HTMLDivElement | null>(null);
  const [colWpx, setColWpx] = useState(200);
  const [colHpx, setColHpx] = useState(200);
  const GAP = 12;

  const recomputeCols = useCallback(() => {
    const el = columnsLayerRef.current;
    if (!el) return;
    const totalW = el.clientWidth;
    const totalH = el.clientHeight;
    const n = Math.max(1, peopleBlocks.length);
    const usedCols = n;
    const totalGaps = (usedCols - 1) * GAP;
    const cw = Math.floor((totalW - totalGaps) / usedCols);
    setColWpx(Math.max(120, cw));
    setColHpx(Math.max(120, totalH));
  }, [peopleBlocks.length]);

  const [metricImgs, setMetricImgs] = useState<Record<string, MetricImage>>({});
  useEffect(() => {
    if (orientation !== "horizontal") {
      setMetricImgs({});
      return;
    }
    const target = Math.round(colWpx * 0.9);
    const next: Record<string, MetricImage> = {};
    peopleBlocks.forEach((p) => (next[p.id] = rasterizeMetric(p.lines, Math.max(140, target))));
    setMetricImgs(next);
  }, [peopleBlocks, colWpx, orientation]);

  const computedScale = useMemo(() => {
    if (orientation !== "horizontal") return {};
    const portraitBaseW = colWpx * 0.8;
    const portraitBaseH = portraitBaseW * (4 / 3);
    const gap = 6;
    const scales: Record<string, number> = {};
    peopleBlocks.forEach((p) => {
      const mi = metricImgs[p.id];
      const metricBaseW = colWpx * 0.9;
      const metricH = mi?.h && mi?.w ? (mi.h * (metricBaseW / mi.w)) : portraitBaseW * 0.4;
      const total = portraitBaseH + gap + metricH;
      const avail = colHpx - 8;
      const s = total > 0 ? Math.min(1, avail / total) : 1;
      scales[p.id] = Math.max(0.35, s);
    });
    return scales;
  }, [colWpx, colHpx, metricImgs, peopleBlocks, orientation]);

  const gridTemplateColumns = useMemo(() => {
    const n = Math.max(1, peopleBlocks.length);
    return `repeat(${n}, ${colWpx}px)`;
  }, [peopleBlocks.length, colWpx]);

  /* ===== Vertical (table layout for >1) ===== */
  const verticalLayerRef = useRef<HTMLDivElement | null>(null);
  const [rowHpx, setRowHpx] = useState(120);

  const recomputeVerticalRows = useCallback(() => {
    const el = verticalLayerRef.current;
    if (!el) return;
    const innerH = el.clientHeight;
    const n = Math.max(1, peopleBlocks.length);
    const rowH = Math.max(100, Math.floor(innerH / n));
    setRowHpx(rowH);
  }, [peopleBlocks.length]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (orientation === "horizontal") recomputeCols();
      else recomputeVerticalRows();
      recalcSketchHeight();
    });
    if (containerRef.current) ro.observe(containerRef.current);
    if (columnsLayerRef.current) ro.observe(columnsLayerRef.current);
    if (verticalLayerRef.current) ro.observe(verticalLayerRef.current);
    return () => ro.disconnect();
  }, [recomputeCols, recomputeVerticalRows, recalcSketchHeight, orientation]);

  useEffect(() => {
    if (orientation === "horizontal") recomputeCols();
    else recomputeVerticalRows();
    const t = setTimeout(() => {
      recalcSketchHeight();
      if (orientation === "horizontal") recomputeCols();
      else recomputeVerticalRows();
    }, 0);
    return () => clearTimeout(t);
  }, [recomputeCols, recomputeVerticalRows, recalcSketchHeight, peopleBlocks.length, orientation]);

  /* ===== MAX WIDTH LIMIT ===== */
  const MAX_W = 600;

  return (
    <div
      style={{
        color: "#fff",
        padding: 12,
        opacity: outro ? 0 : 1,
        transition: "opacity 240ms ease",
        backgroundImage: `url(/Memorial/data/bg.jpg)`,
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundAttachment: "fixed"
      }}
    >
      <div style={{ width: "100%", maxWidth: MAX_W, margin: "0 auto" }}>
        <TopBarWithIntro title="Memorial" />

        {/* Навигация с пунктирной рамкой — не изменять */}
        <div
          ref={navRef}
          style={{
            position: "sticky",
            top: 2,
            zIndex: 50,
            paddingTop: "env(safe-area-inset-top)",
            background: "rgba(0,0,0,0.96)",
            borderRadius: 12,
            border: "1px dashed rgba(255, 255, 255)",
            marginBottom: 10
          }}
        >
          <div style={{ display: "flex", gap: 6, padding: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
            {persons.map((p, i) => {
              const name = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
              return (
                <button key={`${p.id}-${i}`} onClick={() => scrollToForm(p.id)} style={glassButtonStyle("nano")} title={name}>
                  {name}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <button onClick={scrollToPreview} style={glassButtonStyle("nano")}>Эскиз</button>
          </div>
        </div>

        {/* Список персон (аккордеон) */}
        <section>
          <h2 style={{ margin: "0 0 8px 0", textAlign: "left" }}>Информация об усопших</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {persons.map((p, idx) => {
              const id = p.id;
              const isOpen = openMap[id] ?? true;
              const err = validateDates(p.birthDate, p.deathDate);
              const nameLeft = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
              return (
                <div key={`${id}-${idx}`} ref={(el) => (formRefs.current[id] = el)} style={{ ...glassPanelStyle(), padding: 0 }}>
                  <div
                    onClick={() => setOpenMap((prev) => ({ ...prev, [id]: !isOpen }))}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "rgba(0,0,0,0.66)", borderRadius: "12px 12px 0 0", cursor: "pointer" }}
                  >
                    <span style={{ opacity: 0.9 }}>{idx + 1} -</span>
                    <div style={{ fontSize: 16, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameLeft}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPersons((prev) =>
                            idx === 0 ? prev : prev.map((x, i) => (i === idx - 1 ? prev[idx] : i === idx ? prev[idx - 1] : x))
                          );
                        }}
                        disabled={idx === 0}
                        style={{ ...iconBtn(), opacity: idx === 0 ? 0.4 : 1 }}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPersons((prev) =>
                            idx === prev.length - 1 ? prev : prev.map((x, i) => (i === idx ? prev[idx + 1] : i === idx + 1 ? prev[idx] : x))
                          );
                        }}
                        disabled={idx === persons.length - 1}
                        style={{ ...iconBtn(), opacity: idx === persons.length - 1 ? 0.4 : 1 }}
                      >
                        ▼
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removePerson(idx); }} style={iconBtn()}>
                        ✖
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                          <Field label="Фамилия"><input value={p.lastName || ""} onChange={(e) => updatePerson(idx, { lastName: e.target.value })} style={inputStyle()} placeholder="Иванов" /></Field>
                          <Field label="Имя"><input value={p.firstName || ""} onChange={(e) => updatePerson(idx, { firstName: e.target.value })} style={inputStyle()} placeholder="Иван" /></Field>
                          <Field label="Отчество"><input value={p.middleName || ""} onChange={(e) => updatePerson(idx, { middleName: e.target.value })} style={inputStyle()} placeholder="Иванович" /></Field>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                          <Field label="Дата рождения">
                            <input value={p.birthDate || ""} onChange={(e) => updatePerson(idx, { birthDate: e.target.value })} style={{ ...inputStyle(), borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)" }} placeholder="01.01.1950" />
                          </Field>
                          <Field label="Дата смерти">
                            <input value={p.deathDate || ""} onChange={(e) => updatePerson(idx, { deathDate: e.target.value })} style={{ ...inputStyle(), borderColor: err && (err.includes("смерти") || err.includes("раньше")) ? "salmon" : "rgba(255,255,255,0.18)" }} placeholder="01.01.2024" />
                          </Field>
                          {err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}
                        </div>
                        <PhotoField
                          label="Фотография"
                          value={{ url: p.photoUrl || undefined, dataUrl: p.photoDataUrl || undefined }}
                          onChange={(pv) => setPersonPhotoById(p.id, pv)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={addPerson} style={glassButtonStyle("sm")}>Добавить ещё</button>
          </div>
        </section>

        {/* Эскиз */}
        <section ref={previewRef} style={{ ...glassPanelStyle(), padding: 10, margin: "10px 0" }}>
          <p style={{ margin: "0 0 8px 0", textAlign: "center", fontWeight: 200 }}>
            <em>Набросок расположения элементов гравировки. <br />Изменить можно позже.</em>
          </p>

          <div
            ref={containerRef}
            style={{
              ...bottomUnderlayGradient(),
              borderRadius: 10,
              position: "relative",
              width: "100%",
              height: sketchH,
              overflow: "hidden",
              userSelect: "none",
              padding: 8,
              boxSizing: "border-box",
              color: "#fff"
            }}
          >
            <img
              ref={imgRef}
              src={item?.url || ""}
              alt={item?.name || "Изделие"}
              style={{ display: "block", width: "100%", height: "auto", objectFit: "contain", borderRadius: 8 }}
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                setImgNatural({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 });
                if (!initialOri) setOrientation(im.naturalWidth > im.naturalHeight ? "horizontal" : "vertical");
                setTimeout(() => {
                  recalcSketchHeight();
                  if (orientation === "horizontal") recomputeCols();
                  else recomputeVerticalRows();
                }, 0);
              }}
            />

            {/* Горизонтальный шаблон */}
            {peopleBlocks.length > 0 && orientation === "horizontal" && (
              <div
                ref={columnsLayerRef}
                style={{
                  position: "absolute",
                  inset: 8,
                  display: "grid",
                  gridTemplateColumns,
                  justifyContent: "center",
                  alignItems: "center",
                  gap: GAP,
                  height: `calc(100% - 16px)`,
                  pointerEvents: "none"
                }}
              >
                {peopleBlocks.map((mb, idx) => {
                  const scale = (computedScale as any)[mb.id] ?? 1;
                  const pW = Math.round(colWpx * 0.8 * scale);
                  const metric = metricImgs[mb.id];
                  const mW = Math.round(colWpx * 0.9 * scale);
                  const mH = metric?.w && metric?.h ? Math.round(metric.h * (mW / metric.w)) : undefined;
                  return (
                    <div
                      key={`${mb.id}-${idx}`}
                      style={{
                        justifySelf: "center",
                        width: colWpx,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8
                      }}
                    >
                      <div style={{ width: pW, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.35)", background: "rgba(255,255,255,0.04)" }}>
                        {mb.photo ? (
                          <img src={mb.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                        )}
                      </div>
                      <div style={{ width: mW, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {metric?.url ? (
                          <img src={metric.url} alt="Метрика" style={{ width: mW, height: mH, objectFit: "contain", display: "block" }} draggable={false} />
                        ) : (
                          <div style={{ width: mW, aspectRatio: "5/1", display: "grid", placeItems: "center", opacity: 0.6 }}>...</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Вертикальный шаблон */}
            {peopleBlocks.length > 0 && orientation === "vertical" && (
              <>
                {peopleBlocks.length === 1 ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 16,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none"
                    }}
                  >
                    <div style={{ position: "relative", top: "-6%", width: "80%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                      <div style={{ width: "70%", maxWidth: 400, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.35)", background: "rgba(255,255,255,0.04)" }}>
                        {peopleBlocks[0].photo ? (
                          <img src={peopleBlocks[0].photo as string} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                        )}
                      </div>
                      <div style={{ width: "100%", display: "grid", gap: 6, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                        {peopleBlocks[0].lines[0] && <div style={{ fontSize: "clamp(20px, 4vw, 32px)", fontWeight: 700, lineHeight: 1.15 }}>{peopleBlocks[0].lines[0]}</div>}
                        {peopleBlocks[0].lines[1] && <div style={{ fontSize: "clamp(18px, 3.4vw, 26px)", fontWeight: 500, lineHeight: 1.15 }}>{peopleBlocks[0].lines[1]}</div>}
                        {peopleBlocks[0].lines[2] && <div style={{ fontSize: "clamp(16px, 3vw, 22px)", fontWeight: 400, opacity: 0.95, lineHeight: 1.15 }}>{peopleBlocks[0].lines[2]}</div>}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      inset: 16,
                      display: "grid",
                      gridTemplateRows: `repeat(${peopleBlocks.length}, 120px)`,
                      rowGap: 10,
                      height: `calc(100% - 32px)`,
                      alignContent: "center",
                      pointerEvents: "none"
                    }}
                  >
                    {peopleBlocks.map((mb, i) => (
                      <div
                        key={`${mb.id}-${i}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          columnGap: 12,
                          padding: "6px 8px",
                          boxSizing: "border-box",
                          alignItems: "center"
                        }}
                      >
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div
                            style={{
                              height: "70%",
                              aspectRatio: "3 / 4",
                              borderRadius: 4,
                              overflow: "hidden",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
                              background: "rgba(255,255,255,0.04)"
                            }}
                          >
                            {mb.photo ? (
                              <img src={mb.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                            )}
                          </div>
                        </div>
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div
                            style={{
                              width: "90%",
                              maxWidth: "90%",
                              textAlign: "center",
                              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                              display: "grid",
                              gap: 6
                            }}
                          >
                            {mb.lines[0] && <div style={{ fontSize: "clamp(18px, 3.2vw, 26px)", fontWeight: 700, lineHeight: 1.12 }}>{mb.lines[0]}</div>}
                            {mb.lines[1] && <div style={{ fontSize: "clamp(16px, 2.8vw, 22px)", fontWeight: 500, lineHeight: 1.12 }}>{mb.lines[1]}</div>}
                            {mb.lines[2] && <div style={{ fontSize: "clamp(14px, 2.4vw, 18px)", fontWeight: 400, opacity: 0.95, lineHeight: 1.12 }}>{mb.lines[2]}</div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
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
