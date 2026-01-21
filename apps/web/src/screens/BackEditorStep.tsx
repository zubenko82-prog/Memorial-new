// src/screens/BackEditorStep.tsx
// ТЫЛЬНАЯ СТОРОНА — выбор (графика/эпитафии/усопшие) + автогенерация preview тыла (editorBack.previewUrl/previewHiUrl)
// НИЖЕ — Дополнительно/Надгробная плита (как было на Review) + автогенерация preview плиты
//
// УСЛОВИЕ СКРЫТИЯ ЭСКИЗОВ НА ОБЗОРЕ:
// - если на тыле нет элементов (нет графики/эпитафий/усопших) => previewUrl/previewHiUrl = null
// - если на плите нет элементов (нет графики/эпитафий, или headstonePlate=false) => platePreviewUrl/platePreviewHiUrl = null
//
// ВАЖНО:
// - сохранение в draft только патчами (saveOrderDraft({ editorBack: ... }) / saveOrderDraft({ extras: ... }))
// - удаление через null
// - редактора (drag/resize) НЕТ
//
// ТЗ (ваше):
// - На тыле нужен блок "Выбрано для тыльной стороны" как у плиты.
// - Усопшие тыла храним в draft.editorBack.people.
// - Усопшие тыла — UI и сохранение как в EngravingStep (PhotoField + сжатие, без автосейва).
// - Превью тыла учитывает усопших (фото + ФИО/даты), графику и эпитафии.
// - Текст в превью auto-fit (чтобы не был крупный).
// - Попытка нарисовать "контур резной работы" на тыле: overlay-силуэт из item.url (может не сработать из-за CORS).
//   Если нужен 100% стабильный контур — дайте локальный путь в public, заменю item.url на него.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import PhotoField, { type PhotoValue } from "../components/PhotoField";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT, type OrderDraft } from "../lib/order";

/* ========= Styles ========= */
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.95)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  };
}
function sectionBoxStyle(): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: 10
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

function dispatchDraftUpdated() {
  try {
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
  } catch {}
}

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

/* ========= Epitaph helpers ========= */
const normEpitaph = (t: string) =>
  (t || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

function indexOfByNorm(list: string[], needle: string): number {
  const n = normEpitaph(needle);
  for (let i = 0; i < list.length; i++) {
    if (normEpitaph(list[i]) === n) return i;
  }
  return -1;
}
function hasByNorm(list: string[], needle: string) {
  return indexOfByNorm(list, needle) !== -1;
}
function uniqueByNorm(list: string[]): string[] {
  const out: string[] = [];
  for (const t of list) if (!hasByNorm(out, t)) out.push(t);
  return out;
}

/* ========= Date validation (как EngravingStep) ========= */
function parseFlexibleDate(input?: string): Date | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/\d+/g);
  if (!m || m.length < 3) return null;
  const d = +m[0],
    mo = +m[1],
    y = +m[2];
  if (!d || !mo || !y || y < 100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}
function validateDates(birth?: string, death?: string): string | null {
  const bd = parseFlexibleDate(birth);
  const dd = parseFlexibleDate(death);
  if (!bd && !dd) return null;
  if (birth && !bd) return "Некорректная дата рождения";
  if (death && !dd) return "Некорректная дата смерти";
  if (bd && dd && dd.getTime() < bd.getTime()) return "Дата смерти раньше даты рождения";
  return null;
}

/* ========= Image compression (как EngravingStep) ========= */
const DRAFT_IMG_MAX_BYTES = 600 * 1024;
const DRAFT_IMG_MAX_DIM = 1600;
const JPEG_Q_START = 0.9;
const JPEG_Q_MIN = 0.55;
const JPEG_Q_STEP = 0.08;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("read blob"));
    fr.readAsDataURL(blob);
  });
}
async function loadImageFromBlob(b: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(b);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function compressBlobToJpegDataUrl(input: Blob, maxBytes = DRAFT_IMG_MAX_BYTES): Promise<string> {
  const img = await loadImageFromBlob(input);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const r = iw / ih;

  let tw = iw,
    th = ih;
  if (Math.max(iw, ih) > DRAFT_IMG_MAX_DIM) {
    if (r >= 1) {
      tw = DRAFT_IMG_MAX_DIM;
      th = Math.round(DRAFT_IMG_MAX_DIM / r);
    } else {
      th = DRAFT_IMG_MAX_DIM;
      tw = Math.round(DRAFT_IMG_MAX_DIM * r);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(tw));
  canvas.height = Math.max(1, Math.round(th));
  const ctx = canvas.getContext("2d");
  if (!ctx) return await blobToDataUrl(input);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let q = JPEG_Q_START;
  let out: Blob = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
  if (out.size <= maxBytes) return await blobToDataUrl(out);

  while (q > JPEG_Q_MIN && out.size > maxBytes) {
    q = Math.max(JPEG_Q_MIN, q - JPEG_Q_STEP);
    out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
  }
  if (out.size <= maxBytes) return await blobToDataUrl(out);

  let scale = 0.9;
  for (let i = 0; i < 4 && out.size > maxBytes; i++) {
    const nw = Math.max(1, Math.round(canvas.width * scale));
    const nh = Math.max(1, Math.round(canvas.height * scale));
    const c2 = document.createElement("canvas");
    c2.width = nw;
    c2.height = nh;
    const x2 = c2.getContext("2d");
    if (!x2) break;
    x2.drawImage(canvas, 0, 0, nw, nh);

    canvas.width = nw;
    canvas.height = nh;
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) break;
    ctx2.drawImage(c2, 0, 0);

    q = JPEG_Q_START;
    out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
    while (q > JPEG_Q_MIN && out.size > maxBytes) {
      q = Math.max(JPEG_Q_MIN, q - JPEG_Q_STEP);
      out = await new Promise((res) => canvas.toBlob((b) => res(b || new Blob()), "image/jpeg", q));
    }
    scale *= 0.9;
  }
  return await blobToDataUrl(out);
}

/* ========= Canvas fit text ========= */
const FIT = (() => {
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = c ? c.getContext("2d") : null;
  const FAMILY = `"Century Schoolbook","Times New Roman",serif`;
  const LINE_H = 1.16;

  function setFont(px: number, bold = false) {
    if (!ctx) return;
    ctx.font = `${bold ? "bold " : ""}${Math.max(8, Math.floor(px))}px ${FAMILY}`;
  }

  function wrap(text: string, px: number, maxW: number): string[] {
    if (!ctx) return [text];
    setFont(px, false);
    const out: string[] = [];
    const paras = String(text || "").split(/\r?\n/);
    for (const para of paras) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width <= maxW) line = test;
        else {
          if (line) out.push(line);
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out.length ? out : [""];
  }

  function fitBlock(text: string, maxW: number, maxH: number, pxMax = 30, pxMin = 9) {
    if (!ctx) return { px: 12, lines: [text] };
    let lo = pxMin;
    let hi = pxMax;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const lines = wrap(text, mid, maxW);
      const h = Math.ceil(lines.length * mid * LINE_H);
      if (h <= maxH) lo = mid;
      else hi = mid - 1;
    }
    const px = lo;
    const lines = wrap(text, px, maxW);
    return { px, lines };
  }

  return { FAMILY, LINE_H, setFont, fitBlock };
})();

/* ========= Canvas/image helpers ========= */
const PLATE_BG_URL = "/images/carvings/Резные/Прямой вертикально.png";

