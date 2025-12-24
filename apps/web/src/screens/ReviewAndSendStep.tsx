// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение».
// Требования:
// - PDF генерируем ИЗ ТОПБАРА (цветной снимок раскрытой панели), размер страницы 1512×2138 px.
// - На второй странице PDF — эскизы (лицевая и тыльная, если есть).
// - На последующих страницах PDF — прикреплённые фото усопших (по одному на страницу).
// - В UI: TopBar сверху, кнопка «Посмотреть состав заказа» разворачивает TopBar,
//   ниже — блок «Выбрано для плиты» (если есть), ниже — эскиз лицевой,
//   ниже — эскиз тыльной (если есть), ниже — «Примечание к заказу»,
//   ниже — подсказка, и кнопки «Назад / Рассчитать стоимость».
// - По нажатию «Рассчитать стоимость» — модалка: «Отправить / Сохранить PDF / Закрыть (×)».
// - Без использования LoudAccordion (исправляет ошибку ReferenceError).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState } from "../lib/intro";

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

/* ===== jsPDF + шрифты (Century Schoolbook Bold / BoldItalic) ===== */
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
function toParagraphs(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}

/* ===== Подтверждающая модалка ===== */
function ConfirmSendModal({
  onClose, onSend, onSavePdf
}: { onClose: () => void; onSend: () => void; onSavePdf: () => void }) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 10000, display: "grid", placeItems: "center" }}>
      <div
        style={{
          width: "100%", maxWidth: 420, background: "#fff", color: "#111",
          borderRadius: 12, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          transform: "scale(0.98)", opacity: 0, animation: "modalIn 180ms ease forwards", position: "relative"
        }}
      >
        <style>{`
          @keyframes modalIn { to { transform: scale(1); opacity: 1; } }
          .btn { padding: 8px 12px; border-radius: 8px; border: 1px solid #999; cursor: pointer; background: #f7f7f7; }
        `}</style>
        <button onClick={onClose} title="Закрыть" style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 8, border: "1px solid #ccc", background: "#fafafa", cursor: "pointer" }}>×</button>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Вы хотите отправить заказ менеджерам для просчёта стоимости?</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={onSavePdf} title="Сохранить PDF локально">Сохранить PDF</button>
          <button className="btn" onClick={onSend} title="Отправить PDF менеджерам" style={{ background: "#e5ffe5", borderColor: "#99d199" }}>Отправить</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Отправлено ===== */
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

  // Развернуть TopBar программно и проскроллить
  function openTopbar() {
    try {
      const btn = document.querySelector<HTMLButtonElement>('button[aria-controls="order-panel"]');
      if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  }

  // Тыльный эскиз
  const backSketchUrl = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  // Параметры изделия для aspect (для контейнеров эскизов)
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  // Лицевая: люди, графика, эпитафии
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(() => frontPersons.map((p: any, i: number) => ({
    id: p.id || `p-${i}`,
    lines: [
      (p?.lastName || "").trim(),
      [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" "),
      [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ")
    ].filter(Boolean),
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

  // Плита (выбранное)
  const extras0 = (draft as any)?.extras || {};
  const extraPlate = !!extras0.headstonePlate;
  const plateIds: string[] = (extras0.plateGraphicsIds as string[]) || [];
  const plateMeta: Record<string, any> = (extras0.plateGraphicsMeta as Record<string, any>) || {};
  const plateEpitaph: string = (extras0.plateEpitaph as string) || "";
  const chosenPlateList = useMemo(() => Array.from(new Set(plateIds)).map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" }), [plateIds, plateMeta]);
  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  // Поле «Примечание к заказу» сохранение на blur
  function saveOrderNotes(value: string) {
    const prev = loadOrderDraft();
    const extras: any = { ...(prev as any).extras, orderNotes: (value || "").trim() || undefined };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
    setDraft(loadOrderDraft());
  }

  // ===== PDF из TopBar: снимок панели, потом эскизы, потом фото =====
  async function urlToDataUrl(url?: string | null): Promise<string | null> {
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

  async function createPdfFromTopbar(sendAlso: boolean) {
    try {
      // Развернуть topbar, чтобы панель была в DOM и полностью видима
      const btn = document.querySelector<HTMLButtonElement>('button[aria-controls="order-panel"]');
      if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
      await new Promise(r => setTimeout(r, 200));

      const panelSection = document.querySelector<HTMLElement>("#order-panel > section");
      if (!panelSection) throw new Error("Панель заказа не найдена. Откройте «Посмотреть состав заказа» и попробуйте снова.");

      const jsPDF = await ensureJsPdf();
      const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
      await ensureCenturyFonts(doc);

      const FONT = csFontReady ? "CenturySchoolbook" : "helvetica";
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;

      // 1) Первая страница — цветной снимок панели (включая имя/телефон)
      const panelPng = await captureNodePng(panelSection);
      if (panelPng) {
        const im = new Image();
        await new Promise<void>((res) => { im.onload = () => res(); im.src = panelPng; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        const scale = Math.min(contentW / iw, contentH / ih, 1);
        const w = Math.round(iw * scale), h = Math.round(ih * scale);
        const x = margin + Math.max(0, (contentW - w) / 2);
        const y = margin + Math.max(0, (contentH - h) / 2);
        doc.addImage(panelPng, "PNG", x, y, w, h, undefined, "FAST");
      }

      // 2) Вторая страница — эскизы
      doc.addPage();
      doc.setFont(FONT, "bold"); doc.setFontSize(28);
      let y2 = margin;
      const title = doc.splitTextToSize("Эскизы", contentW);
      title.forEach((ln: string) => { doc.text(ln, margin, y2); y2 += 34; });

      // Лицевая — захват DOM id="pdf-front-sketch"
      const frontNode = document.getElementById("pdf-front-sketch");
      if (frontNode) {
        const frontPng = await captureNodePng(frontNode);
        if (frontPng) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = frontPng; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          const scale = Math.min(contentW / iw, (contentH - (y2 - margin)) / ih, 1);
          const w = Math.round(iw * scale), h = Math.round(ih * scale);
          const x = margin + Math.max(0, (contentW - w) / 2);
          doc.addImage(frontPng, "PNG", x, y2, w, h, undefined, "FAST");
          y2 += h + 12;
        }
      }

      // Тыльная — захват DOM id="pdf-back-sketch" (если есть)
      const backNode = document.getElementById("pdf-back-sketch");
      if (backNode) {
        const backPng = await captureNodePng(backNode);
        if (backPng) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = backPng; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          const scale = Math.min(contentW / iw, (contentH - (y2 - margin)) / ih, 1);
          const w = Math.round(iw * scale), h = Math.round(ih * scale);
          const x = margin + Math.max(0, (contentW - w) / 2);
          doc.addImage(backPng, "PNG", x, y2, w, h, undefined, "FAST");
        }
      }

      // 3) Фото — отдельные страницы
      const photos: string[] = frontPersons.map((p) => p.photo).filter(Boolean) as string[];
      for (let i = 0; i < photos.length; i++) {
        doc.addPage();
        let y3 = margin;
        doc.setFont(FONT, "bold"); doc.setFontSize(28);
        doc.text(`Фото ${i + 1}`, margin, y3); y3 += 34;
        const data = await urlToDataUrl(photos[i]);
        if (data) {
          const im = new Image();
          await new Promise<void>((res) => { im.onload = () => res(); im.src = data; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const scale = Math.min(contentW / iw, (pageH - y3 - margin) / ih, 1);
            const w = Math.round(iw * scale), h = Math.round(ih * scale);
            const x = margin + Math.max(0, (contentW - w) / 2);
            doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, y3, w, h, undefined, "FAST");
          }
        }
      }

      const orderNo = String(loadIntroState().orderNumber || "").trim();
      if (sendAlso) {
        const blob = doc.output("blob");
        const fd = new FormData();
        fd.append("pdf", blob, `order-${orderNo || Date.now()}.pdf`);
        fd.append("payload", JSON.stringify({
          orderNo,
          intro: loadIntroState().intro || {},
          extras: (loadOrderDraft() as any)?.extras || {}
        }));
        const res = await fetch("/api/send-order-pdf", { method: "POST", body: fd });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          alert(`Не удалось отправить: ${t || res.statusText}`);
        } else {
          setConfirmOpen(false);
          setSentOpen(true);
        }
      } else {
        doc.save(`order-${orderNo || Date.now()}.pdf`);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Не удалось сформировать PDF.");
    }
  }

  // ===== UI =====
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);

  const orderNotesVal = (extras0.orderNotes || "").trim();

  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
      {/* TopBar */}
      <TopBarWithIntro title="Memorial" />

      {/* Посмотреть состав заказа (развернуть топбар) */}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 12px" }}>
        <button type="button" onClick={openTopbar} style={linkLike()}>Посмотреть состав заказа</button>
      </div>

      {/* Выбрано для плиты — при наличии */}
      {extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
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
      )}

      {/* Эскиз — лицевая (обязательно с id для PDF) */}
      <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскиз — лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0, zIndex: 1, padding: 0 }}>
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

      {/* Эскиз — тыльная (если есть). Помечаем id для PDF-страницы эскизов */}
      {backSketchUrl && (
        <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскиз — тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img
              id="pdf-back-sketch"
              src={backSketchUrl}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1, pointerEvents: "none" }}
            />
          </div>
        </section>
      )}

      {/* Примечание к заказу */}
      <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 12 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Примечание к заказу</label>
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={orderNotesVal}
          onBlur={(e) => saveOrderNotes(e.target.value)}
          placeholder="Любые замечания к заказу…"
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </section>

      {/* Подсказка */}
      <div style={{ fontSize: 12, opacity: 0.85, margin: "4px 12px 12px" }}>
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
          onSavePdf={() => createPdfFromTopbar(false)}
          onSend={() => createPdfFromTopbar(true)}
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

/* ===== Локальные подкомпоненты ===== */
function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
      {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
    </div>
  );
}
