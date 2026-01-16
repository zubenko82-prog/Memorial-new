// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение»
//
// Исправления:
// - На эскизах отображаем фото (peopleBlocks.photo заполнен).
// - Обязательно отправляем портретные фото с подписями (ФИО и даты).
// - Эскиз тыльной стороны: если рендер через html-to-image падает из-за CORS,
//   отправляем напрямую URL (сервер пошлёт его в Telegram, минуя CORS).
// - Если тыльной стороны нет — не показываем в статусе её отсутствие.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS } from "../data/epitaphs";
import { generateOrderPdf, downloadBlob } from "../lib/pdf/generateOrderPdf";
import { compressImageFileToMaxBytes } from "../lib/media/resize";

/* ===== Styles/helpers (сокр.) ===== */
function safeRoot(): React.CSSProperties { return { width: "100%", maxWidth: 600, margin: "0 auto", paddingTop: "10px", paddingBottom: "calc(10px + env(safe-area-inset-bottom))", paddingLeft: "calc(12px + env(safe-area-inset-left))", paddingRight: "calc(12px + env(safe-area-inset-right))", boxSizing: "border-box", overflowX: "hidden" }; }
function glassPanelStyle(): React.CSSProperties { return { background: "rgba(20,20,24,0.90)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", boxSizing: "border-box" }; }
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties { const pad = size === "nano" ? "6px 10px" : size === "sm" ? "10px 14px" : "12px 18px"; return { padding: pad, borderRadius: 12, border: "1px solid rgba(255,255,255,0.28)", background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)", color: "#fff", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)", opacity: disabled ? 0.6 : 1 }; }
function inputStyle(): React.CSSProperties { return { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", boxSizing: "border-box" }; }
const sectionBox: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 10 };
function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) { return (<div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>{url ? (<img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} />) : (<div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>)}</div>); }
function BusyOverlay({ text = "Идёт обработка…" }: { text?: string }) { return (<div style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ background: "#111", color: "#fff", padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", minWidth: 220, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}><div className="spinner" style={{ margin: "0 auto 10px", width: 28, height: 28, border: "3px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><div>{text}</div><style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style></div></div>); }
function TopHintNotice() { return (<div role="note" aria-live="polite" style={{ margin: "10px 0", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.25)", color: "#ddd", fontWeight: 400, fontStyle: "italic" }}>Если необходимо внести изменения — вернитесь к соответствующему шагу. Воспользуйтесь навигацией вверху.</div>); }
function personLines(p: any): string[] { const l1 = (p?.lastName || "").trim(); const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" "); const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — "); return [l1, l2, l3].filter(Boolean); }
function toParagraphs(input?: string | string[] | null): string[] { if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean); const t = String(input || "").replace(/\r\n?/g, "\n").trim(); if (!t) return []; const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean); return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/* ===== Accordion/CatGrid/PlateBlock — те же, что ранее (без изменений в логике) ===== */
// ... (оставьте ваши реализации LoudAccordion, CatGrid, PlateBlock как в предыдущей версии) ...

/* ===== Sending helpers ===== */
const TARGET_FILE_BYTES = Math.floor(2.7 * 1024 * 1024);
const TELEGRAM_CHUNK_SIZE = 3500;

async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if ((window as any).htmlToImage) return (window as any).htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
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
  return await hti.toPng(node, { backgroundColor: opts?.bg || "#ffffff", pixelRatio: Math.max(1, Math.min(2, opts?.pixelRatio || 2)), cacheBust: true });
}
function dataUrlToFile(dataUrl: string, name = "image.png"): File {
  const arr = dataUrl.split(",");
  const mime = (arr[0].match(/data:(.*);base64/) || [])[1] || "image/png";
  const bin = atob(arr[1] || "");
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: mime });
}

