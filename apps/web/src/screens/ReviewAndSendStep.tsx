// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Что исправлено по вашему сообщению:
// - Вернули аккордеоны «Дополнительно» и «Надгробная плита» (определён и используется LoudAccordion).
// - Экран больше «не прилипает» к краям: у корневого контейнера добавлены отступы и safe-area (iOS).
// - PDF: на одной странице слева — состав заказа (как в коде: Лицевая/Тыльная/Плита/Примечания),
//         справа — эскизы (лицевой над тыльным, друг над другом).
//         Далее каждая прикреплённая фотография — на отдельной странице.
// - В PDF добавлена информация о заказчике: имя, телефон и № заказа.
// - Прикреплённые фотографии берём из p.photoPreview/dataUrl/url/photo у людей; конвертируем через dataURL.
// - Доп. секции/стили PDF соответствуют разделам на странице (заголовки и блоки).
//
// Важно: для корректной вставки изображений в PDF источники картинок должны быть доступны по CORS
// или уже быть data:URL (например, загруженные фото — обычно dataURL из canvas/reader).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import SketchTemplate from "../components/SketchTemplate";

/* ===== html-to-image для DOM->PNG (эскизы) ===== */
declare global { interface Window { htmlToImage?: any; jspdf?: any } }
async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.htmlToImage) return window.htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("html-to-image load error"));
    document.head.appendChild(s);
  });
  if (!window.htmlToImage) throw new Error("html-to-image unavailable");
  return window.htmlToImage;
}

/* ===== jsPDF (PDF) + Century Schoolbook (Bold, BoldItalic) ===== */
async function ensureJsPdf(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  const CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("jspdf load error"));
    document.head.appendChild(s);
  });
  if (!window.jspdf?.jsPDF) throw new Error("jspdf unavailable");
  return window.jspdf.jsPDF;
}
let csFontReady = false;
async function ensureCenturyFonts(doc: any) {
  if (csFontReady) return;
  const BOLD = "/fonts/CenturySchoolbook-Bold.ttf";
  const BOLDIT = "/fonts/CenturySchoolbook-BoldItalic.ttf";
  async function fetchTtfToBase64(url: string): Promise<string | null> {
    try {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(ab);
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    } catch { return null; }
  }
  const [b64, bIt64] = await Promise.all([fetchTtfToBase64(BOLD), fetchTtfToBase64(BOLDIT)]);
  if (b64) { doc.addFileToVFS("CenturySchoolbook-Bold.ttf", b64); doc.addFont("CenturySchoolbook-Bold.ttf", "CenturySchoolbook", "bold"); }
  if (bIt64) { doc.addFileToVFS("CenturySchoolbook-BoldItalic.ttf", bIt64); doc.addFont("CenturySchoolbook-BoldItalic.ttf", "CenturySchoolbook", "bolditalic"); }
  csFontReady = !!(b64 && bIt64);
}

/* ===== UI helpers ===== */
function glassPanelStyle(): React.CSSProperties {
  return { background: "rgba(20,20,24,0.90)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", boxSizing: "border-box" };
}
function pagePadStyle(): React.CSSProperties {
  // Не прилипает к краям, учёт safe-area на iOS
  return {
    paddingTop: "12px",
    paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
    paddingLeft: "calc(12px + env(safe-area-inset-left))",
    paddingRight: "calc(12px + env(safe-area-inset-right))"
  };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const pad = size === "nano" ? "6px 10px" : size === "sm" ? "10px 14px" : "12px 18px";
  return {
    padding: pad, borderRadius: 12, border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}
function inputStyle(): React.CSSProperties { return { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", boxSizing: "border-box" }; }
const sectionBox: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 10 };
const hrStyle: React.CSSProperties = { border: 0, height: 1, background: "rgba(0,0,0,0.15)", margin: "8px 0" };
function grid3(): React.CSSProperties { return { display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }; }
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

/* ===== Миниатюра ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
  </div>
);

/* ===== Заголовок с контактами (сохранение на blur) ===== */
function EditableOrderSummary({ orderNo, onOpenSimple }: { orderNo: string; onOpenSimple: () => void }) {
  const introInitial = loadIntroState().intro || {};
  const [name, setName] = useState<string>(introInitial.customerName || "");
  const [phone, setPhone] = useState<string>(introInitial.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introInitial.customerNotes || "");

  const saveOnBlur = () => {
    const next: Intro = {
      customerName: (name || "").trim(),
      customerPhone: (phone || "").trim(),
      customerNotes: (contactNotes || "").trim() || undefined
    };
    saveIntro(next, { lock: false });
  };

  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onOpenSimple} style={linkLike()}>Посмотреть состав заказа</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveOnBlur} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={saveOnBlur} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} onBlur={saveOnBlur} placeholder="Примечание для связи…" style={inputStyle()} />
    </section>
  );
}

