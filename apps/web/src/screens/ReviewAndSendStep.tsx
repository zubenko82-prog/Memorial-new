// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Изменения по задаче:
// - PDF: как в «Заказе списком» (3 колонки), оба эскиза — на той же странице,
//   прикреплённые фото — на отдельных страницах после состава заказа.
// - Кнопка «Оформить заказ» переименована в «Рассчитать стоимость» (и на главной, и в «Заказе списком»).
// - В «Заказе списком» добавлена отдельная кнопка «Рассчитать стоимость» — отправляет PDF в админ-чат.
// - После отправки показываем оверлей с сообщением и кнопками: [×] (закрыть) и «Новый заказ» (переход на начало).
// - Исправлено: при редактировании имени/телефона/примечания «съедается» последняя буква —
//   теперь сохраняем по onBlur (без автообновления во время ввода).
// - Шрифт PDF: Century Schoolbook (Bold — для метрик/заголовков; Bold Italic — для эпитафий).
//   Положите TTF-файлы в /public/fonts:
//     /public/fonts/CenturySchoolbook-Bold.ttf
//     /public/fonts/CenturySchoolbook-BoldItalic.ttf
//   Если отсутствуют — будет fallback на helvetica (латиница).
//
// Примечание: чтобы миниатюры/фото попали в PDF, их URL должны быть доступны браузеру с CORS.
// Иначе вставим только подписи, игнорируя саму картинку (без падения).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import SketchTemplate from "../components/SketchTemplate";

/* ===== html-to-image для DOM->PNG (эскиз лицевой) ===== */
declare global { interface Window { htmlToImage?: any; jspdf?: any } }
async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.htmlToImage) return window.htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const ex = document.querySelector<HTMLScriptElement>(`script[src="${CDN}"]`);
    if (ex) {
      ex.addEventListener("load", () => res(), { once: true });
      ex.addEventListener("error", () => rej(new Error("html-to-image load error")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("html-to-image load error"));
    document.head.appendChild(s);
  });
  if (!window.htmlToImage) throw new Error("html-to-image unavailable");
  return window.htmlToImage;
}

