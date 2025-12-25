// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение» с интеграцией TopBar.
//
// Обновление:
// - «Посмотреть состав заказа» перенесена напротив номера заказа (в одну строку справа).
// - Боковые отступы сделаны минимальными (safe-area учтена).
// - Остальное без изменений: max-width 600px, аккордеоны «Дополнительно / Надгробная плита», эскизы,
//   комментарий, кнопки «Назад / Рассчитать стоимость», bottom sheet подтверждения.
// - PDF (1512×2138): слева — состав заказа (с миниатюрами), справа — эскизы (лицевой над тыльным),
//   далее — каждое прикреплённое фото отдельной страницей. Включены имя, телефон, № заказа.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";

/* ===== html-to-image (DOM -> PNG) ===== */
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

/* ===== jsPDF + шрифты Century Schoolbook ===== */
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
function safeRoot(): React.CSSProperties {
  // Минимальные боковые отступы + safe-area, чтобы контент не уходил за край
  return {
    width: "100%",
    maxWidth: 600,
    margin: "0 auto",
    paddingTop: "10px",
    paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
    paddingLeft: "calc(12px + env(safe-area-inset-left))",
    paddingRight: "calc(12px + env(safe-area-inset-right))",
    boxSizing: "border-box",
    overflowX: "hidden"
  };
}
function glassPanelStyle(): React.CSSProperties {
  return { background: "rgba(20,20,24,0.90)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", boxSizing: "border-box" };
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
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}

/* ===== Мини-компоненты ===== */
function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
      {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
    </div>
  );
}