/* ===== Accordion (вернули) ===== */
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

/* ===== Грид каталога для плиты ===== */
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

/* ===== Блок плиты ===== */
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

/* ===== Модалка подтверждения отправки ===== */
function ConfirmSendModal({
  onClose, onSend, onSavePdf
}: { onClose: () => void; onSend: () => void; onSavePdf: () => void }) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 10000, display: "grid", placeItems: "center" }}>
      <div
        style={{ width: "100%", maxWidth: 420, background: "#fff", color: "#111", borderRadius: 12, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.55)", transform: "scale(0.98)", opacity: 0, animation: "modalIn 180ms ease forwards", position: "relative" }}
      >
        <style>{`@keyframes modalIn { to { transform: scale(1); opacity: 1; } } .btn { padding: 8px 12px; border-radius: 8px; border: 1px solid #999; cursor: pointer; background:#f7f7f7; }`}</style>
        <button onClick={onClose} title="Закрыть" style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, border: "1px solid #ccc", background: "#fafafa", cursor: "pointer" }}>×</button>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Вы хотите отправить заказ менеджерам для просчёта стоимости?</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={onSavePdf}>Сохранить PDF</button>
          <button className="btn" onClick={onSend} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>Отправить</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Модалка «Отправлено менеджерам» ===== */
function SentModal({ onClose, onNew }: { onClose: () => void; onNew: () => void }) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.60)", zIndex: 10000, display: "grid", placeItems: "center", padding: 12 }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 420, background: "#fff", color: "#111", borderRadius: 12, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <button onClick={onClose} title="Закрыть" style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, border: "1px solid #ccc", background: "#f7f7f7", cursor: "pointer" }}>×</button>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Ваш заказ отправлен менеджерам</div>
        <div style={{ fontSize: 14, lineHeight: 1.4, marginBottom: 16 }}>Мы просчитаем заказ и свяжемся с Вами в ближайшее время.</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onNew} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }}>Новый заказ</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Основной компонент шага ===== */
