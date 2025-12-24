// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Реализовано:
// - Центрирование контента (max-width: 600px).
// - Эскизы «вписаны»: лицевая — SketchTemplate; тыльная — превью + контур изделия.
// - Адаптив: ≤600px — 1 столбец, иначе — 2 (если есть тыльная).
// - Галерея графики (плита) — минимум 2 столбца.
// - «Выбрано для плиты» — показываем только при наличии выбранных.
// - «Заказ списком» (оверлей):
//   • миниатюры 70×70 у усопших и у графики (лицевая/тыльная);
//   • «Сохранить PDF»: PDF 1512×2138 px, со встроенным Noto Sans (Unicode, корректная кириллица),
//     весь заказ целиком, эскизы, отдельные страницы с прикреплёнными фото усопших;
//     скачиваем локально и отправляем в /api/send-order-pdf (менеджеру в Telegram и на email).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import SketchTemplate from "../components/SketchTemplate";

/* ===== jsPDF с CDN (PDF) ===== */
declare global { interface Window { jspdf?: any } }
async function ensureJsPdf(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  const CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  await new Promise<void>((res, rej) => {
    const exist = document.querySelector<HTMLScriptElement>(`script[src="${CDN}"]`);
    if (exist) {
      exist.addEventListener("load", () => res(), { once: true });
      exist.addEventListener("error", () => rej(new Error("jspdf load error")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("jspdf load error"));
    document.head.appendChild(s);
  });
  if (!window.jspdf?.jsPDF) throw new Error("jspdf unavailable");
  return window.jspdf.jsPDF;
}

/* ===== Встраивание кириллического шрифта (Noto Sans) ===== */
let fontReady = false;
async function ensureCyrillicFonts(doc: any) {
  if (fontReady) return;
  const REG = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Regular.ttf";
  const BLD = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Bold.ttf";
  async function fetchTtfToBase64(url: string): Promise<string> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Font fetch failed: ${url}`);
    const ab = await r.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(ab);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  const [regB64, bldB64] = await Promise.all([fetchTtfToBase64(REG), fetchTtfToBase64(BLD)]);
  doc.addFileToVFS("NotoSans-Regular.ttf", regB64);
  doc.addFileToVFS("NotoSans-Bold.ttf", bldB64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  fontReady = true;
}

/* ===== UI helpers ===== */
function glassPanelStyle(): React.CSSProperties {
  return { background: "rgba(20,20,24,0.90)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", boxSizing: "border-box" };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const map = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: map[size], borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff", cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}
function inputStyle(): React.CSSProperties {
  return { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", boxSizing: "border-box" };
}
const sectionBox: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 10 };
const hrStyle: React.CSSProperties = { border: 0, height: 1, background: "rgba(0,0,0,0.15)", margin: "8px 0" };
function linkLike(): React.CSSProperties { return { color: "#8ab4ff", textDecoration: "underline", cursor: "pointer", background: "transparent", border: "none", padding: 0, font: "inherit" }; }

/* ===== Utils ===== */
function personLines(p: any): string[] {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
function toParagraphs(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const splitByBlank = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  if (splitByBlank.length) return splitByBlank;
  return t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}

/* ===== Thumb ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
  </div>
);

/* ===== Шапка (номер заказа + контакты + «Заказ списком») ===== */
function EditableOrderSummary({ orderNo, onOpenSimple }: { orderNo: string; onOpenSimple: () => void }) {
  const intro = loadIntroState();
  const [name, setName] = useState<string>(intro.intro?.customerName || "");
  const [phone, setPhone] = useState<string>(intro.intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(intro.intro?.customerNotes || "");
  const t = useRef<number | null>(null);
  const debSave = () => {
    if (t.current) clearTimeout(t.current);
    t.current = window.setTimeout(() => {
      const next: Intro = { customerName: name.trim(), customerPhone: phone.trim(), customerNotes: contactNotes.trim() || undefined };
      saveIntro(next, { lock: false });
    }, 250) as unknown as number;
  };
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onOpenSimple} style={linkLike()}>Заказ списком</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
        <input value={name} onChange={(e) => { setName(e.target.value); debSave(); }} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => { setPhone(e.target.value); debSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); debSave(); }} placeholder="Примечание для связи…" style={inputStyle()} />
    </section>
  );
}

/* ===== Accordion ===== */
function LoudAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode; }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const m = () => setH(ref.current?.scrollHeight || 0);
    m();
    const ro = new (window as any).ResizeObserver?.(m);
    if (ref.current && ro) ro.observe(ref.current);
    return () => ro?.disconnect?.();
  }, [children]);
  return (
    <div style={{ ...glassPanelStyle(), padding: 0, borderWidth: 2, borderColor: "rgba(138,180,255,0.35)" }}>
      <button type="button" onClick={onToggle} style={{ width: "100%", textAlign: "left", padding: "12px 14px", background: "rgba(255,255,255,0.06)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 15, fontWeight: 700 }}>
        <span>{title}</span><span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Галерея каталога (минимум 2 столбца) ===== */
function CatGrid({ items, plateIds, addGraphic, removeGraphic }: { items: any[]; plateIds: string[]; addGraphic: (g: any) => void; removeGraphic: (gid: string) => void; }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number>(2);
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth || 0;
      setCols(Math.max(2, Math.floor(w / 160)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={rootRef} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>
      {items.map((g: any, idx: number) => {
        const gid = String(g.id || g.relPath || g.url || g.name || idx);
        const qty = plateIds.filter((x) => x === gid).length;
        const thumbUrl = g.preview || g.url || "";
        const name = g.name || gid;
        return (
          <div key={gid} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 12 }}>
            <div role="button" title={name} onClick={() => addGraphic(g)} style={{ borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer" }}>
              {thumbUrl ? <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
            </div>
            <div title={name} style={{ marginTop: 6, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 }}>{name}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => removeGraphic(gid)} disabled={qty === 0} style={glassButtonStyle("nano", qty === 0)}>−</button>
              <span style={{ minWidth: 20, textAlign: "center" }}>{qty}</span>
              <button type="button" onClick={() => addGraphic(g)} style={glassButtonStyle("nano")}>+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===== Блок плиты (настройки/выбор) ===== */
function PlateBlock(props: {
  extraPlate: boolean; setExtraPlate: (v: boolean) => void;
  plateSize: string; setPlateSize: (v: string) => void;
  plateCustomSize: string; setPlateCustomSize: (v: string) => void;
  plateThickness: string; setPlateThickness: (v: string) => void;
  plateCustomThickness: string; setPlateCustomThickness: (v: string) => void;
  plateOrientation: string; setPlateOrientation: (v: string) => void;
  plateEpitaph: string; setPlateEpitaph: (v: string) => void;
  catsLoading: boolean; catsError: string; cats: any[];
  catOpen: Record<string, boolean>; setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void; removePlateGraphic: (gid: string) => void;
  plateIds: string[];
}) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize, plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness, plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic,
    plateIds
  } = props;

  const [graphicsOpen, setGraphicsOpen] = useState(false);
  const [showMoreEpitaphs, setShowMoreEpitaphs] = useState(false);
  const [plateEpitaphs, setPlateEpitaphs] = useState<string[]>((plateEpitaph || "").trim() ? (plateEpitaph as string).split(/\n{2,}/g) : []);
  useEffect(() => { setPlateEpitaph(plateEpitaphs.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n")); }, [plateEpitaphs, setPlateEpitaph]);

  const norm = (t: string) => (t || "").replace(/\r\n?/g, "\n").trim();
  const hasByNorm = (list: string[], t: string) => list.some((x) => norm(x) === norm(t));
  const toggleEpitaph = (t: string) => setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev.filter((x) => norm(x) !== norm(t)) : prev.concat([t])));
  const [customText, setCustomText] = useState("");

  return (
    <div style={{ ...sectionBox, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
          <span style={{ fontWeight: 700 }}>Надгробная плита</span>
        </label>
      </div>

      {extraPlate && (
        <>
          {/* Размер */}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Размер</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-size" checked={plateSize === v} onChange={() => setPlateSize(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
            {plateSize === "Свой вариант" && (
              <input value={plateCustomSize} onChange={(e) => setPlateCustomSize(e.target.value)} placeholder="Укажите свой размер (например, 130×60 см)" style={inputStyle()} />
            )}
          </div>

          {/* Толщина */}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Толщина</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-thickness" checked={plateThickness === v} onChange={() => setPlateThickness(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
            {plateThickness === "Свой вариант" && (
              <input value={plateCustomThickness} onChange={(e) => setPlateCustomThickness(e.target.value)} placeholder="Укажите толщину (например, 7 см)" style={inputStyle()} />
            )}
          </div>

          {/* Ориентация */}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Ориентация</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => setPlateOrientation(v)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Эпитафии */}
          <LoudAccordion title="Эпитафия на надгробной плите" open={true} onToggle={() => null}>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => {
                    const active = hasByNorm(plateEpitaphs, t);
                    return (
                      <button key={t} type="button" onClick={() => toggleEpitaph(t)} style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }} title={t}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <button type="button" onClick={() => setShowMoreEpitaphs((v) => !v)} style={glassButtonStyle("nano")}>
                  {showMoreEpitaphs ? "Скрыть список" : "Все эпитафии"}
                </button>
                {showMoreEpitaphs && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                    {MORE_EPITAPHS.map((t, idx) => {
                      const active = hasByNorm(plateEpitaphs, t);
                      return (
                        <button key={idx} type="button" onClick={() => toggleEpitaph(t)} title={t}
                          style={{ textAlign: "left", ...glassPanelStyle(), borderRadius: 10, padding: 10, cursor: "pointer", outline: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)", fontSize: 13, lineHeight: 1.25, whiteSpace: "pre-wrap" }}>
                          {t}
                          <div style={{ marginTop: 6, fontSize: 12 }}>{active ? "Удалить из выбранных" : "Добавить к выбранным"}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea rows={3} value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Введите текст и нажмите «Добавить»" style={{ ...inputStyle(), resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => {
                      const t = (customText || "").trim();
                      if (!t) return;
                      setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([t])));
                      setCustomText("");
                    }}>Добавить</button>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => setPlateEpitaphs([])}>Очистить выбранные</button>
                    {plateEpitaphs.length > 0 && <div style={{ opacity: 0.8, fontSize: 12 }}>Выбрано: {plateEpitaphs.length}</div>}
                  </div>
                </div>
              </div>
            </div>
          </LoudAccordion>

          {/* Графика на плите */}
          <LoudAccordion title="Графика на надгробной плите" open={graphicsOpen} onToggle={() => setGraphicsOpen((v) => !v)}>
            {catsLoading && <div>Загрузка каталога…</div>}
            {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
            {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}
            {!catsLoading && cats.length > 0 && (
              <div style={{ display: "grid", gap: 12 }}>
                {cats.map((cat: any, idx: number) => {
                  const catKey = String(cat._id || cat.name || idx);
                  const open = !!(catOpen || {})[catKey];
                  const setToggle = () => setCatOpen({ ...(catOpen || {}), [catKey]: !open });
                  return (
                    <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={setToggle}>
                      <CatGrid items={cat.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removePlateGraphic={removePlateGraphic} />
                      {(cat.children || []).map((sub: any, j: number) => (
                        <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                          <CatGrid items={sub.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removePlateGraphic={removePlateGraphic} />
                        </div>
                      ))}
                    </LoudAccordion>
                  );
                })}
              </div>
            )}
          </LoudAccordion>
        </>
      )}
    </div>
  );
}

/* ===== Оверлей «Заказ списком» (миниатюры 70×70, кнопка «Сохранить PDF») ===== */
function PrintOverlay({
  onClose, onSave, orderNo, name, phone, frontSketch, previewBack,
  frontData, rearData, extras, plate, notes, aspect
}: {
  onClose: () => void; onSave: () => void;
  orderNo: string; name: string; phone: string;
  frontSketch: React.ReactNode;
  previewBack?: string;
  frontData: { persons: { id?: string; fio1: string; fio2: string; dates: string; photo?: string }[]; graphics: { name: string; qty: number; thumb?: string }[]; epitaphs: string[]; };
  rearData: { graphics: { name: string; qty: number; thumb?: string }[]; epitaphs: string[] } | null;
  extras: { base: boolean; flowerbed: boolean };
  plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string }[]; epitaph?: string };
  notes?: string;
  aspect?: string;
}) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "grid", placeItems: "center", padding: 12 }}>
      <div id="print-root" style={{ background: "#fff", color: "#000", width: "100%", maxWidth: "210mm", maxHeight: "95vh", overflow: "auto", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.55)", padding: "5mm" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#f0f0f0", cursor: "pointer" }}>Закрыть</button>
          <button type="button" onClick={onSave} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }}>Сохранить PDF</button>
        </div>

        <div style={{ fontFamily: "system-ui,-apple-system, Segoe UI, Roboto, Arial, sans-serif", fontSize: 11, lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>заказ № {orderNo || "—"}</div>
          <div style={{ marginBottom: 6 }}>{name || "—"} · {phone || "—"}</div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Лицевая */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Лицевая</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
              {/* Усопшие — миниатюры 70×70 */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                {frontData.persons.length ? frontData.persons.map((p, i) => (
                  <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: p.photo ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    {p.photo && <img src={p.photo} alt="" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />}
                    <div>
                      {p.fio1 && <div style={{ fontWeight: 600 }}>{p.fio1}</div>}
                      {p.fio2 && <div>{p.fio2}</div>}
                      {p.dates && <div>{p.dates}</div>}
                    </div>
                  </div>
                )) : <div>—</div>}
              </div>

              {/* Графика — миниатюры 70×70, если есть */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {frontData.graphics.length ? frontData.graphics.map((g, i) => (
                  <div key={`fg-${i}`} style={{ display: "grid", gridTemplateColumns: g.thumb ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    {g.thumb && <img src={g.thumb} alt="" style={{ width: 70, height: 70, objectFit: "contain", borderRadius: 6, background: "#fafafa", border: "1px solid #eee" }} />}
                    <div>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>
                  </div>
                )) : <div>—</div>}
              </div>

              {/* Эпитафии */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {frontData.epitaphs.length ? frontData.epitaphs.map((t, i) => <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
              </div>
            </div>
          </div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Тыльная */}
          {rearData && (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Тыльная</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
                  <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div><div>—</div></div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                    {rearData.graphics.length ? rearData.graphics.map((g, i) => (
                      <div key={`rg-${i}`} style={{ display: "grid", gridTemplateColumns: g.thumb ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        {g.thumb && <img src={g.thumb} alt="" style={{ width: 70, height: 70, objectFit: "contain", borderRadius: 6, background: "#fafafa", border: "1px solid #eee" }} />}
                        <div>{g.name}{g.qty > 1 ? ` ×${г.qty}` : ""}</div>
                      </div>
                    )) : <div>—</div>}
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                    {rearData.epitaphs.length ? rearData.epitaphs.map((t, i) => <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
                  </div>
                </div>
              </div>

              <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />
            </>
          )}

          {/* Дополнительно */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Дополнительно</div>
            <div>Тумба: {extras.base ? "да" : "нет"}; Цветник: {extras.flowerbed ? "да" : "нет"}</div>
          </div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Плита */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Надгробная плита</div>
            <div>Размер: {plate.enabled ? (plate.size || "—") : "нет"}; Толщина: {plate.enabled ? (plate.thickness || "—") : "нет"}</div>
            {plate.graphics.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {plate.graphics.map((g, i) => <div key={`pg-${i}`}>{g.name}</div>)}
              </div>
            )}
            {plate.epitaph && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{plate.epitaph}</div>
              </div>
            )}
          </div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Примечания */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Примечания</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{notes || "—"}</div>
          </div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Эскизы (вписанные) */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Эскизы</div>
            <div style={{ display: "grid", gridTemplateColumns: rearData ? "1fr 1fr" : "1fr", gap: 6 }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, padding: 0 }}>{frontSketch}</div>
              </div>
              {rearData && (
                <div style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden" }}>
                  {previewBack ? (
                    <img src={previewBack} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>Нет</div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ===== Основной компонент (страница) ===== */
type Props = { onBack?: () => void; onSend?: (payload?: any) => void };
export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());

  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    window.addEventListener("storage", refresh);
    refresh();
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const orderNo = String(introState.orderNumber || "").trim();

  // Тыльный превью
  const backSketchUrl = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  // Параметры изделия (для aspect и контура)
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  // Лицевая — данные
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(() => frontPersons.map((p: any, i: number) => ({
    id: p.id || `p-${i}`,
    lines: personLines(p),
    photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
  })), [frontPersons]);
  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => ((g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross"));
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  /* ===== Дополнительно (плита) ===== */
  const extras0 = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(extras0.base ?? true);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(extras0.plateOrientation || (((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h")) ? "horizontal" : "vertical"));
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    setPlateIds((prev) => prev.concat(gid));
    setPlateMeta((m) => ({ ...m, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } }));
  };
  const removePlateGraphic = (gid: string) => {
    setPlateIds((prev) => {
      const i = prev.findIndex((x) => x === gid);
      if (i === -1) return prev;
      const next = prev.slice(); next.splice(i, 1); return next;
    });
  };

  // Каталог плиты
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      setCatsLoading(true); setCatsError("");
      try {
        const data = await fetchCatalog("graphics");
        const root = (data as any)?.categories || data;
        const catsArr = Array.isArray(root) ? root : [];
        if (alive) setCats(catsArr);
      } catch { if (alive) setCatsError("Не удалось загрузить каталог графики."); }
      finally { if (alive) setCatsLoading(false); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!cats.length) return;
    setCatOpen((prev) => {
      const next = { ...prev };
      for (const c of cats) {
        const key = String(c._id || c.name || "");
        if (!(key in next)) next[key] = false;
      }
      return next;
    });
  }, [cats]);

  // Выбранная графика плиты (мета)
  const chosenPlateList = useMemo(() => {
    const index: Record<string, any> = {};
    cats.forEach((cat: any) => {
      const collect = (arr: any[]) => (arr || []).forEach((it: any) => {
        const id = String(it.id || it.relPath || it.url || it.name || "");
        if (!id) return;
        if (!index[id]) index[id] = { id, name: it.name || id, url: it.preview || it.url || "" };
      });
      collect(cat.items || []);
      (cat.children || []).forEach((sub: any) => collect(sub.items || []));
    });
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || index[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta, cats]);

  // Эпитафии плиты
  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  // Примечания
  const [orderNotes, setOrderNotes] = useState<string>(extras0.orderNotes || "");
  const notesTimer = useRef<number | null>(null);
  const scheduleSaveOrderNotes = () => {
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      const extras: any = { ...(prev as any).extras, orderNotes: (orderNotes || "").trim() || undefined };
      saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
      setDraft(loadOrderDraft());
    }, 300) as unknown as number;
  };
  useEffect(() => () => { if (notesTimer.current) window.clearTimeout(notesTimer.current); }, []);

  // Сохранение extras
  useEffect(() => {
    const prev = loadOrderDraft();
    const prevExtras = ((prev as any).extras || {}) as any;
    const extras: any = { ...prevExtras, base: extraBase, flowerbed: extraFlowerbed, headstonePlate: extraPlate };
    if (extraPlate) {
      extras.plateSize = plateSize;
      extras.plateCustomSize = plateSize === "Свой вариант" ? (plateCustomSize || undefined) : prevExtras.plateCustomSize;
      extras.plateThickness = plateThickness;
      extras.plateCustomThickness = plateThickness === "Свой вариант" ? (plateCustomThickness || undefined) : prevExtras.plateCustomThickness;
      extras.plateOrientation = plateOrientation;
      extras.plateEpitaph = (plateEpitaph || "").trim() || undefined;
      extras.plateGraphicsIds = plateIds;
      extras.plateGraphicsMeta = plateMeta;
    }
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
    setDraft(loadOrderDraft());
  }, [extraBase, extraFlowerbed, extraPlate, plateSize, plateCustomSize, plateThickness, plateCustomThickness, plateOrientation, plateEpitaph, plateIds, plateMeta]);

  /* ===== Адаптив эскизов ===== */
  const [oneCol, setOneCol] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 600px)");
    const update = () => setOneCol(!!mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else (mq as any).addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else (mq as any).removeListener(update);
    };
  }, []);

  /* ===== Служебные: dataURL ===== */
  async function urlToDataUrl(url?: string | null): Promise<string | null> {
    try {
      if (!url) return null;
      if (url.startsWith("data:")) return url;
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  /* ===== PDF: генерация и отправка ===== */
  const [simpleOpen, setSimpleOpen] = useState(false);
  const [sendingPdf, setSendingPdf] = useState(false);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function createPdfBlob(options: {
    orderNo: string;
    customerName: string; customerPhone: string;
    frontPersons: { fio1: string; fio2: string; dates: string; photo?: string | null }[];
    frontGraphics: { name: string; qty: number }[];
    frontEpitaphs: string[];
    rearGraphics: { name: string; qty: number }[];
    rearEpitaphs: string[];
    extras: { base: boolean; flowerbed: boolean };
    plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string }[]; epitaph?: string };
    notes?: string; imgFront?: string | null; imgBack?: string | null;
  }): Promise<Blob> {
    const jsPDF = await ensureJsPdf();
    const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
    await ensureCyrillicFonts(doc);

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentW = pageW - margin * 2;
    let y = margin;

    const setFont = (bold = false, size = 24) => { doc.setFont("NotoSans", bold ? "bold" : "normal"); doc.setFontSize(size); };
    const addHr = (gap = 12) => { doc.setDrawColor(200); doc.setLineWidth(1); doc.line(margin, y, pageW - margin, y); y += gap; };
    const addTitle = (t: string) => {
      setFont(true, 28);
      const lines = doc.splitTextToSize(t, contentW);
      for (const ln of lines) {
        if (y + 34 > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(ln, margin, y);
        y += 34;
      }
    };
    const addText = (t: string, sz = 22, bold = false) => {
      setFont(bold, sz);
      const lh = Math.round(sz * 1.25);
      const lines = doc.splitTextToSize(t, contentW);
      for (const ln of lines) {
        if (y + lh > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(ln, margin, y);
        y += lh;
      }
    };
    const addKV = (k: string, v: string) => addText(`${k}: ${v}`, 22, false);
    const addImageFitted = async (dataUrl: string | null | undefined, maxH = 560) => {
      if (!dataUrl) return;
      const isPng = /^data:image\/png/i.test(dataUrl);
      const fmt = isPng ? "PNG" : "JPEG";
      const img = new Image();
      await new Promise<void>((res) => { img.onload = () => res(); img.src = dataUrl!; });
      const iw = img.naturalWidth || 0, ih = img.naturalHeight || 0;
      if (!iw || !ih) return;
      const scale = Math.min(contentW / iw, maxH / ih, 1);
      const w = Math.round(iw * scale), h = Math.round(ih * scale);
      if (y + h > pageH - margin) { doc.addPage(); y = margin; }
      doc.addImage(dataUrl!, fmt, margin, y, w, h, undefined, "FAST");
      y += h + 12;
    };

    // Header
    addTitle(`Заказ № ${options.orderNo || "—"}`);
    addText(`${options.customerName || "—"} · ${options.customerPhone || "—"}`);

    addHr();

    // Лицевая
    addTitle("Лицевая");
    addText("Усопшие", 24, true);
    if (options.frontPersons.length) {
      options.frontPersons.forEach((p) => {
        const fio = [p.fio1, p.fio2].filter(Boolean).join(" ");
        const line = [fio, p.dates].filter(Boolean).join(" · ");
        addText(line);
      });
    } else addText("—");
    addText("Графика", 24, true);
    if (options.frontGraphics.length) options.frontGraphics.forEach((g) => addText(`${g.name}${g.qty > 1 ? ` ×${g.qty}` : ""}`)); else addText("—");
    addText("Эпитафии", 24, true);
    if (options.frontEpitaphs.length) options.frontEpitaphs.forEach((t) => addText(t)); else addText("—");

    addHr();

    // Тыльная
    addTitle("Тыльная");
    addText("Усопшие", 24, true); addText("—");
    addText("Графика", 24, true);
    if (options.rearGraphics.length) options.rearGraphics.forEach((g) => addText(`${g.name}${g.qty > 1 ? ` ×${g.qty}` : ""}`)); else addText("—");
    addText("Эпитафии", 24, true);
    if (options.rearEpitaphs.length) options.rearEpitaphs.forEach((t) => addText(t)); else addText("—");

    addHr();

    // Дополнительно
    addTitle("Дополнительно");
    addKV("Тумба", options.extras.base ? "да" : "нет");
    addKV("Цветник", options.extras.flowerbed ? "да" : "нет");

    addHr();

    // Плита
    addTitle("Надгробная плита");
    if (options.plate.enabled) {
      addKV("Размер", options.plate.size || "—");
      addKV("Толщина", options.plate.thickness || "—");
      addText("Графика", 24, true);
      if (options.plate.graphics.length) options.plate.graphics.forEach((g) => addText(g.name)); else addText("—");
      addText("Эпитафии", 24, true);
      addText(options.plate.epitaph || "—");
    } else addText("нет");

    addHr();

    // Примечания
    addTitle("Примечания");
    addText(options.notes || "—");

    addHr();

    // Эскизы
    addTitle("Эскизы");
    await addImageFitted(options.imgFront || null, 560);
    await addImageFitted(options.imgBack || null, 560);

    // Фото усопших — отдельные страницы
    const photos = (options.frontPersons || []).map((p) => p.photo).filter(Boolean) as string[];
    if (photos.length) {
      for (let i = 0; i < photos.length; i++) {
        doc.addPage();
        y = margin;
        addTitle(`Фото ${i + 1}`);
        await addImageFitted(photos[i], pageH - margin * 2 - 24);
      }
    }

    return doc.output("blob");
  }

  async function sendPdfToServer(pdf: Blob, meta: any) {
    const fd = new FormData();
    fd.append("pdf", pdf, `order-${meta?.orderNo || Date.now()}.pdf`);
    fd.append("payload", JSON.stringify(meta || {}));
    const res = await fetch("/api/send-order-pdf", { method: "POST", body: fd });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Не удалось отправить PDF: ${t || res.statusText}`);
    }
  }

  async function onSavePdf() {
    try {
      setSendingPdf(true); setErr("");

      const orderNo = String(introState.orderNumber || "").trim();
      const name = (loadIntroState().intro?.customerName || "").trim();
      const phone = (loadIntroState().intro?.customerPhone || "").trim();

      const frontDataPersons = frontPersons.map((p: any) => ({
        fio1: (p.lastName || "").trim(),
        fio2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
        dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — "),
        photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
      }));

      const frontDataGraphics = (allFrontGraphics || []).map((g: any) => ({
        name: g.name || (g.url ? decodeURIComponent(g.url.split("/").pop() || "") : g.id || ""),
        qty: 1
      }));

      const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
      const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
      const rearCounts: Record<string, number> = {};
      (rearIds || []).forEach((id) => (rearCounts[id] = (rearCounts[id] || 0) + 1));
      const rearUnique = Array.from(new Set(rearIds || [])).map((id) => rearMeta?.[id] || { id, name: id, url: "" });
      const rearDataGraphics = rearUnique.map((g: any) => ({
        name: g.name || g.id,
        qty: rearCounts[g?.id || g?.url || g?.name] || 1
      }));
      const rearEpitaphs: string[] = ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean));

      const frontPreviewUrl = (draft as any)?.editor?.previewHiUrl || (draft as any)?.editor?.previewUrl || null;
      const imgFront = await urlToDataUrl(frontPreviewUrl);
      const imgBack = await urlToDataUrl(backSketchUrl || null);

      const plateChosen = chosenPlateList.map((g) => ({ name: g.name || g.id }));

      const pdfBlob = await createPdfBlob({
        orderNo,
        customerName: name,
        customerPhone: phone,
        frontPersons: frontDataPersons,
        frontGraphics: frontDataGraphics,
        frontEpitaphs: frontEpitaphs,
        rearGraphics: rearDataGraphics,
        rearEpitaphs: rearEpitaphs,
        extras: { base: extraBase, flowerbed: extraFlowerbed },
        plate: {
          enabled: !!extraPlate,
          size: extraPlate ? plateSize : undefined,
          thickness: extraPlate ? (plateThickness || undefined) : undefined,
          graphics: plateChosen,
          epitaph: extraPlate ? (plateEpitaph || "") : ""
        },
        notes: (extras0.orderNotes || "").trim(),
        imgFront,
        imgBack
      });

      // Сохранить локально
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pdfBlob);
      a.download = `order-${orderNo || Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);

      // Отправить менеджеру
      await sendPdfToServer(pdfBlob, {
        orderNo,
        intro: loadIntroState().intro || {},
        extras: {
          base: extraBase,
          flowerbed: extraFlowerbed,
          headstonePlate: extraPlate,
          plateSize,
          plateThickness,
          plateOrientation,
          plateEpitaph,
          plateGraphics: plateChosen
        }
      });

      window.alert("PDF сохранён и отправлен менеджеру.");
      setSimpleOpen(false);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Не удалось сформировать/отправить PDF.");
    } finally {
      setSendingPdf(false);
    }
  }

  /* ===== Отправка «Оформить заказ» (без PDF) ===== */
  async function handleSend() {
    setBusy(true); setErr("");
    const attachments: any = {
      frontPreview: null,
      backPreview: backSketchUrl || null,
      itemUrl: null,
      plateGraphics: chosenPlateList
    };
    const extras: Extras & {
      base?: boolean; flowerbed?: boolean; headstonePlate?: boolean;
      plateSize?: string; plateCustomSize?: string; plateThickness?: string; plateCustomThickness?: string; plateOrientation?: string; plateEpitaph?: string; plateGraphicsIds?: string[];
      orderNo?: string; orderNotes?: string; attachments?: any;
    } = {
      base: extraBase,
      flowerbed: extraFlowerbed,
      headstonePlate: extraPlate,
      plateSize: extraPlate ? plateSize : undefined,
      plateCustomSize: extraPlate && plateSize === "Свой вариант" ? plateCustomSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateCustomThickness: extraPlate && plateThickness === "Свой вариант" ? plateCustomThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph || "").trim() || undefined : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined,
      orderNo,
      orderNotes: (orderNotes || "").trim() || undefined,
      attachments
    };
    try {
      await sendOrderEmailAndNotifyTg(extras);
      const nm = (loadIntroState().intro?.customerName || "").trim() || "Заказчик";
      window.alert(`${nm}, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами для подтверждения деталей.`);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  }

  // Тыльная графика для «Заказ списком» (миниатюры)
  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCounts: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    (rearIds || []).forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [rearIds]);
  const rearUnique = useMemo(() => {
    const ids = Array.from(new Set(rearIds || []));
    return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "" });
  }, [rearIds, rearMeta]);
  const rearEpitaphs: string[] = useMemo(() => ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean)), [draft]);

  // Графика с миниатюрами 70×70 для "Заказ списком"
  const frontGraphicsWithThumbs = useMemo(() => {
    return (allFrontGraphics || []).map((g: any) => ({
      name: g.name || (g.url ? decodeURIComponent(g.url.split("/").pop() || "") : g.id || ""),
      qty: 1,
      thumb: g.preview || g.url || ""
    }));
  }, [allFrontGraphics]);
  const rearGraphicsWithThumbs = useMemo(() => {
    return (rearUnique || []).map((g: any) => ({
      name: g.name || g.id,
      qty: rearCounts[g?.id || g?.url || g?.name] || 1,
      thumb: g.url || ""
    }));
  }, [rearUnique, rearCounts]);

  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
      <EditableOrderSummary orderNo={orderNo} onOpenSimple={() => setSimpleOpen(true)} />

      {/* Эскизы */}
      <section id="section-previews" style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: backSketchUrl && !oneCol ? "1fr 1fr" : "1fr", gap: 12 }}>
          {/* Лицевая — SketchTemplate */}
          <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Лицевая</div>
            <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, zIndex: 1, padding: 0 }}>
                <SketchTemplate
                  item={item}
                  peopleBlocks={peopleBlocks}
                  crosses={selectedCrosses}
                  others={selectedOthers}
                  epitaphs={frontEpitaphs}
                  carvingOpacity={0.4}
                />
              </div>
            </div>
          </div>

          {/* Тыльная — превью + контур изделия */}
          {backSketchUrl && (
            <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>Тыльная</div>
              <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
                {itemUrl && (
                  <img
                    src={itemUrl}
                    alt=""
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.22, filter: "grayscale(100%) contrast(180%) brightness(180%)", zIndex: 0, pointerEvents: "none" }}
                  />
                )}
                <img
                  src={backSketchUrl}
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1, pointerEvents: "none" }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Выбрано для плиты */}
      {extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
        <section style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                {chosenPlateList.map((g, i) => (
                  <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                    <Thumb url={g.url} />
                    <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                    <button type="button" onClick={() => setPlateIds((prev) => {
                      const idx = prev.indexOf(g.id || g.url || "");
                      if (idx === -1) return prev;
                      const next = prev.slice(); next.splice(idx, 1); return next;
                    })} style={glassButtonStyle("nano")}>Удалить</button>
                  </div>
                ))}
              </div>
            )}
            {plateEpitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {plateEpitaphList.map((t, idx) => (
                  <div key={`plate-ep-${idx}`} style={{ ...sectionBox, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 8 }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    <button type="button" onClick={() => {
                      const arr = plateEpitaphList.slice(); arr.splice(idx, 1); setPlateEpitaph(arr.join("\n\n"));
                    }} style={glassButtonStyle("nano")}>Удалить</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Дополнительно */}
      <ExtrasSection
        extraBase={extraBase} setExtraBase={setExtraBase}
        extraFlowerbed={extraFlowerbed} setExtraFlowerbed={setExtraFlowerbed}
        extraPlate={extraPlate} setExtraPlate={setExtraPlate}
        plateSize={plateSize} setPlateSize={setPlateSize}
        plateCustomSize={plateCustomSize} setPlateCustomSize={setPlateCustomSize}
        plateThickness={plateThickness} setPlateThickness={setPlateThickness}
        plateCustomThickness={plateCustomThickness} setPlateCustomThickness={setPlateCustomThickness}
        plateOrientation={plateOrientation} setPlateOrientation={setPlateOrientation}
        plateEpitaph={plateEpitaph} setPlateEpitaph={setPlateEpitaph}
        catsLoading={catsLoading} catsError={catsError} cats={cats}
        catOpen={catOpen} setCatOpen={setCatOpen}
        addPlateGraphic={addPlateGraphic} removePlateGraphic={removePlateGraphic}
        plateIds={plateIds}
      />

      {/* Примечания */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Примечание к заказу</label>
        <textarea id="order-notes" rows={3} value={orderNotes} onChange={(e) => { setOrderNotes(e.target.value); scheduleSaveOrderNotes(); }} placeholder="Любые замечания к заказу…" style={{ ...inputStyle(), resize: "vertical" }} />
      </section>

      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy || sendingPdf)} disabled={busy || sendingPdf}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy || sendingPdf)} disabled={busy || sendingPdf}>{busy ? "Отправляем…" : "Оформить заказ"}</button>
        <button type="button" onClick={() => setSimpleOpen(true)} style={glassButtonStyle("sm", busy || sendingPdf)} disabled={busy || sendingPdf}>{sendingPdf ? "Готовим PDF…" : "Заказ списком"}</button>
      </div>

      {/* Оверлей «Заказ списком» */}
      {simpleOpen && (
        <PrintOverlay
          onClose={() => setSimpleOpen(false)}
          onSave={onSavePdf}
          orderNo={orderNo}
          name={(loadIntroState().intro?.customerName || "").trim()}
          phone={(loadIntroState().intro?.customerPhone || "").trim()}
          frontSketch={
            <SketchTemplate
              item={item}
              peopleBlocks={peopleBlocks}
              crosses={selectedCrosses}
              others={selectedOthers}
              epitaphs={frontEpitaphs}
              carvingOpacity={0.4}
            />
          }
          previewBack={backSketchUrl || ""}
          frontData={{
            persons: frontPersons.map((p: any) => ({
              id: p.id,
              fio1: (p.lastName || "").trim(),
              fio2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
              dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — "),
              photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || ""
            })),
            graphics: frontGraphicsWithThumbs,
            epitaphs: frontEpitaphs.slice()
          }}
          rearData={{
            graphics: rearGraphicsWithThumbs,
            epitaphs: rearEpitaphs.slice()
          }}
          extras={{ base: extraBase, flowerbed: extraFlowerbed }}
          plate={{
            enabled: extraPlate,
            size: extraPlate ? plateSize : undefined,
            thickness: extraPlate ? plateThickness : undefined,
            graphics: chosenPlateList.map((g) => ({ name: g.name || g.id })),
            epitaph: (plateEpitaph || "").trim()
          }}
          notes={(extras0.orderNotes || "").trim()}
          aspect={aspect}
        />
      )}
    </div>
  );
}

/* ===== Обёртка «Дополнительно» (секция) ===== */
function ExtrasSection(props: {
  extraBase: boolean; setExtraBase: (v: boolean) => void;
  extraFlowerbed: boolean; setExtraFlowerbed: (v: boolean) => void;
  extraPlate: boolean; setExtraPlate: (v: boolean) => void;
  plateSize: string; setPlateSize: (v: string) => void;
  plateCustomSize: string; setPlateCustomSize: (v: string) => void;
  plateThickness: string; setPlateThickness: (v: string) => void;
  plateCustomThickness: string; setPlateCustomThickness: (v: string) => void;
  plateOrientation: string; setPlateOrientation: (v: string) => void;
  plateEpitaph: string; setPlateEpitaph: (v: string) => void;
  catsLoading: boolean; catsError: string; cats: any[];
  catOpen: Record<string, boolean>; setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void; removePlateGraphic: (gid: string) => void;
  plateIds: string[];
}) {
  const {
    extraBase, setExtraBase,
    extraFlowerbed, setExtraFlowerbed,
    extraPlate, setExtraPlate,
    plateSize, setPlateSize,
    plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness,
    plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic,
    plateIds
  } = props;

  return (
    <section id="section-extras" style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>Дополнительно</div>
      <hr style={hrStyle} />
      <div style={{ ...sectionBox }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={extraBase} onChange={(e) => setExtraBase(e.target.checked)} />
            <span>Тумба</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={extraFlowerbed} onChange={(e) => setExtraFlowerbed(e.target.checked)} />
            <span>Цветник</span>
          </label>
        </div>
      </div>
      <hr style={hrStyle} />
      <PlateBlock
        extraPlate={extraPlate}
        setExtraPlate={setExtraPlate}
        plateSize={plateSize}
        setPlateSize={setPlateSize}
        plateCustomSize={plateCustomSize}
        setPlateCustomSize={setPlateCustomSize}
        plateThickness={plateThickness}
        setPlateThickness={setPlateThickness}
        plateCustomThickness={plateCustomThickness}
        setPlateCustomThickness={setPlateCustomThickness}
        plateOrientation={plateOrientation}
        setPlateOrientation={setPlateOrientation}
        plateEpitaph={plateEpitaph}
        setPlateEpitaph={setPlateEpitaph}
        catsLoading={catsLoading}
        catsError={catsError}
        cats={cats}
        catOpen={catOpen}
        setCatOpen={setCatOpen}
        addPlateGraphic={addPlateGraphic}
        removePlateGraphic={removePlateGraphic}
        plateIds={plateIds}
      />
    </section>
  );
}