/* ===== jsPDF (PDF) ===== */
async function ensureJsPdf(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  const CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  await new Promise<void>((res, rej) => {
    const ex = document.querySelector<HTMLScriptElement>(`script[src="${CDN}"]`);
    if (ex) {
      ex.addEventListener("load", () => res(), { once: true });
      ex.addEventListener("error", () => rej(new Error("jspdf load error")), { once: true });
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

/* ===== Встраивание Century Schoolbook (Bold, Bold Italic) ===== */
let csFontReady = false; // оба начертания готовы
async function ensureCenturyFonts(doc: any) {
  if (csFontReady) return;
  const BOLD_CAND = [
    "/fonts/CenturySchoolbook-Bold.ttf",
  ];
  const BOLD_IT_CAND = [
    "/fonts/CenturySchoolbook-BoldItalic.ttf",
  ];
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
  async function firstOk(urls: string[]): Promise<string | null> {
    for (const u of urls) {
      const b64 = await fetchTtfToBase64(u);
      if (b64) return b64;
    }
    return null;
  }
  const [boldB64, boldItB64] = await Promise.all([firstOk(BOLD_CAND), firstOk(BOLD_IT_CAND)]);
  if (boldB64) {
    doc.addFileToVFS("CenturySchoolbook-Bold.ttf", boldB64);
    doc.addFont("CenturySchoolbook-Bold.ttf", "CenturySchoolbook", "bold");
  }
  if (boldItB64) {
    doc.addFileToVFS("CenturySchoolbook-BoldItalic.ttf", boldItB64);
    doc.addFont("CenturySchoolbook-BoldItalic.ttf", "CenturySchoolbook", "bolditalic");
  }
  csFontReady = !!(boldB64 && boldItB64);
  if (!csFontReady) {
    console.warn("Century Schoolbook TTF не найден в /public/fonts. В PDF будет fallback на helvetica.");
  }
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

/* ===== Thumb ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
  </div>
);

/* ===== Шапка: номер заказа + контакты + «Заказ списком» ===== */
function EditableOrderSummary({ orderNo, onOpenSimple }: { orderNo: string; onOpenSimple: () => void }) {
  // Локальное состояние без автосохранения на onChange (сохраняем на onBlur) — чтобы не «съедались» буквы
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
        <button type="button" onClick={onOpenSimple} style={linkLike()}>Заказ списком</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveOnBlur}
          placeholder="Имя"
          style={inputStyle()}
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={saveOnBlur}
          placeholder="+7..."
          inputMode="tel"
          style={inputStyle()}
        />
      </div>
      <input
        value={contactNotes}
        onChange={(e) => setContactNotes(e.target.value)}
        onBlur={saveOnBlur}
        placeholder="Примечание для связи…"
        style={inputStyle()}
      />
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

/* ===== Оверлей «Заказ списком» (три колонки), с кнопкой «Рассчитать стоимость» ===== */
function PrintOverlay({
  onClose, onSavePdf, onSendCost, orderNo, name, phone, frontSketch, previewBack,
  frontData, rearData, extras, plate, notes, aspect
}: {
  onClose: () => void;
  onSavePdf: () => void;      // Сохранить PDF (локально + попытка отправки)
  onSendCost: () => void;     // Отправить PDF в админ-чат (тот же onSavePdf)
  orderNo: string; name: string; phone: string;
  frontSketch: React.ReactNode;
  previewBack?: string;
  frontData: { persons: { id?: string; fio1: string; fio2: string; dates: string; photo?: string }[]; graphics: { name: string; qty: number; thumb?: string }[]; epitaphs: string[]; };
  rearData: { graphics: { name: string; qty: number; thumb?: string }[]; epitaphs: string[] } | null;
  extras: { base: boolean; flowerbed: boolean };
  plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string; thumb?: string }[]; epitaph?: string };
  notes?: string;
  aspect?: string;
}) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "grid", placeItems: "center", padding: 12 }}>
      <div id="print-root" style={{ background: "#fff", color: "#000", width: "100%", maxWidth: "210mm", maxHeight: "95vh", overflow: "auto", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.55)", padding: "5mm", position: "relative" }}>
        <div style={{ display: "flex", gap: 8, position: "sticky", top: 0, background: "#fff", paddingBottom: 6, justifyContent: "flex-end", zIndex: 2 }}>
          <button type="button" onClick={onClose} title="Закрыть" style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #999", background: "#f0f0f0", cursor: "pointer" }}>×</button>
          <button type="button" onClick={onSavePdf} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }}>Сохранить PDF</button>
          <button type="button" onClick={onSendCost} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#e5ffe5", cursor: "pointer" }}>Рассчитать стоимость</button>
        </div>

        <div style={{ fontFamily: "system-ui,-apple-system, Segoe UI, Roboto, Arial, sans-serif", fontSize: 11, lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>заказ № {orderNo || "—"}</div>
          <div style={{ marginBottom: 6 }}>{name || "—"} · {phone || "—"}</div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Лицевая */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Лицевая</div>
            <div style={grid3()}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                {frontData.persons.length ? frontData.persons.map((p, i) => (
                  <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: p.photo ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    {p.photo && <img src={p.photo} alt="" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />}
                    <div>
                      {p.fio1 && <div style={{ fontWeight: 700 }}>{p.fio1}</div>}
                      {p.fio2 && <div style={{ fontWeight: 700 }}>{p.fio2}</div>}
                      {p.dates && <div style={{ fontWeight: 700 }}>{p.dates}</div>}
                    </div>
                  </div>
                )) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {frontData.graphics.length ? frontData.graphics.map((g, i) => (
                  <div key={`fg-${i}`} style={{ display: "grid", gridTemplateColumns: g.thumb ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    {g.thumb && <img src={g.thumb} alt="" style={{ width: 70, height: 70, objectFit: "contain", borderRadius: 6, background: "#fafafa", border: "1px solid #eee" }} />}
                    <div style={{ fontWeight: 700 }}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>
                  </div>
                )) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {frontData.epitaphs.length ? frontData.epitaphs.map((t, i) => <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap", fontStyle: "italic", fontWeight: 700 }}>{t}</div>) : <div>—</div>}
              </div>
            </div>
          </div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Тыльная */}
          {rearData && (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Тыльная</div>
                <div style={grid3()}>
                  <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div><div>—</div></div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                    {rearData.graphics.length ? rearData.graphics.map((g, i) => (
                      <div key={`rg-${i}`} style={{ display: "grid", gridTemplateColumns: g.thumb ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        {g.thumb && <img src={g.thumb} alt="" style={{ width: 70, height: 70, objectFit: "contain", borderRadius: 6, background: "#fafafa", border: "1px solid #eee" }} />}
                        <div style={{ fontWeight: 700 }}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>
                      </div>
                    )) : <div>—</div>}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                    {rearData.epitaphs.length ? rearData.epitaphs.map((t, i) => <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap", fontStyle: "italic", fontWeight: 700 }}>{t}</div>) : <div>—</div>}
                  </div>
                </div>
              </div>

              <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />
            </>
          )}

          {/* Плита */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Надгробная плита</div>
            <div style={grid3()}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Параметры</div>
                <div style={{ fontWeight: 700 }}>Размер: {plate.enabled ? (plate.size || "—") : "нет"}</div>
                <div style={{ fontWeight: 700 }}>Толщина: {plate.enabled ? (plate.thickness || "—") : "нет"}</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {plate.enabled && plate.graphics.length ? plate.graphics.map((g, i) => (
                  <div key={`pg-${i}`} style={{ display: "grid", gridTemplateColumns: g.thumb ? "70px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    {g.thumb && <img src={g.thumb} alt="" style={{ width: 70, height: 70, objectFit: "contain", borderRadius: 6, background: "#fafafa", border: "1px solid #eee" }} />}
                    <div style={{ fontWeight: 700 }}>{g.name}</div>
                  </div>
                )) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {plate.enabled && plate.epitaph ? <div style={{ whiteSpace: "pre-wrap", fontStyle: "italic", fontWeight: 700 }}>{plate.epitaph}</div> : <div>—</div>}
              </div>
            </div>
          </div>

          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />

          {/* Эскизы на той же странице */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Эскизы</div>
            <div style={{ display: "grid", gridTemplateColumns: rearData ? "1fr 1fr" : "1fr", gap: 6 }}>
              <div id="pdf-front-sketch" style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden", background: "#fff" }}>
                <div style={{ position: "absolute", inset: 0, padding: 0 }}>{frontSketch}</div>
              </div>
              {rearData && (
                <div style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden" }}>
                  {previewBack ? (
                    <img src={previewBack} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>Нет</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Примечания */}
          <hr style={{ border: 0, height: 1, background: "#ddd", margin: "6px 0" }} />
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Примечания</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{notes || "—"}</div>
          </div>
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
        <div style={{ fontSize: 14, lineHeight: 1.4, marginBottom: 16 }}>
          Мы просчитаем заказ и свяжемся с Вами в ближайшее время.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onNew} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }}>Новый заказ</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Основной компонент ===== */
type Props = { onBack?: () => void; onSend?: (payload?: any) => void };
export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());

  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    // ВНИМАНИЕ: не подписываемся на "storage", чтобы не «дергать» поля ввода при печати символов
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    refresh();
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    };
  }, []);

  const orderNo = String(introState.orderNumber || "").trim();

  // Тыльный превью
  const backSketchUrl = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  // Параметры изделия (для aspect)
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
    photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null // прикреплённые фото
  })), [frontPersons]);
  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => ((g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross"));
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  // Эпитафии лицевой
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

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  /* ===== Списки для «Заказ списком» и PDF ===== */
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

  const frontGraphicsWithThumbs = useMemo(() => {
    return (allFrontGraphics || []).map((g: any) => ({
      name: g.name || (g.url ? decodeURIComponent(g.url.split("/").pop() || "") : g.id || ""),
      qty: 1,
      thumb: g.preview || g.url || null
    }));
  }, [allFrontGraphics]);

  const rearGraphicsWithThumbs = useMemo(() => {
    return (rearUnique || []).map((g: any) => ({
      name: g.name || g.id,
      qty: rearCounts[g?.id || g?.url || g?.name] || 1,
      thumb: g.url || null
    }));
  }, [rearUnique, rearCounts]);

  const plateGraphicsWithThumbs = useMemo(() => {
    return (chosenPlateList || []).map((g: any) => ({
      name: g.name || g.id,
      thumb: g.url || null
    }));
  }, [chosenPlateList]);

  /* ===== Инструменты для PDF ===== */
  async function urlToDataUrl(url?: string | null): Promise<string | null> {
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

  async function captureFrontSketchPng(): Promise<string | null> {
    try {
      const node = document.getElementById("pdf-front-sketch");
      if (!node) return null;
      const htmlToImage = await ensureHtmlToImage();
      return await htmlToImage.toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true });
    } catch { return null; }
  }

  async function createPdfBlob(options: {
    orderNo: string;
    customerName: string; customerPhone: string;
    frontPersons: { fio1: string; fio2: string; dates: string; photo?: string | null }[];
    frontGraphics: { name: string; qty: number; thumb?: string | null }[];
    frontEpitaphs: string[];
    rearGraphics: { name: string; qty: number; thumb?: string | null }[];
    rearEpitaphs: string[];
    plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string; thumb?: string | null }[]; epitaph?: string };
    notes?: string;
    imgFront?: string | null; // PNG лицевой эскиз
    imgBack?: string | null;  // PNG тыльный эскиз
  }): Promise<Blob> {
    const jsPDF = await ensureJsPdf();
    const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
    await ensureCenturyFonts(doc);
    const FONT_BASE = csFontReady ? "CenturySchoolbook" : "helvetica";

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentW = pageW - margin * 2;
    const contentH = pageH - margin * 2;
    let y = margin;

    const setFont = (style: "bold" | "bolditalic", size: number) => {
      doc.setFont(FONT_BASE, style);
      doc.setFontSize(size);
    };
    const addHr = (gap = 12) => { doc.setDrawColor(200); doc.setLineWidth(1); doc.line(margin, y, pageW - margin, y); y += gap; };
    const addTitle = (t: string) => {
      setFont("bold", 28);
      const lines = doc.splitTextToSize(t, contentW);
      for (const ln of lines) {
        if (y + 34 > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(ln, margin, y); y += 34;
      }
    };
    const addMetric = (t: string, sz = 22) => {
      setFont("bold", sz);
      const lh = Math.round(sz * 1.25);
      const lines = doc.splitTextToSize(t, contentW);
      for (const ln of lines) {
        if (y + lh > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(ln, margin, y); y += lh;
      }
    };
    const addEpitaph = (t: string, sz = 22) => {
      setFont("bolditalic", sz);
      const lh = Math.round(sz * 1.25);
      const lines = doc.splitTextToSize(t, contentW);
      for (const ln of lines) {
        if (y + lh > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(ln, margin, y); y += lh;
      }
    };
    const addImageFitted = async (dataUrl: string | null | undefined, maxH = 560) => {
      if (!dataUrl) return;
      const fmt = /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG";
      const im = new Image();
      await new Promise<void>((res) => { im.onload = () => res(); im.src = dataUrl!; });
      const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0; if (!iw || !ih) return;
      const scale = Math.min(contentW / iw, maxH / ih, 1);
      const w = Math.round(iw * scale), h = Math.round(ih * scale);
      if (y + h > pageH - margin) { doc.addPage(); y = margin; }
      doc.addImage(dataUrl!, fmt, margin, y, w, h, undefined, "FAST");
      y += h + 12;
    };
    async function addThumbList(title: string, list: { name: string; qty?: number; thumb?: string | null }[]) {
      addMetric(title, 24);
      if (!list.length) { addMetric("—"); return; }
      const rowH = 76;
      for (const it of list) {
        if (y + rowH > pageH - margin) { doc.addPage(); y = margin; }
        let x = margin;
        if (it.thumb) {
          const data = await urlToDataUrl(it.thumb);
          if (data) {
            try { doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, y, 70, 70, undefined, "FAST"); } catch {}
          }
        }
        x += 78;
        const text = `${it.name}${it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}`;
        setFont("bold", 22);
        const lines = doc.splitTextToSize(text, contentW - 78);
        doc.text(lines, x, y + 24);
        y += rowH;
      }
    }

    // Шапка + состав заказа (3 колонки), ЭСКИЗЫ — на той же странице
    addTitle(`Заказ № ${options.orderNo || "—"}`);
    addMetric(`${options.customerName || "—"} · ${options.customerPhone || "—"}`);

    addHr();

    // Лицевая
    addTitle("Лицевая");
    addMetric("Усопшие", 24);
    if (options.frontPersons.length) {
      for (const p of options.frontPersons) {
        const fio = [p.fio1, p.fio2].filter(Boolean).join(" ");
        const line = [fio, p.dates].filter(Boolean).join(" · ");
        addMetric(line);
      }
    } else addMetric("—");
    await addThumbList("Графика", options.frontGraphics);
    addMetric("Эпитафии", 24);
    if (options.frontEpitaphs.length) { for (const t of options.frontEpitaphs) addEpitaph(t); } else addMetric("—");

    addHr();

    // Тыльная
    addTitle("Тыльная");
    addMetric("Усопшие", 24); addMetric("—");
    await addThumbList("Графика", options.rearGraphics);
    addMetric("Эпитафии", 24);
    if (options.rearEpitaphs.length) { for (const t of options.rearEpitaphs) addEpitaph(t); } else addMetric("—");

    addHr();

    // Плита
    addTitle("Надгробная плита");
    if (options.plate.enabled) {
      addMetric(`Размер: ${options.plate.size || "—"}`);
      addMetric(`Толщина: ${options.plate.thickness || "—"}`);
      await addThumbList("Графика", options.plate.graphics);
      addMetric("Эпитафии", 24);
      if (options.plate.epitaph) addEpitaph(options.plate.epitaph); else addMetric("—");
    } else {
      addMetric("нет");
    }

    addHr();

    // Примечания
    addTitle("Примечания");
    addMetric(options.notes || "—");

    addHr();

    // Эскизы (на той же странице)
    addTitle("Эскизы");
    await addImageFitted(options.imgFront || null, 560);
    await addImageFitted(options.imgBack || null, 560);

    // Прикреплённые фото — отдельные страницы
    const photos = (options.frontPersons || []).map((p) => p.photo).filter(Boolean) as string[];
    if (photos.length) {
      for (let i = 0; i < photos.length; i++) {
        doc.addPage();
        y = margin;
        addTitle(`Фото ${i + 1}`);
        // Вписать по высоте контентной области
        const data = await urlToDataUrl(photos[i]);
        if (data) {
          const fmt = /^data:image\/png/i.test(data) ? "PNG" : "JPEG";
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const scale = Math.min(contentW / iw, (contentH - 20) / ih, 1);
            const w = Math.round(iw * scale), h = Math.round(ih * scale);
            const x = margin + Math.max(0, (contentW - w) / 2);
            doc.addImage(data, fmt, x, y, w, h, undefined, "FAST");
          }
        } else {
          addMetric("—");
        }
      }
    }

    return doc.output("blob");
  }

  /* ===== UI: «Заказ списком» / Отправка / Сохранение ===== */
  const [simpleOpen, setSimpleOpen] = useState(false);
  const [sendingPdf, setSendingPdf] = useState(false);
  const [sentModalOpen, setSentModalOpen] = useState(false);
  const [err, setErr] = useState<string>("");

  async function onSavePdfInternal() {
    try {
      setSendingPdf(true); setErr("");
      await new Promise(r => setTimeout(r, 120)); // дать дорисовать DOM

      const orderNo = String(introState.orderNumber || "").trim();
      const name = (loadIntroState().intro?.customerName || "").trim();
      const phone = (loadIntroState().intro?.customerPhone || "").trim();

      const frontPng = await captureFrontSketchPng();
      const backPng = await urlToDataUrl(backSketchUrl || null);

      const pdfBlob = await createPdfBlob({
        orderNo,
        customerName: name,
        customerPhone: phone,
        frontPersons: frontPersons.map((p: any) => ({
          fio1: (p.lastName || "").trim(),
          fio2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
          dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — "),
          photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
        })),
        frontGraphics: frontGraphicsWithThumbs,
        frontEpitaphs: [...frontEpitaphs],
        rearGraphics: rearGraphicsWithThumbs,
        rearEpitaphs: [...rearEpitaphs],
        plate: {
          enabled: !!extraPlate,
          size: extraPlate ? plateSize : undefined,
          thickness: extraPlate ? plateThickness : undefined,
          graphics: plateGraphicsWithThumbs,
          epitaph: extraPlate ? (plateEpitaph || "") : ""
        },
        notes: (extras0.orderNotes || "").trim(),
        imgFront: frontPng,
        imgBack: backPng
      });

      // Сохранить локально
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pdfBlob);
      a.download = `order-${orderNo || Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);

      // Отправить в админ-чат (бэкенд)
      await sendPdfToServer(pdfBlob, {
        orderNo,
        intro: loadIntroState().intro || {},
        extras: {
          base: extraBase, flowerbed: extraFlowerbed, headstonePlate: extraPlate,
          plateSize, plateThickness, plateOrientation, plateEpitaph,
          plateGraphics: plateGraphicsWithThumbs.map(g => g.name)
        }
      });

      setSimpleOpen(false);
      setSentModalOpen(true);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Не удалось сформировать/отправить PDF.");
    } finally {
      setSendingPdf(false);
    }
  }

  function goNewOrder() {
    // Очистка драфта/интро при необходимости:
    // localStorage.removeItem('...') — по вашему ключу.
    // Переход на начальную:
    if (typeof window !== "undefined") {
      window.location.href = "/"; // подстройте под ваш роутинг
    }
  }

  /* ===== Отправка «Рассчитать стоимость» (без PDF) — переименовано ===== */
  const [busy, setBusy] = useState(false);
  async function handleSend() {
    // Теперь это тоже «Рассчитать стоимость»: генерим и отправляем PDF (как в «Заказ списком»)
    await onSavePdfInternal();
  }

  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
      <EditableOrderSummary orderNo={orderNo} onOpenSimple={() => setSimpleOpen(true)} />

      {/* Эскизы */}
      <section id="section-previews" style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: backSketchUrl ? "1fr 1fr" : "1fr", gap: 12 }}>
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
        <textarea id="order-notes" rows={3} defaultValue={extras0.orderNotes || ""} onBlur={(e) => {
          const prev = loadOrderDraft();
          const extras: any = { ...(prev as any).extras, orderNotes: (e.target.value || "").trim() || undefined };
          saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
          setDraft(loadOrderDraft());
        }} placeholder="Любые замечания к заказу…" style={{ ...inputStyle(), resize: "vertical" }} />
      </section>

      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      {/* Кнопки — Переименовано в «Рассчитать стоимость» */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy || sendingPdf)} disabled={busy || sendingPdf}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy || sendingPdf)} disabled={busy || sendingPdf || sendingPdf}>{sendingPdf ? "Готовим…" : "Рассчитать стоимость"}</button>
        <button type="button" onClick={() => setSimpleOpen(true)} style={glassButtonStyle("sm", busy || sendingPdf)} disabled={busy || sendingPdf}>{sendingPdf ? "Готовим…" : "Заказ списком"}</button>
      </div>

      {/* Оверлей «Заказ списком» */}
      {simpleOpen && (
        <PrintOverlay
          onClose={() => setSimpleOpen(false)}
          onSavePdf={onSavePdfInternal}
          onSendCost={onSavePdfInternal}
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
            graphics: plateGraphicsWithThumbs,
            epitaph: (plateEpitaph || "").trim()
          }}
          notes={(extras0.orderNotes || "").trim()}
          aspect={aspect}
        />
      )}

      {/* Модалка «Отправлено» */}
      {sentModalOpen && (
        <SentModal
          onClose={() => setSentModalOpen(false)}
          onNew={goNewOrder}
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