async function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/* ========= Silhouette overlay from item.url (best-effort) ========= */
async function buildSilhouetteOverlayDataUrl(src: string, W: number, H: number): Promise<string | null> {
  const img = await loadImageSafe(src);
  if (!img) return null;

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  // contain geometry
  const sr = iw / ih;
  const dr = W / H;
  let rw = W,
    rh = H,
    rx = 0,
    ry = 0;
  if (sr > dr) {
    rh = Math.round(W / sr);
    ry = Math.round((H - rh) / 2);
  } else {
    rw = Math.round(H * sr);
    rx = Math.round((W - rw) / 2);
  }

  const off = document.createElement("canvas");
  off.width = rw;
  off.height = rh;
  const octx = off.getContext("2d");
  if (!octx) return null;
  octx.drawImage(img, 0, 0, rw, rh);

  const id = octx.getImageData(0, 0, rw, rh);
  const d = id.data;

  // alpha check
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) {
      hasAlpha = true;
      break;
    }
  }

  const mask = octx.createImageData(rw, rh);
  const md = mask.data;

  if (hasAlpha) {
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3];
      const a = A > 10 ? 255 : 0;
      md[i + 0] = 0;
      md[i + 1] = 0;
      md[i + 2] = 0;
      md[i + 3] = a;
    }
  } else {
    // corners background
    const bg = ((): [number, number, number] => {
      const px = (x: number, y: number) => {
        const idx = (y * rw + x) * 4;
        return [d[idx], d[idx + 1], d[idx + 2]] as [number, number, number];
      };
      const corners = [px(0, 0), px(rw - 1, 0), px(0, rh - 1), px(rw - 1, rh - 1)];
      const sum = corners.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]] as [number, number, number], [0, 0, 0]);
      return [Math.round(sum[0] / 4), Math.round(sum[1] / 4), Math.round(sum[2] / 4)];
    })();
    const BG_DELTA = 26;

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i + 0],
        g = d[i + 1],
        b = d[i + 2];
      const diff = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      const a = diff > BG_DELTA ? 255 : 0;
      md[i + 0] = 0;
      md[i + 1] = 0;
      md[i + 2] = 0;
      md[i + 3] = a;
    }
  }

  const shape = document.createElement("canvas");
  shape.width = W;
  shape.height = H;
  const sctx = shape.getContext("2d");
  if (!sctx) return null;

  sctx.clearRect(0, 0, W, H);
  sctx.fillStyle = "#1b1b1b";
  sctx.fillRect(0, 0, W, H);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = rw;
  maskCanvas.height = rh;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) return null;
  mctx.putImageData(mask, 0, 0);

  sctx.globalCompositeOperation = "destination-in";
  sctx.drawImage(maskCanvas, rx, ry);
  sctx.globalCompositeOperation = "source-over";

  return shape.toDataURL("image/png");
}

/* ========= Rear types/helpers ========= */
type NormalizedRearPerson = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoPreview: string | null;
};

type RearPerson = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoUrl?: string | null;
  photoDataUrl?: string | null;
};