type PropsStep = { onBack?: () => void };
export default function ReviewAndSendStep({ onBack }: PropsStep) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
  }, []);

  const orderNo = String(introState.orderNumber || "").trim();

  // Эскизы и данные — как в предыдущей версии (см. выше)
  const backSketchUrl = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

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

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  /* ===== PDF (двухколоночная первая страница: слева состав, справа эскизы) ===== */
  async function urlToDataUrlPDF(url?: string | null): Promise<string | null> {
    try {
      if (!url) return null;
      if (url.startsWith("data:")) return url;
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }
  async function captureNodePng(node: HTMLElement): Promise<string | null> {
    try {
      const hti = await ensureHtmlToImage();
      return await hti.toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true });
    } catch { return null; }
  }
  async function sendPdfToServer(pdf: Blob, meta: any) {
    try {
      const fd = new FormData();
      fd.append("pdf", pdf, `order-${meta?.orderNo || Date.now()}.pdf`);
      fd.append("payload", JSON.stringify(meta || {}));
      const res = await fetch("/api/send-order-pdf", { method: "POST", body: fd });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        alert(`Не удалось отправить PDF: ${t || res.statusText}`);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  async function createPdfTwoColumns(sendAlso: boolean) {
    // Размечаем: контент слева (60%), эскизы справа (40%), обе колонки вмещены на одной странице.
    try {
      // Готовим данные
      const jsPDF = await ensureJsPdf();
      const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
      await ensureCenturyFonts(doc);
      const FONT = csFontReady ? "CenturySchoolbook" : "helvetica";

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;
      const innerW = pageW - margin * 2;
      const innerH = pageH - margin * 2;
      const gap = 24;
      const rightW = Math.round(innerW * 0.40);
      const leftW = innerW - gap - rightW;

      // Преобразуем DOM узлы эскизов в PNG
      await new Promise(r => setTimeout(r, 160)); // дать DOM дорисовать
      const frontNode = document.getElementById("pdf-front-sketch");
      const backNode = document.getElementById("pdf-back-sketch");
      const frontPng = frontNode ? await captureNodePng(frontNode) : null;
      const backPng = backNode ? await captureNodePng(backNode) : (await urlToDataUrlPDF(backSketchUrl || null));

      // ——— Левая колонка — состав заказа ———
      let xL = margin, yL = margin;

      const setFont = (style: "bold" | "bolditalic", size: number) => { doc.setFont(FONT, style); doc.setFontSize(size); };
      const addTitle = (text: string) => {
        setFont("bold", 28);
        const lines = doc.splitTextToSize(text, leftW);
        for (const ln of lines) { doc.text(ln, xL, yL); yL += 34; }
      };
      const addMetric = (text: string, sz = 22) => {
        setFont("bold", sz);
        const lh = Math.round(sz * 1.25);
        const lines = doc.splitTextToSize(text, leftW);
        for (const ln of lines) { doc.text(ln, xL, yL); yL += lh; }
      };
      const addItalic = (text: string, sz = 22) => {
        setFont("bolditalic", sz);
        const lh = Math.round(sz * 1.25);
        const lines = doc.splitTextToSize(text, leftW);
        for (const ln of lines) { doc.text(ln, xL, yL); yL += lh; }
      };
      const addHr = () => { doc.setDrawColor(200); doc.setLineWidth(1); doc.line(xL, yL, xL + leftW, yL); yL += 12; };

      // Заголовок + заказчик
      addTitle(`Заказ № ${orderNo || "—"}`);
      const nm = (loadIntroState().intro?.customerName || "").trim() || "—";
      const ph = (loadIntroState().intro?.customerPhone || "").trim() || "—";
      addMetric(`${nm} · ${ph}`, 22);
      addHr();

      // Лицевая
      addTitle("Лицевая");
      addMetric("Усопшие", 24);
      if (frontPersons.length) {
        frontPersons.forEach((p: any) => {
          const fio = [(p.lastName || "").trim(), [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ")].filter(Boolean).join(" ");
          const dates = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
          addMetric([fio, dates].filter(Boolean).join(" · "));
        });
      } else addMetric("—");
      // Графика
      addMetric("Графика", 24);
      const fg = (allFrontGraphics || []);
      if (fg.length) fg.forEach((g: any) => addMetric(g.name || g.id || "—")); else addMetric("—");
      // Эпитафии
      addMetric("Эпитафии", 24);
      if (frontEpitaphs.length) frontEpitaphs.forEach((t) => addItalic(t)); else addMetric("—");
      addHr();

      // Тыльная
      addTitle("Тыльная");
      addMetric("Усопшие", 24); addMetric("—");
      addMetric("Графика", 24);
      const rg = (rearUnique || []);
      if (rg.length) rg.forEach((g: any) => addMetric(g.name || g.id || "—")); else addMetric("—");
      addMetric("Эпитафии", 24);
      const rearEps = (((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean);
      if (rearEps.length) rearEps.forEach((t) => addItalic(t)); else addMetric("—");
      addHr();

      // Плита
      addTitle("Надгробная плита");
      if (extraPlate) {
        addMetric(`Размер: ${plateSize || "—"}`);
        addMetric(`Толщина: ${plateThickness || "—"}`);
        addMetric("Графика", 24);
        if (chosenPlateList.length) chosenPlateList.forEach((g) => addMetric(g.name || g.id)); else addMetric("—");
        addMetric("Эпитафии", 24);
        if ((plateEpitaph || "").trim()) addItalic((plateEpitaph || "").trim()); else addMetric("—");
      } else {
        addMetric("нет");
      }
      addHr();

      // Примечания
      addTitle("Примечания");
      addMetric((extras0.orderNotes || "").trim() || "—");

      // ——— Правая колонка — эскизы (один над другим) ———
      let xR = margin + leftW + gap;
      let yR = margin;
      const placeImageRight = async (dataUrl: string | null | undefined, maxAvailW: number, maxAvailH: number) => {
        if (!dataUrl) return 0;
        const im = new Image();
        await new Promise<void>((res) => { im.onload = () => res(); im.src = dataUrl!; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (!iw || !ih) return 0;
        const scale = Math.min(maxAvailW / iw, maxAvailH / ih, 1);
        const w = Math.round(iw * scale), h = Math.round(ih * scale);
        doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG", xR, yR, w, h, undefined, "FAST");
        yR += h + 12;
        return h + 12;
      };
      // Front
      await placeImageRight(frontPng, rightW, Math.floor(innerH / 2) - 6);
      // Back
      await placeImageRight(backPng, rightW, innerH - (yR - margin));

      // ——— Фото усопших на отдельных страницах ———
      const photos: string[] = frontPersons.map((p) => p.photo).filter(Boolean) as string[];
      for (let i = 0; i < photos.length; i++) {
        doc.addPage();
        let y = margin;
        setFont("bold", 28); doc.text(`Фото ${i + 1}`, margin, y); y += 34;
        const data = await urlToDataUrlPDF(photos[i]);
        if (data) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const scale = Math.min(innerW / iw, (innerH - (y - margin)) / ih, 1);
            const w = Math.round(iw * scale), h = Math.round(ih * scale);
            const x = margin + Math.max(0, (innerW - w) / 2);
            doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, y, w, h, undefined, "FAST");
          }
        } else {
          setFont("bold", 22); doc.text("—", margin, y);
        }
      }

      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      const blob = doc.output("blob");
      if (sendAlso) {
        await sendPdfToServer(blob, {
          orderNo: orderNoCur,
          intro: loadIntroState().intro || {},
          extras: (loadOrderDraft() as any)?.extras || {}
        });
        setConfirmOpen(false);
        setSentOpen(true);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `order-${orderNoCur || Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Не удалось сформировать PDF.");
    }
  }

  /* ===== Модалки/кнопки ===== */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", ...pagePadStyle() }}>
      {/* Заголовок с контактами и кнопкой «Посмотреть состав заказа» */}
      <EditableOrderSummary orderNo={orderNo} onOpenSimple={() => window.scrollTo({ top: 0, behavior: "smooth" })} />

      {/* Выбрано для плиты (если есть) */}
      {extraPlate && (
        (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
          <section style={{ ...glassPanelStyle(), padding: 12 }}>
            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
              {chosenPlateList.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                  {chosenPlateList.map((g, i) => (
                    <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8, alignItems: "center" }}>
                      <Thumb url={g.url} />
                      <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                    </div>
                  ))}
                </div>
              )}
              {plateEpitaphList.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {plateEpitaphList.map((t, idx) => (
                    <div key={`plate-ep-${idx}`} style={{ ...sectionBox, padding: 8 }}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )
      )}

      {/* Эскиз — лицевая (DOM id нужен для PDF) */}
      <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскиз — лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
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
      </section>

      {/* Эскиз — тыльная (если есть) */}
      {backSketchUrl && (
        <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскиз — тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img id="pdf-back-sketch" src={backSketchUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1, pointerEvents: "none" }} />
          </div>
        </section>
      )}

      {/* Дополнительно (с аккордеонами) */}
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
      <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 12 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Примечание к заказу</label>
        <textarea id="order-notes" rows={3} defaultValue={(extras0.orderNotes || "").trim()} onBlur={(e) => {
          const prev = loadOrderDraft();
          const extras: any = { ...(prev as any).extras, orderNotes: (e.target.value || "").trim() || undefined };
          saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
          setDraft(loadOrderDraft());
        }} placeholder="Любые замечания к заказу…" style={{ ...inputStyle(), resize: "vertical" }} />
      </section>

      {/* Подсказка */}
      <div style={{ fontSize: 12, opacity: 0.85, margin: "6px 12px" }}>
        Не беспокойтесь: даже при отсутствии нужного пункта финальное подтверждение — по телефону или лично.
      </div>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Рассчитать стоимость</button>
      </div>

      {/* Модалки */}
      {confirmOpen && (
        <ConfirmSendModal
          onClose={() => setConfirmOpen(false)}
          onSavePdf={() => createPdfTwoColumns(false)}
          onSend={() => createPdfTwoColumns(true)}
        />
      )}
      {sentOpen && (
        <SentModal
          onClose={() => setSentOpen(false)}
          onNew={() => { if (typeof window !== "undefined") window.location.href = "/"; }}
        />
      )}
    </div>
  );
}

/* ===== Обёртка «Дополнительно» ===== */
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

  const [accPlateOpen, setAccPlateOpen] = useState(true);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);
  const [accEpOpen, setAccEpOpen] = useState(false);

  return (
    <section id="section-extras" style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>Дополнительно</div>
      <hr style={hrStyle} />

      {/* Тумба/Цветник */}
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

      {/* Надгробная плита — общий аккордеон */}
      <LoudAccordion title="Надгробная плита" open={accPlateOpen} onToggle={() => setAccPlateOpen(v => !v)}>
        <div style={{ display: "grid", gap: 12 }}>
          {/* Размер/Толщина/Ориентация */}
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-size" checked={props.plateSize === v} onChange={() => props.setPlateSize(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
            {props.plateSize === "Свой вариант" && (
              <input value={props.plateCustomSize} onChange={(e) => props.setPlateCustomSize(e.target.value)} placeholder="Укажите свой размер (например, 130×60 см)" style={inputStyle()} />
            )}
          </div>

          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-thickness" checked={props.plateThickness === v} onChange={() => props.setPlateThickness(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
            {props.plateThickness === "Свой вариант" && (
              <input value={props.plateCustomThickness} onChange={(e) => props.setPlateCustomThickness(e.target.value)} placeholder="Укажите толщину (например, 7 см)" style={inputStyle()} />
            )}
          </div>

          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-orient" checked={props.plateOrientation === v} onChange={() => props.setPlateOrientation(v)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Эпитафии (аккордеон) */}
          <LoudAccordion title="Эпитафии" open={accEpOpen} onToggle={() => setAccEpOpen(v => !v)}>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => {
                    const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
                    const active = norm((props.plateEpitaph || ""))?.includes(norm(t));
                    return (
                      <button key={t} type="button" onClick={() => {
                        const list = toParagraphs(props.plateEpitaph);
                        const exists = list.some((s) => norm(s) === norm(t));
                        const next = exists ? list.filter((s) => norm(s) !== norm(t)) : list.concat([t]);
                        props.setPlateEpitaph(next.join("\n\n"));
                      }} style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }} title={t}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ ...sectionBox }}>
                <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                <textarea rows={3} value={props.plateEpitaph} onChange={(e) => props.setPlateEpitaph(e.target.value)} placeholder="Текст эпитафии…" style={{ ...inputStyle(), resize: "vertical" }} />
              </div>
            </div>
          </LoudAccordion>

          {/* Графика (аккордеон) */}
          <LoudAccordion title="Графика" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen(v => !v)}>
            {props.catsLoading && <div>Загрузка каталога…</div>}
            {props.catsError && <div style={{ color: "#ffb4b4" }}>{props.catsError}</div>}
            {!props.catsLoading && props.cats.length === 0 && !props.catsError && <div>Каталог пуст.</div>}
            {!props.catsLoading && props.cats.length > 0 && (
              <div style={{ display: "grid", gap: 12 }}>
                {props.cats.map((cat: any, idx: number) => {
                  const catKey = String(cat._id || cat.name || idx);
                  const open = !!(props.catOpen || {})[catKey];
                  const setToggle = () => props.setCatOpen({ ...(props.catOpen || {}), [catKey]: !open });
                  return (
                    <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={setToggle}>
                      <CatGrid items={cat.items || []} plateIds={props.plateIds} addGraphic={props.addPlateGraphic} removeGraphic={props.removePlateGraphic} />
                      {(cat.children || []).map((sub: any, j: number) => (
                        <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                          <CatGrid items={sub.items || []} plateIds={props.plateIds} addGraphic={props.addPlateGraphic} removeGraphic={props.removePlateGraphic} />
                        </div>
                      ))}
                    </LoudAccordion>
                  );
                })}
              </div>
            )}
          </LoudAccordion>
        </div>
      </LoudAccordion>
    </section>
  );
}
