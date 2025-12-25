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

  // Замените текущую функцию createPdfTwoColumns в src/screens/ReviewAndSendStep.tsx.
// Новая версия:
// - Всю информацию обязательно вмещает: сначала максимально сжимает межстрочные интервалы,
//   уменьшает миниатюры и при необходимости понижает размер шрифта (до минимума), чтобы уместить контент в левую колонку.
// - Жирным остаются только заголовки разделов: «Лицевая», «Тыльная», «Надгробная плита» (по центру).
// - Подзаголовки «Усопшие / Графика / Эпитафии / Дополнительно / Примечания» — обычным (не жирным).
// - Линии и рамки удалены.
// - Под разделы «Лицевая» и «Надгробная плита» кладётся светло-серый фон.
// - Миниатюры меньше, подписи по центру под миниатюрами; при нехватке места миниатюры автоматически уменьшаются ещё.
// - Правая колонка: эскизы (лицевой/тыльный), как прежде. Фото — на отдельных страницах.

async function createPdfTwoColumns(sendAlso: boolean) {
  try {
    await new Promise((r) => setTimeout(r, 120));

    const jsPDF = await ensureJsPdf();
    const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
    await ensureCenturyFonts(doc);
    const FONT = csFontReady ? "CenturySchoolbook" : "helvetica";

    // Попытка подключить Regular (для обычного текста)
    let REG_READY = false;
    try {
      const url = "/fonts/CenturySchoolbook-Regular.ttf";
      const r = await fetch(url, { mode: "cors" });
      if (r.ok) {
        const ab = await r.arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(ab);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        doc.addFileToVFS("CenturySchoolbook-Regular.ttf", btoa(bin));
        doc.addFont("CenturySchoolbook-Regular.ttf", "CenturySchoolbook", "normal");
        REG_READY = true;
      }
    } catch {}

    // Геометрия страницы
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const innerW = pageW - margin * 2;
    const innerH = pageH - margin * 2;
    const gapCols = 28;
    const rightW = Math.round(innerW * 0.40);
    const leftW = innerW - gapCols - rightW;

    // Данные (берём из текущего драфта)
    const order = draft || loadOrderDraft();
    const nm = (loadIntroState().intro?.customerName || "").trim() || "—";
    const ph = (loadIntroState().intro?.customerPhone || "").trim() || "—";
    const orderNoCur = String(loadIntroState().orderNumber || "").trim();
    const persons = ((order.engraving?.persons as any[]) || []).filter(Boolean);
    const frontPersonsData = persons.map((p: any) => ({
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null,
      l1: (p.lastName || "").trim(),
      l2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
      l3: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ")
    }));
    const graphicsFront = ((order as any)?.graphics || []).map((g: any) => ({
      name: g.name || g.id || "—",
      url: g.preview || g.url || null
    }));

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

    // Эскизы (DOM -> PNG)
    const frontNode = document.getElementById("pdf-front-sketch");
    const backNode = document.getElementById("pdf-back-sketch");
    const frontPng = frontNode ? await captureNodePng(frontNode) : null;
    const backPng = backNode ? await captureNodePng(backNode) : await (async () => {
      const u = (order as any)?.editorBack?.previewHiUrl || (order as any)?.editorBack?.previewUrl || null;
      return await (async function toDataUrl(url?: string | null): Promise<string | null> {
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
      })(u);
    })();

    // Параметры наборов с начальных значений и пределами, будем подбирать
    const fit = {
      fontSize: 40,             // начальный
      minFont: 18,              // минимум
      lhFactor: 0.95,           // плотный межстрочный
      minLhFactor: 0.90,
      imgPortrait: 120,         // начальные высоты миниатюр (ещё уменьшены)
      imgGraphic: 90,
      imgPlate: 80,
      minImg: 50,               // минимум высоты миниатюр
      captionGap: 24,           // отступ от миниатюры до подписи (больше)
      colGap: 14,               // меньше расстояние между карточками
      rowGap: 14,
      minColW: 260              // можно уменьшать, чтобы увеличить число колонок
    };

    // Утилиты текста/картинок
    const setFont = (style: "bold" | "normal") => {
      if (style === "bold") doc.setFont(FONT, "bold");
      else if (REG_READY) doc.setFont("CenturySchoolbook", "normal");
      else doc.setFont(FONT, "bold"); // fallback
      doc.setFontSize(fit.fontSize);
    };
    function textLinesWidth(text: string, width: number) {
      return doc.splitTextToSize(text, width);
    }
    function gridCols(availW: number, minColW: number, colGap: number) {
      return Math.max(2, Math.floor((availW + colGap) / (minColW + colGap)));
    }

    // Измерение левого столбца (без рисования) с возвратом общих высот и границ фоновых блоков
    const measureLeft = () => {
      let y = margin;

      const LH = Math.round(fit.fontSize * fit.lhFactor);

      // Заголовок заказа
      setFont("bold");
      textLinesWidth(`Заказ № ${orderNoCur || "—"}`, leftW).forEach(() => { y += LH; });
      setFont("normal");
      textLinesWidth(`${nm} · ${ph}`, leftW).forEach(() => { y += LH; });

      // — Лицевая (серый фон) —
      const faceStart = y;
      setFont("bold");
      textLinesWidth("Лицевая", leftW).forEach(() => { y += LH; });

      // Усопшие (подзаголовок обычным)
      setFont("normal");
      textLinesWidth("Усопшие", leftW).forEach(() => { y += LH; });

      const colsP = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_P = Math.floor((leftW - fit.colGap * (colsP - 1)) / colsP);
      let rowMax = 0, col = 0;

      if (frontPersonsData.length) {
        for (let i = 0; i < frontPersonsData.length; i++) {
          // img height
          const imgH = fit.imgPortrait;
          let cellH = imgH + fit.captionGap;
          // l1, l2, l3
          setFont("bold");
          cellH += textLinesWidth(frontPersonsData[i].l1 || "", eachW_P).length * LH;
          cellH += textLinesWidth(frontPersonsData[i].l2 || "", eachW_P).length * LH;
          setFont("normal");
          cellH += textLinesWidth(frontPersonsData[i].l3 || "—", eachW_P).length * LH;

          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsP || i === frontPersonsData.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }

      // Графика
      setFont("normal");
      textLinesWidth("Графика", leftW).forEach(() => { y += LH; });
      const colsG = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_G = Math.floor((leftW - fit.colGap * (colsG - 1)) / colsG);
      rowMax = 0; col = 0;
      if (graphicsFront.length) {
        for (let i = 0; i < graphicsFront.length; i++) {
          const imgH = fit.imgGraphic;
          let cellH = imgH + fit.captionGap;
          setFont("bold");
          cellH += textLinesWidth(graphicsFront[i].name, eachW_G).length * LH;
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsG || i === graphicsFront.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }

      // Эпитафии
      setFont("normal");
      textLinesWidth("Эпитафии", leftW).forEach(() => { y += LH; });
      const colsE = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_E = Math.floor((leftW - fit.colGap * (colsE - 1)) / colsE);
      rowMax = 0; col = 0;
      if (frontEps.length) {
        for (let i = 0; i < frontEps.length; i++) {
          let cellH = textLinesWidth(frontEps[i], eachW_E).length * LH;
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsE || i === frontEps.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }
      const faceEnd = y;

      // — Тыльная —
      setFont("bold");
      textLinesWidth("Тыльная", leftW).forEach(() => { y += LH; });

      setFont("normal");
      textLinesWidth("Усопшие", leftW).forEach(() => { y += LH; });
      y += LH; // «—»

      textLinesWidth("Графика", leftW).forEach(() => { y += LH; });
      const colsRG = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_RG = Math.floor((leftW - fit.colGap * (colsRG - 1)) / colsRG);
      rowMax = 0; col = 0;
      if (rearUnique.length) {
        for (let i = 0; i < rearUnique.length; i++) {
          const imgH = fit.imgGraphic;
          let cellH = imgH + fit.captionGap;
          setFont("bold");
          const nm = `${rearUnique[i].name || "—"}${(rearCounts[rearUnique[i].id || ""] || 1) > 1 ? ` ×${rearCounts[rearUnique[i].id || ""]}` : ""}`;
          cellH += textLinesWidth(nm, eachW_RG).length * LH;
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsRG || i === rearUnique.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }

      setFont("normal");
      textLinesWidth("Эпитафии", leftW).forEach(() => { y += LH; });
      const colsRE = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_RE = Math.floor((leftW - fit.colGap * (colsRE - 1)) / colsRE);
      rowMax = 0; col = 0;
      if (rearEps.length) {
        for (let i = 0; i < rearEps.length; i++) {
          let cellH = textLinesWidth(rearEps[i], eachW_RE).length * LH;
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsRE || i === rearEps.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }

      // — Надгробная плита (серый фон) —
      const plateStart = y;
      setFont("bold");
      textLinesWidth("Надгробная плита", leftW).forEach(() => { y += LH; });

      setFont("normal");
      textLinesWidth(`Размер: ${plateEnabled ? plateSize : "—"}`, leftW).forEach(() => { y += LH; });
      textLinesWidth(`Толщина: ${plateEnabled ? plateThick : "—"}`, leftW).forEach(() => { y += LH; });

      textLinesWidth("Графика", leftW).forEach(() => { y += LH; });
      const colsPG = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_PG = Math.floor((leftW - fit.colGap * (colsPG - 1)) / colsPG);
      rowMax = 0; col = 0;
      if (plateEnabled && plateList.length) {
        for (let i = 0; i < plateList.length; i++) {
          const imgH = fit.imgPlate;
          let cellH = imgH + fit.captionGap;
          setFont("bold");
          cellH += textLinesWidth(plateList[i].name || "—", eachW_PG).length * LH;
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsPG || i === plateList.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }

      setFont("normal");
      textLinesWidth("Эпитафии", leftW).forEach(() => { y += LH; });
      const colsPE = gridCols(leftW, fit.minColW, fit.colGap);
      const eachW_PE = Math.floor((leftW - fit.colGap * (colsPE - 1)) / colsPE);
      rowMax = 0; col = 0;
      if (plateEnabled && plateEpBlocks.length) {
        for (let i = 0; i < plateEpBlocks.length; i++) {
          let cellH = textLinesWidth(plateEpBlocks[i], eachW_PE).length * LH;
          rowMax = Math.max(rowMax, cellH);
          col++;
          if (col >= colsPE || i === plateEpBlocks.length - 1) {
            y += rowMax + fit.rowGap; rowMax = 0; col = 0;
          }
        }
      } else {
        y += LH;
      }

      // Дополнительно: Цветник/Тумба
      textLinesWidth("Дополнительно", leftW).forEach(() => { y += LH; });
      textLinesWidth(`Цветник: ${flowerbed ? "да" : "нет"}`, leftW).forEach(() => { y += LH; });
      textLinesWidth(`Тумба: ${base ? "да" : "нет"}`, leftW).forEach(() => { y += LH; });

      const plateEnd = y;

      // Примечания
      textLinesWidth("Примечания", leftW).forEach(() => { y += LH; });
      textLinesWidth(notes || "—", leftW).forEach(() => { y += LH; });

      return { total: y - margin, faceStart, faceEnd, plateStart, plateEnd, LH };
    };

    // Подбор параметров, чтобы влезло
    let meas = measureLeft();
    while (meas.total > innerH) {
      let changed = false;
      // 1) уменьшаем высоты картинок
      if (fit.imgPortrait > fit.minImg || fit.imgGraphic > fit.minImg || fit.imgPlate > fit.minImg) {
        fit.imgPortrait = Math.max(fit.minImg, Math.round(fit.imgPortrait * 0.9));
        fit.imgGraphic  = Math.max(fit.minImg, Math.round(fit.imgGraphic  * 0.9));
        fit.imgPlate    = Math.max(fit.minImg, Math.round(fit.imgPlate    * 0.9));
        changed = true;
      } else if (fit.lhFactor > fit.minLhFactor) {
        // 2) сжимаем межстрочный
        fit.lhFactor = Math.max(fit.minLhFactor, +(fit.lhFactor - 0.02).toFixed(2));
        changed = true;
      } else if (fit.minColW > 200) {
        // 3) увеличиваем число колонок
        fit.minColW = Math.max(200, fit.minColW - 20);
        changed = true;
      } else if (fit.fontSize > fit.minFont) {
        // 4) уменьшаем шрифт
        fit.fontSize = Math.max(fit.minFont, fit.fontSize - 2);
        changed = true;
      }
      if (!changed) break;
      meas = measureLeft();
    }

    // Рендер: фоны (серые) под Лицевой и Плитой
    doc.setFillColor(242, 242, 242); // светло-серый
    const facePad = 8;
    doc.rect(margin - facePad, meas.faceStart - facePad, leftW + facePad * 2, (meas.faceEnd - meas.faceStart) + facePad * 2, "F");
    const platePad = 8;
    doc.rect(margin - platePad, meas.plateStart - platePad, leftW + platePad * 2, (meas.plateEnd - meas.plateStart) + platePad * 2, "F");

    // Функции отрисовки
    const LH_RENDER = meas.LH;
    const drawText = (style: "bold" | "normal", text: string, x: number, y: number, opts?: { align?: "center" | "left"; maxW?: number }) => {
      setFont(style);
      if (opts?.align === "center") doc.text(text, x, y, { align: "center", maxWidth: opts?.maxW ?? leftW });
      else doc.text(text, x, y, { maxWidth: opts?.maxW ?? leftW });
    };
    async function toDataUrl(url?: string | null): Promise<string | null> {
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
    async function addImageCentered(dataUrl?: string | null, colX = 0, y = 0, colW = 100, maxH = 100) {
      if (!dataUrl) return { w: 0, h: 0 };
      const im = new Image();
      await new Promise<void>((res) => { im.onload = () => res(); im.src = dataUrl; });
      const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
      if (!iw || !ih) return { w: 0, h: 0 };
      const s = Math.min(colW / iw, maxH / ih, 1);
      const w = Math.round(iw * s), h = Math.round(ih * s);
      const x = colX + Math.round((colW - w) / 2);
      doc.addImage(dataUrl, /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG", x, y, w, h, undefined, "FAST");
      return { w, h };
    }

    // Рисуем левую колонку по измеренному плану
    let xL = margin, yL = margin;

    // Заголовок заказа (обычным)
    drawText("bold", `Заказ № ${orderNoCur || "—"}`, xL + leftW / 2, yL, { align: "center", maxW: leftW }); yL += LH_RENDER;
    drawText("normal", `${nm} · ${ph}`, xL, yL); yL += LH_RENDER;

    // — Лицевая —
    drawText("bold", "Лицевая", xL + leftW / 2, yL, { align: "center", maxW: leftW }); yL += LH_RENDER;

    drawText("normal", "Усопшие", xL, yL); yL += LH_RENDER;

    const colsP = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_P = Math.floor((leftW - fit.colGap * (colsP - 1)) / colsP);
    let col = 0, rowMax = 0;
    if (frontPersonsData.length) {
      for (let i = 0; i < frontPersonsData.length; i++) {
        const cx = xL + col * (eachW_P + fit.colGap);
        let yCell = yL;

        const data = await toDataUrl(frontPersonsData[i].photo);
        const img = await addImageCentered(data, cx, yCell, eachW_P, fit.imgPortrait);
        yCell += img.h + fit.captionGap;

        drawText("bold", frontPersonsData[i].l1 || "", cx + eachW_P / 2, yCell, { align: "center", maxW: eachW_P }); yCell += LH_RENDER;
        drawText("bold", frontPersonsData[i].l2 || "", cx + eachW_P / 2, yCell, { align: "center", maxW: eachW_P }); yCell += LH_RENDER;
        drawText("normal", frontPersonsData[i].l3 || "—", cx + eachW_P / 2, yCell, { align: "center", maxW: eachW_P }); yCell += LH_RENDER;

        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsP || i === frontPersonsData.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    drawText("normal", "Графика", xL, yL); yL += LH_RENDER;

    const colsG = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_G = Math.floor((leftW - fit.colGap * (colsG - 1)) / colsG);
    col = 0; rowMax = 0;
    if (graphicsFront.length) {
      for (let i = 0; i < graphicsFront.length; i++) {
        const cx = xL + col * (eachW_G + fit.colGap);
        let yCell = yL;
        const data = await toDataUrl(graphicsFront[i].url);
        const img = await addImageCentered(data, cx, yCell, eachW_G, fit.imgGraphic);
        yCell += img.h + fit.captionGap;

        drawText("bold", graphicsFront[i].name, cx + eachW_G / 2, yCell, { align: "center", maxW: eachW_G }); yCell += LH_RENDER;

        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsG || i === graphicsFront.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    drawText("normal", "Эпитафии", xL, yL); yL += LH_RENDER;

    const colsE = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_E = Math.floor((leftW - fit.colGap * (colsE - 1)) / colsE);
    col = 0; rowMax = 0;
    if (frontEps.length) {
      for (let i = 0; i < frontEps.length; i++) {
        const cx = xL + col * (eachW_E + fit.colGap);
        let yCell = yL;
        for (const ln of textLinesWidth(frontEps[i], eachW_E)) { drawText("normal", ln, cx, yCell); yCell += LH_RENDER; }
        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsE || i === frontEps.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    // — Тыльная —
    drawText("bold", "Тыльная", xL + leftW / 2, yL, { align: "center", maxW: leftW }); yL += LH_RENDER;

    drawText("normal", "Усопшие", xL, yL); yL += LH_RENDER;
    drawText("normal", "—", xL, yL); yL += LH_RENDER;

    drawText("normal", "Графика", xL, yL); yL += LH_RENDER;
    const colsRG = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_RG = Math.floor((leftW - fit.colGap * (colsRG - 1)) / colsRG);
    col = 0; rowMax = 0;
    if (rearUnique.length) {
      for (let i = 0; i < rearUnique.length; i++) {
        const cx = xL + col * (eachW_RG + fit.colGap);
        let yCell = yL;
        const data = await toDataUrl(rearUnique[i].url || null);
        const img = await addImageCentered(data, cx, yCell, eachW_RG, fit.imgGraphic);
        yCell += img.h + fit.captionGap;

        const nmG = `${rearUnique[i].name || "—"}${(rearCounts[rearUnique[i].id || ""] || 1) > 1 ? ` ×${rearCounts[rearUnique[i].id || ""]}` : ""}`;
        for (const ln of textLinesWidth(nmG, eachW_RG)) { drawText("bold", ln, cx + eachW_RG / 2, yCell, { align: "center", maxW: eachW_RG }); yCell += LH_RENDER; }

        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsRG || i === rearUnique.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    drawText("normal", "Эпитафии", xL, yL); yL += LH_RENDER;
    const colsRE = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_RE = Math.floor((leftW - fit.colGap * (colsRE - 1)) / colsRE);
    col = 0; rowMax = 0;
    if (rearEps.length) {
      for (let i = 0; i < rearEps.length; i++) {
        const cx = xL + col * (eachW_RE + fit.colGap); let yCell = yL;
        for (const ln of textLinesWidth(rearEps[i], eachW_RE)) { drawText("normal", ln, cx, yCell); yCell += LH_RENDER; }
        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsRE || i === rearEps.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    // — Надгробная плита —
    drawText("bold", "Надгробная плита", xL + leftW / 2, yL, { align: "center", maxW: leftW }); yL += LH_RENDER;

    drawText("normal", `Размер: ${plateEnabled ? plateSize : "—"}`, xL, yL); yL += LH_RENDER;
    drawText("normal", `Толщина: ${plateEnabled ? plateThick : "—"}`, xL, yL); yL += LH_RENDER;

    drawText("normal", "Графика", xL, yL); yL += LH_RENDER;

    const colsPG = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_PG = Math.floor((leftW - fit.colGap * (colsPG - 1)) / colsPG);
    col = 0; rowMax = 0;
    if (plateEnabled && plateList.length) {
      for (let i = 0; i < plateList.length; i++) {
        const cx = xL + col * (eachW_PG + fit.colGap);
        let yCell = yL;
        const data = await toDataUrl(plateList[i].url || null);
        const img = await addImageCentered(data, cx, yCell, eachW_PG, fit.imgPlate);
        yCell += img.h + fit.captionGap;

        for (const ln of textLinesWidth(plateList[i].name || "—", eachW_PG)) { drawText("bold", ln, cx + eachW_PG / 2, yCell, { align: "center", maxW: eachW_PG }); yCell += LH_RENDER; }

        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsPG || i === plateList.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    drawText("normal", "Эпитафии", xL, yL); yL += LH_RENDER;
    const colsPE = gridCols(leftW, fit.minColW, fit.colGap);
    const eachW_PE = Math.floor((leftW - fit.colGap * (colsPE - 1)) / colsPE);
    col = 0; rowMax = 0;
    if (plateEnabled && plateEpBlocks.length) {
      for (let i = 0; i < plateEpBlocks.length; i++) {
        const cx = xL + col * (eachW_PE + fit.colGap); let yCell = yL;
        for (const ln of textLinesWidth(plateEpBlocks[i], eachW_PE)) { drawText("normal", ln, cx, yCell); yCell += LH_RENDER; }
        rowMax = Math.max(rowMax, yCell - yL);
        col++;
        if (col >= colsPE || i === plateEpBlocks.length - 1) {
          yL += rowMax + fit.rowGap; rowMax = 0; col = 0;
        }
      }
    } else { drawText("normal", "—", xL, yL); yL += LH_RENDER; }

    drawText("normal", "Дополнительно", xL, yL); yL += LH_RENDER;
    drawText("normal", `Цветник: ${flowerbed ? "да" : "нет"}`, xL, yL); yL += LH_RENDER;
    drawText("normal", `Тумба: ${base ? "да" : "нет"}`, xL, yL); yL += LH_RENDER;

    drawText("normal", "Примечания", xL, yL); yL += LH_RENDER;
    for (const ln of textLinesWidth(notes || "—", leftW)) { drawText("normal", ln, xL, yL); yL += LH_RENDER; }

    // Правая колонка — эскизы (по центру)
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

    // Фото — отдельные страницы
    const photos: string[] = frontPersonsData.map((p) => p.photo).filter(Boolean) as string[];
    for (let i = 0; i < photos.length; i++) {
      doc.addPage();
      let y = margin;
      drawText("bold", `Фото ${i + 1}`, margin, y); y += LH_RENDER + 8;
      const data = await toDataUrl(photos[i]);
      if (data) {
        const im = new Image();
        await new Promise<void>((res) => { im.onload = () => res(); im.src = data; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (iw && ih) {
          const availW = pageW - margin * 2, availH = pageH - margin - y;
          const s = Math.min(availW / iw, availH / ih, 1);
          const w = Math.round(iw * s), h = Math.round(ih * s);
          const x = margin + Math.max(0, (availW - w) / 2);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, y, w, h, undefined, "FAST");
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
