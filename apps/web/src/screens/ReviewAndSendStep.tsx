// src/screens/ReviewAndSendStep.tsx
//
// Шаг «Обзор и подтверждение»
//
// ТРЕБОВАНИЯ:
// - НЕ показываем редакторы "Дополнительно/Надгробная плита" на обзоре.
// - НО показываем эскиз надгробной плиты (если он существует и не пустой),
//   по аналогии с тыльной стороной.
// - Эскиз плиты берём из draft.extras.platePreviewHiUrl / platePreviewUrl.
// - Если элементов на тыле/плите нет — соответствующие эскизы скрываются
//   (у вас это достигается тем, что previewUrl/previewHiUrl записываются как null).
//
// ВАЖНО: этот файл компилируется; добавлено только чтение/показ эскиза плиты + отправка в Telegram.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro } from "../lib/intro";
import { generateOrderPdf, downloadBlob } from "../lib/pdf/generateOrderPdf";
import { compressImageFileToMaxBytes } from "../lib/media/resize";

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
function coloredOutlineButtonStyle(color: string = "#4977ff"): React.CSSProperties {
  return {
    ...glassButtonStyle("md"),
    border: `1px solid ${color}`,
    color: "#f7f7fa",
    fontWeight: 600,
    background: "#15161a",
    transition: "box-shadow 120ms, border-color 150ms, color 120ms",
    boxShadow: "0 2px 18px 0px rgba(34,54,120,0.08)",
    marginBottom: 12,
  };
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
  } catch {}}


function __setHashForStep(id: string) {
  window.location.hash = "#/wizard/" + encodeURIComponent(id);
}



/* ========= Top hint ========= */
function TopHintNotice() {
  return (
    <div
      role="note"
      aria-live="polite"
      style={{
        margin: "10px 0",
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.25)",
        color: "#ddd",
        fontWeight: 400,
        fontStyle: "italic"
      }}
    >
      Если необходимо внести изменения — вернитесь к соответствующему шагу. Воспользуйтесь навигацией вверху.
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

function ensurePlates(ex: any): any[] {
  const cur = Array.isArray(ex?.plates) ? ex.plates.slice() : [];
  while (cur.length < 3) cur.push({});
  return cur;
}

/* ========= Main component ========= */
export default function ReviewAndSendStep({
  onBack,
  onSend,
  onNewOrderWipeAll,
  onNewOrderWipeKeepCustomer,
  onNewOrderKeepAllNewNo
}: {
  onBack?: () => void,
  onSend?: () => void,
  onNewOrderWipeAll?: () => void,
  onNewOrderWipeKeepCustomer?: () => void,
  onNewOrderKeepAllNewNo?: () => void
}) {


  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);
    const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderConfirm, setNewOrderConfirm] =
    useState<null | "wipe_all" | "wipe_keep_customer" | "keep_all_new_no">(null);
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
      } catch {}};
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
  }, []);

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
      } catch {}};

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

