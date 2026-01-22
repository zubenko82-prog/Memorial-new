// src/screens/BackEditorStep.tsx
//
// Шаг «Тыл»
//
// Изменения по задаче:
// 1) "Дополнительно" по умолчанию:
//    - Тумба: ВКЛ
//    - Цветник: ВКЛ
//    - Ваза: ВЫКЛ
// 2) Если выключен чекбокс блока (Тыльная сторона / Надгробная плита):
//    - содержимое НЕ показываем,
//    - НЕ учитываем ранее выбранное (очищаем из draft соответствующие поля),
//    - превью тоже очищаем.
// 3) Выбор должен сохраняться даже если внутренние аккордеоны не открываются.
//    Поэтому мы не завязываемся на "открыт/закрыт": состояние хранится в draft,
//    а локальные state синхронизируем с draft.
// 4) Внутри блоков не показываем каталоги выбора эпитафий/графики — оставляем ТОЛЬКО "Выбрано" (красная рамка).
// 5) Аккордеон "Усопшие" — ТОЛЬКО для тыльной стороны. В надгробной плите его нет.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import PhotoField, { type PhotoValue } from "../components/PhotoField";
import { fetchCatalog } from "../api";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT, type OrderDraft } from "../lib/order";

/* ========= Styles ========= */
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.95)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  };
}
function sectionBoxStyle(): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: 10
  };
}
function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    boxSizing: "border-box"
  };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const pad = size === "nano" ? "6px 10px" : size === "sm" ? "10px 14px" : "12px 18px";
  return {
    padding: pad,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}

function dispatchDraftUpdated() {
  try {
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
  } catch {}
}

function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box"
      }}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }}
        />
      ) : (
        <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>
      )}
    </div>
  );
}