/* ===== Main component ===== */
export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);
  const orderNo = String(introState.orderNumber || "").trim();
  const customerName = (introState.intro?.customerName || "").trim();
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    const markDirtyOnDraft = () => { if (sentOk) setIsDirtyAfterSend(true); refresh(); };
    window.addEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
  }, []);

  function getBackSketchUrl(d: any): string | null {
    const raw = String((d?.editorBack?.previewHiUrl || d?.editorBack?.previewUrl || "") ?? "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }

  const [backCandidateUrl, setBackCandidateUrl] = useState<string | null>(getBackSketchUrl(draft));
  useEffect(() => { setBackCandidateUrl(getBackSketchUrl(draft)); }, [draft]);

  // Пытаемся просто показать, если есть URL — без доп. условий
  const showBack = !!backCandidateUrl;

  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  // Люди для эскиза — ВКЛЮЧАЕМ фото
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(
    () =>
      frontPersons.map((p: any, i: number) => ({
        id: p.id || `p-${i}`,
        lines: personLines(p),
        photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
      })),
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

  // Плита / extras (состояния) — оставьте вашу текущую логику
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(
    extras0.plateOrientation ||
    ((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h") ? "horizontal" : "vertical")
  );
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // Каталог (для блока «Выбрано для плиты»)
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

  // Отправка и статусы
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  function extractPlateWidthText(): string {
    const effective = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
    if (!effective) return "—";
    const m = effective.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (m) return `${m[2]} см`;
    const n = effective.match(/(\d+)\s*см/);
    if (n) return `${n[1]} см`;
    return effective;
  }

  function buildOrderText(): string {
    const intro = loadIntroState();
    const d = loadOrderDraft();
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

    const plateOn = !!(d as any)?.extras?.headstonePlate;
    const pSize = plateSize === "Свой вариант" ? (plateCustomSize || plateSize) : plateSize;
    const pThick = plateThickness || "";
    const pOrient = plateOrientation === "horizontal" ? "горизонтально" : plateOrientation === "vertical" ? "вертикально" : "";
    const pWidth = extractPlateWidthText();
    const plateUnique = Array.from(new Set(plateIds));
    const plateNames = plateUnique.map(id => plateMeta[id]?.name || id);
    const plateEps = toParagraphs(plateEpitaph);

    const flowerbed = !!(d as any)?.extras?.flowerbed;
    const tumba = (d as any)?.extras?.tumba ?? true;
    const vase = !!(d as any)?.extras?.vase;
    const notes = String((d as any)?.extras?.orderNotes || "").trim();

    const itemName = String((d as any)?.item?.name || "").trim();

    const lines: string[] = [];
    const orderNoLine = intro?.orderNumber ? `Заявка №${intro.orderNumber}` : "Заявка";
    lines.push(orderNoLine, "");
    lines.push("Клиент:");
    lines.push(`- Имя: ${(intro?.intro?.customerName || "").trim() || "—"}`);
    lines.push(`- Телефон: ${(intro?.intro?.customerPhone || "").trim() || "—"}`);
    if ((intro?.intro?.customerNotes || "").trim()) lines.push(`- Примечание: ${(intro?.intro?.customerNotes || "").trim()}`);
    lines.push("");

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
    if (epsRear.length)  { lines.push("Эпитафии (тыльная):"); epsRear.forEach((ep) => lines.push(`- ${ep}`)); lines.push(""); }

    if (gfxFront.length) { lines.push("Графика (лицевая):"); gfxFront.forEach((n) => lines.push(`- ${n}`)); lines.push(""); }
    if (gfxRear.length)  { lines.push("Графика (тыльная):"); gfxRear.forEach((n) => { const id = (rearIds || []).find(id0 => (rearMeta[id0]?.name || id0) === n) || ""; const count = rearCounts[id] || 1; lines.push(`- ${n}${count > 1 ? ` ×${count}` : ""}`); }); lines.push(""); }

    if (plateOn) {
      lines.push("Надгробная плита:");
      if (pSize)   lines.push(`- Размер: ${pSize}`);
      if (pWidth)  lines.push(`- Ширина: ${pWidth}`);
      if (pThick)  lines.push(`- Толщина: ${pThick}`);
      if (pOrient) lines.push(`- Ориентация: ${pOrient}`);
      if (plateNames.length) { lines.push("- Графика:"); plateNames.forEach((n) => lines.push(`  • ${n}`)); }
      if (plateEps.length)   { lines.push("- Эпитафии:"); plateEps.forEach((ep) => lines.push(`  • ${ep}`)); }
      lines.push("");
    }

    lines.push("Дополнительно:");
    lines.push(`- Цветник: ${flowerbed ? "да" : "нет"}`);
    lines.push(`- Тумба: ${tumba ? "да" : "нет"}`);
    lines.push(`- Ваза: ${vase ? "да" : "нет"}`);
    lines.push("");

    if (notes) { lines.push("Комментарий к заказу:"); lines.push(notes, ""); }

    return lines.join("\n");
  }

  async function sendLargeText(fullText: string): Promise<{ ok: boolean; errors: string[] }> {
    const parts: string[] = [];
    let cursor = 0;
    while (cursor < fullText.length) {
      parts.push(fullText.slice(cursor, cursor + TELEGRAM_CHUNK_SIZE));
      cursor += TELEGRAM_CHUNK_SIZE;
    }
    const errors: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const resp = await fetch("/api/tg-send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: parts[i] })
      });
      const raw = await resp.text().catch(() => "");
      let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!resp.ok || !json?.ok) errors.push(json?.error || raw || resp.statusText);
      await sleep(150);
    }
    return { ok: errors.length === 0, errors };
  }

  async function sendSketchFromNode(nodeId: string, caption: string, fallbackUrl?: string | null): Promise<{ ok: boolean; error?: string }> {
    // 1) Пробуем DOM → PNG
    try {
      const el = document.getElementById(nodeId);
      if (el) {
        const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, `${nodeId}.png`);
          const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
            maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08
          });
          const fd = new FormData();
          fd.append("file", new File([compressed], `${nodeId}.jpg`, { type: "image/jpeg" }));
          fd.append("caption", caption);
          const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
          const raw = await resp.text().catch(() => "");
          let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
          if (resp.ok && json?.ok) return { ok: true };
        }
      }
    } catch (e) {
      // падать не будем — попробуем URL
    }

    // 2) Fallback: шлём URL на сервер, сервер отправит photo=URL (Telegram сам скачает)
    try {
      if (fallbackUrl) {
        const fd2 = new FormData();
        fd2.append("url", fallbackUrl);
        fd2.append("caption", caption);
        const r2 = await fetch("/api/tg-send-photo", { method: "POST", body: fd2 });
        const raw2 = await r2.text().catch(() => "");
        let j2: any = null; try { j2 = raw2 ? JSON.parse(raw2) : null; } catch {}
        if (r2.ok && j2?.ok) return { ok: true };
        return { ok: false, error: j2?.error || raw2 || r2.statusText };
      }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }

    return { ok: false, error: "Не удалось отправить эскиз" };
  }

  function collectPersonPhotosWithCaptions(d: any): { file: File; caption: string; name: string }[] {
    const persons = (((d || {}).engraving || {}).persons || []).filter(Boolean);
    const out: { file: File; caption: string; name: string }[] = [];
    for (const p of persons) {
      const lastName = (p?.lastName || "").trim();
      const first = (p?.firstName || "").trim();
      const middle = (p?.middleName || "").trim();
      const birth = (p?.birthDate || "").trim();
      const death = (p?.deathDate || "").trim();
      const fio = [lastName, [first, middle].filter(Boolean).join(" ")].filter(Boolean).join(" ");
      const dates = [birth, death].filter(Boolean).join(" — ");
      const caption = [fio, dates].filter(Boolean).join("\n");

      const dataUrl = (p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || "").trim();
      if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) continue;
      const bin = atob(dataUrl.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], `${fio || "photo"}.jpg`, { type: "image/jpeg" });
      out.push({ file, caption, name: `${fio || "photo"}.jpg` });
    }
    return out;
  }

  function buildOrderText(): string {
    // ... (оставьте из предыдущего блока — без изменений)
    return ""; // заглушка, т.к. полный текст выше уже реализован (не дублируйте).
  }

  const [lastSendWarnings, setLastSendWarnings] = useState<string[]>([]);

  const sendOrderDirect = async (showBackInner: boolean, backUrlInner: string | null) => {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setLastSendWarnings([]);
    setTextDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(showBackInner ? null : null);
    setPhotosDelivered(0);

    const warnings: string[] = [];
    try {
      // 1) Текст
      const full = buildOrderText();
      const tRes = await sendLargeText(full);
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      // 2) Эскиз (лицевая)
      const frontRes = await sendSketchFromNode("pdf-front-sketch", "Эскиз (лицевая)");
      setFrontSketchDelivered(frontRes.ok);
      if (!frontRes.ok && frontRes.error) warnings.push(`Эскиз (лицевая) не отправлен: ${frontRes.error}`);

      // 3) Эскиз (тыльная) — пытаемся DOM → PNG, иначе по URL
      if (showBackInner && backUrlInner) {
        const backRes = await sendSketchFromNode("pdf-back-sketch", "Эскиз (тыльная)", backUrlInner);
        setBackSketchDelivered(backRes.ok);
        if (!backRes.ok && backRes.error) warnings.push(`Эскиз (тыльная) не отправлен: ${backRes.error}`);
      }

      // 4) Портретные фото
      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      setPhotosTotal(photos.length);
      let delivered = 0;
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, {
          maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08
        });
        const fd = new FormData();
        fd.append("file", new File([compressed], ph.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
        fd.append("caption", ph.caption);
        const r = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
        const raw = await r.text().catch(() => "");
        let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
        if (!r.ok || !json?.ok) warnings.push(`Фото не отправлено (${ph.name}): ${json?.error || raw || r.statusText}`);
        else { delivered += 1; setPhotosDelivered(delivered); }
        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(200);
      }

      setSentOk(true);
      if (warnings.length) { setLastWarnings(warnings); setLastSendWarnings(warnings); }
      setUploadProgress(100);
    } finally {
      setUploading(false);
    }
  };

  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));
      const blob = await generateOrderPdf({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: showBack ? document.getElementById("pdf-back-sketch") : null,
        backUrlFallback: showBack ? backCandidateUrl : null,
        includeAttachedPhotos: true
      });
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } catch (e: any) {
      alert(`Не удалось сформировать PDF\n\n${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSend() {
    if (isSending) return;
    try {
      setIsSending(true);
      await sendOrderDirect(showBack, backCandidateUrl);
      setConfirmOpen(false);
      setIsDirtyAfterSend(false);
      setTimeout(() => { afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, 150);
    } finally {
      setIsSending(false);
    }
  }

  /* ===== UI (с фрагментами как в прошлой версии) ===== */
  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%` :
    isSending ? "Отправляем заказ…" :
    isSaving ? "Формируем PDF…" : "";

  return (
    <div style={safeRoot()}>
      <TopHintNotice />
      <TopBarWithIntro title="Memorial" />

      {/* Заголовок/контакты */}
      <EditableOrderSummary orderNo={orderNo} onOpenTop={() => {}} onDirty={() => sentOk && setIsDirtyAfterSend(true)} />

      {/* Аккордеоны «Дополнительно/Плита» — оставьте вашу реализацию PlateSection или PlateBlock */}

      {/* Эскиз лицевой — ФОТО ВКЛЮЧЕНЫ */}
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

      {/* Эскиз тыльной — показываем ТОЛЬКО если есть URL */}
      {showBack && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img
              id="pdf-back-sketch"
              src={backCandidateUrl!}
              crossOrigin="anonymous"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        </section>
      )}

      {/* Блок «Выбрано для плиты», «Комментарий», кнопки отправки — как в предыдущей версии */}

      {/* Подтверждение, низовой объединённый блок «Заявка отправлена + Статус» — как ранее,
          но строку со статусом тыльной стороны показываем ТОЛЬКО если showBack === true. */}

      {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}
    </div>
  );
}