// пригодится для отправки по URL (fallback)
const plateUrlFallbacks = useMemo(() => plateToShow.map((p) => p.url), [plateToShow]);



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
  const [sentOk, setSentOk] = useState(false);
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
    }}

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
    }}

  async function sendDmToUser(userId: number, text: string): Promise<void> {
    try {
      await fetch("/api/tg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dm", userId, text })
      });
    } catch {
      // ignore
    }}

  function startMarkerText(no: string): string {
    const n = no || "—";
    return `🪦 НАЧАЛО ЗАЯВКИ №${n}`;
  }
  function endMarkerText(no: string): string {
    const n = no || "—";
    return `🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${n}`;
  }

  function buildOrderText(): string {
  const introState = loadIntroState();
  const d: any = loadOrderDraft();

  const orderNo = String(introState?.orderNumber || "").trim();

  const lines: string[] = [];
  lines.push(orderNo ? `Заявка №${orderNo}` : "Заявка");
  lines.push("");

  // ===== Клиент =====
  lines.push("Клиент:");
  lines.push(`- Имя: ${(introState?.intro?.customerName || "").trim() || "—"}`);
  lines.push(`- Телефон: ${(introState?.intro?.customerPhone || "").trim() || "—"}`);
  const customerNotes = String(introState?.intro?.customerNotes || "").trim();
  if (customerNotes) lines.push(`- Примечание: ${customerNotes}`);
  lines.push("");

  // ===== Изделие / размеры =====
  const itemName = String(d?.item?.name || "").trim();
  const itemUrl = String(d?.item?.url || "").trim();
  if (itemName || itemUrl) {
    lines.push("Изделие:");
    if (itemName) lines.push(`- Модель: ${itemName}`);
    if (!itemName && itemUrl) lines.push(`- Файл: ${itemUrl}`);
    lines.push("");
  }

  const size = d?.size || {};
  const w = size?.width;
  const h = size?.height;
  const t = size?.thickness;
  const sizeNotes = String(size?.notes || "").trim();
  if (w || h || t || sizeNotes) {
    lines.push("Размеры:");
    if (w || h || t) lines.push(`- (мм) Ш×В×Т: ${w || "—"} × ${h || "—"} × ${t || "—"}`);
    if (sizeNotes) lines.push(`- Примечание: ${sizeNotes}`);
    lines.push("");
  }

  // ===== Дополнительно (extras) =====
  const ex = (d?.extras || {}) as any;
  const tumba = ex.tumba ?? true;
  const flowerbed = !!ex.flowerbed;
  const vase = !!ex.vase;

  lines.push("Дополнительно:");
  lines.push(`- Тумба: ${tumba ? "да" : "нет"}`);
  lines.push(`- Цветник: ${flowerbed ? "да" : "нет"}`);
  lines.push(`- Ваза: ${vase ? "да" : "нет"}`);
  lines.push("");

  // ===== Лицевая сторона =====
  lines.push("Лицевая сторона:");

  // Усопшие (front)
  const personsFront = ((d?.engraving?.persons as any[]) || []).filter(Boolean);
  if (personsFront.length === 0) {
    lines.push("- Усопшие: —");
  } else {
    lines.push("- Усопшие:");
    personsFront.forEach((p: any, idx: number) => {
      const last = String(p?.lastName || "").trim();
      const namePatr = [p?.firstName, p?.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
      const dates = [p?.birthDate, p?.deathDate].map((s: string) => (s || "").trim()).filter(Boolean).join(" — ");
      const fio = [last, namePatr].filter(Boolean).join(" ").trim();
      lines.push(`  ${idx + 1}) ${fio || "—"}`);
      if (dates) lines.push(`     ${dates}`);
    });
  }

  // Эпитафии (front)
  const engr: any = d?.engraving || {};
  const frontEpitaphs = toParagraphs(engr.epitaphs ?? engr.epitaphText);
  if (frontEpitaphs.length) {
    lines.push("- Эпитафии:");
    frontEpitaphs.forEach((t: string, i: number) => {
      lines.push(`  ${i + 1}) ${t}`);
    });
  } else {
    lines.push("- Эпитафии: —");
  }

  // Графика (front) — из draft.graphics (как у вас в обзоре)
  const frontGraphics: any[] = (d?.graphics || []).filter(Boolean);
  if (frontGraphics.length) {
    const counts: Record<string, number> = {};
    const first: Record<string, any> = {};
    frontGraphics.forEach((g: any) => {
      const id = String(g?.id || g?.url || g?.name || "").trim() || "unknown";
      counts[id] = (counts[id] || 0) + 1;
      if (!first[id]) first[id] = g;
    });
    lines.push("- Графика:");
    Object.keys(first).forEach((id, i) => {
      const g = first[id];
      const name = String(g?.name || g?.id || g?.url || id).trim();
      const qty = counts[id] || 1;
      lines.push(`  ${i + 1}) ${name}${qty > 1 ? ` ×${qty}` : ""}`);
    });
  } else {
    lines.push("- Графика: —");
  }

  const frontWishes = String(d?.editor?.wishes || "").trim();
  if (frontWishes) {
    lines.push("- Пожелания:");
    lines.push(frontWishes);
  }
  lines.push("");

  // ===== Тыльная сторона =====
  const eb: any = d?.editorBack || {};
  const rearEnabled = !!eb.enabled;
  lines.push("Тыльная сторона:");
  lines.push(`- Включено: ${rearEnabled ? "да" : "нет"}`);

  if (rearEnabled) {
    // Усопшие (rear)
    const rearPeople = ((eb?.people as any[]) || []).filter(Boolean);
    if (rearPeople.length) {
      lines.push("- Усопшие:");
      rearPeople.forEach((p: any, idx: number) => {
        const last = String(p?.lastName || "").trim();
        const namePatr = [p?.firstName, p?.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
        const dates = [p?.birthDate, p?.deathDate].map((s: string) => (s || "").trim()).filter(Boolean).join(" — ");
        const fio = [last, namePatr].filter(Boolean).join(" ").trim();
        lines.push(`  ${idx + 1}) ${fio || "—"}`);
        if (dates) lines.push(`     ${dates}`);
      });
    } else {
      lines.push("- Усопшие: —");
    }

    // Эпитафии rear
    const rearEpitaphs = ((eb?.epitaphTexts as string[]) || []).filter(Boolean);
    if (rearEpitaphs.length) {
      lines.push("- Эпитафии:");
      rearEpitaphs.forEach((t: string, i: number) => lines.push(`  ${i + 1}) ${t}`));
    } else {
      lines.push("- Эпитафии: —");
    }

    // Графика rear: ids + meta
    const rearIds: string[] = Array.isArray(eb?.selectedGraphicsIds) ? eb.selectedGraphicsIds : [];
    const rearMeta: Record<string, any> = eb?.graphicsMeta || {};
    if (rearIds.length) {
      const counts: Record<string, number> = {};
      rearIds.forEach((id: string) => (counts[id] = (counts[id] || 0) + 1));
      const uniq = Array.from(new Set(rearIds));
      lines.push("- Графика:");
      uniq.forEach((gid, i) => {
        const m = rearMeta[gid] || {};
        const name = String(m?.name || gid).trim();
        const qty = counts[gid] || 1;
        lines.push(`  ${i + 1}) ${name}${qty > 1 ? ` ×${qty}` : ""}`);
      });
    } else {
      lines.push("- Графика: —");
    }

    const backWishes = String(eb?.wishes || "").trim();
    if (backWishes) {
      lines.push("- Пожелания:");
      lines.push(backWishes);
    }}
  lines.push("");

    // ===== Надгробная плита =====
  const plateEnabled = !!ex.headstonePlate;
  lines.push("Надгробная плита:");
  lines.push(`- Включено: ${plateEnabled ? "да" : "нет"}`);

  const platesArr = ensurePlates(ex); // [0..2]

  // --- Плита 1 (legacy) ---
  const p1PreviewUrl = String(ex?.platePreviewHiUrl || ex?.platePreviewUrl || "").trim();
if (plateEnabled && p1PreviewUrl) {
    lines.push("Плита 1:");
    if (ex.plateSize) lines.push(`- Размер: ${String(ex.plateSize).trim()}`);
    if (ex.plateThickness) lines.push(`- Толщина: ${String(ex.plateThickness).trim()}`);
    if (ex.plateOrientation) lines.push(`- Ориентация: ${String(ex.plateOrientation).trim()}`);

    const plateEpitaphs = [...toParagraphs(ex.plateEpitaph), ...toParagraphs(ex.plateEpitaphs)].filter(Boolean);
    if (plateEpitaphs.length) {
      lines.push("- Эпитафии:");
      plateEpitaphs.forEach((t: string, i: number) => lines.push(`  ${i + 1}) ${t}`));
    } else {
      lines.push("- Эпитафии: —");
    }

    const plateIds: string[] = Array.isArray(ex.plateGraphicsIds) ? ex.plateGraphicsIds : [];
    const plateMeta: Record<string, any> = ex.plateGraphicsMeta || {};
    if (plateIds.length) {
      const counts: Record<string, number> = {};
      plateIds.forEach((id: string) => (counts[id] = (counts[id] || 0) + 1));
      const uniq = Array.from(new Set(plateIds));
      lines.push("- Графика:");
      uniq.forEach((gid, i) => {
        const m = plateMeta[gid] || {};
        const name = String(m?.name || gid).trim();
        const qty = counts[gid] || 1;
        lines.push(`  ${i + 1}) ${name}${qty > 1 ? ` ×${qty}` : ""}`);
      });
    } else {
      lines.push("- Графика: —");
    }}

  // --- Плита 2 и 3 (new extras.plates[1], extras.plates[2]) ---
  for (const i of [1, 2] as const) {
  const p: any = platesArr[i] || {};

  const previewUrl = String(p?.platePreviewHiUrl || p?.platePreviewUrl || "").trim();
  const enabled = !!p.enabled;

  // Печатаем ТОЛЬКО если плита добавлена: включена и есть превью
  if (!enabled || !previewUrl) continue;

  lines.push(`Плита ${i + 1}:`);

  if (p.plateSize) lines.push(`- Размер: ${String(p.plateSize).trim()}`);
  if (p.plateThickness) lines.push(`- Толщина: ${String(p.plateThickness).trim()}`);
  if (p.plateOrientation) lines.push(`- Ориентация: ${String(p.plateOrientation).trim()}`);

  const ep = [...toParagraphs(p.plateEpitaph), ...toParagraphs(p.plateEpitaphs)].filter(Boolean);
  if (ep.length) {
    lines.push("- Эпитафии:");
    ep.forEach((t: string, k: number) => lines.push(`  ${k + 1}) ${t}`));
  } else {
    lines.push("- Эпитафии: —");
  }

  const ids: string[] = Array.isArray(p.plateGraphicsIds) ? p.plateGraphicsIds : [];
  const meta: Record<string, any> = p.plateGraphicsMeta || {};
  if (ids.length) {
    const counts: Record<string, number> = {};
    ids.forEach((id: string) => (counts[id] = (counts[id] || 0) + 1));
    const uniq = Array.from(new Set(ids));
    lines.push("- Графика:");
    uniq.forEach((gid, k) => {
      const m = meta[gid] || {};
      const name = String(m?.name || gid).trim();
      const qty = counts[gid] || 1;
      lines.push(`  ${k + 1}) ${name}${qty > 1 ? ` ×${qty}` : ""}`);
    });
  } else {
    lines.push("- Графика: —");
  }}


  lines.push("");

  // ===== Комментарии =====
  const orderNotes = String(ex?.orderNotes || "").trim();
  const genericNotes = String(d?.notes || "").trim(); // если где-то используется
  if (orderNotes || genericNotes) {
    lines.push("Комментарий к заказу:");
    if (orderNotes) lines.push(orderNotes);
    if (genericNotes && genericNotes !== orderNotes) {
      lines.push("");
      lines.push("Доп. заметки:");
      lines.push(genericNotes);
    }
    lines.push("");
  }

  return lines.join("\n");
}


  async function sendLargeText(fullText: string): Promise<{ ok: boolean; errors: string[] }> {
    const parts: string[] = [];
    for (let i = 0; i < fullText.length; i += TELEGRAM_CHUNK_SIZE) parts.push(fullText.slice(i, i + TELEGRAM_CHUNK_SIZE));
    const errors: string[] = [];
    for (const part of parts) {
      const r = await sendManagerMessage(part);
      if (!r.ok) errors.push(r.error || "send error");
      await sleep(150);
    }
    return { ok: errors.length === 0, errors };
  }

  async function ensureTopBarPanelOpenForShot(): Promise<void> {
    const openTopbar = () => {
      try {
        window.dispatchEvent(new Event("memorial:openTopBarPanel"));
      } catch {}};
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

  async function sendTopbarShotWithHeaderAndPanel(): Promise<{ ok: boolean; error?: string }> {
    try {
      await ensureTopBarPanelOpenForShot();

      const node = findTopBarShotRootNode();
      if (!node) return { ok: false, error: "TopBar shot root not found" };

      const dataUrl = await elementToPngDataUrl(node, { pixelRatio: 2, bg: "#111111" });
      if (!dataUrl) return { ok: false, error: "TopBar shot failed" };

      const file = dataUrlToFile(dataUrl, "topbar.png");
      const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
        maxWidth: 1600,
        maxHeight: 3000,
        mime: "image/jpeg",
        qualityStart: 0.9,
        qualityMin: 0.55,
        qualityStep: 0.08
      });

      const fd = new FormData();
      fd.append("file", new File([compressed], "topbar.jpg", { type: "image/jpeg" }));
      return await sendManagerPhoto(fd);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }}

  async function sendSketchFromNode(
    nodeId: string,
    caption: string | undefined,
    fallbackUrl?: string | null
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const el = document.getElementById(nodeId) as HTMLElement | null;
      if (el) {
        const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, `${nodeId}.png`);
          const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
            maxWidth: 2000,
            maxHeight: 2000,
            mime: "image/jpeg",
            qualityStart: 0.9,
            qualityMin: 0.55,
            qualityStep: 0.08
          });

          const fd = new FormData();
          fd.append("file", new File([compressed], `${nodeId}.jpg`, { type: "image/jpeg" }));
          if (caption) fd.append("caption", caption);

          const r = await sendManagerPhoto(fd);
          if (r.ok) return { ok: true };
        }}
    } catch {
      // ignore, try URL
    }

    if (fallbackUrl) {
      const fd2 = new FormData();
      fd2.append("url", fallbackUrl);
      if (caption) fd2.append("caption", caption);
      const r2 = await sendManagerPhoto(fd2);
      if (r2.ok) return { ok: true };
      return { ok: false, error: r2.error || "url send failed" };
    }

    return { ok: false, error: "Не удалось отправить эскиз" };
  }

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
    }};

  // Лицевая
  pushFromList((((d || {}).engraving || {}).persons || []) as any[], undefined);

  // Тыльная (добавляем (ТЫЛ))
  const rearEnabled = !!d?.editorBack?.enabled;
  if (rearEnabled) {
    pushFromList(((d?.editorBack?.people || []) as any[]), "ТЫЛ");
  }

  return out;
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
    setTextDelivered(null);
    setTopbarDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(null);
    setPlateSketchDelivered(null);
    setPhotosDelivered(0);

    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();

      await sendManagerMessage(startMarkerText(orderNoCur));

      const topRes = await sendTopbarShotWithHeaderAndPanel();
      setTopbarDelivered(topRes.ok);
      if (!topRes.ok && topRes.error) warnings.push(`Топбар не отправлен: ${topRes.error}`);

      const tRes = await sendLargeText(buildOrderText());
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      const frontRes = await sendSketchFromNode("pdf-front-sketch", "Эскиз (лицевая)", null);
      setFrontSketchDelivered(frontRes.ok);
      if (!frontRes.ok && frontRes.error) warnings.push(`Эскиз (лицевая) не отправлен: ${frontRes.error}`);

      if (showBack && backCandidateUrl) {
        const backRes = await sendSketchFromNode("pdf-back-sketch", "Эскиз (тыльная)", backCandidateUrl);
        setBackSketchDelivered(backRes.ok);
        if (!backRes.ok && backRes.error) warnings.push(`Эскиз (тыльная) не отправлен: ${backRes.error}`);
      } else {
        setBackSketchDelivered(null);
      }

      if (showPlate && plateToShow.length > 0) {
  // отправим каждую активную плиту отдельным фото
  let allOk = true;

  for (const p of plateToShow) {
    const caption = `Эскиз (надгробная плита ${p.index + 1})`;
    const res = await sendSketchFromNode(`pdf-plate-sketch-${p.index}`, caption, p.url);

    // у тебя plateSketchDelivered один флаг; сделаем true только если все ок
    allOk = allOk && res.ok;

    if (!res.ok && res.error) warnings.push(`${caption} не отправлен: ${res.error}`);
    await sleep(120);
  }

  setPlateSketchDelivered(allOk);
} else {
  setPlateSketchDelivered(null);
}


      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      setPhotosTotal(photos.length);

      let delivered = 0;
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, {
          maxWidth: 2000,
          maxHeight: 2000,
          mime: "image/jpeg",
          qualityStart: 0.9,
          qualityMin: 0.55,
          qualityStep: 0.08
        });

        const fd = new FormData();
        fd.append("file", new File([compressed], ph.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
        fd.append("caption", ph.caption);

        const r = await sendManagerPhoto(fd);
        if (!r.ok) warnings.push(`Фото не отправлено (${ph.name}): ${r.error || "send failed"}`);
        else {
          delivered += 1;
          setPhotosDelivered(delivered);
        }

        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(200);
      }

      await sendManagerMessage(endMarkerText(orderNoCur));

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);
      setUploadProgress(100);

      await notifyUserAfterSend(orderNoCur);
    } finally {
      setUploading(false);
    }};

  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));
     const plateNodes = showPlate ? plateToShow.map((p) => document.getElementById(`pdf-plate-sketch-${p.index}`)) : [];