/* ===== Заголовок: № заказа + линк справа ===== */
function EditableOrderSummary({ orderNo, onOpenTop }: { orderNo: string; onOpenTop: () => void }) {
  const introInitial = loadIntroState().intro || {};
  const [name, setName] = useState<string>(introInitial.customerName || "");
  const [phone, setPhone] = useState<string>(introInitial.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introInitial.customerNotes || "");
  const saveOnBlur = () => {
    const next: Intro = { customerName: name.trim(), customerPhone: phone.trim(), customerNotes: contactNotes.trim() || undefined };
    saveIntro(next, { lock: false });
  };

  return (
    <section style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
        <div style={{ marginLeft: "auto" }}>
          <button type="button" onClick={onOpenTop} style={linkLike()}>Посмотреть состав заказа</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveOnBlur} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={saveOnBlur} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} onBlur={saveOnBlur} placeholder="Примечание для связи…" style={inputStyle()} />
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
    <div style={{ ...glassPanelStyle(), padding: 0 }}>
      <button type="button" onClick={onToggle} style={{ width: "100%", textAlign: "left", padding: "12px 14px", background: "rgba(255,255,255,0.06)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 15, fontWeight: 700 }}>
        <span>{title}</span><span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Грид каталога (для плиты) ===== */
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

/* ===== Блок плиты/дополнительно (аккордеоны) ===== */
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

  const [accMainOpen, setAccMainOpen] = useState(true);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <LoudAccordion title="Дополнительно / Надгробная плита" open={accMainOpen} onToggle={() => setAccMainOpen(v => !v)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...sectionBox }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
              <span style={{ fontWeight: 700 }}>Надгробная плита</span>
            </label>
          </div>

          {extraPlate && (
            <>
              <div style={{ ...sectionBox }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
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

              <div style={{ ...sectionBox }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
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

              <div style={{ ...sectionBox }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => setPlateOrientation(v)} />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen(v => !v)}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ ...sectionBox }}>
                    <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                    <textarea rows={3} value={plateEpitaph} onChange={(e) => setPlateEpitaph(e.target.value)} placeholder="Введите текст…" style={{ ...inputStyle(), resize: "vertical" }} />
                  </div>
                  <div>
                    <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {QUICK_EPITAPHS.map((t) => (
                        <button key={t} type="button" onClick={() => {
                          const list = toParagraphs(plateEpitaph);
                          const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
                          const exists = list.some((s) => norm(s) === norm(t));
                          const next = exists ? list.filter((s) => norm(s) !== norm(t)) : list.concat([t]);
                          setPlateEpitaph(next.join("\n\n"));
                        }} style={glassButtonStyle("nano")} title={t}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ margin: "10px 0 6px" }}>Больше вариантов:</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                      {MORE_EPITAPHS.map((t, i) => (
                        <button key={i} type="button" onClick={() => {
                          const list = toParagraphs(plateEpitaph);
                          const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
                          const exists = list.some((s) => norm(s) === norm(t));
                          const next = exists ? list.filter((s) => norm(s) !== norm(t)) : list.concat([t]);
                          setPlateEpitaph(next.join("\n\n"));
                        }} style={{ ...glassPanelStyle(), borderRadius: 10, padding: 10, textAlign: "left", cursor: "pointer" }}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </LoudAccordion>

              <LoudAccordion title="Графика на плите" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen(v => !v)}>
                {props.catsLoading && <div>Загрузка каталога…</div>}
                {props.catsError && <div style={{ color: "#ffb4b4" }}>{props.catsError}</div>}
                {!props.catsLoading && props.cats.length === 0 && !props.catsError && <div>Каталог пуст.</div>}
                {!props.catsLoading && props.cats.length > 0 && (
                  <div style={{ display: "grid", gap: 12 }}>
                    {props.cats.map((cat: any, idx: number) => {
                      const catKey = String(cat._id || cat.name || idx);
                      const open = !!(props.catOpen || {})[catKey];
                      const toggle = () => props.setCatOpen({ ...(props.catOpen || {}), [catKey]: !open });
                      return (
                        <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={toggle}>
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
            </>
          )}
        </div>
      </LoudAccordion>
    </div>
  );
}

/* ===== Bottom sheet подтверждение ===== */
function ConfirmBottomSheet({ onClose, onSend, onSave }: { onClose: () => void; onSend: () => void; onSave: () => void }) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111",
          borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16,
          boxShadow: "0 -20px 60px rgba(0,0,0,0.45)", transform: "translateY(8px)", opacity: 0,
          animation: "sheetIn 180ms ease forwards"
        }}
      >
        <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <button onClick={onClose} title="Закрыть" className="btn">×</button>
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам для просчёта стоимости?</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onSave}>Сохранить PDF</button>
          <button className="btn" onClick={onSend} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>Отправить</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Основной компонент ===== */
type Props = { onBack?: () => void };
export default function ReviewAndSendStep({ onBack }: Props) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
  }, []);

  const orderNo = String(introState.orderNumber || "").trim();

  // Развернуть TopBar
  const openTopbar = () => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-controls="order-panel"]');
    if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Эскизы и данные
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

  // Плита
  const extras0 = (draft as any)?.extras || {};
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

  // Каталог для плиты
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

  // Bottom sheet
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* ===== PDF: состав с миниатюрами слева + эскизы справа, фото по страницам ===== */
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
    const hti = await ensureHtmlToImage();
    return await hti.toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true });
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

  // Замените существующую функцию createPdfTwoColumns в src/screens/ReviewAndSendStep.tsx
// на эту версию. Она:
// - использует размер шрифта 14 для всего контента,
// - увеличивает межстрочные интервалы и интервалы между разделами,
// - отображает элементы внутри каждого раздела столбцами (grid) с сохранением пропорций миниатюр,
// - «важное» (заголовки разделов, ФИО, названия графики) — жирным курсивом (bold italic).

