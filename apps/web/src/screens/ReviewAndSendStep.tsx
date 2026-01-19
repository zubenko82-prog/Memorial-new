// src/screens/ReviewAndSendStep.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState } from "../lib/intro";
import { fetchCatalog } from "../api";
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
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}
function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    boxSizing: "border-box"
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
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box"
      }}
    >
      {url ? (
        <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} />
      ) : (
        <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>
      )}
    </div>
  );
}

function BusyOverlay({ open, text = "Идёт обработка…" }: { open: boolean; text?: string }) {
  if (!open) return null;
  // Когда открыт — блокируем клики (StepNav недоступен, это ок)
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
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/* ========= Accordion ========= */
function LoudAccordion({ title, open, onToggle, children }: { title: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode; }) {
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
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          background: "rgba(255,255,255,0.06)",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 15,
          fontWeight: 700
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ========= Graphics grid ========= */
function CatGrid({ items, plateIds, addGraphic, removeGraphic }: { items: any[]; plateIds: string[]; addGraphic: (g: any) => void; removeGraphic: (gid: string) => void; }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number>(2);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
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
        const selected = qty > 0;
        const thumbUrl = g.preview || g.url || "";
        const name = g.name || gid;
        return (
          <div key={gid} aria-selected={selected} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 12, position: "relative", borderColor: selected ? "#9cc4ff" : "rgba(255,255,255,0.14)", boxShadow: selected ? "0 0 0 1px #9cc4ff inset" : undefined }}>
            <div aria-hidden style={{ position: "absolute", top: 8, right: 8, display: selected ? "inline-flex" : "none", alignItems: "center", gap: 4, background: "rgba(10,127,46,0.95)", color: "#fff", borderRadius: 999, padding: "0 6px", fontSize: 11, lineHeight: "18px", height: 18 }}>
              <span>✓</span><span>{qty}</span>
            </div>
            <div role="button" title={name} onClick={() => addGraphic(g)} style={{ borderRadius: 10, overflow: "hidden", background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", border: selected ? "1px solid #9cc4ff" : "1px solid rgba(255,255,255,0.12)", cursor: "pointer" }}>
              {thumbUrl ? <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
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

/* ========= Sending helpers ========= */
const TARGET_FILE_BYTES = Math.floor(2.7 * 1024 * 1024);
const TELEGRAM_CHUNK_SIZE = 3500;

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
async function sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch("/api/tg-send-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const raw = await resp.text().catch(() => "");
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch {}
    return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
async function sendPhotoByFileNoCaption(file: File, name = "image.jpg"): Promise<{ ok: boolean; error?: string }> {
  try {
    const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
    const fd = new FormData();
    fd.append("file", new File([compressed], name, { type: "image/jpeg" }));
    const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd }); // caption не передаем
    const raw = await resp.text().catch(() => "");
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch {}
    return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
async function sendPhotoByUrlNoCaption(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const fd = new FormData();
    fd.append("url", url);
    const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd }); // caption не передаем
    const raw = await resp.text().catch(() => "");
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch {}
    return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
async function sendLargeText(fullText: string): Promise<{ ok: boolean; errors: string[] }> {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < fullText.length) { parts.push(fullText.slice(cursor, cursor + TELEGRAM_CHUNK_SIZE)); cursor += TELEGRAM_CHUNK_SIZE; }

  const errors: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const resp = await fetch("/api/tg-send-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: parts[i] }) });
    const raw = await resp.text().catch(() => "");
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch {}
    if (!resp.ok || !json?.ok) errors.push(json?.error || raw || resp.statusText);
    await sleep(150);
  }
  return { ok: errors.length === 0, errors };
}
function collectPersonPhotos(d: any): File[] {
  const persons = (((d || {}).engraving || {}).persons || []).filter(Boolean);
  const out: File[] = [];
  for (const p of persons) {
    const dataUrl = String((p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || "") || "").trim();
    if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) continue;
    const bin = atob(dataUrl.split(",")[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    out.push(new File([u8], `photo-${out.length + 1}.jpg`, { type: "image/jpeg" }));
  }
  return out;
}

/* ========= Main ========= */
export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());

  const topbarWrapRef = useRef<HTMLDivElement | null>(null);

  // раскрываем топбар при входе (и не блокируем StepNav)
  useEffect(() => {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    setTimeout(() => {
      const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
      if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    }, 50);
  }, []);

  // sync
  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
  }, []);

  // back raster
  const backCandidateUrl = useMemo(() => {
    const raw = String((draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl || "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }, [draft]);
  const showBack = !!backCandidateUrl;

  // front sketch (aspect)
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  // people/graphics/epitaphs front
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

  // plate state
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // catalog for plate
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      setCatsLoading(true);
      setCatsError("");
      try {
        const data = await fetchCatalog("graphics");
        const root = (data as any)?.categories || data;
        const catsArr = Array.isArray(root) ? root : [];
        if (alive) setCats(catsArr);
      } catch {
        if (alive) setCatsError("Не удалось загрузить каталог графики.");
      } finally {
        if (alive) setCatsLoading(false);
      }
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

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  // send states
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // delivery
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [topbarDelivered, setTopbarDelivered] = useState<boolean | null>(null);
  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  function buildOrderText(): string {
    const d = loadOrderDraft();
    const intro = loadIntroState();
    const lines: string[] = [];
    lines.push(intro?.orderNumber ? `Заявка №${intro.orderNumber}` : "Заявка");
    lines.push("");
    lines.push("Клиент:");
    lines.push(`- Имя: ${(intro?.intro?.customerName || "").trim() || "—"}`);
    lines.push(`- Телефон: ${(intro?.intro?.customerPhone || "").trim() || "—"}`);
    if ((intro?.intro?.customerNotes || "").trim()) lines.push(`- Примечание: ${(intro?.intro?.customerNotes || "").trim()}`);
    lines.push("");

    const persons = (((d?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      fio: [String(p?.lastName || "").trim(), [p?.firstName, p?.middleName].map((x: string) => String(x || "").trim()).filter(Boolean).join(" ")].filter(Boolean).join(" "),
      dates: [p?.birthDate, p?.deathDate].map((x: string) => String(x || "").trim()).filter(Boolean).join(" — ")
    }));

    lines.push("Люди:");
    if (!persons.length) lines.push("- —");
    else persons.forEach((p) => { lines.push(`- ${p.fio || "—"}`); if (p.dates) lines.push(`  ${p.dates}`); });
    lines.push("");

    const epsFront = toParagraphs((d?.engraving as any)?.epitaphs ?? (d?.engraving as any)?.epitaphText);
    if (epsFront.length) { lines.push("Эпитафии (лицевая):"); epsFront.forEach((x) => lines.push(`- ${x}`)); lines.push(""); }

    const epsRear = toParagraphs(((d as any)?.editorBack?.epitaphTexts || []).join("\n\n"));
    if (epsRear.length) { lines.push("Эпитафии (тыльная):"); epsRear.forEach((x) => lines.push(`- ${x}`)); lines.push(""); }

    if (extraPlate && plateEpitaphList.length) {
      lines.push("Плита — эпитафии:");
      plateEpitaphList.forEach((x) => lines.push(`- ${x}`));
      lines.push("");
    }
    return lines.join("\n");
  }

  async function ensureTopbarOpen() {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
    if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
  }

  async function captureTopbarAsFile(): Promise<File | null> {
    const wrap = topbarWrapRef.current;
    if (!wrap) return null;

    await ensureTopbarOpen();
    window.scrollTo({ top: 0, behavior: "auto" });

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(240);

    const panel = wrap.querySelector('[data-topbar-panel="1"]') as HTMLElement | null; // в TopBarWithIntro вы добавили data-topbar-panel
    const prevOverflow = panel?.style.overflow;
    const prevMaxH = panel?.style.maxHeight;

    if (panel) {
      panel.style.overflow = "visible";
      panel.style.maxHeight = "none";
    }

    let dataUrl: string | null = null;
    try {
      dataUrl = await elementToPngDataUrl(wrap, { pixelRatio: 2, bg: "#ffffff" });
    } finally {
      if (panel) {
        panel.style.overflow = prevOverflow || "";
        panel.style.maxHeight = prevMaxH || "";
      }
    }
    if (!dataUrl) return null;
    return dataUrlToFile(dataUrl, "topbar.png");
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

    setIsSending(true);
    setUploading(true);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setTopbarDelivered(null);
    setTextDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(showBack ? null : null);
    setPhotosDelivered(0);

    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      await sendMessage(`🪦 НАЧАЛО ЗАЯВКИ №${orderNoCur || "—"}`);

      // 1) topbar screenshot (no caption)
      const topbarFile = await captureTopbarAsFile();
      if (topbarFile) {
        const r = await sendPhotoByFileNoCaption(topbarFile, "topbar.jpg");
        setTopbarDelivered(r.ok);
        if (!r.ok && r.error) warnings.push(`Топбар: ${r.error}`);
      } else {
        setTopbarDelivered(false);
        warnings.push("Топбар: не удалось снять скриншот");
      }

      // 2) text
      const t = await sendLargeText(buildOrderText());
      setTextDelivered(t.ok);
      if (!t.ok) warnings.push(`Текст: ${t.errors.join(" | ")}`);

      // 3) front sketch (no caption)
      {
        const el = document.getElementById("pdf-front-sketch");
        const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, "front.png");
          const r = await sendPhotoByFileNoCaption(file, "front.jpg");
          setFrontSketchDelivered(r.ok);
          if (!r.ok && r.error) warnings.push(`Лицевая: ${r.error}`);
        } else {
          setFrontSketchDelivered(false);
          warnings.push("Лицевая: не удалось растрировать");
        }
      }

      // 4) back sketch by URL (no caption)
      if (showBack && backCandidateUrl) {
        const r = await sendPhotoByUrlNoCaption(backCandidateUrl);
        setBackSketchDelivered(r.ok);
        if (!r.ok && r.error) warnings.push(`Тыльная: ${r.error}`);
      }

      // 5) person photos (no caption)
      const photos = collectPersonPhotos(loadOrderDraft());
      setPhotosTotal(photos.length);
      let delivered = 0;
      for (let i = 0; i < photos.length; i++) {
        const r = await sendPhotoByFileNoCaption(photos[i], `person-${i + 1}.jpg`);
        if (!r.ok && r.error) warnings.push(`Фото ${i + 1}: ${r.error}`);
        else { delivered += 1; setPhotosDelivered(delivered); }
        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(150);
      }

      await sendMessage(`🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${orderNoCur || "—"}`);

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);
      setUploadProgress(100);
      setTimeout(() => afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 150);
    } finally {
      setUploading(false);
      setIsSending(false);
      setConfirmOpen(false);
    }
  }

  const overlayText =
    uploading ? `Отправляем… ${Math.max(0, Math.min(100, uploadProgress || 0))}%`
      : isSending ? "Отправляем заказ…"
      : isSaving ? "Формируем PDF…"
      : "";

  return (
    <div style={safeRoot()}>
      {/* TopBar (для скриншота) */}
      <div id="topbar-capture" ref={topbarWrapRef}>
        <TopBarWithIntro title="Memorial" />
      </div>

      {/* Блок с номером заказа ниже топбара — НЕ РЕНДЕРИМ */}

      {/* Лицевая */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
            <SketchTemplate item={item} peopleBlocks={peopleBlocks} crosses={selectedCrosses} others={selectedOthers} epitaphs={frontEpitaphs} carvingOpacity={0.4} />
          </div>
        </div>
      </section>

      {/* Тыльная */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img src={backCandidateUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* Комментарий */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Комментарий к заказу</label>
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={String((extras0.orderNotes || "")).trim()}
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
        <button type="button" onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Отправить менеджеру</button>
        <button type="button" onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>
          {isSaving ? "Формируем PDF…" : "Скачать PDF"}
        </button>
      </div>

      {/* Модалка подтверждения — блокирует StepNav только пока открыта */}
      {confirmOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 15000 }}>
          <div
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}
            onClick={() => { if (!isSending && !uploading) setConfirmOpen(false); }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              background: "#fff",
              color: "#111",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              boxShadow: "0 -20px 60px rgba(0,0,0,0.45)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам в Telegram?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={isSending || uploading}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #999", background: "#f7f7f7", cursor: "pointer" }}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={isSending || uploading}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #99d199", background: "#e5ffe5", cursor: "pointer" }}
              >
                {isSending || uploading ? "Отправляем…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Статус */}
      {(deliveryVisible || sentOk) && (
        <div ref={afterHintRef}>
          <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Статус доставки</div>
            <div style={{ ...sectionBox }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div><span style={{ opacity: 0.85 }}>Топбар — </span><strong>{topbarDelivered == null ? "—" : topbarDelivered ? "да" : "нет"}</strong></div>
                <div><span style={{ opacity: 0.85 }}>Текст — </span><strong>{textDelivered == null ? "—" : textDelivered ? "да" : "нет"}</strong></div>
                <div><span style={{ opacity: 0.85 }}>Лицевая — </span><strong>{frontSketchDelivered == null ? "—" : frontSketchDelivered ? "да" : "нет"}</strong></div>
                {showBack && (<div><span style={{ opacity: 0.85 }}>Тыльная — </span><strong>{backSketchDelivered == null ? "—" : backSketchDelivered ? "да" : "нет"}</strong></div>)}
                <div><span style={{ opacity: 0.85 }}>Фото — </span><strong>{photosTotal > 0 ? `${photosDelivered} из ${photosTotal}` : "—"}</strong></div>
              </div>

              {lastWarnings.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer" }}>Подробности</summary>
                  <ul style={{ margin: "6px 0 0 20px" }}>
                    {lastWarnings.map((w, i) => (<li key={`w-${i}`}>{w}</li>))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        </div>
      )}

      <BusyOverlay open={isSending || isSaving || uploading} text={overlayText} />
    </div>
  );
}