const plateUrlFallbacks = showPlate ? plateToShow.map((p) => p.url) : [];

const blob = await generateOrderPdf({
  draft: loadOrderDraft(),
  intro: loadIntroState(),
  frontNode: document.getElementById("pdf-front-sketch"),
  backNode: showBack ? document.getElementById("pdf-back-sketch") : null,
  backUrlFallback: showBack ? backCandidateUrl : null,

  // NEW:
  plateNodes,
  plateUrlFallbacks,

  // legacy fields keep (for backward compat inside generateOrderPdf):
  plateNode: plateNodes[0] || null,
  plateUrlFallback: plateUrlFallbacks[0] || null,

  includeAttachedPhotos: true
} as any);


      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
            setPdfSavedOnce(true);

    } catch (e: any) {
      alert(`Не удалось сформировать PDF\n\n${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }}

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
    }}

  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%` :
    isSending ? "Отправляем заказ…" :
    isSaving ? "Формируем PDF…" : "";

  return (
    <div style={safeRoot()}>
      <TopHintNotice />

      {/* Скриншотим этот контейнер целиком: кнопка + панель */}
      <div id="topbar-shot-root">
        <TopBarWithIntro title="Обзор и отправка" />
      </div>

      {/* Эскиз лицевой */}
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

      {/* Эскиз тыльной */}
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

      {/* Эскиз надгробной плиты (только если есть) */}
{showPlate && (
  <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>Надгробная плита</div>

    <div style={{ display: "grid", gridTemplateColumns: `repeat(${plateToShow.length}, 1fr)`, gap: 10 }}>
      {plateToShow.map((p) => (
        <div
          key={`plate-sketch-${p.index}`}
          style={{ position: "relative", width: "100%", overflow: "hidden", aspectRatio: "1 / 2" }}
        >
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

      {/* Комментарий к заказу */}
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

      {/* Кнопки */}
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

      {/* Статус */}
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
                  <span style={{ opacity: 0.85 }}>Состав заказа — </span>
                  <strong style={{ color: topbarDelivered == null ? "#ccc" : topbarDelivered ? "#7dffa0" : "#ffb4b4" }}>
                    {topbarDelivered == null ? "—" : topbarDelivered ? "да" : "нет"}
                  </strong>
                </div>
                <div>
                  <span style={{ opacity: 0.85 }}>Текст — </span>
                  <strong style={{ color: textDelivered == null ? "#ccc" : textDelivered ? "#7dffa0" : "#ffb4b4" }}>
                    {textDelivered == null ? "—" : textDelivered ? "да" : "нет"}
                  </strong>
                </div>
                <div>
                  <span style={{ opacity: 0.85 }}>Превью (лицевая) — </span>
                  <strong style={{ color: frontSketchDelivered == null ? "#ccc" : frontSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>
                    {frontSketchDelivered == null ? "—" : frontSketchDelivered ? "да" : "нет"}
                  </strong>
                </div>
                {showBack && (
                  <div>
                    <span style={{ opacity: 0.85 }}>Превью (тыльная) — </span>
                    <strong style={{ color: backSketchDelivered == null ? "#ccc" : backSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>
                      {backSketchDelivered == null ? "—" : backSketchDelivered ? "да" : "нет"}
                    </strong>
                  </div>
                )}
                {showPlate && (
                  <div>
                    <span style={{ opacity: 0.85 }}>Превью (плита) — </span>
                    <strong style={{ color: plateSketchDelivered == null ? "#ccc" : plateSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>
                      {plateSketchDelivered == null ? "—" : plateSketchDelivered ? "да" : "нет"}
                    </strong>
                  </div>
                )}
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
              {(topbarDelivered === false ||
                textDelivered === false ||
                frontSketchDelivered === false ||
                (showBack && backSketchDelivered === false) ||
                (showPlate && plateSketchDelivered === false) ||
                (photosTotal > 0 && photosDelivered < photosTotal)) && (
                <button type="button" onClick={() => sendOrderDirect()} disabled={uploading || isSending} style={glassButtonStyle("sm", uploading || isSending)}>
                  {uploading ? "Повторяем…" : "Повторить отправку"}
                </button>
              )}
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
             
            {/* Меню "Новая заявка" */}
      {newOrderOpen && (
        <div>
          <div
            aria-hidden
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2147483600,
              background: "rgba(12, 8, 8, 0.5)"
            }}
            onClick={() => setNewOrderOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              background: "#181922",
              color: "#fff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              boxShadow: "0 -20px 60px rgba(0,0,0,0.57)",
              boxSizing: "border-box",
              padding: 24,
              maxWidth: 420,
              margin: "0 auto",
              width: "100%",
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 2147483601,
              fontSize: 17,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "stretch"
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 21, textAlign: "center", marginBottom: 12 }}>
              Начать новую заявку?
            </div>
            <button
  style={glassButtonStyle("sm")}
  onClick={() => { setNewOrderOpen(false); setShowWipeWarn("wipeAll"); }}
>Стереть все (очистить полностью)</button>
            <button
  style={glassButtonStyle("sm")}
  onClick={() => { setNewOrderOpen(false); setShowWipeWarn("wipeAll"); }}
>Стереть все, оставить заказчика</button>
           <button
  style={glassButtonStyle("sm")}
  onClick={() => { setNewOrderOpen(false); setShowWipeWarn("wipeAll"); }}
>Оставить все поля, новый номер заказа</button>
            <button
  style={glassButtonStyle("sm")}
  onClick={() => { setNewOrderOpen(false); setShowWipeWarn("wipeAll"); }}
>Отмена</button>
          </div>
        </div>
      )}

      {/* Предупреждение о необходимости сначала скачать PDF */}
      {showWipeWarn && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10002,
            background: "rgba(0,0,0,0.32)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setShowWipeWarn(null)}
        >
          <div
            style={{
              background: "#181922",
              color: "#fff",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: 24,
              margin: "0 auto",
              maxWidth: 420,
              width: "100%",
              boxShadow: "0 -8px 38px #0006",
              textAlign: "center",
              fontSize: 17,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              alignItems: "center",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{fontWeight:700, marginBottom:4}}>Сначала сохраните PDF</div>
            <div style={{marginBottom:0, fontSize:15}}>
              Перед началом новой заявки <span style={{color:'#c00'}}>настоятельно рекомендуем</span> скачать и сохранить PDF заказа&nbsp;—
              иначе ваши данные будут безвозвратно утеряны.
            </div>
            <button
              style={glassButtonStyle("sm")}
              onClick={() => {
                setShowWipeWarn(null);
                handleSavePdf();
              }}
            >Скачать PDF</button>
            <button
              style={glassButtonStyle("sm")}
              onClick={() => {
                setShowWipeWarn(null);
                if (showWipeWarn === "wipeAll") onNewOrderWipeAll?.();
                if (showWipeWarn === "wipeKeepCustomer") onNewOrderWipeKeepCustomer?.();
                if (showWipeWarn === "wipeKeepAll") onNewOrderKeepAllNewNo?.();
              }}
            >Продолжить с потерей данных</button>
            <button
              style={glassButtonStyle("sm")}
              onClick={() => setShowWipeWarn(null)}
            >Отмена</button>
          </div>
        </div>
      )}

      {/* Подтверждение "Отправить заказ менеджерам в Telegram" */}
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
              onClick={e => e.stopPropagation()}
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
              >×</button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 5 }}>
              Отправить заказ менеджерам в Telegram?
            </div>
            <button
              style={glassButtonStyle("sm")}
              onClick={handleSend}
              disabled={isSending || uploading}
            >
              {isSending || uploading ? "Отправляем…" : "Отправить"}
            </button>
            <button
              style={glassButtonStyle("sm")}
              onClick={() => setConfirmOpen(false)}
              disabled={isSending || uploading}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

  {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}

</div>
  );
}