/* ========= Accordion ========= */
function LoudAccordion({
  title,
  open,
  onToggle,
  children
}: {
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const m = () => setH(ref.current?.scrollHeight || 0);
    m();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(m) : null;
    if (ref.current && ro) ro.observe(ref.current);
    return () => ro?.disconnect?.();
  }, [children]);

  return (
    <div style={{ ...glassPanelStyle(), padding: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          background: "rgba(255,255,255,0.06)",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 15,
          fontWeight: 700
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ========= Helpers ========= */
const normEpitaph = (t: string) =>
  (t || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

function indexOfByNorm(list: string[], needle: string): number {
  const n = normEpitaph(needle);
  for (let i = 0; i < list.length; i++) {
    if (normEpitaph(list[i]) === n) return i;
  }
  return -1;
}
function uniqueByNorm(list: string[]): string[] {
  const out: string[] = [];
  for (const t of list) {
    const n = normEpitaph(t);
    if (!n) continue;
    if (out.some((x) => normEpitaph(x) === n)) continue;
    out.push(t);
  }
  return out;
}

/* ========= People (rear) types & helpers ========= */
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
function parseFlexibleDate(input?: string): Date | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/\d+/g);
  if (!m || m.length < 3) return null;
  const d = +m[0],
    mo = +m[1],
    y = +m[2];
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

/* ===== Image compression (safe localStorage) ===== */
const DRAFT_IMG_MAX_BYTES = 600 * 1024; // 600 KiB
const DRAFT_IMG_MAX_DIM = 1600;
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

  let tw = iw,
    th = ih;
  if (Math.max(iw, ih) > DRAFT_IMG_MAX_DIM) {
    if (r >= 1) {
      tw = DRAFT_IMG_MAX_DIM;
      th = Math.round(DRAFT_IMG_MAX_DIM / r);
    } else {
      th = DRAFT_IMG_MAX_DIM;
      tw = Math.round(DRAFT_IMG_MAX_DIM * r);
    }
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

  let scale = 0.9;
  for (let i = 0; i < 4 && out.size > maxBytes; i++) {
    const nw = Math.max(1, Math.round(canvas.width * scale));
    const nh = Math.max(1, Math.round(canvas.height * scale));
    const c2 = document.createElement("canvas");
    c2.width = nw;
    c2.height = nh;
    const x2 = c2.getContext("2d");
    if (!x2) break;
    x2.drawImage(canvas, 0, 0, nw, nh);
    canvas.width = nw;
    canvas.height = nh;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, width: "100%", boxSizing: "border-box" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
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

/* ========= Chosen view helpers ========= */
function uniqMetaByIds(ids: string[], meta: Record<string, any>) {
  const uniq = Array.from(new Set(ids));
  return uniq.map((gid) => meta[gid] || { id: gid, name: gid, url: "" });
}

/* ========= Block (only "Выбрано") ========= */
function SelectedOnlyBlock(props: {
  title: string;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;

  // selected graphics
  chosenList: any[];
  onRemoveChosenItem: (gid: string) => void;

  // selected epitaphs
  epitaphList: string[];
  onRemoveEpitaph: (t: string) => void;

  // people (rear only)
  showPeople?: boolean;
  people?: Person[];
  setPeople?: (v: Person[] | ((p: Person[]) => Person[])) => void;
  transientPhotoUrlById?: Record<string, string | null>;
  setPersonPhotoById?: (personId: string, pv: PhotoValue | null) => void;
}) {
  const {
    title,
    enabled,
    onToggleEnabled,
    chosenList,
    onRemoveChosenItem,
    epitaphList,
    onRemoveEpitaph,
    showPeople,
    people,
    setPeople,
    transientPhotoUrlById,
    setPersonPhotoById
  } = props;

  const [accPeopleOpen, setAccPeopleOpen] = useState(false);

  const blockTitle = (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggleEnabled(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      <span>{title}</span>
    </label>
  );

  // People CRUD (only if showPeople)
  const updatePerson = (idx: number, patch: Partial<Person>) => setPeople?.((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const removePerson = (idx: number) =>
    setPeople?.((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [makeBlankPerson("p-0")];
    });
  const addPerson = () => setPeople?.((prev) => prev.concat([makeBlankPerson()]));
  const moveUp = (idx: number) =>
    setPeople?.((prev) => (idx === 0 ? prev : prev.map((x, i) => (i === idx - 1 ? prev[idx] : i === idx ? prev[idx - 1] : x))));
  const moveDown = (idx: number) =>
    setPeople?.((prev) =>
      idx === prev.length - 1 ? prev : prev.map((x, i) => (i === idx ? prev[idx + 1] : i === idx + 1 ? prev[idx] : x))
    );

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((people || []).map((p) => [p.id, true]))
  );
  useEffect(() => {
    if (!people) return;
    setOpenMap((prev) => {
      const next: Record<string, boolean> = {};
      people.forEach((p) => (next[p.id] = prev[p.id] ?? true));
      return next;
    });
  }, [people]);

  return (
    <LoudAccordion title={blockTitle} open={enabled} onToggle={() => onToggleEnabled(!enabled)}>
      {enabled && (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Выбрано (красная рамка) */}
          <div style={{ ...sectionBoxStyle(), border: "1px solid rgba(255,80,80,0.95)" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано</div>

            {chosenList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: epitaphList.length ? 8 : 0 }}>
                {chosenList.map((g, i) => {
                  const gid = String(g.id || g.url || i);
                  return (
                    <div
                      key={`chosen-${gid}-${i}`}
                      style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}
                    >
                      <Thumb url={g.url} />
                      <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.name || g.id}
                      </div>
                      <button
                        type="button"
                        title="Удалить"
                        onClick={() => onRemoveChosenItem(String(g.id || g.name || g.url || ""))}
                        style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {epitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {epitaphList.map((t, idx) => (
                  <div
                    key={`ep-preview-${idx}-${normEpitaph(t)}`}
                    style={{
                      ...sectionBoxStyle(),
                      padding: 8,
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      alignItems: "start"
                    }}
                  >
                    <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    <button
                      type="button"
                      title="Удалить эпитафию"
                      onClick={() => onRemoveEpitaph(t)}
                      style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {chosenList.length === 0 && epitaphList.length === 0 && <div style={{ opacity: 0.85 }}>Пока ничего не выбрано.</div>}
          </div>

          {/* Усопшие (ТОЛЬКО для тыла) */}
          {showPeople && people && setPeople && transientPhotoUrlById && setPersonPhotoById && (
            <LoudAccordion title="Усопшие" open={accPeopleOpen} onToggle={() => setAccPeopleOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {people.map((p, idx) => {
                    const id = p.id;
                    const isOpen = openMap[id] ?? true;
                    const err = validateDates(p.birthDate, p.deathDate);
                    const nameLeft = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
                    const hasPhoto = !!(transientPhotoUrlById[p.id] || p.photoDataUrl || p.photoUrl);

                    return (
                      <div key={id} style={{ ...glassPanelStyle(), padding: 0 }}>
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
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                          >
                            {nameLeft}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveUp(idx);
                              }}
                              disabled={idx === 0}
                              style={{ ...iconBtn(), opacity: idx === 0 ? 0.4 : 1 }}
                              title="Выше"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveDown(idx);
                              }}
                              disabled={idx === people.length - 1}
                              style={{ ...iconBtn(), opacity: idx === people.length - 1 ? 0.4 : 1 }}
                              title="Ниже"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removePerson(idx);
                              }}
                              style={iconBtn()}
                              title="Удалить"
                            >
                              ✖
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                            <div style={{ display: "grid", gap: 10 }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                                <Field label="Фамилия">
                                  <input
                                    value={p.lastName ?? ""}
                                    onChange={(e) => updatePerson?.(idx, { lastName: e.target.value })}
                                    style={inputStyle()}
                                    placeholder="Иванов"
                                  />
                                </Field>
                                <Field label="Имя">
                                  <input
                                    value={p.firstName ?? ""}
                                    onChange={(e) => updatePerson?.(idx, { firstName: e.target.value })}
                                    style={inputStyle()}
                                    placeholder="Иван"
                                  />
                                </Field>
                                <Field label="Отчество">
                                  <input
                                    value={p.middleName ?? ""}
                                    onChange={(e) => updatePerson?.(idx, { middleName: e.target.value })}
                                    style={inputStyle()}
                                    placeholder="Иванович"
                                  />
                                </Field>
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                                <Field label="Дата рождения">
                                  <input
                                    value={p.birthDate ?? ""}
                                    onChange={(e) => updatePerson?.(idx, { birthDate: e.target.value })}
                                    style={{
                                      ...inputStyle(),
                                      borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)"
                                    }}
                                    placeholder="01.01.1950"
                                  />
                                </Field>
                                <Field label="Дата смерти">
                                  <input
                                    value={p.deathDate ?? ""}
                                    onChange={(e) => updatePerson?.(idx, { deathDate: e.target.value })}
                                    style={{
                                      ...inputStyle(),
                                      borderColor:
                                        err && (err.includes("смерти") || err.includes("раньше"))
                                          ? "salmon"
                                          : "rgba(255,255,255,0.18)"
                                    }}
                                    placeholder="01.01.2024"
                                  />
                                </Field>
                                {!!err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}
                              </div>

                              <div>
                                {!hasPhoto && (
                                  <div style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, opacity: 0.92 }}>
                                    Прикрепите фотографию. Она сохранится в заявке.
                                  </div>
                                )}
                                <PhotoField
                                  label="Фотография"
                                  value={{
                                    url: transientPhotoUrlById[p.id] ?? p.photoUrl ?? undefined,
                                    dataUrl: p.photoDataUrl ?? undefined
                                  }}
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

                <div style={{ marginTop: 2 }}>
                  <button type="button" onClick={addPerson} style={glassButtonStyle("sm")}>
                    Добавить
                  </button>
                </div>
              </div>
            </LoudAccordion>
          )}
        </div>
      )}
    </LoudAccordion>
  );
}

/* ========= Main step ========= */
type Props = { onBack?: () => void; onContinue?: (payload?: any) => void };

export default function BackEditorStep({ onBack, onContinue }: Props) {
  const [outro, setOutro] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());

  // Keep in sync with storage/events
  useEffect(() => {
    const sync = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  /* ========= Shared catalog (не показываем, но сохраняем поведение/совместимость) ========= */
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setCatsLoading(true);
      setCatsError("");
      try {
        const data = await fetchCatalog("graphics");
        const root = (data as any)?.categories || data;
        const catsArr = Array.isArray(root) ? root : [];
        if (alive) setCats(catsArr);
      } catch {
        if (alive) setCatsError("Не удалось загрузить каталог графики.");
      } finally {
        if (alive) setCatsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* =========================
   * Дополнительно (extras) — defaults
   * ========================= */
  const extras0: any = (draft as any)?.extras || {};
  const [hasPedestal, setHasPedestal] = useState<boolean>(() => (extras0.tumba ?? true));
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(() => (extras0.flowerbed ?? true));
  const [hasVase, setHasVase] = useState<boolean>(() => (extras0.vase ?? false));

  /* =========================
   * REAR (editorBack)
   * ========================= */
  const editorBack0: any = (draft as any)?.editorBack || {};

  // rearEnabled only reflects checkbox (not "has something")
  const [rearEnabled, setRearEnabled] = useState<boolean>(() => !!editorBack0.enabled);

  // local state mirrors draft; keeps values even if UI collapsed (but we will clear when disabled)
  const [rearIds, setRearIds] = useState<string[]>((editorBack0.selectedGraphicsIds as string[]) || []);
  const [rearMeta, setRearMeta] = useState<Record<string, any>>((editorBack0.graphicsMeta as Record<string, any>) || {});
  const [rearSelectedEpitaphs, setRearSelectedEpitaphs] = useState<string[]>(
    ((editorBack0.epitaphTexts as string[]) || []).filter(Boolean)
  );
  const [rearPeople, setRearPeople] = useState<Person[]>(() => {
    const p0 = draftPersonsToLocal((editorBack0.people as NormalizedPerson[]) || null);
    return p0.length ? p0 : [makeBlankPerson("p-0")];
  });

  // transient photo urls (blob:) with revoke
  const [rearTransientPhotoUrlById, setRearTransientPhotoUrlById] = useState<Record<string, string | null>>({});
  const setRearTransientFor = useCallback((id: string, url: string | null) => {
    setRearTransientPhotoUrlById((prev) => {
      const prevUrl = prev[id];
      if (prevUrl && prevUrl.startsWith("blob:") && prevUrl !== url) {
        try {
          URL.revokeObjectURL(prevUrl);
        } catch {}
      }
      return { ...prev, [id]: url ?? null };
    });
  }, []);
  useEffect(() => {
    return () => {
      Object.values(rearTransientPhotoUrlById).forEach((u) => {
        if (u && u.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(u);
          } catch {}
        }
      });
    };
  }, [rearTransientPhotoUrlById]);

  // Photo handler
  const photoSeqByIdRef = useRef<Record<string, number>>({});
  const isBlobUrl = (url?: string | null) => !!url && url.startsWith("blob:");

  const setRearPersonPhotoById = useCallback(
    (personId: string, pv: PhotoValue | null) => {
      const nextSeq = (photoSeqByIdRef.current[personId] || 0) + 1;
      photoSeqByIdRef.current[personId] = nextSeq;
      const isCurrentSeq = () => photoSeqByIdRef.current[personId] === nextSeq;

      const commitLocal = (patch: Partial<Person>) => {
        if (!isCurrentSeq()) return;
        setRearTransientFor(personId, null);
        setRearPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
      };

      if (!pv) {
        setRearTransientFor(personId, null);
        commitLocal({ photoUrl: null, photoDataUrl: null });
        return;
      }

      if ((pv as any)?.dataUrl) {
        const dataUrl = (pv as any).dataUrl as string;
        (async () => {
          try {
            const blob = await (await fetch(dataUrl)).blob();
            const safe = await compressBlobToJpegDataUrl(blob, DRAFT_IMG_MAX_BYTES);
            commitLocal({ photoDataUrl: safe, photoUrl: safe });
          } catch {
            commitLocal({ photoDataUrl: dataUrl, photoUrl: (pv as any).url ?? dataUrl });
          }
        })();
        return;
      }

      const maybeFile: File | undefined = (pv as any)?.file;
      if (maybeFile instanceof File) {
        const tempUrl = URL.createObjectURL(maybeFile);
        setRearTransientFor(personId, tempUrl);
        (async () => {
          try {
            const safe = await compressBlobToJpegDataUrl(maybeFile, DRAFT_IMG_MAX_BYTES);
            try {
              URL.revokeObjectURL(tempUrl);
            } catch {}
            commitLocal({ photoDataUrl: safe, photoUrl: safe });
          } catch {
            try {
              URL.revokeObjectURL(tempUrl);
            } catch {}
            commitLocal({ photoUrl: tempUrl, photoDataUrl: null });
          }
        })();
        return;
      }

      if ((pv as any)?.url) {
        const url = (pv as any).url as string;
        if (isBlobUrl(url)) {
          setRearTransientFor(personId, url);
          (async () => {
            try {
              const blob = await (await fetch(url)).blob();
              const safe = await compressBlobToJpegDataUrl(blob, DRAFT_IMG_MAX_BYTES);
              commitLocal({ photoDataUrl: safe, photoUrl: safe });
            } catch {
              commitLocal({ photoUrl: url, photoDataUrl: null });
            }
          })();
        } else {
          setRearTransientFor(personId, null);
          commitLocal({ photoUrl: url, photoDataUrl: null });
        }
      }
    },
    [setRearTransientFor]
  );

  // === Persist rear state into draft on changes (NOT tied to accordion open) ===
  // Epitaphs / graphics - these are small, can be saved immediately.
  useEffect(() => {
    if (!rearEnabled) return;
    saveOrderDraft({
      editorBack: {
        enabled: true,
        selectedGraphicsIds: rearIds.length ? rearIds : null,
        graphicsMeta: Object.keys(rearMeta || {}).length ? rearMeta : null,
        epitaphTexts: uniqueByNorm(rearSelectedEpitaphs).length ? uniqueByNorm(rearSelectedEpitaphs) : null
      } as any
    });
    dispatchDraftUpdated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rearEnabled, JSON.stringify(rearIds), JSON.stringify(rearMeta), JSON.stringify(rearSelectedEpitaphs)]);

  // People - heavy: save only on transitions/hide (like EngravingStep)
  const flushRearPeopleSaveNow = useCallback(() => {
    if (!rearEnabled) return;
    const norm = normalizePersonsForSave(rearPeople);
    saveOrderDraft({ editorBack: { people: norm.length ? norm : null, enabled: true } as any });
    dispatchDraftUpdated();
  }, [rearEnabled, rearPeople]);

  useEffect(() => {
    const saveNow = () => {
      try {
        flushRearPeopleSaveNow();
      } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
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
  }, [flushRearPeopleSaveNow]);

  // When rear disabled: clear everything so it is not shown/considered anywhere
  useEffect(() => {
    if (rearEnabled) return;
    saveOrderDraft({
      editorBack: {
        enabled: false,
        selectedGraphicsIds: null,
        graphicsMeta: null,
        epitaphTexts: null,
        people: null,
        previewUrl: null,
        previewHiUrl: null
      } as any
    });
    dispatchDraftUpdated();

    // local reset
    setRearIds([]);
    setRearMeta({});
    setRearSelectedEpitaphs([]);
    setRearPeople([makeBlankPerson("p-0")]);
    setRearTransientPhotoUrlById({});
  }, [rearEnabled]);

  const rearChosenList = useMemo(() => uniqMetaByIds(rearIds, rearMeta), [rearIds, rearMeta]);

  const removeRearGraphic = (gid: string) => {
    if (!rearEnabled) return;
    const idx = rearIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = rearIds.slice();
    nextIds.splice(idx, 1);
    setRearIds(nextIds);
  };

  const removeRearEpitaph = (text: string) => {
    if (!rearEnabled) return;
    setRearSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
  };

  /* =========================
   * PLATE (extras)
   * ========================= */
  // plateEnabled is checkbox only
  const [plateEnabled, setPlateEnabled] = useState<boolean>(() => !!extras0.headstonePlate);

  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [plateSelectedEpitaphs, setPlateSelectedEpitaphs] = useState<string[]>(() => {
    const ex: any = loadOrderDraft()?.extras || {};
    const arr: string[] = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : [];
    const one: string[] = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? [ex.plateEpitaph.trim()] : [];
    return uniqueByNorm([...one, ...arr]);
  });

  // Persist plate state (not tied to accordion open)
  useEffect(() => {
    if (!plateEnabled) return;
    // epitaphs rule as in your original code (plateEpitaph vs plateEpitaphs)
    const list = uniqueByNorm(plateSelectedEpitaphs);
    const patchExtras: any = {};
    patchExtras.headstonePlate = true;

    if (list.length === 0) {
      patchExtras.plateEpitaph = null;
      patchExtras.plateEpitaphs = null;
      patchExtras.plateEpitaphTexts = null;
    } else if (list.length === 1) {
      patchExtras.plateEpitaph = list[0];
      patchExtras.plateEpitaphs = null;
      patchExtras.plateEpitaphTexts = null;
    } else {
      patchExtras.plateEpitaph = null;
      patchExtras.plateEpitaphs = list.slice();
      patchExtras.plateEpitaphTexts = null;
    }

    patchExtras.plateGraphicsIds = plateIds.length ? plateIds : null;
    patchExtras.plateGraphicsMeta = Object.keys(plateMeta || {}).length ? plateMeta : null;

    saveOrderDraft({ extras: patchExtras } as any);
    dispatchDraftUpdated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateEnabled, JSON.stringify(plateIds), JSON.stringify(plateMeta), JSON.stringify(plateSelectedEpitaphs)]);

  // When plate disabled: clear everything so it is not shown/considered anywhere
  useEffect(() => {
    if (plateEnabled) return;
    saveOrderDraft({
      extras: {
        headstonePlate: false,
        plateGraphicsIds: null,
        plateGraphicsMeta: null,
        plateEpitaph: null,
        plateEpitaphs: null,
        plateEpitaphTexts: null,
        platePreviewUrl: null,
        platePreviewHiUrl: null
      } as any
    });
    dispatchDraftUpdated();

    // local reset
    setPlateIds([]);
    setPlateMeta({});
    setPlateSelectedEpitaphs([]);
  }, [plateEnabled]);

  const chosenPlateList = useMemo(() => uniqMetaByIds(plateIds, plateMeta), [plateIds, plateMeta]);

  const removePlateGraphic = (gid: string) => {
    if (!plateEnabled) return;
    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = plateIds.slice();
    nextIds.splice(idx, 1);
    setPlateIds(nextIds);
  };

  const removePlateEpitaph = (text: string) => {
    if (!plateEnabled) return;
    setPlateSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
  };

  // We keep existing preview generation behavior in file, but it must not run when disabled.
  // (If you still need preview generation here later, you can re-add it guarded by plateEnabled/rearEnabled.)

  /* ========= Handlers ========= */
  const handleBack = useCallback(() => {
    try {
      flushRearPeopleSaveNow();
    } catch {}
    setOutro(true);
    setTimeout(() => onBack?.(), 320);
  }, [flushRearPeopleSaveNow, onBack]);

  const handleContinue = useCallback(() => {
    try {
      flushRearPeopleSaveNow();
    } catch {}
    setOutro(true);
    setTimeout(() => onContinue?.(), 320);
  }, [flushRearPeopleSaveNow, onContinue]);

  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease", maxWidth: 600, margin: "0 auto" }}>
      <TopBarWithIntro title="Тыл" />

      {/* Дополнительно */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <LoudAccordion title="Дополнительно" open={true} onToggle={() => void 0}>
          <div style={sectionBoxStyle()}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasPedestal}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHasPedestal(v);
                    saveOrderDraft({ extras: { tumba: v } as any });
                    dispatchDraftUpdated();
                    setDraft(loadOrderDraft());
                  }}
                />
                <span>Тумба</span>
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasFlowerbed}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHasFlowerbed(v);
                    saveOrderDraft({ extras: { flowerbed: v } as any });
                    dispatchDraftUpdated();
                    setDraft(loadOrderDraft());
                  }}
                />
                <span>Цветник</span>
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasVase}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHasVase(v);
                    saveOrderDraft({ extras: { vase: v } as any });
                    dispatchDraftUpdated();
                    setDraft(loadOrderDraft());
                  }}
                />
                <span>Ваза</span>
              </label>
            </div>

            {/* Debug info can be removed; keeping cats loaded to not break existing assumptions */}
            {(catsLoading || catsError) && (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                {catsLoading ? "Загрузка каталога графики…" : null}
                {catsError ? <span style={{ color: "#ffb4b4" }}>{catsError}</span> : null}
                {!catsLoading && !catsError && cats.length ? null : null}
              </div>
            )}
          </div>
        </LoudAccordion>
      </section>

      {/* Тыльная сторона (только "Выбрано" + Усопшие) */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 12 }}>
        <SelectedOnlyBlock
          title="Тыльная сторона"
          enabled={rearEnabled}
          onToggleEnabled={(v) => {
            setRearEnabled(v);
            saveOrderDraft({ editorBack: { enabled: v } as any });
            dispatchDraftUpdated();
          }}
          chosenList={rearChosenList}
          onRemoveChosenItem={(gid) => removeRearGraphic(gid)}
          epitaphList={rearSelectedEpitaphs}
          onRemoveEpitaph={(t) => removeRearEpitaph(t)}
          showPeople={true}
          people={rearPeople}
          setPeople={setRearPeople}
          transientPhotoUrlById={rearTransientPhotoUrlById}
          setPersonPhotoById={setRearPersonPhotoById}
        />
      </section>

      {/* Надгробная плита (только "Выбрано", без "Усопшие") */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 12 }}>
        <SelectedOnlyBlock
          title="Надгробная плита"
          enabled={plateEnabled}
          onToggleEnabled={(v) => {
            setPlateEnabled(v);
            saveOrderDraft({ extras: { headstonePlate: v } as any });
            dispatchDraftUpdated();
          }}
          chosenList={chosenPlateList}
          onRemoveChosenItem={(gid) => removePlateGraphic(gid)}
          epitaphList={plateSelectedEpitaphs}
          onRemoveEpitaph={(t) => removePlateEpitaph(t)}
          showPeople={false}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>
          Назад
        </button>

        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>
          Продолжить
        </button>
      </div>
    </div>
  );
}