async function createPdfTwoColumns(sendAlso: boolean) {
  try {
    // Дать DOM дорисоваться (эскизы)
    await new Promise(r => setTimeout(r, 160));

    const jsPDF = await ensureJsPdf();
    const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
    await ensureCenturyFonts(doc);
    const FONT = csFontReady ? "CenturySchoolbook" : "helvetica";

    // Геометрия страницы
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const innerW = pageW - margin * 2;
    const innerH = pageH - margin * 2;
    const gapCols = 28;     // зазор между левой/правой колонками
    const rightW = Math.round(innerW * 0.40);
    const leftW = innerW - gapCols - rightW;

    // Типографика (всё 14)
    const SIZE_BASE = 14;
    const LH = Math.round(SIZE_BASE * 1.45);  // межстрочный
    const SEC_SPACE = 18;                     // отступ между разделами
    const TITLE_SPACE = 10;                   // отступ после заголовка

    const setBase = (style: "bold" | "bolditalic" | "normal" = "bold") => {
      if (style === "bolditalic") doc.setFont(FONT, "bolditalic");
      else if (style === "bold") doc.setFont(FONT, "bold");
      else doc.setFont(FONT, "bold"); // helvetica не имеет normal + кириллица в embedded — держим bold
      doc.setFontSize(SIZE_BASE);
    };

    // Вспомогательные конвертеры изображений
    async function toDataUrl(url?: string | null): Promise<string | null> {
      try {
        if (!url) return null;
        if (url.startsWith("data:")) return url;
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ""));
          fr.readAsDataURL(blob);
        });
      } catch { return null; }
    }
    async function imageMeta(dataUrl: string): Promise<{ w: number; h: number } | null> {
      try {
        const im = new Image();
        await new Promise<void>((res) => { im.onload = () => res(); im.src = dataUrl; });
        const w = im.naturalWidth || 0, h = im.naturalHeight || 0;
        if (!w || !h) return null;
        return { w, h };
      } catch { return null; }
    }
    async function addImageFitted(dataUrl?: string | null, x=0, y=0, maxW=100, maxH=100): Promise<{ w: number; h: number } | null> {
      if (!dataUrl) return null;
      const meta = await imageMeta(dataUrl);
      if (!meta) return null;
      const s = Math.min(maxW / meta.w, maxH / meta.h, 1);
      const w = Math.round(meta.w * s), h = Math.round(meta.h * s);
      try {
        doc.addImage(dataUrl, /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG", x, y, w, h, undefined, "FAST");
        return { w, h };
      } catch { return null; }
    }

    // Эскизы (DOM -> PNG)
    const frontNode = document.getElementById("pdf-front-sketch");
    const backNode = document.getElementById("pdf-back-sketch");
    const frontPng = frontNode ? await captureNodePng(frontNode) : null;
    const backPng = backNode ? await captureNodePng(backNode) : await toDataUrl(backSketchUrl || null);

    // Левая колонка: координаты
    let xL = margin, yL = margin;

    // Заголовок раздела
    function sectionTitle(text: string) {
      setBase("bolditalic");
      const lines = doc.splitTextToSize(text, leftW);
      lines.forEach((ln: string) => { doc.text(ln, xL, yL); yL += LH; });
      yL += TITLE_SPACE;
    }
    // Горизонтальная линия
    function hr(space = SEC_SPACE) {
      doc.setDrawColor(180);
      doc.setLineWidth(1.2);
      doc.line(xL, yL, xL + leftW, yL);
      yL += space;
    }

    // Универсальный грид (столбцами) для разделов
    // items: массив; renderCell: async (x, y, colW) => высота ячейки
    async function renderGrid(items: any[], renderCell: (x: number, y: number, colW: number, idx: number) => Promise<number>, opts?: { minColW?: number; colGap?: number; rowGap?: number }) {
      const minColW = Math.max(180, opts?.minColW ?? 200);
      const colGap = opts?.colGap ?? 14;
      const rowGap = opts?.rowGap ?? 16;
      const cols = Math.max(2, Math.floor((leftW + colGap) / (minColW + colGap)));
      const colW = Math.floor((leftW - colGap * (cols - 1)));
      const eachW = Math.floor(colW / cols);

      let col = 0;
      let rowMaxH = 0;

      for (let i = 0; i < items.length; i++) {
        const x = xL + col * (eachW + colGap);
        const y = yL;
        const h = await renderCell(x, y, eachW, i);
        rowMaxH = Math.max(rowMaxH, h);

        col++;
        if (col >= cols || i === items.length - 1) {
          yL += rowMaxH + rowGap;
          col = 0;
          rowMaxH = 0;
        }
      }
      // Дополнительный отступ после грид-раздела
      yL += Math.round(LH * 0.25);
    }

    // Данные заказчика
    const nm = (loadIntroState().intro?.customerName || "").trim() || "—";
    const ph = (loadIntroState().intro?.customerPhone || "").trim() || "—";
    const orderNoCur = String(loadIntroState().orderNumber || "").trim();

    // Шапка
    sectionTitle(`Заказ № ${orderNoCur || "—"}`);
    setBase("bold"); doc.text(`${nm} · ${ph}`, xL, yL); yL += LH + Math.round(LH * 0.4);
    hr();

    // Лицевая — портреты в столбцах (портрет сверху, под ним 3 строки: фамилия, имя(отчество), даты)
    sectionTitle("Лицевая");
    setBase("bolditalic"); doc.text("Усопшие", xL, yL); yL += LH + 6;

    const portraitsFront = frontPersons.map((p: any) => ({
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null,
      l1: (p.lastName || "").trim(),
      l2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
      l3: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ")
    }));

    if (portraitsFront.length) {
      await renderGrid(portraitsFront, async (x, y, colW) => {
        const PADDING = 6;
        const IMG_MAX_H = 160; // увеличено
        let usedH = 0;
        // Фото
        const data = await toDataUrl(portraitsFront[Math.floor((x - xL) / colW)]?.photo);
        const img = await addImageFitted(data, x, y, colW, IMG_MAX_H);
        usedH += (img?.h || 0);
        let yText = y + usedH + PADDING;

        // ФИО/даты: важное — жирный курсив
        setBase("bolditalic");
        if (portraitsFront[Math.floor((x - xL) / colW)]?.l1) { doc.text(portraitsFront[Math.floor((x - xL) / colW)].l1, x, yText); yText += LH; }
        if (portraitsFront[Math.floor((x - xL) / colW)]?.l2) { doc.text(portraitsFront[Math.floor((x - xL) / colW)].l2, x, yText); yText += LH; }
        setBase("bold"); // даты можно обычным bold
        const dates = portraitsFront[Math.floor((x - xL) / colW)]?.l3 || "";
        doc.text(dates || "—", x, yText); yText += LH;

        return (yText - y);
      }, { minColW: 220, colGap: 16, rowGap: 20 });
    } else {
      setBase("bold"); doc.text("—", xL, yL); yL += LH;
    }
    yL += SEC_SPACE;

    // Лицевая — графика (миниатюра сверху, под ней название жирным курсивом)
    setBase("bolditalic"); doc.text("Графика", xL, yL); yL += LH + 6;
    const graphicsFront = (allFrontGraphics || []).map((g: any) => ({
      name: g.name || g.id || "—",
      url: g.preview || g.url || null
    }));
    if (graphicsFront.length) {
      await renderGrid(graphicsFront, async (x, y, colW, idx) => {
        const PADDING = 6;
        const IMG_MAX_H = 140;
        let usedH = 0;
        const data = await toDataUrl(graphicsFront[idx]?.url);
        const img = await addImageFitted(data, x, y, colW, IMG_MAX_H);
        usedH += (img?.h || 0);
        let yText = y + usedH + PADDING;
        setBase("bolditalic");
        const lines = doc.splitTextToSize(graphicsFront[idx]?.name || "—", colW);
        lines.forEach((ln: string) => { doc.text(ln, x, yText); yText += LH; });
        return (yText - y);
      }, { minColW: 200, colGap: 16, rowGap: 20 });
    } else {
      setBase("bold"); doc.text("—", xL, yL); yL += LH;
    }
    yL += SEC_SPACE;

    // Лицевая — эпитафии (каждый столбец — один блок текста)
    setBase("bolditalic"); doc.text("Эпитафии", xL, yL); yL += LH + 6;
    const frontEps = toParagraphs((draft?.engraving as any)?.epitaphs ?? (draft?.engraving as any)?.epitaphText);
    if (frontEps.length) {
      await renderGrid(frontEps, async (x, y, colW, idx) => {
        setBase("bolditalic");
        const lines = doc.splitTextToSize(frontEps[idx], colW);
        let yCur = y;
        lines.forEach((ln: string) => { doc.text(ln, x, yCur); yCur += LH; });
        return (yCur - y);
      }, { minColW: 220, colGap: 16, rowGap: 20 });
    } else {
      setBase("bold"); doc.text("—", xL, yL); yL += LH;
    }
    yL += SEC_SPACE;
    hr();

    // Тыльная
    sectionTitle("Тыльная");

    setBase("bolditalic"); doc.text("Усопшие", xL, yL); yL += LH + 6;
    setBase("bold"); doc.text("—", xL, yL); yL += LH + SEC_SPACE;

    setBase("bolditalic"); doc.text("Графика", xL, yL); yL += LH + 6;
    const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
    const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
    const rearCounts: Record<string, number> = {};
    (rearIds || []).forEach((id) => (rearCounts[id] = (rearCounts[id] || 0) + 1));
    const rearUnique = Array.from(new Set(rearIds || [])).map((id) => rearMeta?.[id] || { id, name: id, url: "" });
    if (rearUnique.length) {
      await renderGrid(rearUnique, async (x, y, colW, idx) => {
        const PADDING = 6;
        const IMG_MAX_H = 140;
        let usedH = 0;
        const data = await toDataUrl(rearUnique[idx]?.url);
        const img = await addImageFitted(data, x, y, colW, IMG_MAX_H);
        usedH += (img?.h || 0);
        let yText = y + usedH + PADDING;
        setBase("bolditalic");
        const nm = `${rearUnique[idx]?.name || "—"}${rearCounts[rearUnique[idx]?.id || ""] > 1 ? ` ×${rearCounts[rearUnique[idx]?.id]}` : ""}`;
        const lines = doc.splitTextToSize(nm, colW);
        lines.forEach((ln: string) => { doc.text(ln, x, yText); yText += LH; });
        return (yText - y);
      }, { minColW: 200, colGap: 16, rowGap: 20 });
    } else {
      setBase("bold"); doc.text("—", xL, yL); yL += LH;
    }
    yL += SEC_SPACE;

    setBase("bolditalic"); doc.text("Эпитафии", xL, yL); yL += LH + 6;
    const rearEps = (((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean);
    if (rearEps.length) {
      await renderGrid(rearEps, async (x, y, colW, idx) => {
        setBase("bolditalic");
        const lines = doc.splitTextToSize(rearEps[idx], colW);
        let yCur = y;
        lines.forEach((ln: string) => { doc.text(ln, x, yCur); yCur += LH; });
        return (yCur - y);
      }, { minColW: 220, colGap: 16, rowGap: 20 });
    } else {
      setBase("bold"); doc.text("—", xL, yL); yL += LH;
    }
    yL += SEC_SPACE;
    hr();

    // Плита
    sectionTitle("Надгробная плита");
    const plateEnabled = !!(draft as any)?.extras?.headstonePlate;
    if (plateEnabled) {
      setBase("bold"); doc.text(`Размер: ${(draft as any)?.extras?.plateSize || "—"}`, xL, yL); yL += LH;
      setBase("bold"); doc.text(`Толщина: ${(draft as any)?.extras?.plateThickness || "—"}`, xL, yL); yL += LH + SEC_SPACE;

      setBase("bolditalic"); doc.text("Графика", xL, yL); yL += LH + 6;
      const chosenPlateList: { id: string; name: string; url?: string }[] =
        Array.from(new Set(((draft as any)?.extras?.plateGraphicsIds as string[]) || []))
          .map((gid) => ((draft as any)?.extras?.plateGraphicsMeta || {})[gid] || { id: gid, name: gid, url: "" });
      if (chosenPlateList.length) {
        await renderGrid(chosenPlateList, async (x, y, colW, idx) => {
          const IMG_MAX_H = 120;
          let usedH = 0;
          const data = await toDataUrl(chosenPlateList[idx]?.url || null);
          const img = await addImageFitted(data, x, y, colW, IMG_MAX_H);
          usedH += (img?.h || 0);
          let yText = y + usedH + 6;
          setBase("bolditalic");
          const lines = doc.splitTextToSize(chosenPlateList[idx]?.name || "—", colW);
          lines.forEach((ln: string) => { doc.text(ln, x, yText); yText += LH; });
          return (yText - y);
        }, { minColW: 200, colGap: 16, rowGap: 20 });
      } else {
        setBase("bold"); doc.text("—", xL, yL); yL += LH;
      }
      yL += SEC_SPACE;

      setBase("bolditalic"); doc.text("Эпитафии", xL, yL); yL += LH + 6;
      const plateEp = String((draft as any)?.extras?.plateEpitaph || "").trim();
      if (plateEp) {
        await renderGrid(toParagraphs(plateEp), async (x, y, colW, idx) => {
          setBase("bolditalic");
          const lines = doc.splitTextToSize(toParagraphs(plateEp)[idx], colW);
          let yCur = y;
          lines.forEach((ln: string) => { doc.text(ln, x, yCur); yCur += LH; });
          return (yCur - y);
        }, { minColW: 220, colGap: 16, rowGap: 20 });
      } else {
        setBase("bold"); doc.text("—", xL, yL); yL += LH;
      }
    } else {
      setBase("bold"); doc.text("нет", xL, yL); yL += LH;
    }
    yL += SEC_SPACE;
    hr();

    // Примечания
    sectionTitle("Примечания");
    setBase("bold"); doc.text((extras0.orderNotes || "").trim() || "—", xL, yL); yL += LH + SEC_SPACE;

    // Правая колонка — эскизы (над друг другом, пропорции сохранены, увеличенные интервалы)
    let xR = margin + leftW + gapCols;
    let yR = margin;
    async function placeRight(dataUrl: string | null | undefined, maxH: number) {
      if (!dataUrl) return 0;
      const im = await imageMeta(dataUrl);
      if (!im) return 0;
      const s = Math.min(rightW / im.w, maxH / im.h, 1);
      const w = Math.round(im.w * s), h = Math.round(im.h * s);
      doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG", xR, yR, w, h, undefined, "FAST");
      yR += h + 20; // увеличенный отступ
      return h;
    }
    await placeRight(frontPng, Math.floor(innerH / 2) - 10);
    await placeRight(backPng, innerH - (yR - margin));

    // Фото усопших — отдельные страницы, крупнее
    const photos: string[] = frontPersons.map((p) => p.photo).filter(Boolean) as string[];
    for (let i = 0; i < photos.length; i++) {
      doc.addPage();
      let y = margin;
      setBase("bolditalic");
      doc.text(`Фото ${i + 1}`, margin, y);
      y += LH + TITLE_SPACE;

      const data = await toDataUrl(photos[i]);
      if (data) {
        const im = await imageMeta(data);
        if (im) {
          const availW = pageW - margin * 2;
          const availH = pageH - margin - y;
          const s = Math.min(availW / im.w, availH / im.h, 1);
          const w = Math.round(im.w * s), h = Math.round(im.h * s);
          const x = margin + Math.max(0, (availW - w) / 2);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, y, w, h, undefined, "FAST");
        }
      } else {
        setBase("bold"); doc.text("Фото недоступно", margin, y);
      }
    }

    const blob = doc.output("blob");
    if (sendAlso) {
      await sendPdfToServer(blob, {
        orderNo: orderNoCur,
        intro: loadIntroState().intro || {},
        extras: (loadOrderDraft() as any)?.extras || {}
      });
      setConfirmOpen(false);
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


  return (
    <div style={safeRoot()}>
      {/* TopBar */}
      <TopBarWithIntro title="Memorial" />

      {/* № заказа + линк справа */}
      <EditableOrderSummary orderNo={orderNo} onOpenTop={openTopbar} />

      {/* Выбрано для плиты */}
      {extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
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
      )}

      {/* Аккордеоны «Дополнительно / Надгробная плита» */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
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
      </section>

      {/* Эскизы */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскиз — лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
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

      {backSketchUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскиз — тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img id="pdf-back-sketch" src={backSketchUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* Комментарий и подсказка */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Комментарий к заказу</label>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
          Не беспокойтесь: даже при отсутствии нужного пункта финальное подтверждение — по телефону или лично.
        </div>
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={(extras0.orderNotes || "").trim()}
          onBlur={(e) => {
            const prev = loadOrderDraft();
            const extras: any = { ...(prev as any).extras, orderNotes: (e.target.value || "").trim() || undefined };
            saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
            setDraft(loadOrderDraft());
          }}
          placeholder="Добавьте комментарий…"
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </section>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Рассчитать стоимость</button>
      </div>

      {/* Bottom sheet подтверждение */}
      {confirmOpen && (
        <ConfirmBottomSheet
          onClose={() => setConfirmOpen(false)}
          onSave={() => createPdfTwoColumns(false)}
          onSend={() => createPdfTwoColumns(true)}
        />
      )}
    </div>
  );
}
