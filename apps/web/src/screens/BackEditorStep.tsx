// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение»
//
// По требованиям:
// - Топбар разворачиваем прямо на этой странице (и перед скриншотом). Блок с номером/контактами НЕ показываем.
// - Тыльная сторона: отображаем и отправляем как на шаге «Тыл» — композиция из:
//   • Подложки изделия (силуэт по альфе/по «не фону» по углам, заливка #1b1b1b, зеркально)
//   • Растрового превью тыльной стороны (contain, без обрезки).
//   Контейнер эскиза использует aspectRatio исходного изделия (натуральные размеры item).
// - Скриншот топбара делаем по нажатию «Отправить», без подписи, с ожиданием — не обрезается.
// - Блоки «Дополнительно» и «Надгробная плита» возвращены (управление флагами/размерами/эпитафией).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState } from "../lib/intro";
import { QUICK_EPITAPHS } from "../data/epitaphs";
import { generateOrderPdf, downloadBlob } from "../lib/pdf/generateOrderPdf";
import { compressImageFileToMaxBytes } from "../lib/media/resize";

/* ========= Styles ========= */
function safeRoot(): React.CSSProperties {
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
  return {
    background: "rgba(20,20,24,0.90)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const pad = size === "nano" ? "6px 10px" : size === "sm" ? "10px 14px" : "12px 18px";
  return {
    padding: pad,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}
const sectionBox: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 10,
  padding: 10
};
function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
      {url ? <img src={url} alt={alt} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
    </div>
  );
}
function BusyOverlay({ text = "Идёт обработка…" }: { text?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111", color: "#fff", padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", minWidth: 220, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div className="spinner" style={{ margin: "0 auto 10px", width: 28, height: 28, border: "3px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <div>{text}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}

/* ========= Utils ========= */
function toParagraphs(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}
function personLines(p: any): string[] {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/* ========= HTML-to-image ========= */
async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if ((window as any).htmlToImage) return (window as any).htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("html-to-image load error"));
    document.head.appendChild(s);
  });
  if (!(window as any).htmlToImage) throw new Error("html-to-image unavailable");
  return (window as any).htmlToImage;
}
async function elementToPngDataUrl(node: HTMLElement | null, opts?: { pixelRatio?: number; bg?: string }): Promise<string | null> {
  if (!node) return null;
  const hti = await ensureHtmlToImage();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return await hti.toPng(node, {
    backgroundColor: opts?.bg || "#ffffff",
    pixelRatio: Math.max(1, Math.min(2, opts?.pixelRatio || 2)),
    cacheBust: true
  });
}
function dataUrlToFile(dataUrl: string, name = "image.png"): File {
  const arr = dataUrl.split(",");
  const mime = (arr[0].match(/data:(.*);base64/) || [])[1] || "image/png";
  const bin = atob(arr[1] || "");
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: mime });
}

/* ========= Telegram helpers ========= */
async function sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch("/api/tg-send-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const raw = await resp.text().catch(() => "");
    let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
    return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}
async function sendLargeText(fullText: string): Promise<{ ok: boolean; errors: string[] }> {
  const TELEGRAM_CHUNK_SIZE = 3500;
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < fullText.length) { parts.push(fullText.slice(cursor, cursor + TELEGRAM_CHUNK_SIZE)); cursor += TELEGRAM_CHUNK_SIZE; }
  const errors: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const resp = await fetch("/api/tg-send-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: parts[i] }) });
    const raw = await resp.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
    if (!resp.ok || !json?.ok) errors.push(json?.error || raw || resp.statusText);
    await sleep(120);
  }
  return { ok: errors.length === 0, errors };
}
async function sendPhotoFileNoCaption(file: File): Promise<{ ok: boolean; error?: string }> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
    const raw = await resp.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
    return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
  } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

