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

// Вставьте эту версию вместо вашей функции createPdfTwoColumns в src/screens/ReviewAndSendStep.tsx.
// Она повторяет верстку из референс‑картинки:
// - Слева два серых блока (Лицевая, Надгробная плита). «Тыльная» — без заливки.
// - Заголовок клиента слева, номер заказа — по центру.
// - Усопшие: миниатюра слева, метрика справа (3 строки: Фамилия / Имя Отчество / Даты).
// - Графика: миниатюра слева, название файла справа.
// - Эпитафии: не жирные, крупнее обычного, аккуратные переносы.
// - Справа — эскизы (лицевой сверху, тыльный ниже), сохраняем пропорции.
// - Все высоты тщательно просчитаны, наложений нет.

async function createPdfTwoColumns(sendAlso: boolean) {
  try {
    await new Promise((r) => setTimeout(r, 80));

    const jsPDF = await ensureJsPdf();
    const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
    await ensureCenturyFonts(doc);
    const FONT = csFontReady ? "CenturySchoolbook" : "helvetica";

    // Попробуем подключить Regular (если нет — fallback на bold)
    let REG_READY = false;
    try {
      const r = await fetch("/fonts/CenturySchoolbook-Regular.ttf", { mode: "cors" });
      if (r.ok) {
        const ab = await r.arrayBuffer();
        let bin = ""; const bytes = new Uint8Array(ab);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        doc.addFileToVFS("CenturySchoolbook-Regular.ttf", btoa(bin));
        doc.addFont("CenturySchoolbook-Regular.ttf", "CenturySchoolbook", "normal");
        REG_READY = true;
      }
    } catch {}

    // Геометрия
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const innerW = pageW - margin * 2;
    const innerH = pageH - margin * 2;
    const gapCols = 28;
    const rightW = Math.round(innerW * 0.40);
    const leftW = innerW - gapCols - rightW;

    // Данные
    const order = draft || loadOrderDraft();
    const intro = loadIntroState();
    const custName = (intro.intro?.customerName || "—").trim();
    const custPhone = (intro.intro?.customerPhone || "—").trim();
    const orderNo = String(intro.orderNumber || "—").trim();

    const people = (((order?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null,
      last: (p.lastName || "").trim(),
      namePatr: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
      dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ")
    }));

    const gfxFront = ((order as any)?.graphics || []).map((g: any) => ({ name: g.name || g.id || "—", url: g.preview || g.url || null }));

    const rearIds: string[] = (((order as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
    const rearMeta: Record<string, any> = (((order as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
    const rearCounts: Record<string, number> = {};
    (rearIds || []).forEach((id) => (rearCounts[id] = (rearCounts[id] || 0) + 1));
    const gfxRear = Array.from(new Set(rearIds || [])).map((id) => rearMeta?.[id] || { id, name: id, url: "" });

    const epsFront = toParagraphs((order?.engraving as any)?.epitaphs ?? (order?.engraving as any)?.epitaphText);
    const epsRear = (((order as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean);

    const plateOn = !!(order as any)?.extras?.headstonePlate;
    const plateSize = (order as any)?.extras?.plateSize || "—";
    const plateThick = (order as any)?.extras?.plateThickness || "—";
    const plateList: { id: string; name: string; url?: string }[] =
      Array.from(new Set(((order as any)?.extras?.plateGraphicsIds as string[]) || []))
        .map((gid) => ((order as any)?.extras?.plateGraphicsMeta || {})[gid] || { id: gid, name: gid, url: "" });
    const plateEps = toParagraphs(((order as any)?.extras?.plateEpitaph || "").trim());

    const flowerbed = !!(order as any)?.extras?.flowerbed;
    const base = !!((order as any)?.extras?.base);
    const notes = String(((order as any)?.extras?.orderNotes || "")).trim());

    // Эскизы (DOM -> PNG)
    const frontNode = document.getElementById("pdf-front-sketch");
    const backNode = document.getElementById("pdf-back-sketch");
    const frontPng = frontNode ? await (await ensureHtmlToImage()).toPng(frontNode, { backgroundColor: "#ffffff", pixelRatio: 2 }) : null;
    const backPng =
      backNode
        ? await (await ensureHtmlToImage()).toPng(backNode as any, { backgroundColor: "#ffffff", pixelRatio: 2 })
        : await (async () => {
            try {
              const u = (order as any)?.editorBack?.previewHiUrl || (order as any)?.editorBack?.previewUrl;
              if (!u) return null;
              if (u.startsWith("data:")) return u;
              const res = await fetch(u, { mode: "cors" }); if (!res.ok) return null;
              const b = await res.blob();
              return await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(b); });
            } catch { return null; }
          })();

    // Типографика (под референс)
    const SIZE_BASE = 28;     // основной текст
    const SIZE_TITLE = 28;    // заголовки разделов (жирные, по центру)
    const SIZE_FILE = 30;     // названия файлов
    const SIZE_EPITAPH = 34;  // эпитафии — крупнее (см. картинку)
    let base = 32;            // стартовый базовый (чуть крупнее, дальше может уменьшиться)
    const minBase = 22;
    let lhK = 1.22;           // межстрочный (безопасный, чтобы не налезало)
    const minLhK = 1.14;

    // Карточки
    let photoH = 110;         // высота миниатюр в людях
    let gfxH = 90;            // высота миниатюр в графике
    let plateH = 90;
    const minImgH = 56;
    let minColW = 255;        // ширина колонки в сетке
    let gapCol = 16, gapRow = 16, gapText = 14;

    // Хелперы шрифта/текста
    const setFont = (bold = false, size = base) => {
      if (bold) doc.setFont(FONT, "bold");
      else doc.setFont(REG_READY ? "CenturySchoolbook" : FONT, REG_READY ? "normal" : "bold");
      doc.setFontSize(size);
    };
    const lh = (size = base) => Math.ceil(size * lhK);
    const split = (text: string, width: number, size = base, bold = false) => { setFont(bold, size); return doc.splitTextToSize(text, width); };
    const cols = (availW: number) => Math.max(2, Math.floor((availW + gapCol) / (minColW + gapCol)));

    // Линия
    const hr = (y: number) => { doc.setDrawColor(180); doc.setLineWidth(1.2); doc.line(margin, y, margin + leftW, y); };

    // Измерение левой колонки и границ серых блоков
    function measureLeft() {
      let y = margin;

      // Заголовок клиента + номер
      // (Имя с телефоном слева, номер — по центру, как в макете)
      // Высоту считаем как две строки
      split(custName + " · " + custPhone, leftW, base, true).forEach(() => y += lh(base));
      split("Заказ № " + (orderNo || "—"), leftW, base, false).forEach(() => y += lh(base));

      // Серый блок «Лицевая»
      const faceTop = y + 6; y += 6; y += 1; // под линию
      split("Лицевая", leftW, SIZE_TITLE, true).forEach(() => y += lh(SIZE_TITLE));

      // Усопшие
      split("Усопшие", leftW, base, false).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        const imgW = Math.floor(cellW * 0.40);
        const txtW = Math.max(40, cellW - imgW - gapText);
        let colI = 0, rowMax = 0;
        if (people.length) {
          for (let i = 0; i < people.length; i++) {
            const hTxt =
              split(people[i].last || "—", txtW, base).length * lh(base) +
              split(people[i].namePatr || "—", txtW, base).length * lh(base) +
              split(people[i].dates || "—", txtW, base).length * lh(base);
            const hCell = Math.max(photoH, hTxt);
            rowMax = Math.max(rowMax, hCell);
            if (++colI >= c || i === people.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }

      // Графика (внутри «Лицевая»)
      y += 4; split("Графика", leftW, base).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        const imgW = Math.floor(cellW * 0.40);
        const txtW = Math.max(40, cellW - imgW - gapText);
        let colI = 0, rowMax = 0;
        if (gfxFront.length) {
          for (let i = 0; i < gfxFront.length; i++) {
            const hTxt = split(gfxFront[i].name, txtW, SIZE_FILE).length * lh(SIZE_FILE);
            const hCell = Math.max(gfxH, hTxt);
            rowMax = Math.max(rowMax, hCell);
            if (++colI >= c || i === gfxFront.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }

      // Эпитафии (внутри «Лицевая»)
      y += 4; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        let colI = 0, rowMax = 0;
        if (epsFront.length) {
          for (let i = 0; i < epsFront.length; i++) {
            const hTxt = split(epsFront[i], cellW, SIZE_EPITAPH).length * lh(SIZE_EPITAPH);
            rowMax = Math.max(rowMax, hTxt);
            if (++colI >= c || i === epsFront.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }
      const faceBottom = y;

      // «Тыльная»
      y += 10; // небольшой интервал между серым блоком и белым
      const rearHrY = y; y += 1; // линия
      split("Тыльная", leftW, SIZE_TITLE, true).forEach(() => y += lh(SIZE_TITLE));
      split("Усопшие", leftW, base).forEach(() => y += lh(base));
      y += lh(base); // «—»

      y += 4; split("Графика", leftW, base).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        const imgW = Math.floor(cellW * 0.40);
        const txtW = Math.max(40, cellW - imgW - gapText);
        let colI = 0, rowMax = 0;
        if (gfxRear.length) {
          for (let i = 0; i < gfxRear.length; i++) {
            const nm = `${gfxRear[i].name || "—"}${(rearCounts[gfxRear[i].id || ""] || 1) > 1 ? ` ×${rearCounts[gfxRear[i].id || ""]}` : ""}`;
            const hTxt = split(nm, txtW, SIZE_FILE).length * lh(SIZE_FILE);
            const hCell = Math.max(gfxH, hTxt);
            rowMax = Math.max(rowMax, hCell);
            if (++colI >= c || i === gfxRear.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }

      y += 4; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        let colI = 0, rowMax = 0;
        if (epsRear.length) {
          for (let i = 0; i < epsRear.length; i++) {
            const hTxt = split(epsRear[i], cellW, SIZE_EPITAPH).length * lh(SIZE_EPITAPH);
            rowMax = Math.max(rowMax, hTxt);
            if (++colI >= c || i === epsRear.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }

      // Серый блок «Надгробная плита»
      y += 10;
      const plateTop = y + 6; y += 6; y += 1; // линия над заголовком
      split("Надгробная плита", leftW, SIZE_TITLE, true).forEach(() => y += lh(SIZE_TITLE));
      split(`Размер: ${plateOn ? plateSize : "—"}`, leftW, base).forEach(() => y += lh(base));
      split(`Толщина: ${plateOn ? plateThick : "—"}`, leftW, base).forEach(() => y += lh(base));

      y += 4; split("Графика", leftW, base).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        const imgW = Math.floor(cellW * 0.40);
        const txtW = Math.max(40, cellW - imgW - gapText);
        let colI = 0, rowMax = 0;
        if (plateOn && plateList.length) {
          for (let i = 0; i < plateList.length; i++) {
            const hTxt = split(plateList[i].name || "—", txtW, SIZE_FILE).length * lh(SIZE_FILE);
            const hCell = Math.max(plateH, hTxt);
            rowMax = Math.max(rowMax, hCell);
            if (++colI >= c || i === plateList.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }

      y += 4; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
      {
        const c = cols(leftW);
        const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
        let colI = 0, rowMax = 0;
        if (plateOn && plateEps.length) {
          for (let i = 0; i < plateEps.length; i++) {
            const hTxt = split(plateEps[i], cellW, SIZE_EPITAPH).length * lh(SIZE_EPITAPH);
            rowMax = Math.max(rowMax, hTxt);
            if (++colI >= c || i === plateEps.length - 1) { y += rowMax + gapRow; colI = 0; rowMax = 0; }
          }
        } else y += lh(base);
      }
      const plateBottom = y;

      // Дополнительно
      y += 10; split("Дополнительно", leftW, base).forEach(() => y += lh(base));
      split(`Цветник: ${flowerbed ? "да" : "нет"}`, leftW, base).forEach(() => y += lh(base));
      split(`Тумба: ${base ? "да" : "нет"}`, leftW, base).forEach(() => y += lh(base));

      // Примечания
      y += 6; y += 1;
      split("Примечания", leftW, base).forEach(() => y += lh(base));
      split(notes || "—", leftW, base).forEach(() => y += lh(base));

      return { total: y - margin, faceTop, faceBottom, plateTop, plateBottom };
    }

    // Подгонка до влезания
    let meas = measureLeft();
    while (meas.total > innerH) {
      let changed = false;
      if (photoH > minImgH || gfxH > minImgH || plateH > minImgH) {
        photoH = Math.max(minImgH, Math.round(photoH * 0.92));
        gfxH   = Math.max(minImgH, Math.round(gfxH   * 0.92));
        plateH = Math.max(minImgH, Math.round(plateH * 0.92));
        changed = true;
      } else if (lhK > minLhK) {
        lhK = Math.max(minLhK, +(lhK - 0.02).toFixed(2));
        changed = true;
      } else if (minColW > 210) {
        minColW = Math.max(210, minColW - 20);
        changed = true;
      } else if (base > minBase) {
        base = Math.max(minBase, base - 2);
        changed = true;
      }
      if (!changed) break;
      meas = measureLeft();
    }

    // Рендер: серые блоки сначала, потом текст (чтобы текст был поверх)
    doc.setFillColor(238, 238, 238);
    doc.rect(margin, meas.faceTop, leftW, Math.max(0, meas.faceBottom - meas.faceTop), "F");
    doc.rect(margin, meas.plateTop, leftW, Math.max(0, meas.plateBottom - meas.plateTop), "F");

    // Левая колонка — печать
    let y = margin;

    // Клиент слева
    setFont(true, base);
    doc.text(`${custName} · ${custPhone}`, margin, y); y += lh(base);
    // Номер по центру
    setFont(false, base);
    doc.text(`Заказ № ${orderNo || "—"}`, margin + leftW / 2, y, { align: "center", maxWidth: leftW }); y += lh(base);

    // Лицевая (линия над словом)
    y += 6; hr(y); y += 1;
    setFont(true, SIZE_TITLE); doc.text("Лицевая", margin + leftW / 2, y, { align: "center" }); y += lh(SIZE_TITLE);

    // Усопшие
    setFont(false, base); doc.text("Усопшие", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * 0.40);
      const txtW = Math.max(40, cellW - imgW - gapText);

      let colI = 0, rowMax = 0, rowStartY = y;
      for (let i = 0; i < (people.length || 1); i++) {
        if (!people.length) { setFont(false, base); doc.text("—", margin, rowStartY); rowMax = Math.max(rowMax, lh(base)); i = 0; break; }

        const cx = margin + colI * (cellW + gapCol);
        // Фото слева
        let usedH = 0;
        const data = people[i].photo ? await (async (u?: string | null) => {
          try {
            if (!u) return null;
            if (u.startsWith("data:")) return u;
            const res = await fetch(u, { mode: "cors" });
            if (!res.ok) return null;
            const b = await res.blob();
            return await new Promise<string>((resolve) => {
              const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(b);
            });
          } catch { return null; }
        })(people[i].photo) : null;

        if (data) {
          const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgW / iw, photoH / ih, 1);
            const w = Math.min(imgW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
            usedH = h;
          }
        }
        // Метрика справа (3 строки)
        let yTxt = rowStartY;
        const xTxt = cx + imgW + gapText;
        setFont(false, base);
        for (const ln of split(people[i].last || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
        for (const ln of split(people[i].namePatr || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
        for (const ln of split(people[i].dates || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }

        const cellH = Math.max(usedH, yTxt - rowStartY);
        rowMax = Math.max(rowMax, cellH);

        if (++colI >= c || i === people.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Графика (внутри «Лицевая»)
    y += 4; setFont(false, base); doc.text("Графика", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * 0.40);
      const txtW = Math.max(40, cellW - imgW - gapText);

      let colI = 0, rowMax = 0, rowStartY = y;
      if (!gfxFront.length) { setFont(false, base); doc.text("—", margin, y); y += lh(base); }
      for (let i = 0; i < gfxFront.length; i++) {
        const cx = margin + colI * (cellW + gapCol);

        // миниатюра
        let usedH = 0;
        const data = gfxFront[i].url ? await (async (u?: string | null) => {
          try {
            if (!u) return null; if (u.startsWith("data:")) return u;
            const res = await fetch(u, { mode: "cors" }); if (!res.ok) return null;
            const b = await res.blob();
            return await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(b); });
          } catch { return null; }
        })(gfxFront[i].url) : null;

        if (data) {
          const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgW / iw, gfxH / ih, 1);
            const w = Math.min(imgW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
            usedH = h;
          }
        }
        // название справа
        setFont(false, SIZE_FILE);
        const xTxt = cx + imgW + gapText;
        let yTxt = rowStartY;
        for (const ln of doc.splitTextToSize(gfxFront[i].name, txtW)) { doc.text(ln, xTxt, yTxt); yTxt += lh(SIZE_FILE); }

        rowMax = Math.max(rowMax, Math.max(usedH, yTxt - rowStartY));
        if (++colI >= c || i === gfxFront.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Эпитафии (внутри «Лицевая»)
    y += 4; setFont(false, base); doc.text("Эпитафии", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      let colI = 0, rowMax = 0, rowStartY = y;
      if (!epsFront.length) { setFont(false, base); doc.text("—", margin, y); y += lh(base); }
      for (let i = 0; i < epsFront.length; i++) {
        const cx = margin + colI * (cellW + gapCol);
        let yC = rowStartY;
        setFont(false, SIZE_EPITAPH);
        for (const ln of doc.splitTextToSize(epsFront[i], cellW)) { doc.text(ln, cx, yC); yC += lh(SIZE_EPITAPH); }
        rowMax = Math.max(rowMax, yC - rowStartY);
        if (++colI >= c || i === epsFront.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Тыльная (линия сверху)
    y += 10; hr(y); y += 1;
    setFont(true, SIZE_TITLE); doc.text("Тыльная", margin + leftW / 2, y, { align: "center" }); y += lh(SIZE_TITLE);

    setFont(false, base); doc.text("Усопшие", margin, y); y += lh(base);
    doc.text("—", margin, y); y += lh(base);

    // Тыльная — графика
    y += 4; setFont(false, base); doc.text("Графика", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * 0.40);
      const txtW = Math.max(40, cellW - imgW - gapText);

      let colI = 0, rowMax = 0, rowStartY = y;
      if (!gfxRear.length) { setFont(false, base); doc.text("—", margin, y); y += lh(base); }
      for (let i = 0; i < gfxRear.length; i++) {
        const cx = margin + colI * (cellW + gapCol);

        let usedH = 0;
        const data = gfxRear[i].url ? await (async (u?: string | null) => {
          try {
            if (!u) return null; if (u.startsWith("data:")) return u;
            const res = await fetch(u, { mode: "cors" }); if (!res.ok) return null;
            const b = await res.blob();
            return await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(b); });
          } catch { return null; }
        })(gfxRear[i].url) : null;

        if (data) {
          const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgW / iw, gfxH / ih, 1);
            const w = Math.min(imgW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
            usedH = h;
          }
        }

        const nm = `${gfxRear[i].name || "—"}${(rearCounts[gfxRear[i].id || ""] || 1) > 1 ? ` ×${rearCounts[gfxRear[i].id || ""]}` : ""}`;
        setFont(false, SIZE_FILE);
        const xTxt = cx + imgW + gapText;
        let yTxt = rowStartY;
        for (const ln of doc.splitTextToSize(nm, txtW)) { doc.text(ln, xTxt, yTxt); yTxt += lh(SIZE_FILE); }

        rowMax = Math.max(rowMax, Math.max(usedH, yTxt - rowStartY));
        if (++colI >= c || i === gfxRear.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Тыльная — эпитафии
    y += 4; setFont(false, base); doc.text("Эпитафии", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      let colI = 0, rowMax = 0, rowStartY = y;
      if (!epsRear.length) { setFont(false, base); doc.text("—", margin, y); y += lh(base); }
      for (let i = 0; i < epsRear.length; i++) {
        const cx = margin + colI * (cellW + gapCol);
        let yC = rowStartY; setFont(false, SIZE_EPITAPH);
        for (const ln of doc.splitTextToSize(epsRear[i], cellW)) { doc.text(ln, cx, yC); yC += lh(SIZE_EPITAPH); }
        rowMax = Math.max(rowMax, yC - rowStartY);
        if (++colI >= c || i === epsRear.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Надгробная плита (линия сверху)
    y += 10; hr(y); y += 1;
    setFont(true, SIZE_TITLE); doc.text("Надгробная плита", margin + leftW / 2, y, { align: "center" }); y += lh(SIZE_TITLE);

    setFont(false, base); doc.text(`Размер: ${plateOn ? plateSize : "—"}`, margin, y); y += lh(base);
    doc.text(`Толщина: ${plateOn ? plateThick : "—"}`, margin, y); y += lh(base);

    // Плита — графика
    y += 4; setFont(false, base); doc.text("Графика", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * 0.40);
      const txtW = Math.max(40, cellW - imgW - gapText);
      let colI = 0, rowMax = 0, rowStartY = y;

      if (!(plateOn && plateList.length)) { setFont(false, base); doc.text("—", margin, y); y += lh(base); }
      for (let i = 0; i < (plateOn ? plateList.length : 0); i++) {
        const cx = margin + colI * (cellW + gapCol);

        let usedH = 0;
        const data = plateList[i].url ? await (async (u?: string | null) => {
          try { if (!u) return null; if (u.startsWith("data:")) return u;
            const res = await fetch(u, { mode: "cors" }); if (!res.ok) return null;
            const b = await res.blob();
            return await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(b); });
          } catch { return null; }
        })(plateList[i].url) : null;

        if (data) {
          const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgW / iw, plateH / ih, 1);
            const w = Math.min(imgW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
            usedH = h;
          }
        }

        setFont(false, SIZE_FILE);
        const xTxt = cx + imgW + gapText; let yTxt = rowStartY;
        for (const ln of doc.splitTextToSize(plateList[i].name || "—", txtW)) { doc.text(ln, xTxt, yTxt); yTxt += lh(SIZE_FILE); }

        rowMax = Math.max(rowMax, Math.max(usedH, yTxt - rowStartY));
        if (++colI >= c || i === plateList.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Плита — эпитафии
    y += 4; setFont(false, base); doc.text("Эпитафии", margin, y); y += lh(base);

    {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      let colI = 0, rowMax = 0, rowStartY = y;
      if (!(plateOn && plateEps.length)) { setFont(false, base); doc.text("—", margin, y); y += lh(base); }
      for (let i = 0; i < (plateOn ? plateEps.length : 0); i++) {
        const cx = margin + colI * (cellW + gapCol);
        let yC = rowStartY; setFont(false, SIZE_EPITAPH);
        for (const ln of doc.splitTextToSize(plateEps[i], cellW)) { doc.text(ln, cx, yC); yC += lh(SIZE_EPITAPH); }
        rowMax = Math.max(rowMax, yC - rowStartY);
        if (++colI >= c || i === plateEps.length - 1) {
          y = rowStartY + rowMax + gapRow; rowStartY = y; colI = 0; rowMax = 0;
        }
      }
    }

    // Дополнительно
    y += 10; setFont(false, base); doc.text("Дополнительно", margin, y); y += lh(base);
    doc.text(`Цветник: ${flowerbed ? "да" : "нет"}`, margin, y); y += lh(base);
    doc.text(`Тумба: ${base ? "да" : "нет"}`, margin, y); y += lh(base);

    // Примечания (линия сверху, заголовок по центру)
    y += 6; hr(y); y += 1;
    setFont(false, base);
    doc.text("Примечания", margin + leftW / 2, y, { align: "center" }); y += lh(base);
    for (const ln of split(notes || "—", leftW, base)) { doc.text(ln, margin, y); y += lh(base); }

    // Правая колонка — эскизы (сохраняем пропорции)
    let xR = margin + leftW + gapCols, yR = margin;
    async function placeRight(dataUrl: string | null | undefined, maxH: number) {
      if (!dataUrl) return;
      const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = dataUrl!; });
      const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
      if (!iw || !ih) return;
      const s = Math.min(rightW / iw, maxH / ih, 1);
      const w = Math.round(iw * s), h = Math.round(ih * s);
      const x = xR + Math.round((rightW - w) / 2);
      doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl!) ? "PNG" : "JPEG", x, yR, w, h, undefined, "FAST");
      yR += h + 18;
    }
    await placeRight(frontPng, Math.floor(innerH / 2) - 10);
    await placeRight(backPng, innerH - (yR - margin));

    // Фото — отдельные страницы: метрика (3 строки) над фото, слева
    const photos: { data?: string | null; last: string; namePatr: string; dates: string }[] = await (async () => {
      const out: any[] = [];
      for (const p of people) {
        let data: string | null = null;
        try {
          const u = p.photo;
          if (u) {
            if (u.startsWith("data:")) data = u;
            else {
              const res = await fetch(u, { mode: "cors" });
              if (res.ok) {
                const b = await res.blob();
                data = await new Promise<string>((resolve) => {
                  const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(b);
                });
              }
            }
          }
        } catch {}
        if (data) out.push({ data, last: p.last, namePatr: p.namePatr, dates: p.dates });
      }
      return out;
    })();

    for (let i = 0; i < photos.length; i++) {
      doc.addPage();
      let yP = margin;
      setFont(false, base);
      for (const ln of split(photos[i].last || "—", pageW - margin * 2, base)) { doc.text(ln, margin, yP); yP += lh(base); }
      for (const ln of split(photos[i].namePatr || "—", pageW - margin * 2, base)) { doc.text(ln, margin, yP); yP += lh(base); }
      for (const ln of split(photos[i].dates || "—", pageW - margin * 2, base)) { doc.text(ln, margin, yP); yP += lh(base) + 8; }

      const d = photos[i].data!;
      const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = d; });
      const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
      if (iw && ih) {
        const availW = pageW - margin * 2, availH = pageH - margin - yP;
        const s = Math.min(availW / iw, availH / ih, 1);
        const w = Math.round(iw * s), h = Math.round(ih * s);
        const x = margin + Math.max(0, (availW - w) / 2);
        doc.addImage(d, /^data:image\/png/i.test(d) ? "PNG" : "JPEG", x, yP, w, h, undefined, "FAST");
      }
    }

    // Отправка/скачивание
    const blob = doc.output("blob");
    if (sendAlso) {
      const meta = { orderNo, intro: intro.intro || {}, extras: (loadOrderDraft() as any)?.extras || {} };
      const fd = new FormData(); fd.append("pdf", blob, `order-${orderNo || Date.now()}.pdf`); fd.append("payload", JSON.stringify(meta));
      const res = await fetch("/api/send-order-pdf", { method: "POST", body: fd });
      if (!res.ok) alert(await res.text().catch(() => "Не удалось отправить PDF."));
      else setConfirmOpen(false);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `order-${orderNo || Date.now()}.pdf`; document.body.appendChild(a); a.click();
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
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
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
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
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
