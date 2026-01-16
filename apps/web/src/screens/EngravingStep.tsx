// src/screens/EngravingStep.tsx
// Шаг «Информация об усопших» (без редактора).
//
// Требования:
// - Тяжёлые фото сжимаются до «безопасного» размера перед сохранением (локально через canvas).
// - Драфт НЕ обновляем «на лету» при каждом вводе. Сохраняем ТОЛЬКО:
//     • по «Назад» / «Продолжить»,
//     • при размонтировании компонента,
//     • при beforeunload / pagehide / visibilitychange (уход со страницы),
//     • при hashchange / popstate (переход между шагами).
// - При внешней очистке/изменении драфта (TopBar) — подтягиваем новые данные, сбрасываем локальные.
//
// Навигация:
// - Внутренняя панель — липкая (sticky).
//
// Предпросмотр:
// - Общий SketchTemplate; эпитафии из драфта/initial.
// - carvingOpacity управляет прозрачноcтью «резной» подложки.

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
  photoUrl?: string | null;     // для превью (может быть внешний URL или blob:)
  photoDataUrl?: string | null; // сжатый dataURL (готовим к отправке/ресайзу)
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
function personsEqual(a: Person[], b: Person[]): boolean {
  const na = normalizePersonsForSave(a);
  const nb = normalizePersonsForSave(b);
  return JSON.stringify(na) === JSON.stringify(nb);
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

/* ===== Локальный компрессор изображений (canvas) ===== */
const PHOTO_TARGET_MAX_BYTES = Math.floor(2.7 * 1024 * 1024); // ≈2.7 MiB
const MAX_DIM = 2200; // длинная сторона в пикселях
const QUALITY_START = 0.9;
const QUALITY_MIN = 0.55;
const QUALITY_STEP = 0.08;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.readAsDataURL(blob);
  });
}
async function loadImageFromFileOrBlob(src: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(src);
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
async function compressImageFileToMaxBytes(file: File, maxBytes = PHOTO_TARGET_MAX_BYTES): Promise<Blob> {
  const img = await loadImageFromFileOrBlob(file);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const r = iw / ih;

  let tw = iw, th = ih;
  if (Math.max(iw, ih) > MAX_DIM) {
    if (r >= 1) { tw = MAX_DIM; th = Math.round(MAX_DIM / r); }
    else { th = MAX_DIM; tw = Math.round(MAX_DIM * r); }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(tw));
  canvas.height = Math.max(1, Math.round(th));
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let q = QUALITY_START;
  let out: Blob = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
  if (out.size <= maxBytes) return out;

  while (q > QUALITY_MIN && out.size > maxBytes) {
    q = Math.max(QUALITY_MIN, q - QUALITY_STEP);
    out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
  }
  if (out.size <= maxBytes) return out;

  // Доп. уменьшение геометрии, если всё ещё велик
  let scale = 0.9;
  for (let i = 0; i < 4 && out.size > maxBytes; i++) {
    const nw = Math.max(1, Math.round(canvas.width * scale));
    const nh = Math.max(1, Math.round(canvas.height * scale));
    const c2 = document.createElement("canvas");
    c2.width = nw; c2.height = nh;
    const x2 = c2.getContext("2d");
    if (!x2) break;
    x2.drawImage(canvas, 0, 0, nw, nh);

    // заменяем исходный canvas, пробуем снова
    canvas.width = nw; canvas.height = nh;
    ctx.clearRect(0, 0, nw, nh);
    ctx.drawImage(c2, 0, 0);

    q = QUALITY_START;
    out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
    while (q > QUALITY_MIN && out.size > maxBytes) {
      q = Math.max(QUALITY_MIN, q - QUALITY_STEP);
      out = await new Promise((res) => c2.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
    }
    scale *= 0.9;
  }

  return out;
}

/* ===== Component ===== */
type Props = {
  item: any;
  sizeResult?: any;
  initial?:
    | {
        persons?: Person[];
        epitaphs?: string[];
        epitaphText?: string;
        [k: string]: any;
      }
    | null;
  onBack?: () => void;
  onSaveDraft?: (data: any) => void;
  onDone?: (data: any) => void;
};

export default function EngravingStep({
  item,
  sizeResult,
  initial,
  onBack,
  onSaveDraft,
  onDone
}: Props) {
  const [outro, setOutro] = useState(false);

  // Живой драфт (подписка)
  const [orderDraft, setOrderDraft] = useState<OrderDraft>(() => loadOrderDraft());
  const draftRef = useRef<OrderDraft>(orderDraft);
  useEffect(() => { draftRef.current = orderDraft; }, [orderDraft]);

  // Инициализация людей
  const initialPersons = useMemo(
    () => draftPersonsToLocal(orderDraft?.engraving?.persons as any) || [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [persons, setPersons] = useState<Person[]>(
    initialPersons.length
      ? initialPersons
      : Array.isArray(initial?.persons) && initial!.persons!.length
      ? initial!.persons!.map((p: any, i: number) => ({ id: p.id || `p-${i}`, ...p }))
      : [makeBlankPerson("p-0")]
  );

  // Транзиентные превью (blob:)
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

  // Элементы предпросмотра
  const peopleBlocks = useMemo(
    () => persons.map((p) => {
      const t = transientPhotoUrlById[p.id];
      const stable = p.photoDataUrl ?? p.photoUrl ?? null;
      return { id: p.id, lines: linesFromPerson(p), photo: t ?? stable };
    }),
    [persons, transientPhotoUrlById]
  );

  // Валидация дат
  const dateErrors = useMemo(() => {
    const errs: Record<string, string | null> = {};
    persons.forEach((p) => (errs[p.id] = validateDates(p.birthDate, p.deathDate)));
    return errs;
  }, [persons]);
  const canContinue = useMemo(() => Object.values(dateErrors).every((e) => !e), [dateErrors]);

  // Состояние аккордеонов
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

  /* ===== Фото: сжатие перед сохранением ===== */
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

    // Очистка
    if (!pv) {
      setTransientFor(personId, null);
      commitLocal({ photoUrl: null, photoDataUrl: null });
      return;
    }

    // dataUrl
    if ((pv as any)?.dataUrl) {
      const dataUrl">▼</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removePerson(idx); }} style={iconBtn()} title="Удалить">✖</button>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                          <Field label="Фамилия"><input value={p.lastName ?? ""} onChange={(e) => updatePerson(idx, { lastName: e.target.value })} style={inputStyleField()} placeholder="Иванов" /></Field>
                          <Field label="Имя"><input value={p.firstName ?? ""} onChange={(e) => updatePerson(idx, { firstName: e.target.value })} style={inputStyleField()} placeholder="Иван" /></Field>
                          <Field label="Отчество"><input value={p.middleName ?? ""} onChange={(e) => updatePerson(idx, { middleName: e.target.value })} style={inputStyleField()} placeholder="Иванович" /></Field>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                          <Field label="Дата рождения">
                            <input value={p.birthDate ?? ""} onChange={(e) => updatePerson(idx, { birthDate: e.target.value })} style={{ ...inputStyleField(), borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)" }} placeholder="01.01.1950" />
                          </Field>
                          <Field label="Дата смерти">
                            <input value={p.deathDate ?? ""} onChange={(e) => updatePerson(idx, { deathDate: e.target.value })} style={{ ...inputStyleField(), borderColor: err && (err.includes("смерти") || err.includes("раньше")) ? "salmon" : "rgba(255,255,255,0.18)" }} placeholder="01.01.2024" />
                          </Field>
                          {!!err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}
                        </div>

                        {/* Фото */}
                        <div>
                          {!hasPhoto && (
                            <div style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, opacity: 0.92 }}>
                              Прикрепите фотографию. Мы автоматически уменьшим её размер.
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
            <button type="button" onClick={addPerson} style={glassButtonStyle("sm")}>Добавить</button>
          </div>
        </section>

        {/* Пояснение */}
        <div style={{ color: "#fff", opacity: 0.9, fontSize: 15, lineHeight: 1.25, margin: "6px 0 8px", textAlign: "center", fontWeight: 400 }}>
          Это визуализация состава заказа; не является макетом для гравировки. Возможны наложения объектов. Макет подготовит специалист.
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
function inputStyleField(): React.CSSProperties {
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