/* ========= Back composite (как на «Тыл») ========= */
async function loadImage(url: string, cross = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (cross) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}
function colorDist(a: [number, number, number], b: [number, number, number]) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
function pickCorners(imgData: ImageData) {
  const w = imgData.width, h = imgData.height, d = imgData.data;
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const p1 = [d[idx(0, 0)], d[idx(0, 0) + 1], d[idx(0, 0) + 2]] as [number, number, number];
  const p2 = [d[idx(w - 1, 0)], d[idx(w - 1, 0) + 1], d[idx(w - 1, 0) + 2]] as [number, number, number];
  const p3 = [d[idx(0, h - 1)], d[idx(0, h - 1) + 1], d[idx(0, h - 1) + 2]] as [number, number, number];
  const p4 = [d[idx(w - 1, h - 1)], d[idx(w - 1, h - 1) + 1], d[idx(w - 1, h - 1) + 2]] as [number, number, number];
  const avg: [number, number, number] = [
    Math.round((p1[0] + p2[0] + p3[0] + p4[0]) / 4),
    Math.round((p1[1] + p2[1] + p3[1] + p4[1]) / 4),
    Math.round((p1[2] + p2[2] + p3[2] + p4[2]) / 4)
  ];
  return avg;
}
// Строим композицию: зеркальный силует изделия (#1b1b1b) + backPreview (contain). Возвращаем dataURL.
async function buildBackComposite(params: {
  itemUrl: string;
  backUrl: string;
  maxCanvasW?: number;
  tolerance?: number;
}): Promise<string | null> {
  const { itemUrl, backUrl, maxCanvasW = 1600, tolerance = 22 } = params;
  try {
    const [itemImg, backImg] = await Promise.all([
      loadImage(itemUrl, true),
      loadImage(backUrl, true).catch(() => loadImage(backUrl, false))
    ]);

    const iw = itemImg.naturalWidth || itemImg.width;
    const ih = itemImg.naturalHeight || itemImg.height;
    if (!iw || !ih) return null;

    const scale = Math.min(1, maxCanvasW / iw);
    const cw = Math.max(1, Math.round(iw * scale));
    const ch = Math.max(1, Math.round(ih * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d")!;

    // Рисуем изделие в tmp, строим маску «не фон»
    const tmp = document.createElement("canvas"); tmp.width = cw; tmp.height = ch;
    const tctx = tmp.getContext("2d")!;
    tctx.drawImage(itemImg, 0, 0, cw, ch);
    const imgData = tctx.getImageData(0, 0, cw, ch);
    const bg = pickCorners(imgData);

    const sil = document.createElement("canvas"); sil.width = cw; sil.height = ch;
    const sctx = sil.getContext("2d")!;
    const sd = sctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        const r = imgData.data[i], g = imgData.data[i + 1], b = imgData.data[i + 2], a = imgData.data[i + 3];
        const isBg = a < 10 || colorDist([r, g, b], bg) <= tolerance;
        if (!isBg) { sd.data[i] = 0x1b; sd.data[i + 1] = 0x1b; sd.data[i + 2] = 0x1b; sd.data[i + 3] = 255; }
        else { sd.data[i + 3] = 0; }
      }
    }
    sctx.putImageData(sd, 0, 0);

    // Рисуем силует зеркально
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sil, 0, 0);
    ctx.restore();

    // Вписываем backPreview по contain
    const bw = backImg.naturalWidth || backImg.width;
    const bh = backImg.naturalHeight || backImg.height;
    if (bw && bh) {
      const r = Math.min(cw / bw, ch / bh);
      const dw = Math.round(bw * r), dh = Math.round(bh * r);
      const dx = Math.round((cw - dw) / 2), dy = Math.round((ch - dh) / 2);
      ctx.drawImage(backImg, dx, dy, dw, dh);
    }

    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return null;
  }
}