function rearLinesFromPerson(p: RearPerson) {
  const l1 = (p.lastName || "").trim();
  const l2 = [p.firstName, p.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
  const l3 = [p.birthDate, p.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
function draftRearPersonsToLocal(list?: NormalizedRearPerson[] | null): RearPerson[] {
  if (!Array.isArray(list)) return [];
  return list.map((d, i) => ({
    id: d.id || `p-${i}`,
    lastName: d.lastName || "",
    firstName: d.firstName || "",
    middleName: d.middleName || "",
    birthDate: d.birthDate || "",
    deathDate: d.deathDate || "",
    photoUrl: d.photoPreview ?? null,
    photoDataUrl: d.photoPreview ?? null
  }));
}
function normalizeRearPersonsForSave(persons: RearPerson[]): NormalizedRearPerson[] {
  return persons.map((p) => ({
    id: p.id,
    lastName: p.lastName?.trim() || undefined,
    firstName: p.firstName?.trim() || undefined,
    middleName: p.middleName?.trim() || undefined,
    birthDate: p.birthDate?.trim() || undefined,
    deathDate: p.deathDate?.trim() || undefined,
    photoPreview: p.photoDataUrl ?? p.photoUrl ?? null
  }));
}
function makeBlankRearPerson(id?: string): RearPerson {
  return {
    id: id ?? `p-${Date.now()}`,
    lastName: "",
    firstName: "",
    middleName: "",
    birthDate: "",
    deathDate: "",
    photoUrl: null,
    photoDataUrl: null
  };
}

function normalizeRearGraphic(it: any) {
  const id = String(it?.id || it?.relPath || it?.url || it?.name || "");
  return {
    id,
    name: it?.name || id,
    url: it?.url || "",
    preview: it?.preview || it?.url || ""
  };
}

/* ========= Preview renderer (rear + plate) ========= */
async function renderPreview(params: {
  W: number;
  H: number;
  bg: { type: "gradient" } | { type: "image"; url: string };
  silhouette?: string | null;
  people: RearPerson[];
  graphics: { url?: string; preview?: string }[];
  epitaphs: string[];
}): Promise<string | null> {
  const { W, H, bg, silhouette, people, graphics, epitaphs } = params;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // background
  if (bg.type === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const bgIm = await loadImageSafe(bg.url);
    if (bgIm) {
      const iw = bgIm.naturalWidth || bgIm.width;
      const ih = bgIm.naturalHeight || bgIm.height;
      const sr = iw / ih;
      const dr = W / H;
      let dw = W,
        dh = H,
        dx = 0,
        dy = 0;
      if (sr > dr) {
        dh = Math.round(W / sr);
        dy = Math.round((H - dh) / 2);
      } else {
        dw = Math.round(H * sr);
        dx = Math.round((W - dw) / 2);
      }
      ctx.drawImage(bgIm, dx, dy, dw, dh);
    }
  }

  // silhouette overlay (rear)
  if (silhouette) {
    const s = await loadImageSafe(silhouette);
    if (s) {
      ctx.save();
      // mirror X
      ctx.translate(W / 2, 0);
      ctx.scale(-1, 1);
      ctx.translate(-W / 2, 0);
      ctx.drawImage(s, 0, 0, W, H);
      ctx.restore();
    }
  }

  type Item =
    | { kind: "pPhoto"; url: string }
    | { kind: "pText"; text: string }
    | { kind: "g"; url: string }
    | { kind: "t"; text: string };

  const items: Item[] = [];

  for (const p of people) {
    const photo = (p.photoDataUrl || p.photoUrl || "").trim();
    const lines = rearLinesFromPerson(p);
    if (photo) items.push({ kind: "pPhoto", url: photo });
    if (lines.length) items.push({ kind: "pText", text: lines.join("\n") });
  }
  for (const g of graphics) {
    const u = (g.preview || g.url || "").trim();
    if (u) items.push({ kind: "g", url: u });
  }
  for (const t of epitaphs) {
    const tt = String(t || "").trim();
    if (tt) items.push({ kind: "t", text: tt });
  }

  if (items.length === 0) return null;

  const pad = Math.round(Math.min(W, H) * 0.06);
  const gap = Math.round(Math.min(W, H) * 0.018);
  const usableH = Math.max(10, H - pad * 2);
  const blockH = Math.max(54, Math.floor((usableH - gap * (items.length - 1)) / items.length));
  const totalH = items.length * blockH + gap * (items.length - 1);
  let y = Math.max(pad, Math.floor((H - totalH) / 2));

  const blockW = Math.floor(W * 0.35);
  const x = Math.floor((W - blockW) / 2);

  async function drawContain(url: string, r: { x: number; y: number; w: number; h: number }) {
    const im = await loadImageSafe(url);
    if (!im) return;
    const iw = im.naturalWidth || im.width;
    const ih = im.naturalHeight || im.height;
    const sr = iw / ih;
    const dr = r.w / r.h;

    let dw = r.w,
      dh = r.h,
      dx = r.x,
      dy = r.y;
    if (sr > dr) {
      dh = Math.round(r.w / sr);
      dy = r.y + Math.round((r.h - dh) / 2);
    } else {
      dw = Math.round(r.h * sr);
      dx = r.x + Math.round((r.w - dw) / 2);
    }
    ctx.drawImage(im, dx, dy, dw, dh);
  }

  function drawText(text: string, r: { x: number; y: number; w: number; h: number }) {
    const padding = 10;
    const maxW = Math.max(10, r.w - padding * 2);
    const maxH = Math.max(10, r.h - padding * 2);

    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";

    const { px, lines } = FIT.fitBlock(text, maxW, maxH, 30, 9);
    FIT.setFont(px, false);

    const lh = Math.round(px * FIT.LINE_H);
    const total = lines.length * lh;
    let ty = r.y + Math.round((r.h - total) / 2) + lh;

    for (const line of lines) {
      ctx.fillText(line, r.x + r.w / 2, ty, maxW);
      ty += lh;
    }

    ctx.restore();
  }

  for (const it of items) {
    const r = { x, y, w: blockW, h: blockH };
    if (it.kind === "g" || it.kind === "pPhoto") await drawContain(it.url, r);
    else drawText(it.text, r);
    y += blockH + gap;
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

/* ========= Accordion ========= */
function LoudAccordion({
  title,
  open,
  onToggle,
  children
}: {
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const m = () => setH(ref.current?.scrollHeight || 0);
    m();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(m) : null;
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
        <div ref={ref} style={{ padding: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ========= PlateBlock (ВАШ рабочий из репозитория) ========= */
function PlateBlock(props: {
  extraPlate: boolean;
  setExtraPlate: (v: boolean) => void;

  plateSize: string;
  setPlateSize: (v: string) => void;
  plateCustomSize: string;
  setPlateCustomSize: (v: string) => void;

  plateThickness: string;
  setPlateThickness: (v: string) => void;
  plateCustomThickness: string;
  setPlateCustomThickness: (v: string) => void;

  plateOrientation: string;
  setPlateOrientation: (v: string) => void;

  plateSelectedEpitaphs: string[];
  setPlateSelectedEpitaphs: (v: string[] | ((p: string[]) => string[])) => void;
  plateShowMore: boolean;
  setPlateShowMore: (v: boolean | ((p: boolean) => boolean)) => void;
  plateCustomText: string;
  setPlateCustomText: (v: string) => void;
  onTogglePlateEpitaph: (t: string) => void;
  onAddPlateCustom: () => void;
  onRemovePlateEpitaph: (t: string) => void;

  catsLoading: boolean;
  catsError: string;
  cats: any[];
  catOpen: Record<string, boolean>;
  setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void;
  removePlateGraphic: (gid: string) => void;
  plateIds: string[];

  chosenPlateList: any[];
  onRemoveChosenPlateItem: (gid: string) => void;

  plateEpitaphList: string[];

  hasPedestal: boolean;
  setHasPedestal: (v: boolean) => void;
  hasFlowerbed: boolean;
  setHasFlowerbed: (v: boolean) => void;
  hasVase: boolean;
  setHasVase: (v: boolean) => void;

  extractPlateWidthText: () => string;

  onDirty?: () => void;
}) {
  // Это ваш PlateBlock (из того файла, который вы присылали). Оставляю как есть.
  // (Чтобы не сломать логику плиты — он большой, но рабочий.)
  const {
    extraPlate,
    setExtraPlate,
    plateSize,
    setPlateSize,
    plateCustomSize,
    setPlateCustomSize,
    plateThickness,
    setPlateThickness,
    plateCustomThickness,
    setPlateCustomThickness,
    plateOrientation,
    setPlateOrientation,

    plateSelectedEpitaphs,
    setPlateSelectedEpitaphs,
    plateShowMore,
    setPlateShowMore,
    plateCustomText,
    setPlateCustomText,
    onTogglePlateEpitaph,
    onAddPlateCustom,
    onRemovePlateEpitaph,

    catsLoading,
    catsError,
    cats,
    catOpen,
    setCatOpen,
    addPlateGraphic,
    removePlateGraphic,
    plateIds,

    chosenPlateList,
    onRemoveChosenPlateItem,
    plateEpitaphList,

    hasPedestal,
    setHasPedestal,
    hasFlowerbed,
    setHasFlowerbed,
    hasVase,
    setHasVase,

    extractPlateWidthText,

    onDirty
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  const plateOpen = extraPlate;
  const markDirty = () => onDirty?.();

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

  function CatGrid({ items }: { items: any[] }) {
    return (
      <div ref={rootRef} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>
        {items.map((g: any, idx: number) => {
          const gid = String(g.id || g.relPath || g.url || g.name || idx);
          const qty = plateIds.filter((x) => x === gid).length;
          const selected = qty > 0;
          const thumbUrl = g.preview || g.url || "";
          const name = g.name || gid;

          return (
            <div
              key={gid}
              aria-selected={selected}
              style={{
                ...glassPanelStyle(),
                padding: 8,
                borderRadius: 12,
                position: "relative",
                borderColor: selected ? "#9cc4ff" : "rgba(255,255,255,0.14)",
                boxShadow: selected ? "0 0 0 1px #9cc4ff inset" : undefined
              }}
            >
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  display: selected ? "inline-flex" : "none",
                  alignItems: "center",
                  gap: 4,
                  background: "rgba(10,127,46,0.95)",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "0 6px",
                  fontSize: 11,
                  lineHeight: "18px",
                  height: 18
                }}
                title={`Выбрано: ${qty}`}
              >
                <span>✓</span>
                <span>{qty}</span>
              </div>

              <div
                role="button"
                title={name}
                onClick={() => {
                  addPlateGraphic(g);
                  markDirty();
                }}
                style={{
                  borderRadius: 10,
                  overflow: "hidden",
                  background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                  aspectRatio: "1/1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: selected ? "1px solid #9cc4ff" : "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                  outline: "none"
                }}
              >
                {thumbUrl ? (
                  <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} />
                ) : (
                  <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>
                )}
              </div>

              <div title={name} style={{ marginTop: 6, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 }}>
                {name}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    removePlateGraphic(gid);
                    markDirty();
                  }}
                  disabled={qty === 0}
                  style={glassButtonStyle("nano", qty === 0)}
                >
                  −
                </button>
                <span style={{ minWidth: 20, textAlign: "center" }}>{qty}</span>
                <button
                  type="button"
                  onClick={() => {
                    addPlateGraphic(g);
                    markDirty();
                  }}
                  style={glassButtonStyle("nano")}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const plateTitle = (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={extraPlate}
        onChange={(e) => {
          setExtraPlate(e.target.checked);
          markDirty();
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <span>Надгробная плита</span>
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <LoudAccordion title="Дополнительно" open={accExtrasOpen} onToggle={() => setAccExtrasOpen((v) => !v)}>
        <div style={sectionBoxStyle()}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasPedestal}
                onChange={(e) => {
                  setHasPedestal(e.target.checked);
                  markDirty();
                }}
              />
              <span>Тумба</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasFlowerbed}
                onChange={(e) => {
                  setHasFlowerbed(e.target.checked);
                  markDirty();
                }}
              />
              <span>Цветник</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasVase}
                onChange={(e) => {
                  setHasVase(e.target.checked);
                  markDirty();
                }}
              />
              <span>Ваза</span>
            </label>
          </div>
        </div>
      </LoudAccordion>

      <LoudAccordion
        title={plateTitle}
        open={plateOpen}
        onToggle={() => {
          setExtraPlate(!extraPlate);
          markDirty();
        }}
      >
        {extraPlate && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ ...sectionBoxStyle(), border: "1px solid rgba(255,80,80,0.95)" }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <strong>Размер:</strong> {(plateSize === "Свой вариант" ? plateCustomSize : plateSize) || "—"}
                </div>
                <div>
                  <strong>Ширина:</strong> {extractPlateWidthText()}
                </div>
              </div>

              {chosenPlateList.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                  {chosenPlateList.map((g, i) => {
                    const gid = String(g.id || g.url || i);
                    return (
                      <div key={`chosen-${gid}-${i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                        <Thumb url={g.url} />
                        <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.name || g.id}
                        </div>
                        <button
                          type="button"
                          title="Удалить"
                          onClick={() => {
                            onRemoveChosenPlateItem(String(g.id || g.name || g.url || ""));
                            markDirty();
                          }}
                          style={{
                            ...glassButtonStyle("nano"),
                            padding: "6px 10px",
                            borderColor: "rgba(255,80,80,0.9)"
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {plateEpitaphList.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {plateEpitaphList.map((t, idx) => (
                    <div
                      key={`plate-ep-preview-${idx}-${normEpitaph(t)}`}
                      style={{
                        ...sectionBoxStyle(),
                        padding: 8,
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 10,
                        alignItems: "start"
                      }}
                    >
                      <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                      <button
                        type="button"
                        title="Удалить эпитафию"
                        onClick={() => {
                          onRemovePlateEpitaph(t);
                          markDirty();
                        }}
                        style={{
                          ...glassButtonStyle("nano"),
                          padding: "6px 10px",
                          borderColor: "rgba(255,80,80,0.9)"
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="plate-size"
                      checked={plateSize === v}
                      onChange={() => {
                        setPlateSize(v);
                        markDirty();
                      }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateSize === "Свой вариант" && (
                <input
                  value={plateCustomSize}
                  onChange={(e) => {
                    setPlateCustomSize(e.target.value);
                    markDirty();
                  }}
                  placeholder="Укажите свой размер (например, 130×60 см)"
                  style={inputStyle()}
                />
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="plate-thickness"
                      checked={plateThickness === v}
                      onChange={() => {
                        setPlateThickness(v);
                        markDirty();
                      }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateThickness === "Свой вариант" && (
                <input
                  value={plateCustomThickness}
                  onChange={(e) => {
                    setPlateCustomThickness(e.target.value);
                    markDirty();
                  }}
                  placeholder="Укажите толщину (например, 7 см)"
                  style={inputStyle()}
                />
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="plate-orient"
                      checked={plateOrientation === v}
                      onChange={() => {
                        setPlateOrientation(v);
                        markDirty();
                      }}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>

            <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {QUICK_EPITAPHS.map((t) => {
                      const active = hasByNorm(plateSelectedEpitaphs, t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            onTogglePlateEpitaph(t);
                            markDirty();
                          }}
                          style={{
                            ...glassButtonStyle("nano"),
                            border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)"
                          }}
                          title={t}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 8, textAlign: "left" }}>Еще варианты:</div>
                  <button type="button" onClick={() => setPlateShowMore((v) => !v)} style={glassButtonStyle("nano")}>
                    {plateShowMore ? "Свернуть список" : "Развернуть список"}
                  </button>

                  {plateShowMore && (
                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                        gap: 8,
                        padding: 2
                      }}
                    >
                      {MORE_EPITAPHS.map((t, idx) => {
                        const active = hasByNorm(plateSelectedEpitaphs, t);
                        return (
                          <button
                            key={`more-${idx}-${normEpitaph(t)}`}
                            type="button"
                            onClick={() => {
                              onTogglePlateEpitaph(t);
                              markDirty();
                            }}
                            title={t}
                            style={{
                              textAlign: "left",
                              ...glassPanelStyle(),
                              borderRadius: 10,
                              padding: 10,
                              cursor: "pointer",
                              outline: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)",
                              fontSize: 13,
                              lineHeight: 1.25,
                              whiteSpace: "pre-wrap"
                            }}
                          >
                            {t}
                            <div style={{ marginTop: 6, fontSize: 12 }}>{active ? "Удалить из выбранных" : "Добавить к выбранным"}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 6, textAlign: "left" }}>Свой вариант:</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <textarea
                      rows={3}
                      value={plateCustomText}
                      onChange={(e) => setPlateCustomText(e.target.value)}
                      placeholder="Введите текст и нажмите «Добавить»"
                      style={{ ...inputStyle(), resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        style={glassButtonStyle("nano")}
                        onClick={() => {
                          onAddPlateCustom();
                          markDirty();
                        }}
                      >
                        Добавить
                      </button>
                      <button
                        type="button"
                        style={glassButtonStyle("nano")}
                        onClick={() => {
                          setPlateSelectedEpitaphs([]);
                          markDirty();
                        }}
                      >
                        Очистить выбранные
                      </button>
                      {plateSelectedEpitaphs.length > 0 && <div>Выбрано: {plateSelectedEpitaphs.length}</div>}
                    </div>
                  </div>
                </div>

                {plateSelectedEpitaphs.length > 0 && (
                  <div style={sectionBoxStyle()}>
                    <div style={{ marginBottom: 6, textAlign: "left" }}>Выбранные эпитафии:</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {plateSelectedEpitaphs.map((t, idx) => (
                        <div
                          key={`sel-${idx}-${normEpitaph(t)}`}
                          style={{
                            ...glassPanelStyle(),
                            borderRadius: 10,
                            padding: 10,
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            justifyContent: "space-between"
                          }}
                        >
                          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                          <button
                            type="button"
                            style={glassButtonStyle("nano")}
                            onClick={() => {
                              onRemovePlateEpitaph(t);
                              markDirty();
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </LoudAccordion>

            <LoudAccordion title="Графика на плите" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen((v) => !v)}>
              {catsLoading && <div>Загрузка каталога…</div>}
              {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
              {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}
              {!catsLoading && cats.length > 0 && (
                <div style={{ display: "grid", gap: 12 }}>
                  {cats.map((cat: any, idx: number) => {
                    const catKey = String(cat._id || cat.name || idx);
                    const open = !!(catOpen || {})[catKey];
                    const toggle = () => setCatOpen({ ...(catOpen || {}), [catKey]: !open });

                    return (
                      <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={toggle}>
                        <CatGrid items={cat.items || []} />
                        {(cat.children || []).map((sub: any, j: number) => (
                          <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                            <CatGrid items={sub.items || []} />
                          </div>
                        ))}
                      </LoudAccordion>
                    );
                  })}
                </div>
              )}
            </LoudAccordion>
          </div>
        )}
      </LoudAccordion>
    </div>
  );
}

/* ========= Step component ========= */
type Props = { onBack?: () => void; onContinue?: (payload?: any) => void };

export default function BackEditorStep({ onBack, onContinue }: Props) {
  const [outro, setOutro] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());

  useEffect(() => {
    const sync = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const item: any = (draft as any)?.item || null;

  /* =========================
   * 1) REAR (editorBack)
   * ========================= */
  const editorBack0: any = (draft as any)?.editorBack || {};

  const [rearSelectedIds, setRearSelectedIds] = useState<string[]>((editorBack0.selectedGraphicsIds as string[]) || []);
  const [rearMeta, setRearMeta] = useState<Record<string, any>>((editorBack0.graphicsMeta as Record<string, any>) || {});
  const [rearEpitaphs, setRearEpitaphs] = useState<string[]>(((editorBack0.epitaphTexts as string[]) || []).filter(Boolean));

  // people from draft.editorBack.people (normalized)
  const peopleFromDraft = useMemo(() => draftRearPersonsToLocal((editorBack0.people as NormalizedRearPerson[]) || []), [editorBack0.people]);
  const [rearPeople, setRearPeople] = useState<RearPerson[]>(peopleFromDraft.length ? peopleFromDraft : [makeBlankRearPerson("p-0")]);

  // transient blob previews
  const [transientPhotoUrlById, setTransientPhotoUrlById] = useState<Record<string, string | null>>({});
  const setTransientFor = useCallback((id: string, url: string | null) => {
    setTransientPhotoUrlById((prev) => {
      const prevUrl = prev[id];
      if (prevUrl && prevUrl.startsWith("blob:") && prevUrl !== url) {
        try {
          URL.revokeObjectURL(prevUrl);
        } catch {}
      }
      return { ...prev, [id]: url ?? null };
    });
  }, []);
  useEffect(() => {
    return () => {
      Object.values(transientPhotoUrlById).forEach((u) => {
        if (u && u.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(u);
          } catch {}
        }
      });
    };
  }, [transientPhotoUrlById]);

  // photo setter (as EngravingStep)
  const photoSeqByIdRef = useRef<Record<string, number>>({});
  const isBlobUrl = (url?: string | null) => !!url && url.startsWith("blob:");

  const setRearPersonPhotoById = (personId: string, pv: PhotoValue | null) => {
    const nextSeq = (photoSeqByIdRef.current[personId] || 0) + 1;
    photoSeqByIdRef.current[personId] = nextSeq;
    const isCurrentSeq = () => photoSeqByIdRef.current[personId] === nextSeq;

    const commitLocal = (patch: Partial<RearPerson>) => {
      if (!isCurrentSeq()) return;
      setTransientFor(personId, null);
      setRearPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
    };

    if (!pv) {
      setTransientFor(personId, null);
      commitLocal({ photoUrl: null, photoDataUrl: null });
      return;
    }

    if ((pv as any)?.dataUrl) {
      const dataUrl = (pv as any).dataUrl as string;
      (async () => {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const safe = await compressBlobToJpegDataUrl(blob, DRAFT_IMG_MAX_BYTES);
          commitLocal({ photoDataUrl: safe, photoUrl: safe });
        } catch {
          commitLocal({ photoDataUrl: dataUrl, photoUrl: (pv as any).url ?? dataUrl });
        }
      })();
      return;
    }

    const maybeFile: File | undefined = (pv as any)?.file;
    if (maybeFile instanceof File) {
      const tempUrl = URL.createObjectURL(maybeFile);
      setTransientFor(personId, tempUrl);
      (async () => {
        try {
          const safe = await compressBlobToJpegDataUrl(maybeFile, DRAFT_IMG_MAX_BYTES);
          try {
            URL.revokeObjectURL(tempUrl);
          } catch {}
          commitLocal({ photoDataUrl: safe, photoUrl: safe });
        } catch {
          try {
            URL.revokeObjectURL(tempUrl);
          } catch {}
          commitLocal({ photoUrl: tempUrl, photoDataUrl: null });
        }
      })();
      return;
    }

    if ((pv as any)?.url) {
      const url = (pv as any).url as string;
      if (isBlobUrl(url)) {
        setTransientFor(personId, url);
        (async () => {
          try {
            const blob = await (await fetch(url)).blob();
            const safe = await compressBlobToJpegDataUrl(blob, DRAFT_IMG_MAX_BYTES);
            commitLocal({ photoDataUrl: safe, photoUrl: safe });
          } catch {
            commitLocal({ photoUrl: url, photoDataUrl: null });
          }
        })();
      } else {
        setTransientFor(personId, null);
        commitLocal({ photoUrl: url, photoDataUrl: null });
      }
    }
  };

  // save rear people only on transitions/hide
  const flushRearPeopleNow = useCallback(() => {
    const norm = normalizeRearPersonsForSave(rearPeople);
    saveOrderDraft({ editorBack: { people: norm.length ? norm : null } as any });
    dispatchDraftUpdated();
  }, [rearPeople]);

  useEffect(() => {
    const saveNow = () => {
      try {
        flushRearPeopleNow();
      } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("beforeunload", saveNow);
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("hashchange", saveNow);
    window.addEventListener("popstate", saveNow);
    window.addEventListener("visibilitychange", onVisibility);
    return () => {
      saveNow();
      window.removeEventListener("beforeunload", saveNow);
      window.removeEventListener("pagehide", saveNow);
      window.removeEventListener("hashchange", saveNow);
      window.removeEventListener("popstate", saveNow);
      window.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushRearPeopleNow]);

  // rear catalog
  const [rearCatsLoading, setRearCatsLoading] = useState(false);
  const [rearCatsError, setRearCatsError] = useState("");
  const [rearCats, setRearCats] = useState<any[]>([]);
  const [rearCatOpen, setRearCatOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      setRearCatsLoading(true);
      setRearCatsError("");
      try {
        const data = await fetchCatalog("graphics");
        const root = (data as any)?.categories || data;
        const catsArr = Array.isArray(root) ? root : [];
        if (alive) setRearCats(catsArr);
      } catch {
        if (alive) setRearCatsError("Не удалось загрузить каталог графики.");
      } finally {
        if (alive) setRearCatsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!rearCats.length) return;
    setRearCatOpen((prev) => {
      const next = { ...prev };
      for (const c of rearCats) {
        const key = String(c._id || c.name || "");
        if (!(key in next)) next[key] = false;
      }
      return next;
    });
  }, [rearCats]);

  const rearCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    rearSelectedIds.forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [rearSelectedIds]);

  const addRearGraphic = (g: any) => {
    const gg = normalizeRearGraphic(g);
    if (!gg.id) return;

    const qty = rearCountsById[gg.id] || 0;
    if (qty >= 3) {
      window.alert("Нельзя добавить более трёх одинаковых изображений");
      return;
    }

    const nextIds = [...rearSelectedIds, gg.id];
    const nextMeta = { ...rearMeta, [gg.id]: { ...(rearMeta[gg.id] || {}), ...gg } };

    setRearSelectedIds(nextIds);
    setRearMeta(nextMeta);

    saveOrderDraft({ editorBack: { selectedGraphicsIds: nextIds, graphicsMeta: nextMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const removeRearGraphicOne = (gid: string) => {
    const idx = rearSelectedIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = rearSelectedIds.slice();
    nextIds.splice(idx, 1);
    setRearSelectedIds(nextIds);

    saveOrderDraft({ editorBack: { selectedGraphicsIds: nextIds, graphicsMeta: rearMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  // rear epitaphs
  const [rearShowMore, setRearShowMore] = useState(false);
  const [rearCustomText, setRearCustomText] = useState("");

  const toggleRearEpitaph = (text: string) => {
    const t = normEpitaph(text);
    if (!t) return;
    setRearEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, t);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return prev.concat([text]);
    });
  };
  const addRearCustom = () => {
    const raw = (rearCustomText || "").trim();
    const t = normEpitaph(raw);
    if (!t) return;
    setRearEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
    setRearCustomText("");
  };
  const removeRearEpitaph = (text: string) =>
    setRearEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });

  // persist rear epitaphs immediately (не тяжёлое)
  const prevRearEpiJsonRef = useRef<string>("");
  useEffect(() => {
    const list = uniqueByNorm(rearEpitaphs);
    const snapshot = JSON.stringify(list);
    if (snapshot === prevRearEpiJsonRef.current) return;
    prevRearEpiJsonRef.current = snapshot;

    saveOrderDraft({ editorBack: { epitaphTexts: list.length ? list : null } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rearEpitaphs]);

  // "Выбрано" for rear
  const rearChosenList = useMemo(() => {
    const uniq = Array.from(new Set(rearSelectedIds));
    return uniq.map((gid) => rearMeta[gid] || { id: gid, name: gid, url: "" });
  }, [rearSelectedIds, rearMeta]);

  // rear silhouette
  const [rearSilhouette, setRearSilhouette] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const u = String(item?.url || "").trim();
      if (!u) {
        setRearSilhouette(null);
        return;
      }
      const sil = await buildSilhouetteOverlayDataUrl(u, 900, 1200);
      if (!alive) return;
      setRearSilhouette(sil);
    })();
    return () => {
      alive = false;
    };
  }, [item?.url]);

  // rear preview generation (people+graphics+epitaphs)
  useEffect(() => {
    let alive = true;

    const run = async () => {
      const d = loadOrderDraft();
      const eb: any = (d as any)?.editorBack || {};
      const ids: string[] = Array.isArray(eb.selectedGraphicsIds) ? eb.selectedGraphicsIds : [];
      const meta: Record<string, any> = eb.graphicsMeta || {};
      const ep: string[] = Array.isArray(eb.epitaphTexts) ? eb.epitaphTexts : [];
      const pplNorm: NormalizedRearPerson[] = Array.isArray(eb.people) ? eb.people : [];

      const people = draftRearPersonsToLocal(pplNorm).map((p) => {
        const t = transientPhotoUrlById[p.id];
        if (t) return { ...p, photoUrl: t, photoDataUrl: null };
        return p;
      });

      const graphics = Array.from(new Set(ids)).map((gid) => meta[gid] || { id: gid, url: "" }).filter(Boolean);
      const epitaphs = ep.map((s) => String(s || "").trim()).filter(Boolean);

      const hasPeople = people.some((p) => !!(p.photoUrl || p.photoDataUrl) || rearLinesFromPerson(p).length > 0);
      const hasRear = hasPeople || graphics.length > 0 || epitaphs.length > 0;

      if (!hasRear) {
        saveOrderDraft({ editorBack: { previewUrl: null, previewHiUrl: null } as any });
        dispatchDraftUpdated();
        return;
      }

      const mini = await renderPreview({
        W: 900,
        H: 1200,
        bg: { type: "gradient" },
        silhouette: rearSilhouette,
        people,
        graphics,
        epitaphs
      });

      const big = await renderPreview({
        W: 1600,
        H: 2200,
        bg: { type: "gradient" },
        silhouette: rearSilhouette,
        people,
        graphics,
        epitaphs
      });

      if (!alive) return;

      saveOrderDraft({ editorBack: { previewUrl: mini || null, previewHiUrl: big || null } as any });
      dispatchDraftUpdated();
    };

    const t = window.setTimeout(() => void run(), 520);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [rearSelectedIds, rearMeta, rearEpitaphs, rearPeople, transientPhotoUrlById, rearSilhouette]);

  // rear people UI helpers
  const addRearPerson = () => setRearPeople((prev) => prev.concat([makeBlankRearPerson()]));
  const removeRearPerson = (id: string) =>
    setRearPeople((prev) => {
      const next = prev.filter((p) => p.id !== id);
      return next.length ? next : [makeBlankRearPerson("p-0")];
    });

  const moveUp = (idx: number) =>
    setRearPeople((prev) =>
      idx === 0 ? prev : prev.map((x, i) => (i === idx - 1 ? prev[idx] : i === idx ? prev[idx - 1] : x))
    );
  const moveDown = (idx: number) =>
    setRearPeople((prev) =>
      idx === prev.length - 1 ? prev : prev.map((x, i) => (i === idx ? prev[idx + 1] : i === idx + 1 ? prev[idx] : x))
    );

  const dateErrors = useMemo(() => {
    const errs: Record<string, string | null> = {};
    rearPeople.forEach((p) => (errs[p.id] = validateDates(p.birthDate, p.deathDate)));
    return errs;
  }, [rearPeople]);

  const canContinue = useMemo(() => Object.values(dateErrors).every((e) => !e), [dateErrors]);

  /* =========================
   * 2) PLATE (extras) + preview
   * ========================= */
  const extras0: any = (draft as any)?.extras || {};

  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(
    extras0.plateOrientation ||
      (((draft?.size?.orientation || (draft as any)?.orientation || "") as string).toLowerCase().startsWith("h") ? "horizontal" : "vertical")
  );

  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  const initialPlateSelected = useMemo(() => {
    const d = loadOrderDraft();
    const ex: any = (d as any)?.extras || {};
    const arr: string[] | undefined = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : undefined;
    const single: string | undefined = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? ex.plateEpitaph.trim() : undefined;
    return uniqueByNorm((arr && arr.length ? arr : single ? [single] : []) as string[]);
  }, []);

  const [plateSelectedEpitaphs, setPlateSelectedEpitaphs] = useState<string[]>(initialPlateSelected);
  const [plateShowMore, setPlateShowMore] = useState(false);
  const [plateCustomText, setPlateCustomText] = useState("");
  const plateEpitaphList = useMemo(() => plateSelectedEpitaphs, [plateSelectedEpitaphs]);

  const prevPlateEpiJsonRef = useRef<string>("");
  useEffect(() => {
    const list = uniqueByNorm(plateSelectedEpitaphs);

    const patchExtras: any = {};
    if (list.length === 0) {
      patchExtras.plateEpitaph = null;
      patchExtras.plateEpitaphs = null;
      patchExtras.plateEpitaphTexts = null;
    } else if (list.length === 1) {
      patchExtras.plateEpitaph = list[0];
      patchExtras.plateEpitaphs = null;
      patchExtras.plateEpitaphTexts = null;
    } else {
      patchExtras.plateEpitaph = null;
      patchExtras.plateEpitaphs = list.slice();
      patchExtras.plateEpitaphTexts = null;
    }

    const snapshot = JSON.stringify(patchExtras);
    if (snapshot !== prevPlateEpiJsonRef.current) {
      prevPlateEpiJsonRef.current = snapshot;
      saveOrderDraft({ extras: patchExtras } as any);
      dispatchDraftUpdated();
      setDraft(loadOrderDraft());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateSelectedEpitaphs]);

  // catalog for plate graphics
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
    return () => {
      alive = false;
    };
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
      const collect = (arr: any[]) =>
        (arr || []).forEach((it: any) => {
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

  function extractPlateWidthText(): string {
    const effective = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
    if (!effective) return "—";
    const m = effective.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (m) return `${m[2]} см`;
    const n = effective.match(/(\d+)\s*см/);
    if (n) return `${n[1]} см`;
    return effective;
  }

  const removeChosenPlateOne = (gidRaw: string) => {
    const gid = String(gidRaw || "").trim();
    if (!gid) return;

    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;

    const nextIds = plateIds.slice();
    nextIds.splice(idx, 1);
    setPlateIds(nextIds);

    saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  // plate preview generation (graphics+epitaphs)
  useEffect(() => {
    let alive = true;

    const run = async () => {
      const d = loadOrderDraft();
      const ex: any = (d as any)?.extras || {};

      const ids: string[] = Array.isArray(ex.plateGraphicsIds) ? ex.plateGraphicsIds : [];
      const meta: Record<string, any> = ex.plateGraphicsMeta || {};

      const arr: string[] = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : [];
      const one: string[] = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? [ex.plateEpitaph.trim()] : [];
      const epitaphs = [...one, ...arr].map((s) => String(s || "").trim()).filter(Boolean);

      const graphicsUniq = Array.from(new Set(ids)).map((gid) => meta[gid] || { id: gid, url: "" }).filter(Boolean);

      const hasPlate = !!ex.headstonePlate && (graphicsUniq.length > 0 || epitaphs.length > 0);
      if (!hasPlate) {
        saveOrderDraft({ extras: { platePreviewUrl: null, platePreviewHiUrl: null } as any });
        dispatchDraftUpdated();
        return;
      }

      const mini = await renderPreview({
        W: 900,
        H: 1200,
        bg: { type: "image", url: PLATE_BG_URL },
        silhouette: null,
        people: [],
        graphics: graphicsUniq,
        epitaphs
      });
      const big = await renderPreview({
        W: 1600,
        H: 2200,
        bg: { type: "image", url: PLATE_BG_URL },
        silhouette: null,
        people: [],
        graphics: graphicsUniq,
        epitaphs
      });

      if (!alive) return;

      saveOrderDraft({ extras: { platePreviewUrl: mini || null, platePreviewHiUrl: big || null } as any });
      dispatchDraftUpdated();
    };

    const t = window.setTimeout(() => void run(), 520);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [extraPlate, plateIds, plateMeta, plateEpitaphList]);

  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease", maxWidth: 600, margin: "0 auto" }}>
      <TopBarWithIntro title="Тыл" />

      {/* ======================= Тыльная сторона ======================= */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Тыльная сторона</div>

        {/* Выбрано для тыла */}
        <div style={{ ...sectionBoxStyle(), border: "1px solid rgba(255,80,80,0.95)", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для тыльной стороны</div>

          {rearChosenList.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: rearEpitaphs.length ? 8 : 0 }}>
              {rearChosenList.map((g, i) => {
                const gid = String(g.id || g.url || i);
                const url = g.preview || g.url || "";
                return (
                  <div key={`rear-chosen-${gid}-${i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                    <Thumb url={url} />
                    <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.name || g.id}
                    </div>
                    <button
                      type="button"
                      title="Удалить (1 шт.)"
                      onClick={() => removeRearGraphicOne(String(g.id || g.name || g.url || ""))}
                      style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {rearEpitaphs.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {rearEpitaphs.map((t, idx) => (
                <div
                  key={`rear-ep-preview-${idx}-${normEpitaph(t)}`}
                  style={{ ...sectionBoxStyle(), padding: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start" }}
                >
                  <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                  <button
                    type="button"
                    title="Удалить эпитафию"
                    onClick={() => removeRearEpitaph(t)}
                    style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {!rearChosenList.length && !rearEpitaphs.length && <div style={{ opacity: 0.85 }}>Пока ничего не выбрано.</div>}
        </div>

        {/* Графика тыла */}
        <LoudAccordion
          title="Графика (тыльная сторона)"
          open={!!rearCatOpen.__open_rear_graphics}
          onToggle={() => setRearCatOpen((m) => ({ ...m, __open_rear_graphics: !m.__open_rear_graphics }))}
        >
          {rearCatsLoading && <div>Загрузка каталога…</div>}
          {rearCatsError && <div style={{ color: "#ffb4b4" }}>{rearCatsError}</div>}
          {!rearCatsLoading && rearCats.length === 0 && !rearCatsError && <div>Каталог пуст.</div>}

          {!rearCatsLoading && rearCats.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {rearCats.map((cat: any, idx: number) => {
                const catKey = String(cat._id || cat.name || idx);
                const open = !!rearCatOpen[catKey];
                return (
                  <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={() => setRearCatOpen((m) => ({ ...m, [catKey]: !open }))}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                      {(cat.items || []).map((it: any, i: number) => {
                        const g = normalizeRearGraphic(it);
                        const qty = rearCountsById[g.id] || 0;
                        return (
                          <div key={`${catKey}-${g.id || i}`} style={{ ...sectionBoxStyle(), padding: 8 }}>
                            <div style={{ display: "grid", gap: 8 }}>
                              <Thumb url={g.preview || g.url} alt={g.name} size={90} />
                              <div style={{ fontSize: 12, opacity: 0.95, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={g.name}>
                                {g.name}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                <button type="button" style={glassButtonStyle("nano", qty === 0)} disabled={qty === 0} onClick={() => removeRearGraphicOne(g.id)}>
                                  −
                                </button>
                                <span style={{ minWidth: 24, textAlign: "center" }}>{qty}</span>
                                <button type="button" style={glassButtonStyle("nano", qty >= 3)} disabled={qty >= 3} onClick={() => addRearGraphic(it)}>
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {(cat.children || []).map((sub: any, j: number) => (
                      <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>{sub.name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                          {(sub.items || []).map((it: any, i: number) => {
                            const g = normalizeRearGraphic(it);
                            const qty = rearCountsById[g.id] || 0;
                            return (
                              <div key={`${catKey}-${sub._id || j}-${g.id || i}`} style={{ ...sectionBoxStyle(), padding: 8 }}>
                                <div style={{ display: "grid", gap: 8 }}>
                                  <Thumb url={g.preview || g.url} alt={g.name} size={90} />
                                  <div style={{ fontSize: 12, opacity: 0.95, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={g.name}>
                                    {g.name}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                    <button type="button" style={glassButtonStyle("nano", qty === 0)} disabled={qty === 0} onClick={() => removeRearGraphicOne(g.id)}>
                                      −
                                    </button>
                                    <span style={{ minWidth: 24, textAlign: "center" }}>{qty}</span>
                                    <button type="button" style={glassButtonStyle("nano", qty >= 3)} disabled={qty >= 3} onClick={() => addRearGraphic(it)}>
                                      +
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </LoudAccordion>
                );
              })}
            </div>
          )}
        </LoudAccordion>

        {/* Эпитафии тыла */}
        <LoudAccordion
          title="Эпитафии (тыльная сторона)"
          open={!!rearCatOpen.__open_rear_epitaphs}
          onToggle={() => setRearCatOpen((m) => ({ ...m, __open_rear_epitaphs: !m.__open_rear_epitaphs }))}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div style={sectionBoxStyle()}>
              <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {QUICK_EPITAPHS.map((t) => {
                  const active = hasByNorm(rearEpitaphs, t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleRearEpitaph(t)}
                      style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }}
                      title={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ marginBottom: 8, textAlign: "left" }}>Еще варианты:</div>
              <button type="button" onClick={() => setRearShowMore((v) => !v)} style={glassButtonStyle("nano")}>
                {rearShowMore ? "Свернуть список" : "Развернуть список"}
              </button>

              {rearShowMore && (
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, padding: 2 }}>
                  {MORE_EPITAPHS.map((t, idx) => {
                    const active = hasByNorm(rearEpitaphs, t);
                    return (
                      <button
                        key={`rear-more-${idx}-${normEpitaph(t)}`}
                        type="button"
                        onClick={() => toggleRearEpitaph(t)}
                        title={t}
                        style={{
                          textAlign: "left",
                          ...glassPanelStyle(),
                          borderRadius: 10,
                          padding: 10,
                          cursor: "pointer",
                          outline: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)",
                          fontSize: 13,
                          lineHeight: 1.25,
                          whiteSpace: "pre-wrap"
                        }}
                      >
                        {t}
                        <div style={{ marginTop: 6, fontSize: 12 }}>{active ? "Удалить из выбранных" : "Добавить к выбранным"}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ marginBottom: 6, textAlign: "left" }}>Свой вариант:</div>
              <div style={{ display: "grid", gap: 8 }}>
                <textarea
                  rows={3}
                  value={rearCustomText}
                  onChange={(e) => setRearCustomText(e.target.value)}
                  placeholder="Введите текст и нажмите «Добавить»"
                  style={{ ...inputStyle(), resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" style={glassButtonStyle("nano")} onClick={addRearCustom}>
                    Добавить
                  </button>
                  <button type="button" style={glassButtonStyle("nano")} onClick={() => setRearEpitaphs([])}>
                    Очистить выбранные
                  </button>
                  {rearEpitaphs.length > 0 && <div>Выбрано: {rearEpitaphs.length}</div>}
                </div>
              </div>
            </div>
          </div>
        </LoudAccordion>

        {/* Усопшие тыла (как EngravingStep, но без sticky) */}
        <LoudAccordion
          title="Усопшие (тыльная сторона)"
          open={!!rearCatOpen.__open_rear_people}
          onToggle={() => setRearCatOpen((m) => ({ ...m, __open_rear_people: !m.__open_rear_people }))}
        >
          <div style={{ display: "grid", gap: 10 }}>
            {rearPeople.map((p, idx) => {
              const err = dateErrors[p.id];
              const hasPhoto = !!(transientPhotoUrlById[p.id] || p.photoDataUrl || p.photoUrl);

              return (
                <div key={p.id} style={sectionBoxStyle()}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>Усопший {idx + 1}</div>
                    <div style={{ flex: 1 }} />
                    <button type="button" style={glassButtonStyle("nano", idx === 0)} disabled={idx === 0} onClick={() => moveUp(idx)}>
                      ▲
                    </button>
                    <button
                      type="button"
                      style={glassButtonStyle("nano", idx === rearPeople.length - 1)}
                      disabled={idx === rearPeople.length - 1}
                      onClick={() => moveDown(idx)}
                    >
                      ▼
                    </button>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => removeRearPerson(p.id)}>
                      Удалить
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      style={inputStyle()}
                      placeholder="Фамилия"
                      value={p.lastName || ""}
                      onChange={(e) => setRearPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, lastName: e.target.value } : x)))}
                    />
                    <input
                      style={inputStyle()}
                      placeholder="Имя"
                      value={p.firstName || ""}
                      onChange={(e) => setRearPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, firstName: e.target.value } : x)))}
                    />
                    <input
                      style={inputStyle()}
                      placeholder="Отчество"
                      value={p.middleName || ""}
                      onChange={(e) => setRearPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, middleName: e.target.value } : x)))}
                    />

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input
                        style={{ ...inputStyle(), borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)" }}
                        placeholder="Дата рождения"
                        value={p.birthDate || ""}
                        onChange={(e) => setRearPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, birthDate: e.target.value } : x)))}
                      />
                      <input
                        style={{ ...inputStyle(), borderColor: err && (err.includes("смерти") || err.includes("раньше")) ? "salmon" : "rgba(255,255,255,0.18)" }}
                        placeholder="Дата смерти"
                        value={p.deathDate || ""}
                        onChange={(e) => setRearPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, deathDate: e.target.value } : x)))}
                      />
                    </div>
                    {!!err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}

                    {!hasPhoto && (
                      <div style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, opacity: 0.92 }}>
                        Прикрепите фотографию (сохраняется в заявке).
                      </div>
                    )}

                    <PhotoField
                      label="Фотография"
                      value={{ url: transientPhotoUrlById[p.id] ?? p.photoUrl ?? undefined, dataUrl: p.photoDataUrl ?? undefined }}
                      onChange={(pv) => setRearPersonPhotoById(p.id, pv)}
                    />
                  </div>
                </div>
              );
            })}

            <button type="button" style={glassButtonStyle("sm")} onClick={addRearPerson}>
              Добавить
            </button>
          </div>
        </LoudAccordion>
      </section>

      {/* ======================= Плита ======================= */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Дополнительно / Надгробная плита</div>

        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => {
            setExtraPlate(v);
            saveOrderDraft({ extras: { headstonePlate: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateSize={plateSize}
          setPlateSize={(v) => {
            setPlateSize(v);
            saveOrderDraft({ extras: { plateSize: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateCustomSize={plateCustomSize}
          setPlateCustomSize={(v) => {
            setPlateCustomSize(v);
            saveOrderDraft({ extras: { plateCustomSize: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateThickness={plateThickness}
          setPlateThickness={(v) => {
            setPlateThickness(v);
            saveOrderDraft({ extras: { plateThickness: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateCustomThickness={plateCustomThickness}
          setPlateCustomThickness={(v) => {
            setPlateCustomThickness(v);
            saveOrderDraft({ extras: { plateCustomThickness: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateOrientation={plateOrientation}
          setPlateOrientation={(v) => {
            setPlateOrientation(v);
            saveOrderDraft({ extras: { plateOrientation: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateSelectedEpitaphs={plateSelectedEpitaphs}
          setPlateSelectedEpitaphs={setPlateSelectedEpitaphs}
          plateShowMore={plateShowMore}
          setPlateShowMore={setPlateShowMore}
          plateCustomText={plateCustomText}
          setPlateCustomText={setPlateCustomText}
          onTogglePlateEpitaph={(text) => {
            const t = normEpitaph(text);
            if (!t) return;
            setPlateSelectedEpitaphs((prev) => {
              const idx = indexOfByNorm(prev, t);
              if (idx !== -1) return prev.filter((_, i) => i !== idx);
              return prev.concat([text]);
            });
          }}
          onAddPlateCustom={() => {
            const raw = (plateCustomText || "").trim();
            const t = normEpitaph(raw);
            if (!t) return;
            setPlateSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
            setPlateCustomText("");
          }}
          onRemovePlateEpitaph={(text) => {
            setPlateSelectedEpitaphs((prev) => {
              const idx = indexOfByNorm(prev, text);
              return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
            });
          }}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpen}
          setCatOpen={setCatOpen}
          addPlateGraphic={(g) => {
            const gid = String(g.id || g.relPath || g.url || g.name);
            const nextIds = [...plateIds, gid];
            const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };

            setPlateIds(nextIds);
            setPlateMeta(nextMeta);

            saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;

            const nextIds = plateIds.slice();
            nextIds.splice(idx, 1);
            setPlateIds(nextIds);

            saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateIds={plateIds}
          chosenPlateList={chosenPlateList}
          onRemoveChosenPlateItem={removeChosenPlateOne}
          plateEpitaphList={plateEpitaphList}
          hasPedestal={hasPedestal}
          setHasPedestal={(v) => {
            setHasPedestal(v);
            saveOrderDraft({ extras: { tumba: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          hasFlowerbed={hasFlowerbed}
          setHasFlowerbed={(v) => {
            setHasFlowerbed(v);
            saveOrderDraft({ extras: { flowerbed: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          hasVase={hasVase}
          setHasVase={(v) => {
            setHasVase(v);
            saveOrderDraft({ extras: { vase: v } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          extractPlateWidthText={extractPlateWidthText}
          onDirty={() => void 0}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            flushRearPeopleNow();
            setOutro(true);
            setTimeout(() => onBack?.(), 320);
          }}
          style={glassButtonStyle("sm")}
        >
          Назад
        </button>

        <button
          type="button"
          disabled={!canContinue}
          onClick={() => {
            flushRearPeopleNow();
            setOutro(true);
            setTimeout(() => onContinue?.(), 320);
          }}
          style={glassButtonStyle("sm", !canContinue)}
          title={!canContinue ? "Проверьте даты усопших" : undefined}
        >
          Продолжить
        </button>
      </div>
    </div>
  );
}

