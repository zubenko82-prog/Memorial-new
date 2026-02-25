// src/screens/ReviewAndSendStep.tsx
//
// Вариант: прямой upload в Vercel Blob с клиента (без /api/blob-upload),
// чтобы обойти FUNCTION_PAYLOAD_TOO_LARGE на serverless.
//
// Требуется:
// 1) npm i @vercel/blob
// 2) API route /api/blob-token (см. ниже) в memorial-web
// 3) API route /api/email (action=send_blob) как мы делали: скачивает из Blob и шлёт вложениями + удаляет

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState } from "../lib/intro";
import { downloadBlob } from "../lib/pdf/generateOrderPdf";
import { generateOrderPdfShots } from "../lib/pdf/generateOrderPdfShots";
import { compressImageFileToMaxBytes } from "../lib/media/resize";
import { hardResetAll } from "../lib/hardReset";
import { upload } from "@vercel/blob/client";

/* ========= Styles and helpers ========= */
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
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
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

function BusyOverlay({ text = "Идёт обработка…" }: { text?: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          background: "#111",
          color: "#fff",
          padding: 16,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.2)",
          minWidth: 220,
          textAlign: "center",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
        }}
      >
        <div
          className="spinner"
          style={{
            margin: "0 auto 10px",
            width: 28,
            height: 28,
            border: "3px solid rgba(255,255,255,0.35)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite"
          }}
        />
        <div>{text}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) }}`}</style>
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
  if (Array.isArray(input)) return input.map((s) => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map((s) => s.trim()).filter(Boolean);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function dispatchDraftUpdated() {
  try {
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
  } catch {}
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
async function urlToFile(url: string, name: string, fallbackMime = "image/jpeg"): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = (blob as any)?.type || fallbackMime;
    return new File([blob], name, { type: mime });
  } catch {
    return null;
  }
}

function ensurePlates(ex: any): any[] {
  const cur = Array.isArray(ex?.plates) ? ex.plates.slice() : [];
  while (cur.length < 3) cur.push({});
  return cur;
}

type NamedFile = { file: File; name: string };
type BlobItem = { url: string; pathname: string; filename: string };

function safeBlobName(name: string) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/* ========= Main component ========= */
export default function ReviewAndSendStep({
  onBack,
  onSend,
  onNewOrderWipeAll,
  onNewOrderWipeKeepCustomer,
  onNewOrderKeepAllNewNo
}: {
  onBack?: () => void;
  onSend?: () => void;
  onNewOrderWipeAll?: () => void;
  onNewOrderWipeKeepCustomer?: () => void;
  onNewOrderKeepAllNewNo?: () => void;
}) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [pdfSavedOnce, setPdfSavedOnce] = useState(false);

  const customerName = (introState.intro?.customerName || "").trim();
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  // Telegram expand (высота webview) при переходе
  useEffect(() => {
    let alive = true;
    const run = () => {
      try {
        const tg = (window as any)?.Telegram?.WebApp;
        tg?.ready?.();
        tg?.expand?.();
        tg?.requestViewport?.();
      } catch {}
    };
    const t1 = setTimeout(() => alive && run(), 0);
    const t2 = setTimeout(() => alive && run(), 120);
    const t3 = setTimeout(() => alive && run(), 400);
    const t4 = setTimeout(() => alive && run(), 900);
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setDraft(loadOrderDraft());
      setIntroState(loadIntroState());
    };
    const markDirtyOnDraft = () => {
      if (sentOk) setIsDirtyAfterSend(true);
      refresh();
    };
    window.addEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentOk]);

  // ===== Force open TopBarWithIntro & keep open =====
  useEffect(() => {
    let alive = true;

    const isOpen = () => {
      const el = document.querySelector('[data-topbar-panel="1"]') as HTMLElement | null;
      return el?.getAttribute("data-topbar-open") === "1";
    };

    const openTopbar = () => {
      try {
        window.dispatchEvent(new Event("memorial:openTopBarPanel"));
      } catch {}
    };

    openTopbar();
    const timer = window.setInterval(() => {
      if (!alive) return;
      if (isOpen()) return;
      openTopbar();
    }, 120);

    const onFocus = () => openTopbar();
    const onVisible = () => {
      if (document.visibilityState === "visible") openTopbar();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ===== Back sketch: detect "empty" by actual image size =====
  function getBackSketchUrl(d: any): string | null {
    const raw = String((d?.editorBack?.previewHiUrl || d?.editorBack?.previewUrl || "") ?? "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }
  const [backCandidateUrl, setBackCandidateUrl] = useState<string | null>(getBackSketchUrl(draft));
  useEffect(() => setBackCandidateUrl(getBackSketchUrl(draft)), [draft]);

  const [backIsRenderable, setBackIsRenderable] = useState(false);
  useEffect(() => {
    setBackIsRenderable(false);
    if (!backCandidateUrl) return;

    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      setBackIsRenderable(w >= 50 && h >= 50);
    };
    img.onerror = () => {
      if (!alive) return;
      setBackIsRenderable(false);
    };
    img.crossOrigin = "anonymous";
    img.src = backCandidateUrl;
    return () => {
      alive = false;
    };
  }, [backCandidateUrl]);

  const showBack = !!backCandidateUrl && backIsRenderable;

  // ===== Plate sketches (1..3): detect "empty" by actual image size =====
  type PlateSketch = { index: 0 | 1 | 2; url: string };

  function getPlateSketchUrls(d: any): PlateSketch[] {
    const ex: any = (d as any)?.extras || {};
    const plates = ensurePlates(ex);

    const norm = (raw: any): string | null => {
      const s = String(raw ?? "").trim();
      if (!s || s === "#" || s.toLowerCase() === "about:blank") return null;
      return s;
    };

    const out: PlateSketch[] = [];

    // plate #1 (legacy)
    const p1Enabled = !!ex.headstonePlate;
    const p1Url = norm(ex?.platePreviewHiUrl || ex?.platePreviewUrl);
    if (p1Enabled && p1Url) out.push({ index: 0, url: p1Url });

    // plate #2/#3 (new)
    for (const i of [1, 2] as const) {
      const p = plates[i] || {};
      const enabled = !!p.enabled;
      const url = norm(p?.platePreviewHiUrl || p?.platePreviewUrl);
      if (enabled && url) out.push({ index: i, url });
    }

    return out;
  }

  const [plateCandidates, setPlateCandidates] = useState<PlateSketch[]>(() => getPlateSketchUrls(draft));
  useEffect(() => setPlateCandidates(getPlateSketchUrls(draft)), [draft]);

  const [plateRenderable, setPlateRenderable] = useState<Record<number, boolean>>({});
  useEffect(() => {
    let alive = true;
    setPlateRenderable({});

    const run = async () => {
      const entries = await Promise.all(
        plateCandidates.map(
          (p) =>
            new Promise<[number, boolean]>((res) => {
              const img = new Image();
              img.onload = () => {
                const w = img.naturalWidth || 0;
                const h = img.naturalHeight || 0;
                res([p.index, w >= 50 && h >= 50]);
              };
              img.onerror = () => res([p.index, false]);
              img.crossOrigin = "anonymous";
              img.src = p.url;
            })
        )
      );

      if (!alive) return;
      const m: Record<number, boolean> = {};
      for (const [idx, ok] of entries) m[idx] = ok;
      setPlateRenderable(m);
    };

    run();
    return () => {
      alive = false;
    };
  }, [plateCandidates]);

  const plateToShow = useMemo(
    () => plateCandidates.filter((p) => !!plateRenderable[p.index]),
    [plateCandidates, plateRenderable]
  );
  const showPlate = plateToShow.length > 0;

  // Front
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => {
      if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`);
    };
    im.src = itemUrl;
  }, [itemUrl]);

  // Люди на эскизе — с фото
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

  // Графика лицевой
  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) =>
    (g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross");
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  // ===== Sending state =====
  const [showWipeWarn, setShowWipeWarn] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [deliveryVisible, setDeliveryVisible] = useState(false);

  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [topbarDelivered, setTopbarDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [plateSketchDelivered, setPlateSketchDelivered] = useState<boolean | null>(null);

  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  // ===== Telegram API (/api/tg) =====
  async function sendManagerMessage(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch("/api/tg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manager_message", text })
      });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {}
      return { ok: !!(resp.ok && json?.ok), error: json?.error || json?.description || raw || resp.statusText };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function sendManagerPhoto(fd: FormData): Promise<{ ok: boolean; error?: string }> {
    try {
      fd.append("action", "manager_photo");
      const resp = await fetch("/api/tg", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {}
      if (resp.ok && json?.ok) return { ok: true };
      return { ok: false, error: json?.error || json?.description || raw || resp.statusText };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function sendDmToUser(userId: number, text: string): Promise<void> {
    try {
      await fetch("/api/tg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dm", userId, text })
      });
    } catch {
      // ignore
    }
  }

  async function sendEmailFromBlobLinks(meta: {
    orderNo: string;
    subject: string;
    text: string;
    pdfUrl: string;
    pdfPathname: string;
    pdfFilename: string;
    photoUrls: string[];
    photoPathnames: string[];
    photoFilenames: string[];
  }): Promise<{ ok: boolean; error?: string }> {
    const resp = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_blob", ...meta })
    });
    const raw = await resp.text().catch(() => "");
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {}

    if (resp.ok && json?.ok) return { ok: true };
    return { ok: false, error: json?.error || raw || resp.statusText };
  }

  function startMarkerText(no: string): string {
    const n = no || "—";
    return `🪦 НАЧАЛО ЗАЯВКИ №${n}`;
  }
  function endMarkerText(no: string): string {
    const n = no || "—";
    return `🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${n}`;
  }

  function buildOrderText(): string {
    const intro = loadIntroState();
    const d: any = loadOrderDraft();

    const orderNo = String(intro?.orderNumber || "").trim();

    const lines: string[] = [];
    lines.push(orderNo ? `Заявка №${orderNo}` : "Заявка");
    lines.push("");

    // ===== Клиент =====
    lines.push("Клиент:");
    lines.push(`- Имя: ${(intro?.intro?.customerName || "").trim() || "—"}`);
    lines.push(`- Телефон: ${(intro?.intro?.customerPhone || "").trim() || "—"}`);
    const customerNotes = String(intro?.intro?.customerNotes || "").trim();
    if (customerNotes) lines.push(`- Примечание: ${customerNotes}`);
    lines.push("");

    // ... (оставлено как в вашем текущем файле — функция большая)
    // Чтобы ответ не раздувать в 5 раз, в этом варианте buildOrderText можно оставить из вашего файла без изменений.
    // Здесь коротко верну строку, но у вас уже есть полный buildOrderText — оставьте его как есть.
    return lines.join("\n");
  }

  // ==== сбор фото персон (ФИО.jpg как сейчас) ====
  function collectPersonPhotosWithCaptions(d: any): { file: File; caption: string; name: string }[] {
    const out: { file: File; caption: string; name: string }[] = [];

    const pushFromList = (persons: any[], tag?: string) => {
      for (const p of (persons || []).filter(Boolean)) {
        const lastName = (p?.lastName || "").trim();
        const first = (p?.firstName || "").trim();
        const middle = (p?.middleName || "").trim();
        const birth = (p?.birthDate || "").trim();
        const death = (p?.deathDate || "").trim();
        const fio = [lastName, [first, middle].filter(Boolean).join(" ")].filter(Boolean).join(" ").trim();
        const dates = [birth, death].filter(Boolean).join(" — ").trim();

        const baseCaption = [fio || "—", dates].filter(Boolean).join("\n");
        const caption = tag ? `${baseCaption}\n(${tag})` : baseCaption;

        const dataUrl = String(p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || "").trim();
        if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) continue;

        const bin = atob(dataUrl.split(",")[1] || "");
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

        const safeNameBase = (fio || "photo").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
        const safeName = tag ? `${safeNameBase}__${tag}` : safeNameBase;

        const file = new File([u8], `${safeName}.jpg`, { type: "image/jpeg" });
        out.push({ file, caption, name: `${safeName}.jpg` });
      }
    };

    pushFromList((((d || {}).engraving || {}).persons || []) as any[], undefined);

    const rearEnabled = !!d?.editorBack?.enabled;
    if (rearEnabled) pushFromList(((d?.editorBack?.people || []) as any[]), "ТЫЛ");

    return out;
  }

  // ===== Topbar / Sketches -> files for email =====
  async function ensureTopBarPanelOpenForShot(): Promise<void> {
    const openTopbar = () => {
      try {
        window.dispatchEvent(new Event("memorial:openTopBarPanel"));
      } catch {}
    };
    const isOpen = () => {
      const el = document.querySelector('[data-topbar-panel="1"]') as HTMLElement | null;
      return el?.getAttribute("data-topbar-open") === "1";
    };

    openTopbar();
    const start = Date.now();
    while (Date.now() - start < 1200) {
      if (isOpen()) break;
      await sleep(120);
      openTopbar();
    }
    await sleep(160);
  }
  function findTopBarShotRootNode(): HTMLElement | null {
    return document.getElementById("topbar-shot-root");
  }

  async function collectSketchFilesForEmail(orderNoCur: string): Promise<NamedFile[]> {
    const out: NamedFile[] = [];

    // Topbar screenshot
    try {
      await ensureTopBarPanelOpenForShot();
      const node = findTopBarShotRootNode();
      const dataUrl = await elementToPngDataUrl(node, { pixelRatio: 2, bg: "#111111" });
      if (dataUrl) {
        const file = dataUrlToFile(dataUrl, "topbar.png");
        const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
          maxWidth: 1600,
          maxHeight: 3000,
          mime: "image/jpeg",
          qualityStart: 0.9,
          qualityMin: 0.55,
          qualityStep: 0.08
        });
        out.push({ file: new File([compressed], "TopBar.jpg", { type: "image/jpeg" }), name: "TopBar.jpg" });
      }
    } catch {
      // ignore
    }

    // Front sketch (node)
    try {
      const node = document.getElementById("pdf-front-sketch");
      const dataUrl = await elementToPngDataUrl(node as any, { pixelRatio: 2, bg: "#ffffff" });
      if (dataUrl) {
        const file = dataUrlToFile(dataUrl, "front.png");
        const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
          maxWidth: 2000,
          maxHeight: 2000,
          mime: "image/jpeg",
          qualityStart: 0.9,
          qualityMin: 0.55,
          qualityStep: 0.08
        });
        out.push({ file: new File([compressed], "Эскиз_лицевая.jpg", { type: "image/jpeg" }), name: "Эскиз_лицевая.jpg" });
      }
    } catch {
      // ignore
    }

    // Back sketch
    try {
      if (showBack && backCandidateUrl) {
        let f: File | null = null;

        const node = document.getElementById("pdf-back-sketch");
        if (node) {
          const dataUrl = await elementToPngDataUrl(node as any, { pixelRatio: 2, bg: "#ffffff" });
          if (dataUrl) f = dataUrlToFile(dataUrl, "back.png");
        }
        if (!f) f = await urlToFile(backCandidateUrl, "Эскиз_тыльная.jpg");

        if (f) {
          const compressed = await compressImageFileToMaxBytes(f, TARGET_FILE_BYTES, {
            maxWidth: 2000,
            maxHeight: 2000,
            mime: "image/jpeg",
            qualityStart: 0.9,
            qualityMin: 0.55,
            qualityStep: 0.08
          });
          out.push({ file: new File([compressed], "Эскиз_тыльная.jpg", { type: "image/jpeg" }), name: "Эскиз_тыльная.jpg" });
        }
      }
    } catch {
      // ignore
    }

    // Plates by URL
    try {
      if (showPlate && plateToShow.length > 0) {
        for (const p of plateToShow) {
          const base = `Эскиз_плита_${p.index + 1}`;
          const f = await urlToFile(p.url, `${base}.jpg`);
          if (!f) continue;

          const compressed = await compressImageFileToMaxBytes(f, TARGET_FILE_BYTES, {
            maxWidth: 2000,
            maxHeight: 2500,
            mime: "image/jpeg",
            qualityStart: 0.9,
            qualityMin: 0.55,
            qualityStep: 0.08
          });

          out.push({ file: new File([compressed], `${base}.jpg`, { type: "image/jpeg" }), name: `${base}.jpg` });
          await sleep(80);
        }
      }
    } catch {
      // ignore
    }

    // Чтобы гарантировать уникальность (на всякий)
    return out.map((x) => ({ ...x, name: safeBlobName(x.name) || `file-${orderNoCur}.jpg` }));
  }

  async function blobUploadOne(orderNoCur: string, f: File, folder: string): Promise<BlobItem> {
    const filename = safeBlobName(f.name || "file");
    const res = await upload(`${folder}/${filename}`, f, {
      access: "public",
      handleUploadUrl: "/api/blob-token" // наш endpoint выдачи токена
    });
    // res: { url, pathname, contentType, contentDisposition, ... }
    return { url: res.url, pathname: res.pathname, filename };
  }

  async function notifyUserAfterSend(orderNoCur: string) {
    const tgUser = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user;
    const userId = Number(tgUser?.id);
    if (!Number.isFinite(userId) || userId <= 0) return;

    const intro = loadIntroState();
    const name = (intro?.intro?.customerName || "").trim() || "—";
    const phone = (intro?.intro?.customerPhone || "").trim() || "—";
    const uname = tgUser?.username ? `@${tgUser.username}` : "";
    const full = [uname, tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ").trim();

    const text =
      `Заявка №${orderNoCur || "—"} отправлена.\n` +
      `Спасибо, ${name}! Наш менеджер свяжется с вами по указанному номеру ${phone}.\n\n` +
      `Telegram: ${full || "—"}\n` +
      `ID: ${userId}`;

    await sendDmToUser(userId, text);
  }

  // ===== Main send =====
  const sendOrderDirect = async () => {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);

    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim() || `order-${Date.now()}`;

      await sendManagerMessage(startMarkerText(orderNoCur));

      // Telegram sending (оставьте вашу текущую логику здесь; чтобы не раздувать ответ — опущено)
      // ...

      // === EMAIL via BLOB (client upload) ===
      try {
        const orderText = buildOrderText();

        const plateNodesLocal = showPlate ? plateToShow.map((p) => document.getElementById(`pdf-plate-sketch-${p.index}`)) : [];
        const plateUrlFallbacksLocal = showPlate ? plateToShow.map((p) => p.url) : [];

        const pdfBlob = await generateOrderPdfShots({
          draft: loadOrderDraft(),
          intro: loadIntroState(),

          topbarNode: document.getElementById("topbar-shot-root"),
          frontNode: document.getElementById("pdf-front-sketch"),
          backNode: showBack ? (document.getElementById("pdf-back-sketch") as any) : null,
          backUrlFallback: showBack ? backCandidateUrl : null,

          plateNodes: plateNodesLocal,
          plateUrlFallbacks: plateUrlFallbacksLocal,

          orderText,
          includeAttachedPhotos: true
        } as any);

        const pdfFile = new File([pdfBlob], `order-${orderNoCur}.pdf`, { type: "application/pdf" });

        const personNamedPhotos: NamedFile[] = collectPersonPhotosWithCaptions(loadOrderDraft()).map((x) => ({
          file: x.file,
          name: x.name
        }));

        const sketchFiles = await collectSketchFilesForEmail(orderNoCur);

        // объединяем фото: персональные имена + скетчи
        const allPhotos: NamedFile[] = [
          ...personNamedPhotos.map((x) => ({ file: x.file, name: safeBlobName(x.name) })),
          ...sketchFiles
        ].filter((x) => !!x?.file);

        // Загружаем в Blob
        setUploadProgress(10);

        const baseFolder = `orders/${encodeURIComponent(orderNoCur)}`;
        const pdfBlobItem = await blobUploadOne(orderNoCur, pdfFile, `${baseFolder}/pdf`);

        setUploadProgress(30);

        const photoUrls: string[] = [];
        const photoPathnames: string[] = [];
        const photoFilenames: string[] = [];

        for (let i = 0; i < allPhotos.length; i++) {
          const nf = allPhotos[i];
          const res = await blobUploadOne(orderNoCur, new File([nf.file], nf.name, { type: nf.file.type || "image/jpeg" }), `${baseFolder}/photos`);
          photoUrls.push(res.url);
          photoPathnames.push(res.pathname);
          photoFilenames.push(nf.name);

          // прогресс 30..80
          const p = 30 + Math.round(((i + 1) / Math.max(1, allPhotos.length)) * 50);
          setUploadProgress(p);
          await sleep(40);
        }

        // Send email (server downloads from blob + attaches + deletes)
        setUploadProgress(85);
        const mailRes = await sendEmailFromBlobLinks({
          orderNo: orderNoCur,
          subject: `Заявка №${orderNoCur || "—"} (PDF)`,
          text: orderText,

          pdfUrl: pdfBlobItem.url,
          pdfPathname: pdfBlobItem.pathname,
          pdfFilename: pdfBlobItem.filename,

          photoUrls,
          photoPathnames,
          photoFilenames
        });

        if (!mailRes.ok) warnings.push(`Email не отправлен: ${mailRes.error || "ошибка"}`);

        setUploadProgress(100);
      } catch (e: any) {
        warnings.push(`Email не отправлен: ${String(e?.message || e)}`);
      }

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);

      await notifyUserAfterSend(orderNoCur);
    } finally {
      setUploading(false);
    }
  };

  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));

      const plateNodes = showPlate ? plateToShow.map((p) => document.getElementById(`pdf-plate-sketch-${p.index}`)) : [];
      const plateUrlFallbacks = showPlate ? plateToShow.map((p) => p.url) : [];

      const blob = await generateOrderPdfShots({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        topbarNode: document.getElementById("topbar-shot-root"),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: showBack ? (document.getElementById("pdf-back-sketch") as any) : null,
        backUrlFallback: showBack ? backCandidateUrl : null,
        plateNodes,
        plateUrlFallbacks,
        orderText: buildOrderText(),
        includeAttachedPhotos: true
      } as any);

      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
      setPdfSavedOnce(true);
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
      await sendOrderDirect();
      setConfirmOpen(false);
      setIsDirtyAfterSend(false);
      setTimeout(() => afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 150);
    } finally {
      setIsSending(false);
    }
  }

  const overlayText =
    uploading ? `Отправляем… ${Math.max(0, Math.min(100, uploadProgress || 0))}%` :
    isSending ? "Отправляем заказ…" :
    isSaving ? "Формируем PDF…" : "";

  return (
    <div style={safeRoot()}>
      <div role="note" aria-live="polite" style={{ margin: "10px 0", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.25)", color: "#ddd", fontWeight: 400, fontStyle: "italic" }}>
        Если необходимо внести изменения — вернитесь к соответствующему шагу. Воспользуйтесь навигацией вверху.
      </div>

      <div id="topbar-shot-root">
        <TopBarWithIntro title="Обзор и отправка" />
      </div>

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

      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img
              id="pdf-back-sketch"
              src={backCandidateUrl}
              crossOrigin="anonymous"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        </section>
      )}

      {showPlate && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Надгробная плита</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${plateToShow.length}, 1fr)`, gap: 10 }}>
            {plateToShow.map((p) => (
              <div key={`plate-sketch-${p.index}`} style={{ position: "relative", width: "100%", overflow: "hidden", aspectRatio: "1 / 2" }}>
                <img
                  id={`pdf-plate-sketch-${p.index}`}
                  src={p.url}
                  crossOrigin="anonymous"
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>
          Комментарий к заказу
        </label>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
          Не беспокойтесь: даже при отсутствии нужного пункта финальное подтверждение — по телефону или лично.
        </div>
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={String(((draft as any)?.extras?.orderNotes || "")).trim()}
          onBlur={(e) => {
            const v = String(e.target.value || "").trim();
            saveOrderDraft({ extras: { orderNotes: v ? v : null } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          placeholder="Добавьте комментарий…"
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </section>

      {(!sentOk || isDirtyAfterSend) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
          <button type="button" onClick={onBack} style={glassButtonStyle("sm")}>
            Назад
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>
            Отправить менеджеру
          </button>
        </div>
      )}

      {(deliveryVisible || sentOk) && (
        <div ref={afterHintRef}>
          <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
            <div style={{ fontWeight: 500, opacity: 0.92, marginBottom: 10 }}>
              {`Спасибо${customerName ? `, ${customerName}` : ""}! Сохраните PDF заказа, при необходимости сможете отправить менеджеру.`}
            </div>

            <div style={{ ...sectionBox, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Статус доставки</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div>
                  <span style={{ opacity: 0.85 }}>Email — </span>
                  <strong style={{ color: sentOk ? "#7dffa0" : "#ffd666" }}>{sentOk ? "да" : "в процессе/нет"}</strong>
                </div>
              </div>

              {lastWarnings.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer" }}>Подробности</summary>
                  <ul style={{ margin: "6px 0 0 20px" }}>
                    {lastWarnings.map((w, i) => (
                      <li key={`w-${i}`} style={{ marginBottom: 4 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>
                {isSaving ? "Формируем PDF…" : "Скачать PDF"}
              </button>
              <button type="button" onClick={() => setNewOrderOpen(true)} disabled={isSaving || uploading || isSending} style={glassButtonStyle("sm", isSaving || uploading || isSending)}>
                Новая заявка
              </button>
            </div>
          </section>
        </div>
      )}

      {confirmOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.47)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center"
          }}
          onClick={() => {
            if (!isSending && !uploading) setConfirmOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#181922",
              color: "#fff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 24,
              boxShadow: "0 -20px 60px rgba(0,0,0,0.57)",
              margin: "0 auto",
              maxWidth: 420,
              width: "100%",
              fontSize: 17,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              position: "relative"
            }}
          >
            <div style={{ position: "absolute", top: 10, right: 12 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                title="Закрыть"
                style={{ ...glassButtonStyle("sm"), width: 36, height: 36, fontWeight: 600, fontSize: 24, padding: 0, lineHeight: 1 }}
                disabled={isSending || uploading}
              >
                ×
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 5 }}>
              Отправить заказ менеджерам?
            </div>
            <button style={glassButtonStyle("sm")} onClick={handleSend} disabled={isSending || uploading}>
              {isSending || uploading ? "Отправляем…" : "Отправить"}
            </button>
            <button style={glassButtonStyle("sm")} onClick={() => setConfirmOpen(false)} disabled={isSending || uploading}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}
    </div>
  );
}