/* ========= Component ========= */
export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());

  // Разворачиваем TopBar на этой странице (и фолбэк — кликаем по кнопке)
  useEffect(() => {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    setTimeout(() => {
      const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
      if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    }, 60);
  }, []);

  // Обновление драфта
  useEffect(() => {
    const onUpdate = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpdate as any);
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, onUpdate as any);
  }, []);

  // Исходное изделие: для aspectRatio контейнеров
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [itemWH, setItemWH] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!itemUrl) { setItemWH(null); return; }
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
      if (w && h) setItemWH({ w, h });
    };
    im.src = itemUrl;
  }, [itemUrl]);

  // Тыльная сторона: растр из BackEditor + композиция
  function getBackPreviewUrl(d: any): string | null {
    const eb = (d || {}).editorBack || {};
    const raw = String(eb.previewHiUrl || eb.previewUrl || "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }
  const [backPreviewUrl, setBackPreviewUrl] = useState<string | null>(getBackPreviewUrl(draft));
  const [backCompositeUrl, setBackCompositeUrl] = useState<string | null>(null);
  useEffect(() => { setBackPreviewUrl(getBackPreviewUrl(draft)); }, [draft]);
  useEffect(() => {
    const run = async () => {
      if (!itemUrl || !backPreviewUrl) { setBackCompositeUrl(null); return; }
      const built = await buildBackComposite({ itemUrl, backUrl: backPreviewUrl, maxCanvasW: 1600, tolerance: 22 });
      setBackCompositeUrl(built || backPreviewUrl);
    };
    run().catch(() => setBackCompositeUrl(backPreviewUrl || null));
  }, [itemUrl, backPreviewUrl]);
  const showBack = !!(backCompositeUrl || backPreviewUrl);

  // Лицевая: люди/графика/эпитафии
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(
    () => frontPersons.map((p: any, i: number) => ({ id: p.id || `p-${i}`, lines: personLines(p), photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null })),
    [frontPersons]
  );
  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => (g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross");
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);
  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  /* ========= Дополнительно / Плита ========= */
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(extras0.plateOrientation || ((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h") ? "horizontal" : "vertical"));
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // Каталог/графика плиты тут опустим — главное вернуть секции управления (размер/толщина/ориентация/эпитафии/флаги)

  /* ========= Отправка и статусы ========= */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [topbarDelivered, setTopbarDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  const TARGET_FILE_BYTES = Math.floor(2.7 * 1024 * 1024);

  function buildOrderText(): string {
    const d = loadOrderDraft();
    const introObj = loadIntroState();
    const persons = (((d?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      last: (p?.lastName || "").trim(),
      namePatr: [p?.firstName, p?.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
      dates: [p?.birthDate, p?.deathDate].map((s: string) => (s || "").trim()).filter(Boolean).join(" — ")
    }));
    const gfxFront = (((d as any)?.graphics || []) as any[]).map((g) => g?.name || g?.id || g?.relPath || g?.url).filter(Boolean);

    const rearIds: string[] = (((d as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
    const rearMeta: Record<string, any> = ((d as any)?.editorBack?.graphicsMeta || {});
    const rearCounts: Record<string, number> = {};
    (rearIds || []).forEach(id => rearCounts[id] = (rearCounts[id] || 0) + 1);
    const gfxRear = Array.from(new Set(rearIds || [])).map(id => (rearMeta?.[id]?.name || id));

    const epsFront = toParagraphs((d?.engraving as any)?.epitaphs ?? (d?.engraving as any)?.epitaphText);
    const epsRear = toParagraphs(((d as any)?.editorBack?.epitaphTexts || []).join("\n\n"));

    const pSize = plateSize === "Свой вариант" ? (plateCustomSize || plateSize) : plateSize;
    const pThick = plateThickness || "";
    const pOrient = plateOrientation === "horizontal" ? "горизонтально" : plateOrientation === "vertical" ? "вертикально" : "";
    const pWidth = (() => {
      const eff = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
      if (!eff) return "—";
      const m = eff.match(/(\d+)\s*[×xX]\s*(\d+)/);
      if (m) return `${m[2]} см`;
      const n = eff.match(/(\d+)\s*см/);
      if (n) return `${n[1]} см`;
      return eff;
    })();

    const lines: string[] = [];
    const orderNoLine = introObj?.orderNumber ? `Заявка №${introObj.orderNumber}` : "Заявка";
    lines.push(orderNoLine, "");

    lines.push("Клиент:");
    lines.push(`- Имя: ${(introObj?.intro?.customerName || "").trim() || "—"}`);
    lines.push(`- Телефон: ${(introObj?.intro?.customerPhone || "").trim() || "—"}`);
    if ((introObj?.intro?.customerNotes || "").trim()) lines.push(`- Примечание: ${(introObj?.intro?.customerNotes || "").trim()}`);
    lines.push("");

    const itemName = String((d as any)?.item?.name || "").trim();
    if (itemName) { lines.push("Изделие:"); lines.push(`- Модель: ${itemName}`); lines.push(""); }

    lines.push("Люди:");
    if (persons.length === 0) lines.push("- —");
    else {
      persons.forEach((p) => {
        const fio = [p.last, p.namePatr].filter(Boolean).join(" ");
        lines.push(`- ${fio || "—"}`);
        if (p.dates) lines.push(`  ${p.dates}`);
      });
    }
    lines.push("");

    if (epsFront.length) { lines.push("Эпитафии (лицевая):"); epsFront.forEach((ep) => lines.push(`- ${ep}`)); lines.push(""); }
    if (epsRear.length) { lines.push("Эпитафии (тыльная):"); epsRear.forEach((ep) => lines.push(`- ${ep}`)); lines.push(""); }
    if (gfxFront.length) { lines.push("Графика (лицевая):"); gfxFront.forEach((n) => lines.push(`- ${n}`)); lines.push(""); }
    if (gfxRear.length) {
      lines.push("Графика (тыльная):");
      gfxRear.forEach((n) => {
        const id = (rearIds || []).find(id0 => (rearMeta[id0]?.name || id0) === n) || "";
        const count = rearCounts[id] || 1;
        lines.push(`- ${n}${count > 1 ? ` ×${count}` : ""}`);
      });
      lines.push("");
    }

    if (extraPlate) {
      lines.push("Надгробная плита:");
      if (pSize) lines.push(`- Размер: ${pSize}`);
      if (pWidth) lines.push(`- Ширина: ${pWidth}`);
      if (pThick) lines.push(`- Толщина: ${pThick}`);
      if (pOrient) lines.push(`- Ориентация: ${pOrient}`);
      const plateEps = toParagraphs(plateEpitaph);
      if (plateEps.length) { lines.push("- Эпитафии:"); plateEps.forEach((ep) => lines.push(` • ${ep}`)); }
      lines.push("");
    }

    return lines.join("\n");
  }

  async function ensureTopbarOpenAndReady() {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    window.scrollTo({ top: 0, behavior: "auto" });
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
      if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    }
    await sleep(160);
  }
  async function sendTopbarShotNoCaption() {
    const el = document.getElementById("topbar-capture");
    if (!el) return { ok: false, error: "topbar node not found" };
    const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
    if (!dataUrl) return { ok: false, error: "toPng failed" };
    const f = dataUrlToFile(dataUrl, "topbar.png");
    const compressed = await compressImageFileToMaxBytes(f, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
    return await sendPhotoFileNoCaption(new File([compressed], "topbar.jpg", { type: "image/jpeg" }));
  }
  async function sendFrontSketchNoCaption() {
    const el = document.getElementById("pdf-front-sketch");
    if (!el) return { ok: false, error: "front node not found" };
    const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
    if (!dataUrl) return { ok: false, error: "toPng failed" };
    const f = dataUrlToFile(dataUrl, "front.png");
    const compressed = await compressImageFileToMaxBytes(f, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
    return await sendPhotoFileNoCaption(new File([compressed], "front.jpg", { type: "image/jpeg" }));
  }
  async function sendBackComposite() {
    const url = backCompositeUrl || backPreviewUrl;
    if (!url) return { ok: false, error: "no back" };
    try {
      if (url.startsWith("data:image/")) {
        const f = dataUrlToFile(url, "back.png");
        const compressed = await compressImageFileToMaxBytes(f, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
        return await sendPhotoFileNoCaption(new File([compressed], "back.jpg", { type: "image/jpeg" }));
      }
      // http(s): попробуем получить dataUrl через canvas (может упасть по CORS)
      try {
        const im = await loadImage(url, true);
        const c = document.createElement("canvas");
        c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
        const cx = c.getContext("2d")!; cx.drawImage(im, 0, 0);
        const dataUrl = c.toDataURL("image/jpeg", 0.95);
        const f = dataUrlToFile(dataUrl, "back.png");
        const compressed = await compressImageFileToMaxBytes(f, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
        return await sendPhotoFileNoCaption(new File([compressed], "back.jpg", { type: "image/jpeg" }));
      } catch {
        // если CORS — отправим URL как есть (сервер скачает сам)
        const fd = new FormData(); fd.append("url", url);
        const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
        const raw = await resp.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
        return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
      }
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }

  async function sendOrderDirect() {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setTextDelivered(null);
    setTopbarDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(showBack ? null : null);
    setPhotosDelivered(0);

    const warnings: string[] = [];
    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      await sendMessage(`🪦 НАЧАЛО ЗАЯВКИ №${orderNoCur || "—"}`);

      await ensureTopbarOpenAndReady();
      const tbRes = await sendTopbarShotNoCaption();
      setTopbarDelivered(tbRes.ok);
      if (!tbRes.ok && tbRes.error) warnings.push(`Шапка не отправлена: ${tbRes.error}`);

      const full = buildOrderText();
      const tRes = await sendLargeText(full);
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      const fRes = await sendFrontSketchNoCaption();
      setFrontSketchDelivered(fRes.ok);
      if (!fRes.ok && fRes.error) warnings.push(`Эскиз (лицевая) не отправлен: ${fRes.error}`);

      if (showBack) {
        const bRes = await sendBackComposite();
        setBackSketchDelivered(bRes.ok);
        if (!bRes.ok && bRes.error) warnings.push(`Эскиз (тыльная) не отправлен: ${bRes.error}`);
      }

      // Фото персон (без подписи)
      const photos = collectPersonPhotos(loadOrderDraft());
      setPhotosTotal(photos.length);
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
        const res = await sendPhotoFileNoCaption(new File([compressed], ph.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
        if (!res.ok) warnings.push(`Фото не отправлено (${ph.name}): ${res.error || "ошибка"}`);
        else setPhotosDelivered((v) => v + 1);
        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(140);
      }

      await sendMessage(`🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${orderNoCur || "—"}`);

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);
      setUploadProgress(100);
    } finally {
      setUploading(false);
    }
  }

  function collectPersonPhotos(d: any): { file: File; name: string }[] {
    const persons = (((d || {}).engraving || {}).persons || []).filter(Boolean);
    const out: { file: File; name: string }[] = [];
    for (const p of persons) {
      const fio = [(p?.lastName || "").trim(), [p?.firstName, p?.middleName].map((x: any) => (x || "").trim()).filter(Boolean).join(" ")].filter(Boolean).join(" ");
      const dataUrl = (p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || "").trim();
      if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) continue;
      const bin = atob(dataUrl.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], `${fio || "photo"}.jpg`, { type: "image/jpeg" });
      out.push({ file, name: `${fio || "photo"}.jpg` });
    }
    return out;
  }

  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));
      const blob = await generateOrderPdf({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: null,
        backUrlFallback: backCompositeUrl || backPreviewUrl || null,
        includeAttachedPhotos: true
      });
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } finally { setIsSaving(false); }
  }

  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%`
      : isSaving ? "Формируем PDF…"
      : isSending ? "Отправляем заказ…"
      : "";

  return (
    <div style={safeRoot()}>
      {/* Топбар — обязательно развёрнут */}
      <div id="topbar-capture">
        <TopBarWithIntro title="Memorial" />
      </div>

      {/* Дополнительно и Надгробная плита */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        {/* Дополнительно */}
        <div style={{ ...sectionBox, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Дополнительно</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={hasPedestal} onChange={(e) => { setHasPedestal(e.target.checked); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, tumba: e.target.checked }, updatedAt: Date.now() }); }} />
              <span>Тумба</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={hasFlowerbed} onChange={(e) => { setHasFlowerbed(e.target.checked); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, flowerbed: e.target.checked }, updatedAt: Date.now() }); }} />
              <span>Цветник</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={hasVase} onChange={(e) => { setHasVase(e.target.checked); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, vase: e.target.checked }, updatedAt: Date.now() }); }} />
              <span>Ваза</span>
            </label>
          </div>
        </div>

        {/* Надгробная плита */}
        <div style={{ ...sectionBox }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={extraPlate}
                onChange={(e) => { setExtraPlate(e.target.checked); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: e.target.checked }, updatedAt: Date.now() }); }}
              />
              <span style={{ fontWeight: 700 }}>Надгробная плита</span>
            </label>
          </div>

          {extraPlate && (
            <div style={{ display: "grid", gap: 12 }}>
              {/* Размер */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="plate-size"
                        checked={plateSize === v}
                        onChange={() => { setPlateSize(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateSize: v }, updatedAt: Date.now() }); }}
                      />
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
                {plateSize === "Свой вариант" && (
                  <input
                    value={plateCustomSize}
                    onChange={(e) => setPlateCustomSize(e.target.value)}
                    onBlur={(e) => { const v = e.target.value.trim(); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateCustomSize: v || "" }, updatedAt: Date.now() }); }}
                    placeholder="Укажите свой размер (например, 130×60 см)"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none" }}
                  />
                )}
              </div>

              {/* Толщина */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="plate-thickness"
                        checked={plateThickness === v}
                        onChange={() => { setPlateThickness(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateThickness: v }, updatedAt: Date.now() }); }}
                      />
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
                {plateThickness === "Свой вариант" && (
                  <input
                    value={plateCustomThickness}
                    onChange={(e) => setPlateCustomThickness(e.target.value)}
                    onBlur={(e) => { const v = e.target.value.trim(); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateCustomThickness: v || "" }, updatedAt: Date.now() }); }}
                    placeholder="Укажите толщину (например, 7 см)"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none" }}
                  />
                )}
              </div>

              {/* Ориентация */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="plate-orient"
                        checked={plateOrientation === v}
                        onChange={() => { setPlateOrientation(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateOrientation: v }, updatedAt: Date.now() }); }}
                      />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Эпитафии */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Эпитафии на плите</div>
                <textarea
                  rows={3}
                  value={plateEpitaph}
                  onChange={(e) => setPlateEpitaph(e.target.value)}
                  onBlur={(e) => { const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateEpitaph: (e.target.value || "").trim() }, updatedAt: Date.now() }); }}
                  placeholder="Введите текст…"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", resize: "vertical" }}
                />
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const list = toParagraphs(plateEpitaph);
                        const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
                        const exists = list.some((s) => norm(s) === norm(t));
                        const next = exists ? list.filter((s) => norm(s) !== norm(t)) : list.concat([t]);
                        const joined = next.join("\n\n");
                        setPlateEpitaph(joined);
                        const prev = loadOrderDraft();
                        saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateEpitaph: joined }, updatedAt: Date.now() });
                      }}
                      style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer" }}
                      title={t}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Лицевая — исходный эскиз (геометрия по itemWH) */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
        <div style={{ position: "relative", aspectRatio: itemWH ? `${itemWH.w} / ${itemWH.h}` : "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
            <SketchTemplate item={item} peopleBlocks={peopleBlocks} crosses={selectedCrosses} others={selectedOthers} epitaphs={frontEpitaphs} carvingOpacity={0.4} />
          </div>
        </div>
      </section>

      {/* Тыльная — композиция (подложка изделия + backPreview) */}
      {showBack && (backCompositeUrl || backPreviewUrl) && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: itemWH ? `${itemWH.w} / ${itemWH.h}` : "4 / 3", width: "100%", overflow: "hidden" }}>
            <img
              id="pdf-back-sketch"
              src={backCompositeUrl || backPreviewUrl || ""}
              crossOrigin="anonymous"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        </section>
      )}

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Отправить менеджеру</button>
        <button type="button" onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>{isSaving ? "Формируем PDF…" : "Скачать PDF"}</button>
      </div>

      {/* Подтверждение */}
      {confirmOpen && (
        <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }} onPointerUp={() => { if (!isSending && !uploading) setConfirmOpen(false); }}>
          <div onPointerUp={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation() as any)} style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, boxShadow: "0 -20px 60px rgba(0,0,0,0.45)", transform: "translateY(8px)", opacity: 0, animation: "sheetIn 180ms ease forwards" }}>
            <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <button onClick={() => setConfirmOpen(false)} title="Закрыть" className="btn" disabled={isSending || uploading}>×</button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам в Telegram?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={async () => { if (isSending) return; setIsSending(true); await sendOrderDirect(); setIsSending(false); setConfirmOpen(false); }} disabled={isSending || uploading} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>
                {isSending || uploading ? "Отправляем…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Статусы */}
      {(deliveryVisible || sentOk) && (
        <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
          <div style={{ ...sectionBox, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Статус доставки</div>
            <div style={{ display: "grid", gap: 6 }}>
              <div><span style={{ opacity: 0.85 }}>Шапка — </span><strong style={{ color: topbarDelivered == null ? "#ccc" : topbarDelivered ? "#7dffa0" : "#ffb4b4" }}>{topbarDelivered == null ? "—" : topbarDelivered ? "да" : "нет"}</strong></div>
              <div><span style={{ opacity: 0.85 }}>Текст — </span><strong style={{ color: textDelivered == null ? "#ccc" : textDelivered ? "#7dffa0" : "#ffb4b4" }}>{textDelivered == null ? "—" : textDelivered ? "да" : "нет"}</strong></div>
              <div><span style={{ opacity: 0.85 }}>Эскиз (лицевая) — </span><strong style={{ color: frontSketchDelivered == null ? "#ccc" : frontSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>{frontSketchDelivered == null ? "—" : frontSketchDelivered ? "да" : "нет"}</strong></div>
              {showBack && (<div><span style={{ opacity: 0.85 }}>Эскиз (тыльная) — </span><strong style={{ color: backSketchDelivered == null ? "#ccc" : backSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>{backSketchDelivered == null ? "—" : backSketchDelivered ? "да" : "нет"}</strong></div>)}
              <div>
                <span style={{ opacity: 0.85 }}>Фото — </span>
                <strong style={{ color: photosDelivered === photosTotal ? "#7dffa0" : photosDelivered > 0 ? "#ffd666" : photosTotal === 0 ? "#ccc" : "#ffb4b4" }}>
                  {photosTotal > 0 ? `${photosDelivered} из ${photosTotal}` : "—"}
                </strong>
              </div>
            </div>
            {lastWarnings.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer" }}>Подробности</summary>
                <ul style={{ margin: "6px 0 0 20px" }}>
                  {lastWarnings.map((w, i) => (<li key={`w-${i}`} style={{ marginBottom: 4 }}>{w}</li>))}
                </ul>
              </details>
            )}
          </div>
        </section>
      )}

      {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}
    </div>
  );
}
