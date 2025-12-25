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
// Изменения по требованиям:
// - Убраны все фоны/рамки.
// - Добавлены горизонтальные линии над словами: «Лицевая», «Тыльная», «Надгробная плита», «Примечания».
// - Эпитафии и названия файлов — размер 30 (не жирные).
// - Названия файлов располагаем справа от миниатюр (миниатюра слева, текст — справа).
// - Метрика (для людей) выравнивание по левому краю колонки, перенос строк: Фамилия (строка 1), Имя Отчество (строка 2), Даты (строка 3). Метрика располагается над фото.
// - Жирным остаются только заголовки «Лицевая/Тыльная/Надгробная плита» (по центру).
// - Алгоритм подгоняет контент под одну страницу левой колонки: уменьшает миниатюры, сжимает межстрочные, увеличивает число колонок, затем уменьшает кегль.
// - На фото-страницах вместо «Фото 1/2…» — метрика в 3 строки (Фамилия / Имя Отчество / Даты) над фотографией.

async function createPdfTwoColumns(sendAlso: boolean) {
  try {
    await new Promise((r) => setTimeout(r, 100));

    const jsPDF = await ensureJsPdf();
    const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
    await ensureCenturyFonts(doc);
    const FONT = csFontReady ? "CenturySchoolbook" : "helvetica";

    // Попытка подключить Regular для обычного текста
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
    const nm = (loadIntroState().intro?.customerName || "").trim() || "—";
    const ph = (loadIntroState().intro?.customerPhone || "").trim() || "—";
    const orderNoCur = String(loadIntroState().orderNumber || "").trim();

    const frontPersonsData = (((order?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null,
      last: (p.lastName || "").trim(),
      namePatr: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
      dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ")
    }));

    const graphicsFront = ((order as any)?.graphics || []).map((g: any) => ({ name: g.name || g.id || "—", url: g.preview || g.url || null }));

    const rearIds: string[] = (((order as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
    const rearMeta: Record<string, any> = (((order as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
    const rearCounts: Record<string, number> = {};
    (rearIds || []).forEach((id) => (rearCounts[id] = (rearCounts[id] || 0) + 1));
    const rearUnique = Array.from(new Set(rearIds || [])).map((id) => rearMeta?.[id] || { id, name: id, url: "" });

    const frontEps = toParagraphs((order?.engraving as any)?.epitaphs ?? (order?.engraving as any)?.epitaphText);
    const rearEps = (((order as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean);

    const plateEnabled = !!(order as any)?.extras?.headstonePlate;
    const plateSize = (order as any)?.extras?.plateSize || "—";
    const plateThick = (order as any)?.extras?.plateThickness || "—";
    const plateList: { id: string; name: string; url?: string }[] =
      Array.from(new Set(((order as any)?.extras?.plateGraphicsIds as string[]) || []))
        .map((gid) => ((order as any)?.extras?.plateGraphicsMeta || {})[gid] || { id: gid, name: gid, url: "" });
    const plateEpBlocks = toParagraphs(((order as any)?.extras?.plateEpitaph || "").trim());

    const flowerbed = !!(order as any)?.extras?.flowerbed;
    const base = (order as any)?.extras?.base ?? false;
    const notes = String(((order as any)?.extras?.orderNotes || "")).trim();

    // Эскизы
    const frontNode = document.getElementById("pdf-front-sketch");
    const backNode = document.getElementById("pdf-back-sketch");
    const frontPng = frontNode ? await captureNodePng(frontNode) : null;
    const backPng = backNode
      ? await captureNodePng(backNode)
      : await (async (u?: string | null) => {
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
        })((order as any)?.editorBack?.previewHiUrl || (order as any)?.editorBack?.previewUrl || null);

    // Параметры подгонки
    const EP_SIZE = 30;                 // эпитафии
    const FILE_SIZE = 30;               // названия файлов
    let fitFont = 40;                   // основной
    const minFont = 18;
    let lhFactor = 0.95;
    const minLh = 0.90;

    let imgPortrait = 120;
    let imgGraphic = 90;
    let imgPlate = 80;
    const minImg = 50;

    let colGap = 14, rowGap = 14, minColW = 260;
    const TXT_GAP = 14; // зазор между миниатюрой и подписью справа

    // Хелперы шрифтов/текста/сетки
    const setFont = (weight: "bold" | "normal", size?: number) => {
      const s = size ?? fitFont;
      if (weight === "bold") doc.setFont(FONT, "bold");
      else doc.setFont(REG_READY ? "CenturySchoolbook" : FONT, REG_READY ? "normal" : "bold");
      doc.setFontSize(s);
    };
    const splitText = (text: string, width: number, size?: number, weight: "bold" | "normal" = "normal") => {
      setFont(weight, size);
      return doc.splitTextToSize(text, width);
    };
    const gridCols = (availW: number, minColW: number, gap: number) => Math.max(2, Math.floor((availW + gap) / (minColW + gap)));

    // Линия (горизонтальная) на всю ширину левой колонки
    const drawHr = (y: number) => {
      doc.setDrawColor(180);
      doc.setLineWidth(1.2);
      doc.line(margin, y, margin + leftW, y);
    };

    // Измерение левой колонки — возвращает общую высоту
    function measureLeft() {
      let y = margin;
      const LH = Math.round((fitFont) * lhFactor);
      const EP_LH = Math.round(EP_SIZE * lhFactor);
      const FILE_LH = Math.round(FILE_SIZE * lhFactor);

      // Заголовок заказа
      splitText(`Заказ № ${orderNoCur || "—"}`, leftW, fitFont, "bold").forEach(() => (y += LH));
      splitText(`${nm} · ${ph}`, leftW, fitFont, "normal").forEach(() => (y += LH));

      // — Лицевая —
      y += 6; // небольшой отступ перед линией
      y += 1; // сама линия (в измерении просто резервируем пиксель)
      splitText("Лицевая", leftW, fitFont, "bold").forEach(() => (y += LH));

      // Усопшие
      splitText("Усопшие", leftW, fitFont, "normal").forEach(() => (y += LH));
      let cols = gridCols(leftW, minColW, colGap);
      let eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      let col = 0, rowMax = 0;

      // метрика (3 строки, слева), затем фото
      if (frontPersonsData.length) {
        const imgAreaW = Math.floor(eachW * 0.40); // фиксируем ~40% под миниатюру в ширину
        for (let i = 0; i < frontPersonsData.length; i++) {
          let cellH = 0;
          // Метрика — 3 строки, обычным, слева колонки
          cellH += splitText(frontPersonsData[i].last || "", eachW, fitFont, "normal").length * LH;
          cellH += splitText(frontPersonsData[i].namePatr || "", eachW, fitFont, "normal").length * LH;
          cellH += splitText(frontPersonsData[i].dates || "—", eachW, fitFont, "normal").length * LH;
          // Фото под метрикой
          cellH += imgPortrait + 24;

          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= cols || i === frontPersonsData.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      // Графика
      splitText("Графика", leftW, fitFont, "normal").forEach(() => (y += LH));
      cols = gridCols(leftW, minColW, colGap);
      eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      col = 0; rowMax = 0;
      if (graphicsFront.length) {
        const imgAreaW = Math.floor(eachW * 0.40);
        const textW = Math.max(40, eachW - imgAreaW - TXT_GAP);
        for (let i = 0; i < graphicsFront.length; i++) {
          let cellH = 0;
          // Графика: слева миниатюра (высотой imgGraphic), справа название (FILE_SIZE=30)
          const nameLines = splitText(graphicsFront[i].name, textW, FILE_SIZE, "normal").length;
          const textH = nameLines * FILE_LH;
          cellH = Math.max(imgGraphic, textH);
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= cols || i === graphicsFront.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      // Эпитафии (размер 30)
      splitText("Эпитафии", leftW, fitFont, "normal").forEach(() => (y += LH));
      cols = gridCols(leftW, minColW, colGap);
      eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      col = 0; rowMax = 0;
      if (frontEps.length) {
        for (let i = 0; i < frontEps.length; i++) {
          const lines = splitText(frontEps[i], eachW, EP_SIZE, "normal").length;
          const h = lines * EP_LH;
          rowMax = Math.max(rowMax, h);
          col++;
          if (col >= cols || i === frontEps.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      // — Тыльная —
      y += 6; y += 1;
      splitText("Тыльная", leftW, fitFont, "bold").forEach(() => (y += LH));

      splitText("Усопшие", leftW, fitFont, "normal").forEach(() => (y += LH));
      y += LH; // «—»

      splitText("Графика", leftW, fitFont, "normal").forEach(() => (y += LH));
      cols = gridCols(leftW, minColW, colGap);
      eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      col = 0; rowMax = 0;
      if (rearUnique.length) {
        const imgAreaW = Math.floor(eachW * 0.40);
        const textW = Math.max(40, eachW - imgAreaW - TXT_GAP);
        for (let i = 0; i < rearUnique.length; i++) {
          const nmG = `${rearUnique[i].name || "—"}${(rearCounts[rearUnique[i].id || ""] || 1) > 1 ? ` ×${rearCounts[rearUnique[i].id || ""]}` : ""}`;
          const nameLines = splitText(nmG, textW, FILE_SIZE, "normal").length;
          const textH = nameLines * FILE_LH;
          const h = Math.max(imgGraphic, textH);
          rowMax = Math.max(rowMax, h);
          col++;
          if (col >= cols || i === rearUnique.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      splitText("Эпитафии", leftW, fitFont, "normal").forEach(() => (y += LH));
      cols = gridCols(leftW, minColW, colGap);
      eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      col = 0; rowMax = 0;
      if (rearEps.length) {
        for (let i = 0; i < rearEps.length; i++) {
          const lines = splitText(rearEps[i], eachW, EP_SIZE, "normal").length;
          const h = lines * EP_LH;
          rowMax = Math.max(rowMax, h);
          col++;
          if (col >= cols || i === rearEps.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      // — Надгробная плита —
      y += 6; y += 1;
      splitText("Надгробная плита", leftW, fitFont, "bold").forEach(() => (y += LH));

      splitText(`Размер: ${plateEnabled ? plateSize : "—"}`, leftW, fitFont, "normal").forEach(() => (y += LH));
      splitText(`Толщина: ${plateEnabled ? plateThick : "—"}`, leftW, fitFont, "normal").forEach(() => (y += LH));

      splitText("Графика", leftW, fitFont, "normal").forEach(() => (y += LH));
      cols = gridCols(leftW, minColW, colGap);
      eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      col = 0; rowMax = 0;
      if (plateEnabled && plateList.length) {
        const imgAreaW = Math.floor(eachW * 0.40);
        const textW = Math.max(40, eachW - imgAreaW - TXT_GAP);
        for (let i = 0; i < plateList.length; i++) {
          const nameLines = splitText(plateList[i].name || "—", textW, FILE_SIZE, "normal").length;
          const textH = nameLines * FILE_LH;
          const h = Math.max(imgPlate, textH);
          rowMax = Math.max(rowMax, h);
          col++;
          if (col >= cols || i === plateList.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      splitText("Эпитафии", leftW, fitFont, "normal").forEach(() => (y += LH));
      cols = gridCols(leftW, minColW, colGap);
      eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
      col = 0; rowMax = 0;
      if (plateEnabled && plateEpBlocks.length) {
        for (let i = 0; i < plateEpBlocks.length; i++) {
          const lines = splitText(plateEpBlocks[i], eachW, EP_SIZE, "normal").length;
          const h = lines * EP_LH;
          rowMax = Math.max(rowMax, h);
          col++;
          if (col >= cols || i === plateEpBlocks.length - 1) {
            y += rowMax + rowGap; rowMax = 0; col = 0;
          }
        }
      } else y += LH;

      // — Примечания —
      y += 6; y += 1;
      splitText("Примечания", leftW, fitFont, "normal").forEach(() => (y += LH));
      splitText(notes || "—", leftW, fitFont, "normal").forEach(() => (y += LH));

      return { total: y - margin, LH, EP_LH, FILE_LH };
    }

    // Подбор параметров, чтобы влезло
    let m = measureLeft();
    while (m.total > innerH) {
      let changed = false;
      if (imgPortrait > minImg || imgGraphic > minImg || imgPlate > minImg) {
        imgPortrait = Math.max(minImg, Math.round(imgPortrait * 0.9));
        imgGraphic  = Math.max(minImg, Math.round(imgGraphic  * 0.9));
        imgPlate    = Math.max(minImg, Math.round(imgPlate    * 0.9));
        changed = true;
      } else if (lhFactor > minLh) {
        lhFactor = Math.max(minLh, +(lhFactor - 0.02).toFixed(2));
        changed = true;
      } else if (minColW > 200) {
        minColW = Math.max(200, minColW - 20);
        changed = true;
      } else if (fitFont > minFont) {
        fitFont = Math.max(minFont, fitFont - 2);
        changed = true;
      }
      if (!changed) break;
      m = measureLeft();
    }

    // Рендер левой колонки
    let yL = margin;

    const drawText = (weight: "bold" | "normal", text: string, x: number, y: number, opts?: { center?: boolean; size?: number; maxW?: number }) => {
      setFont(weight, opts?.size ?? fitFont);
      if (opts?.center) doc.text(text, x, y, { align: "center", maxWidth: opts?.maxW ?? leftW });
      else doc.text(text, x, y, { maxWidth: opts?.maxW ?? leftW });
    };

    // Шапка
    drawText("bold", `Заказ № ${orderNoCur || "—"}`, margin + leftW / 2, yL, { center: true }); yL += m.LH;
    drawText("normal", `${nm} · ${ph}`, margin, yL); yL += m.LH;

    // Лица — линия, заголовок
    yL += 6; drawHr(yL); yL += 1;
    drawText("bold", "Лицевая", margin + leftW / 2, yL, { center: true }); yL += m.LH;

    // Усопшие
    drawText("normal", "Усопшие", margin, yL); yL += m.LH;

    let cols = gridCols(leftW, minColW, colGap);
    let eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    let col = 0, rowMax = 0;

    if (frontPersonsData.length) {
      const imgAreaW = Math.floor(eachW * 0.40);
      for (let i = 0; i < frontPersonsData.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yCell = yL;

        // Метрика (3 строки), слева (по левому краю колонки)
        drawText("normal", frontPersonsData[i].last || "", cx, yCell, { maxW: eachW }); yCell += m.LH;
        drawText("normal", frontPersonsData[i].namePatr || "", cx, yCell, { maxW: eachW }); yCell += m.LH;
        drawText("normal", frontPersonsData[i].dates || "—", cx, yCell, { maxW: eachW }); yCell += m.LH;

        // Фото
        const data = frontPersonsData[i].photo ? await (async (u?: string | null) => {
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
        })(frontPersonsData[i].photo) : null;

        if (data) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(eachW / iw, imgPortrait / ih, 1);
            const w = Math.round(iw * s), h = Math.round(ih * s);
            const x = cx + Math.round((eachW - w) / 2);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", x, yCell, w, h, undefined, "FAST");
            yCell += h + 24;
          }
        } else {
          yCell += 24;
        }

        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= cols || i === frontPersonsData.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Графика (миниатюра слева, название справа — FILE_SIZE=30)
    drawText("normal", "Графика", margin, yL); yL += m.LH;
    cols = gridCols(leftW, minColW, colGap);
    eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    col = 0; rowMax = 0;

    if (graphicsFront.length) {
      const imgAreaW = Math.floor(eachW * 0.40);
      const textW = Math.max(40, eachW - imgAreaW - TXT_GAP);
      for (let i = 0; i < graphicsFront.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yImg = yL;
        let yText = yL;

        // Миниатюра
        const data = graphicsFront[i].url ? await (async (u?: string | null) => {
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
        })(graphicsFront[i].url) : null;

        let imgHUsed = 0;
        if (data) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            // ограничим высоту imgGraphic, ширину — не больше imgAreaW
            const s = Math.min(imgAreaW / iw, imgGraphic / ih, 1);
            const w = Math.min(imgAreaW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, yImg, w, h, undefined, "FAST");
            imgHUsed = h;
          }
        }

        // Название справа
        const xText = cx + imgAreaW + TXT_GAP;
        setFont("normal", FILE_SIZE);
        const lines = doc.splitTextToSize(graphicsFront[i].name, textW);
        for (const ln of lines) { doc.text(ln, xText, yText + FILE_SIZE); yText += m.FILE_LH; }

        const cellH = Math.max(imgHUsed, yText - yL);
        rowMax = Math.max(rowMax, cellH + 4);
        col++;
        if (col >= cols || i === graphicsFront.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Эпитафии (EP_SIZE=30)
    drawText("normal", "Эпитафии", margin, yL); yL += m.LH;
    cols = gridCols(leftW, minColW, colGap);
    eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    col = 0; rowMax = 0;
    if (frontEps.length) {
      for (let i = 0; i < frontEps.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yCell = yL;
        setFont("normal", EP_SIZE);
        const lines = doc.splitTextToSize(frontEps[i], eachW);
        for (const ln of lines) { doc.text(ln, cx, yCell + EP_SIZE); yCell += m.EP_LH; }
        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= cols || i === frontEps.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Тыльная — линия, заголовок
    yL += 6; drawHr(yL); yL += 1;
    drawText("bold", "Тыльная", margin + leftW / 2, yL, { center: true }); yL += m.LH;

    drawText("normal", "Усопшие", margin, yL); yL += m.LH;
    drawText("normal", "—", margin, yL); yL += m.LH;

    // Тыльная — Графика
    drawText("normal", "Графика", margin, yL); yL += m.LH;
    cols = gridCols(leftW, minColW, colGap);
    eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    col = 0; rowMax = 0;

    if (rearUnique.length) {
      const imgAreaW = Math.floor(eachW * 0.40);
      const textW = Math.max(40, eachW - imgAreaW - TXT_GAP);
      for (let i = 0; i < rearUnique.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yImg = yL;
        let yText = yL;

        // Изображение
        const data = rearUnique[i].url ? await (async (u?: string | null) => {
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
        })(rearUnique[i].url) : null;

        let imgHUsed = 0;
        if (data) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgAreaW / iw, imgGraphic / ih, 1);
            const w = Math.min(imgAreaW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, yImg, w, h, undefined, "FAST");
            imgHUsed = h;
          }
        }

        // Название справа
        const nmG = `${rearUnique[i].name || "—"}${(rearCounts[rearUnique[i].id || ""] || 1) > 1 ? ` ×${rearCounts[rearUnique[i].id || ""]}` : ""}`;
        const xText = cx + imgAreaW + TXT_GAP;
        setFont("normal", FILE_SIZE);
        const lines = doc.splitTextToSize(nmG, textW);
        for (const ln of lines) { doc.text(ln, xText, yText + FILE_SIZE); yText += m.FILE_LH; }

        const cellH = Math.max(imgHUsed, yText - yL);
        rowMax = Math.max(rowMax, cellH + 4);
        col++;
        if (col >= cols || i === rearUnique.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Тыльная — Эпитафии (30)
    drawText("normal", "Эпитафии", margin, yL); yL += m.LH;
    cols = gridCols(leftW, minColW, colGap);
    eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    col = 0; rowMax = 0;
    if (rearEps.length) {
      for (let i = 0; i < rearEps.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yCell = yL;
        setFont("normal", EP_SIZE);
        const lines = doc.splitTextToSize(rearEps[i], eachW);
        for (const ln of lines) { doc.text(ln, cx, yCell + EP_SIZE); yCell += m.EP_LH; }
        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= cols || i === rearEps.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Плита — линия + заголовок
    yL += 6; drawHr(yL); yL += 1;
    drawText("bold", "Надгробная плита", margin + leftW / 2, yL, { center: true }); yL += m.LH;

    drawText("normal", `Размер: ${plateEnabled ? plateSize : "—"}`, margin, yL); yL += m.LH;
    drawText("normal", `Толщина: ${plateEnabled ? plateThick : "—"}`, margin, yL); yL += m.LH;

    // Плита — Графика (миниатюра слева, название справа)
    drawText("normal", "Графика", margin, yL); yL += m.LH;
    cols = gridCols(leftW, minColW, colGap);
    eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    col = 0; rowMax = 0;
    if (plateEnabled && plateList.length) {
      const imgAreaW = Math.floor(eachW * 0.40);
      const textW = Math.max(40, eachW - imgAreaW - TXT_GAP);
      for (let i = 0; i < plateList.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yImg = yL;
        let yText = yL;

        const data = plateList[i].url ? await (async (u?: string | null) => {
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
        })(plateList[i].url) : null;

        let imgHUsed = 0;
        if (data) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data!; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgAreaW / iw, imgPlate / ih, 1);
            const w = Math.min(imgAreaW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data!, /^data:image\/png/i.test(data!) ? "PNG" : "JPEG", cx, yImg, w, h, undefined, "FAST");
            imgHUsed = h;
          }
        }

        setFont("normal", FILE_SIZE);
        const lines = doc.splitTextToSize(plateList[i].name || "—", textW);
        const xText = cx + imgAreaW + TXT_GAP;
        for (const ln of lines) { doc.text(ln, xText, yText + FILE_SIZE); yText += m.FILE_LH; }

        const cellH = Math.max(imgHUsed, yText - yL);
        rowMax = Math.max(rowMax, cellH + 4);
        col++;
        if (col >= cols || i === plateList.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Плита — Эпитафии (30)
    drawText("normal", "Эпитафии", margin, yL); yL += m.LH;
    cols = gridCols(leftW, minColW, colGap);
    eachW = Math.floor((leftW - colGap * (cols - 1)) / cols);
    col = 0; rowMax = 0;
    if (plateEnabled && plateEpBlocks.length) {
      for (let i = 0; i < plateEpBlocks.length; i++) {
        const cx = margin + col * (eachW + colGap);
        let yCell = yL;
        setFont("normal", EP_SIZE);
        const lines = doc.splitTextToSize(plateEpBlocks[i], eachW);
        for (const ln of lines) { doc.text(ln, cx, yCell + EP_SIZE); yCell += m.EP_LH; }
        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= cols || i === plateEpBlocks.length - 1) {
          yL += rowMax + rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", margin, yL); yL += m.LH; }

    // Дополнительно
    drawText("normal", "Дополнительно", margin, yL); yL += m.LH;
    drawText("normal", `Цветник: ${flowerbed ? "да" : "нет"}`, margin, yL); yL += m.LH;
    drawText("normal", `Тумба: ${base ? "да" : "нет"}`, margin, yL); yL += m.LH;

    // Примечания — линия + заголовок по центру
    yL += 6; drawHr(yL); yL += 1;
    drawText("normal", "Примечания", margin + leftW / 2, yL, { center: true }); yL += m.LH;
    for (const ln of splitText(notes || "—", leftW, fitFont, "normal")) { drawText("normal", ln, margin, yL); yL += m.LH; }

    // Правая колонка — эскизы
    let xR = margin + leftW + gapCols, yR = margin;
    async function placeRight(dataUrl: string | null | undefined, maxH: number) {
      if (!dataUrl) return;
      const im = new Image();
      await new Promise<void>((res) => { im.onload = () => res(); im.src = dataUrl!; });
      const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
      if (!iw || !ih) return;
      const s = Math.min(rightW / iw, maxH / ih, 1);
      const w = Math.round(iw * s), h = Math.round(ih * s);
      const x = xR + Math.round((rightW - w) / 2);
      doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG", x, yR, w, h, undefined, "FAST");
      yR += h + 16;
    }
    await placeRight(frontPng, Math.floor(innerH / 2) - 8);
    await placeRight(backPng, innerH - (yR - margin));

    // Фото — отдельные страницы: метрика 3 строки (Фамилия / Имя Отчество / Даты) над фото, по левому краю
    const photos: { data?: string | null; last: string; namePatr: string; dates: string }[] = await (async () => {
      const arr: { data?: string | null; last: string; namePatr: string; dates: string }[] = [];
      for (const p of frontPersonsData) {
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
        if (data) arr.push({ data, last: p.last, namePatr: p.namePatr, dates: p.dates });
      }
      return arr;
    })();

    for (let i = 0; i < photos.length; i++) {
      doc.addPage();
      let y = margin;
      // Метрика в 3 строки, левый край
      drawText("normal", photos[i].last || "—", margin, y); y += m.LH;
      drawText("normal", photos[i].namePatr || "—", margin, y); y += m.LH;
      drawText("normal", photos[i].dates || "—", margin, y); y += m.LH + 8;

      const d = photos[i].data;
      if (d) {
        const im = new Image();
        await new Promise<void>((res) => { im.onload = () => res(); im.src = d!; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (iw && ih) {
          const availW = pageW - margin * 2, availH = pageH - margin - y;
          const s = Math.min(availW / iw, availH / ih, 1);
          const w = Math.round(iw * s), h = Math.round(ih * s);
          const x = margin + Math.max(0, (availW - w) / 2);
          doc.addImage(d!, /^data:image\/png/i.test(d!) ? "PNG" : "JPEG", x, y, w, h, undefined, "FAST");
        }
      } else {
        drawText("normal", "Фото недоступно", margin, y);
      }
    }

    const blob = doc.output("blob");
    if (sendAlso) {
      const meta = { orderNo: orderNoCur, intro: loadIntroState().intro || {}, extras: (loadOrderDraft() as any)?.extras || {} };
      const fd = new FormData();
      fd.append("pdf", blob, `order-${orderNoCur || Date.now()}.pdf`);
      fd.append("payload", JSON.stringify(meta));
      const res = await fetch("/api/send-order-pdf", { method: "POST", body: fd });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        alert(`Не удалось отправить PDF: ${t || res.statusText}`);
      } else {
        setConfirmOpen(false);
      }
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
