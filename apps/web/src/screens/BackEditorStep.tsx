// src/screens/BackEditorStep.tsx
//
// Превью (тыл/плита):
// - пропорция строго 1:2
// - длинная сторона 900 (W=450, H=900)
// - без hi-res (previewHiUrl/platePreviewHiUrl = null)
// - композиция: портрет (если есть) сверху -> метрика под ним -> далее графика/эпитафии по порядку добавления
// - всё центрируем по горизонтали, равномерно распределяем по вертикали
// - эпитафии: сохраняем разрывы строк как в тексте (не делаем перенос по словам), только уменьшаем шрифт при необходимости
// - для маленьких экранов масштабируем UI (не здесь; это относится к месту показа превью, но генерация корректна)

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
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
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

/* ========= Preview helpers ========= */
const PLATE_BG_URL = "/images/carvings/Резные/Прямой вертикально.png";

// Strict 1:2 with long side 900
const PREVIEW_W = 450;
const PREVIEW_H = 900;

function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const sr = iw / ih;
  const dr = r.w / r.h;

  let dw = r.w,
    dh = r.h,
    dx = r.x,
    dy = r.y;

  if (sr > dr) {
    dh = r.h;
    dw = Math.round(r.h * sr);
    dx = r.x + Math.round((r.w - dw) / 2);
  } else {
    dw = r.w;
    dh = Math.round(r.w / sr);
    dy = r.y + Math.round((r.h - dh) / 2);
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawImageContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
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
  ctx.drawImage(img, dx, dy, dw, dh);
}

async function buildSilhouetteOverlayDataUrl(params: { src: string; W: number; H: number; mirrorX?: boolean }): Promise<string | null> {
  const { src, W, H, mirrorX } = params;
  const baseImg = await loadImageSafe(src);
  if (!baseImg) return null;

  const iw = baseImg.naturalWidth || baseImg.width;
  const ih = baseImg.naturalHeight || baseImg.height;
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
  octx.clearRect(0, 0, rw, rh);
  octx.drawImage(baseImg, 0, 0, rw, rh);

  const imgData = octx.getImageData(0, 0, rw, rh);
  const d = imgData.data;

  let hasUsefulAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) {
      hasUsefulAlpha = true;
      break;
    }
  }

  const mask = octx.createImageData(rw, rh);
  const md = mask.data;

  if (hasUsefulAlpha) {
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3];
      const alpha = A > 10 ? 255 : 0;
      md[i + 0] = 0;
      md[i + 1] = 0;
      md[i + 2] = 0;
      md[i + 3] = alpha;
    }
  } else {
    const pxAt = (x: number, y: number) => {
      const idx = (y * rw + x) * 4;
      return [d[idx], d[idx + 1], d[idx + 2]] as [number, number, number];
    };
    const corners = [pxAt(0, 0), pxAt(rw - 1, 0), pxAt(0, rh - 1), pxAt(rw - 1, rh - 1)];
    const bg = corners
      .reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]] as [number, number, number], [0, 0, 0])
      .map((v) => Math.round(v / 4)) as [number, number, number];

    const BG_DELTA = 26;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i + 0],
        g = d[i + 1],
        b = d[i + 2];
      const diff = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      const alpha = diff > BG_DELTA ? 255 : 0;
      md[i + 0] = 0;
      md[i + 1] = 0;
      md[i + 2] = 0;
      md[i + 3] = alpha;
    }
  }

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = rw;
  maskCanvas.height = rh;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) return null;
  mctx.putImageData(mask, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, W, H);
  ctx.save();

  if (mirrorX) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }

  ctx.fillStyle = "#1b1b1b";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "destination-in";

  const drawX = mirrorX ? W - (rx + rw) : rx;
  ctx.drawImage(maskCanvas, drawX, ry);

  ctx.restore();
  return canvas.toDataURL("image/png");
}

function splitHardLines(text: string): string[] {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((s) => s.trimEnd());
}

function measureHardLinesHeight(fontPx: number, lineH: number, linesCount: number) {
  return Math.round(linesCount * fontPx * lineH);
}

function fitFontToBoxHardLines(params: {
  ctx: CanvasRenderingContext2D;
  lines: string[];
  maxW: number;
  maxH: number;
  startSize: number;
  minSize: number;
  lineH: number;
}) {
  const { ctx, lines, maxW, maxH, startSize, minSize, lineH } = params;
  let fs = startSize;

  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l || " ").width), 0);

  while (fs > minSize) {
    ctx.font = `${fs}px "Times New Roman", serif`;
    const w = widest();
    const h = measureHardLinesHeight(fs, lineH, lines.length);
    if (w <= maxW && h <= maxH) break;
    fs -= 1;
  }
  return fs;
}

type PersonPreview = {
  id: string;
  photo: string | null;
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string;
  deathDate: string;
};

type StackItem =
  | { kind: "photo"; url: string }
  | { kind: "metrica"; lastName: string; firstName: string; middleName: string; dates: string }
  | { kind: "img"; url: string }
  | { kind: "text"; text: string };

async function renderStackedCenteredPreview(params: {
  W: number;
  H: number;
  bg: { type: "gradient" } | { type: "image"; url: string };
  bgFit?: "cover" | "contain";
  overlayPng?: string | null;
  items: StackItem[];
}): Promise<string | null> {
  const { W, H, bg, bgFit = "cover", overlayPng, items } = params;

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
      if (bgFit === "contain") drawImageContain(ctx, bgIm, { x: 0, y: 0, w: W, h: H });
      else drawImageCover(ctx, bgIm, { x: 0, y: 0, w: W, h: H });
    }
  }

  // overlay
  if (overlayPng) {
    const ov = await loadImageSafe(overlayPng);
    if (ov) ctx.drawImage(ov, 0, 0, W, H);
  }

  // layout
  const padX = Math.round(W * 0.10);
  const padY = Math.round(H * 0.06);
  const colW = W - padX * 2;

  const gap = Math.max(10, Math.round(H * 0.02));
  const top = padY;
  const bottom = H - padY;
  const usable = Math.max(10, bottom - top);

  if (!items.length) return null;

  // allocate heights by type
  const basePhotoH = Math.round(H * 0.26);
  const baseMetricaH = Math.round(H * 0.14);
  const baseImgH = Math.round(H * 0.14);
  const baseTextH = Math.round(H * 0.14);

  const plannedHeights = items.map((it) => {
    if (it.kind === "photo") return basePhotoH;
    if (it.kind === "metrica") return baseMetricaH;
    if (it.kind === "img") return baseImgH;
    return baseTextH;
  });

  const totalGaps = gap * (items.length - 1);
  const totalPlanned = plannedHeights.reduce((a, b) => a + b, 0);

  // scale down if not fit (keep proportions)
  const k = Math.min(1, (usable - totalGaps) / Math.max(1, totalPlanned));
  const heights = plannedHeights.map((h) => Math.max(34, Math.floor(h * k)));

  const totalH = heights.reduce((a, b) => a + b, 0) + totalGaps;
  let y = Math.round(top + (usable - totalH) / 2);

  // draw each item centered
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const h = heights[i];
    const r = { x: padX, y, w: colW, h };

    if (it.kind === "photo" || it.kind === "img") {
      const im = await loadImageSafe(it.url);
      if (im) {
        // contain inside a smaller box to avoid touching edges
        const innerPad = Math.round(Math.min(r.w, r.h) * 0.06);
        const rr = { x: r.x + innerPad, y: r.y + innerPad, w: r.w - innerPad * 2, h: r.h - innerPad * 2 };
        drawImageContain(ctx, im, rr);
      }
    }

    if (it.kind === "metrica") {
      const innerPad = Math.round(Math.min(r.w, r.h) * 0.10);
      const rr = { x: r.x + innerPad, y: r.y + innerPad, w: r.w - innerPad * 2, h: r.h - innerPad * 2 };

      const ln = (it.lastName || "").trim();
      const fn = [it.firstName, it.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
      const dates = (it.dates || "").trim();

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // size hierarchy: lastName > first/middle > dates
      const lastBase = Math.min(44, Math.max(18, Math.floor(rr.h * 0.42)));
      const fnBase = Math.min(32, Math.max(14, Math.floor(rr.h * 0.30)));
      const datesBase = Math.min(26, Math.max(12, Math.floor(rr.h * 0.22)));

      // fit to width independently
      const fit = (text: string, start: number, min: number) => {
        let fs = start;
        while (fs > min) {
          ctx.font = `${fs}px "Times New Roman", serif`;
          if (ctx.measureText(text || " ").width <= rr.w) break;
          fs -= 1;
        }
        return fs;
      };

      const lastSize = ln ? fit(ln, lastBase, 12) : lastBase;
      const fnSize = fn ? fit(fn, fnBase, 11) : fnBase;
      const datesSize = dates ? fit(dates, datesBase, 10) : datesBase;

      const lh1 = Math.round(lastSize * 1.05);
      const lh2 = fn ? Math.round(fnSize * 1.05) : 0;
      const lh3 = dates ? Math.round(datesSize * 1.05) : 0;
      const total = lh1 + lh2 + lh3;
      let ty = rr.y + Math.round(rr.h / 2 - total / 2);

      if (ln) {
        ctx.font = `${lastSize}px "Times New Roman", serif`;
        ctx.fillText(ln, rr.x + rr.w / 2, ty + lh1 / 2);
        ty += lh1;
      }
      if (fn) {
        ctx.font = `${fnSize}px "Times New Roman", serif`;
        ctx.fillText(fn, rr.x + rr.w / 2, ty + lh2 / 2);
        ty += lh2;
      }
      if (dates) {
        ctx.font = `${datesSize}px "Times New Roman", serif`;
        ctx.fillText(dates, rr.x + rr.w / 2, ty + lh3 / 2);
        ty += lh3;
      }

      ctx.restore();
    }

    if (it.kind === "text") {
      const innerPad = Math.round(Math.min(r.w, r.h) * 0.10);
      const rr = { x: r.x + innerPad, y: r.y + innerPad, w: r.w - innerPad * 2, h: r.h - innerPad * 2 };

      const lines = splitHardLines(it.text);
      // keep original \n, but fit font to box (no word wrap)
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const start = Math.min(26, Math.max(14, Math.floor(rr.h * 0.32)));
      ctx.font = `${start}px "Times New Roman", serif`;

      const fs = fitFontToBoxHardLines({
        ctx,
        lines,
        maxW: rr.w,
        maxH: rr.h,
        startSize: start,
        minSize: 10,
        lineH: 1.18
      });

      ctx.font = `${fs}px "Times New Roman", serif`;
      const lineH = Math.round(fs * 1.18);
      const total = lineH * lines.length;
      let ty = rr.y + Math.round(rr.h / 2 - total / 2 + lineH / 2);

      for (const line of lines) {
        ctx.fillText(line || " ", rr.x + rr.w / 2, ty);
        ty += lineH;
      }

      ctx.restore();
    }

    y += h + gap;
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}

/* ========= People (rear) types ========= */
type Person = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoUrl?: string | null;
  photoDataUrl?: string | null;
};
type NormalizedPerson = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoPreview: string | null;
};

function draftPersonsToLocal(list?: NormalizedPerson[] | null): Person[] {
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
function normalizePersonsForSave(persons: Person[]): NormalizedPerson[] {
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
function makeBlankPerson(id?: string): Person {
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

/* ===== Date validation (локально) ===== */
function parseFlexibleDate(input?: string): Date | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/\d+/g);
  if (!m || m.length < 3) return null;
  const d = +m[0], mo = +m[1], y = +m[2];
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

/* ===== Image compression (for safe save) ===== */
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

  let tw = iw, th = ih;
  if (Math.max(iw, ih) > DRAFT_IMG_MAX_DIM) {
    if (r >= 1) { tw = DRAFT_IMG_MAX_DIM; th = Math.round(DRAFT_IMG_MAX_DIM / r); }
    else { th = DRAFT_IMG_MAX_DIM; tw = Math.round(DRAFT_IMG_MAX_DIM * r); }
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
    c2.width = nw; c2.height = nh;
    const x2 = c2.getContext("2d");
    if (!x2) break;
    x2.drawImage(canvas, 0, 0, nw, nh);
    canvas.width = nw; canvas.height = nh;
    ctx.drawImage(c2, 0, 0);

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

/* ===== Form helpers ===== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, width: "100%", boxSizing: "border-box" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
}
function iconBtn(): React.CSSProperties {
  return {
    padding: "2px 6px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  };
}

/* ========= SideLikePlateBlock ========= */
/* (UI часть оставлена как у вас — без урезаний, только перенесена как есть) */
function SideLikePlateBlock(props: {
  title: string;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;

  showPeople: boolean;
  people: Person[];
  setPeople: (v: Person[] | ((p: Person[]) => Person[])) => void;
  transientPhotoUrlById: Record<string, string | null>;
  setPersonPhotoById: (personId: string, pv: PhotoValue | null) => void;

  selectedEpitaphs: string[];
  setSelectedEpitaphs: (v: string[] | ((p: string[]) => string[])) => void;
  showMore: boolean;
  setShowMore: (v: boolean | ((p: boolean) => boolean)) => void;
  customText: string;
  setCustomText: (v: string) => void;
  onToggleEpitaph: (t: string) => void;
  onAddCustom: () => void;
  onRemoveEpitaph: (t: string) => void;
  epitaphList: string[];

  catsLoading: boolean;
  catsError: string;
  cats: any[];
  catOpen: Record<string, boolean>;
  setCatOpen: (m: Record<string, boolean>) => void;
  addGraphic: (g: any) => void;
  removeGraphic: (gid: string) => void;
  ids: string[];
  chosenList: any[];
  onRemoveChosenItem: (gid: string) => void;
}) {
  const {
    title,
    enabled,
    onToggleEnabled,
    showPeople,
    people,
    setPeople,
    transientPhotoUrlById,
    setPersonPhotoById,
    selectedEpitaphs,
    setSelectedEpitaphs,
    showMore,
    setShowMore,
    customText,
    setCustomText,
    onToggleEpitaph,
    onAddCustom,
    onRemoveEpitaph,
    epitaphList,
    catsLoading,
    catsError,
    cats,
    catOpen,
    setCatOpen,
    addGraphic,
    removeGraphic,
    ids,
    chosenList,
    onRemoveChosenItem
  } = props;

  const [accPeopleOpen, setAccPeopleOpen] = useState(false);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

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
          const qty = ids.filter((x) => x === gid).length;
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
                onClick={() => addGraphic(g)}
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
                <button type="button" onClick={() => removeGraphic(gid)} disabled={qty === 0} style={glassButtonStyle("nano", qty === 0)}>
                  −
                </button>
                <span style={{ minWidth: 20, textAlign: "center" }}>{qty}</span>
                <button type="button" onClick={() => addGraphic(g)} style={glassButtonStyle("nano")}>
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const blockTitle = (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input type="checkbox" checked={enabled} onChange={(e) => onToggleEnabled(e.target.checked)} onClick={(e) => e.stopPropagation()} />
      <span>{title}</span>
    </label>
  );

  const updatePerson = (idx: number, patch: Partial<Person>) => setPeople((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  const removePerson = (idx: number) =>
    setPeople((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [makeBlankPerson("p-0")];
    });
  const addPerson = () => setPeople((prev) => prev.concat([makeBlankPerson()]));
  const moveUp = (idx: number) =>
    setPeople((prev) => (idx === 0 ? prev : prev.map((x, i) => (i === idx - 1 ? prev[idx] : i === idx ? prev[idx - 1] : x))));
  const moveDown = (idx: number) =>
    setPeople((prev) => (idx === prev.length - 1 ? prev : prev.map((x, i) => (i === idx ? prev[idx + 1] : i === idx + 1 ? prev[idx] : x))));

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => Object.fromEntries(people.map((p) => [p.id, true])));
  useEffect(() => {
    setOpenMap((prev) => {
      const next: Record<string, boolean> = {};
      people.forEach((p) => { next[p.id] = prev[p.id] ?? true; });
      return next;
    });
  }, [people]);

  return (
    <LoudAccordion title={blockTitle} open={enabled} onToggle={() => onToggleEnabled(!enabled)}>
      {enabled && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...sectionBoxStyle(), border: "1px solid rgba(255,80,80,0.95)" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано</div>

            {chosenList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: epitaphList.length ? 8 : 0 }}>
                {chosenList.map((g, i) => {
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
                        onClick={() => onRemoveChosenItem(String(g.id || g.name || g.url || ""))}
                        style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {epitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {epitaphList.map((t, idx) => (
                  <div key={`ep-preview-${idx}-${normEpitaph(t)}`} style={{ ...sectionBoxStyle(), padding: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start" }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    <button
                      type="button"
                      title="Удалить эпитафию"
                      onClick={() => onRemoveEpitaph(t)}
                      style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {chosenList.length === 0 && epitaphList.length === 0 && <div style={{ opacity: 0.85 }}>Пока ничего не выбрано.</div>}
          </div>

          {showPeople && (
            <LoudAccordion title="Усопшие" open={accPeopleOpen} onToggle={() => setAccPeopleOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {people.map((p, idx) => {
                    const id = p.id;
                    const isOpen = openMap[id] ?? true;
                    const err = validateDates(p.birthDate, p.deathDate);
                    const nameLeft = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
                    const hasPhoto = !!(transientPhotoUrlById[p.id] || p.photoDataUrl || p.photoUrl);

                    return (
                      <div key={id} style={{ ...glassPanelStyle(), padding: 0 }}>
                        <div
                          onClick={() => setOpenMap((prev) => ({ ...prev, [id]: !isOpen }))}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "rgba(0,0,0,0.66)", borderRadius: "12px 12px 0 0", cursor: "pointer" }}
                        >
                          <span style={{ opacity: 0.9 }}>{idx + 1} -</span>
                          <div style={{ fontSize: 16, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {nameLeft}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                            <button type="button" onClick={(e) => { e.stopPropagation(); moveUp(idx); }} disabled={idx === 0} style={{ ...iconBtn(), opacity: idx === 0 ? 0.4 : 1 }} title="Выше">
                              ▲
                            </button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); moveDown(idx); }} disabled={idx === people.length - 1} style={{ ...iconBtn(), opacity: idx === people.length - 1 ? 0.4 : 1 }} title="Ниже">
                              ▼
                            </button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); removePerson(idx); }} style={iconBtn()} title="Удалить">
                              ✖
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                            <div style={{ display: "grid", gap: 10 }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                                <Field label="Фамилия"><input value={p.lastName ?? ""} onChange={(e) => updatePerson(idx, { lastName: e.target.value })} style={inputStyle()} placeholder="Иванов" /></Field>
                                <Field label="Имя"><input value={p.firstName ?? ""} onChange={(e) => updatePerson(idx, { firstName: e.target.value })} style={inputStyle()} placeholder="Иван" /></Field>
                                <Field label="Отчество"><input value={p.middleName ?? ""} onChange={(e) => updatePerson(idx, { middleName: e.target.value })} style={inputStyle()} placeholder="Иванович" /></Field>
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                                <Field label="Дата рождения">
                                  <input
                                    value={p.birthDate ?? ""}
                                    onChange={(e) => updatePerson(idx, { birthDate: e.target.value })}
                                    style={{ ...inputStyle(), borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)" }}
                                    placeholder="01.01.1950"
                                  />
                                </Field>
                                <Field label="Дата смерти">
                                  <input
                                    value={p.deathDate ?? ""}
                                    onChange={(e) => updatePerson(idx, { deathDate: e.target.value })}
                                    style={{ ...inputStyle(), borderColor: err && (err.includes("смерти") || err.includes("раньше")) ? "salmon" : "rgba(255,255,255,0.18)" }}
                                    placeholder="01.01.2024"
                                  />
                                </Field>
                                {!!err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}
                              </div>

                              <div>
                                {!hasPhoto && <div style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.35, opacity: 0.92 }}>Прикрепите фотографию. Она сохранится в заявке.</div>}
                                <PhotoField
                                  label="Фотография"
                                  value={{ url: transientPhotoUrlById[p.id] ?? p.photoUrl ?? undefined, dataUrl: p.photoDataUrl ?? undefined }}
                                  onChange={(pv) => setPersonPhotoById(p.id, pv)}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 2 }}>
                  <button type="button" onClick={addPerson} style={glassButtonStyle("sm")}>Добавить</button>
                </div>
              </div>
            </LoudAccordion>
          )}

          <LoudAccordion title="Эпитафии" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={sectionBoxStyle()}>
                <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => {
                    const active = hasByNorm(selectedEpitaphs, t);
                    return (
                      <button key={t} type="button" onClick={() => onToggleEpitaph(t)} style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }} title={t}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={sectionBoxStyle()}>
                <div style={{ marginBottom: 8, textAlign: "left" }}>Еще варианты:</div>
                <button type="button" onClick={() => setShowMore((v) => !v)} style={glassButtonStyle("nano")}>
                  {showMore ? "Свернуть список" : "Развернуть список"}
                </button>

                {showMore && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, padding: 2 }}>
                    {MORE_EPITAPHS.map((t, idx) => {
                      const active = hasByNorm(selectedEpitaphs, t);
                      return (
                        <button
                          key={`more-${idx}-${normEpitaph(t)}`}
                          type="button"
                          onClick={() => onToggleEpitaph(t)}
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
                  <textarea rows={3} value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Введите текст и нажмите «Добавить»" style={{ ...inputStyle(), resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" style={glassButtonStyle("nano")} onClick={onAddCustom}>Добавить</button>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => setSelectedEpitaphs([])}>Очистить выбранные</button>
                    {selectedEpitaphs.length > 0 && <div>Выбрано: {selectedEpitaphs.length}</div>}
                  </div>
                </div>
              </div>
            </div>
          </LoudAccordion>

          <LoudAccordion title="Графика" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen((v) => !v)}>
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
  );
}

/* ========= Main step ========= */
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

  const itemUrl = String((draft as any)?.item?.url || "").trim();

  /* ========= Shared catalog ========= */
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [catOpenRear, setCatOpenRear] = useState<Record<string, boolean>>({});
  const [catOpenPlate, setCatOpenPlate] = useState<Record<string, boolean>>({});

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
    const init = (prev: Record<string, boolean>) => {
      const next = { ...prev };
      for (const c of cats) {
        const key = String(c._id || c.name || "");
        if (!(key in next)) next[key] = false;
      }
      return next;
    };
    setCatOpenRear(init);
    setCatOpenPlate(init);
  }, [cats]);

  /* =========================
   * Дополнительно (extras)
   * ========================= */
  const extras0: any = (draft as any)?.extras || {};
  const [hasPedestal, setHasPedestal] = useState<boolean>(() => (extras0.tumba ?? true));
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(() => (extras0.flowerbed ?? true));
  const [hasVase, setHasVase] = useState<boolean>(() => (extras0.vase ?? false));

  useEffect(() => {
    const d = loadOrderDraft() as any;
    const ex = (d?.extras || {}) as any;
    const patch: any = {};
    if (ex.tumba === undefined) patch.tumba = true;
    if (ex.flowerbed === undefined) patch.flowerbed = true;
    if (ex.vase === undefined) patch.vase = false;
    if (Object.keys(patch).length) {
      saveOrderDraft({ extras: patch } as any);
      dispatchDraftUpdated();
    }
  }, []);

  /* =========================
   * REAR (editorBack)
   * ========================= */
  const editorBack0: any = (draft as any)?.editorBack || {};
  const [rearEnabled, setRearEnabled] = useState<boolean>(() => !!editorBack0.enabled);

  const [rearIds, setRearIds] = useState<string[]>((editorBack0.selectedGraphicsIds as string[]) || []);
  const [rearMeta, setRearMeta] = useState<Record<string, any>>((editorBack0.graphicsMeta as Record<string, any>) || {});
  const [rearSelectedEpitaphs, setRearSelectedEpitaphs] = useState<string[]>(((editorBack0.epitaphTexts as string[]) || []).filter(Boolean));
  const [rearShowMore, setRearShowMore] = useState(false);
  const [rearCustomText, setRearCustomText] = useState("");

  const rearPeople0 = draftPersonsToLocal((editorBack0.people as NormalizedPerson[]) || null);
  const [rearPeople, setRearPeople] = useState<Person[]>(rearPeople0.length ? rearPeople0 : [makeBlankPerson("p-0")]);

  // transient photo urls
  const [rearTransientPhotoUrlById, setRearTransientPhotoUrlById] = useState<Record<string, string | null>>({});
  const setRearTransientFor = useCallback((id: string, url: string | null) => {
    setRearTransientPhotoUrlById((prev) => {
      const prevUrl = prev[id];
      if (prevUrl && prevUrl.startsWith("blob:") && prevUrl !== url) {
        try { URL.revokeObjectURL(prevUrl); } catch {}
      }
      return { ...prev, [id]: url ?? null };
    });
  }, []);
  useEffect(() => {
    return () => {
      Object.values(rearTransientPhotoUrlById).forEach((u) => {
        if (u && u.startsWith("blob:")) { try { URL.revokeObjectURL(u); } catch {} }
      });
    };
  }, [rearTransientPhotoUrlById]);

  const photoSeqByIdRef = useRef<Record<string, number>>({});
  const isBlobUrl = (url?: string | null) => !!url && url.startsWith("blob:");

  const setRearPersonPhotoById = useCallback(
    (personId: string, pv: PhotoValue | null) => {
      const nextSeq = (photoSeqByIdRef.current[personId] || 0) + 1;
      photoSeqByIdRef.current[personId] = nextSeq;
      const isCurrentSeq = () => photoSeqByIdRef.current[personId] === nextSeq;

      const commitLocal = (patch: Partial<Person>) => {
        if (!isCurrentSeq()) return;
        setRearTransientFor(personId, null);
        setRearPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)));
      };

      if (!pv) {
        setRearTransientFor(personId, null);
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
        setRearTransientFor(personId, tempUrl);
        (async () => {
          try {
            const safe = await compressBlobToJpegDataUrl(maybeFile, DRAFT_IMG_MAX_BYTES);
            try { URL.revokeObjectURL(tempUrl); } catch {}
            commitLocal({ photoDataUrl: safe, photoUrl: safe });
          } catch {
            try { URL.revokeObjectURL(tempUrl); } catch {}
            commitLocal({ photoUrl: tempUrl, photoDataUrl: null });
          }
        })();
        return;
      }

      if ((pv as any)?.url) {
        const url = (pv as any).url as string;
        if (isBlobUrl(url)) {
          setRearTransientFor(personId, url);
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
          setRearTransientFor(personId, null);
          commitLocal({ photoUrl: url, photoDataUrl: null });
        }
      }
    },
    [setRearTransientFor]
  );

  const rearPeopleForPreview = useMemo<PersonPreview[]>(() => {
    // take first person as "portrait block" (as per requirement)
    const p = rearPeople[0];
    if (!p) return [];
    const transient = rearTransientPhotoUrlById[p.id];
    const stable = p.photoDataUrl ?? p.photoUrl ?? null;
    const photo = (transient ?? stable) as string | null;

    return [
      {
        id: p.id,
        photo,
        lastName: (p.lastName || "").trim(),
        firstName: (p.firstName || "").trim(),
        middleName: (p.middleName || "").trim(),
        birthDate: (p.birthDate || "").trim(),
        deathDate: (p.deathDate || "").trim()
      }
    ].filter((x) => x.photo || x.lastName || x.firstName || x.middleName || x.birthDate || x.deathDate);
  }, [rearPeople, rearTransientPhotoUrlById]);

  const prevRearEpiJsonRef = useRef<string>("");
  useEffect(() => {
    if (!rearEnabled) return;
    const list = uniqueByNorm(rearSelectedEpitaphs);
    const snapshot = JSON.stringify(list);
    if (snapshot === prevRearEpiJsonRef.current) return;
    prevRearEpiJsonRef.current = snapshot;

    saveOrderDraft({ editorBack: { epitaphTexts: list.length ? list : null } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  }, [rearEnabled, rearSelectedEpitaphs]);

  const rearCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    rearIds.forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [rearIds]);

  const addRearGraphic = (g: any) => {
    if (!rearEnabled) return;
    const gid = String(g.id || g.relPath || g.url || g.name);
    if (!gid) return;
    const qty = rearCountsById[gid] || 0;
    if (qty >= 3) {
      window.alert("Нельзя добавить более трёх одинаковых изображений");
      return;
    }
    const nextIds = [...rearIds, gid];
    const nextMeta = { ...rearMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
    setRearIds(nextIds);
    setRearMeta(nextMeta);
    saveOrderDraft({ editorBack: { selectedGraphicsIds: nextIds, graphicsMeta: nextMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const removeRearGraphic = (gid: string) => {
    if (!rearEnabled) return;
    const idx = rearIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = rearIds.slice();
    nextIds.splice(idx, 1);
    setRearIds(nextIds);
    saveOrderDraft({ editorBack: { selectedGraphicsIds: nextIds, graphicsMeta: rearMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const rearChosenList = useMemo(() => {
    const uniq = Array.from(new Set(rearIds));
    return uniq.map((gid) => rearMeta[gid] || { id: gid, name: gid, url: "" });
  }, [rearIds, rearMeta]);

  const toggleRearEpitaph = (text: string) => {
    if (!rearEnabled) return;
    const t = normEpitaph(text);
    if (!t) return;
    setRearSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, t);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return prev.concat([text]);
    });
  };
  const addRearCustom = () => {
    if (!rearEnabled) return;
    const raw = (rearCustomText || "").trim();
    const t = normEpitaph(raw);
    if (!t) return;
    setRearSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
    setRearCustomText("");
  };
  const removeRearEpitaph = (text: string) => {
    if (!rearEnabled) return;
    setRearSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
  };
  const rearEpitaphList = useMemo(() => rearSelectedEpitaphs, [rearSelectedEpitaphs]);

  const flushRearPeopleSaveNow = useCallback(() => {
    const norm = normalizePersonsForSave(rearPeople);
    saveOrderDraft({ editorBack: { people: norm.length ? norm : null } as any });
    dispatchDraftUpdated();
  }, [rearPeople]);

  useEffect(() => {
    const saveNow = () => {
      try { if (rearEnabled) flushRearPeopleSaveNow(); } catch {}
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") saveNow(); };
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
  }, [rearEnabled, flushRearPeopleSaveNow]);

  useEffect(() => {
    saveOrderDraft({ editorBack: { enabled: rearEnabled } as any });
    dispatchDraftUpdated();

    if (!rearEnabled) {
      saveOrderDraft({
        editorBack: { enabled: false, selectedGraphicsIds: null, graphicsMeta: null, epitaphTexts: null, people: null, previewUrl: null, previewHiUrl: null } as any
      });
      dispatchDraftUpdated();
      return;
    }

    const list = uniqueByNorm(rearSelectedEpitaphs);
    const normPeople = normalizePersonsForSave(rearPeople);

    saveOrderDraft({
      editorBack: {
        enabled: true,
        selectedGraphicsIds: rearIds.length ? rearIds : null,
        graphicsMeta: Object.keys(rearMeta || {}).length ? rearMeta : null,
        epitaphTexts: list.length ? list : null,
        people: normPeople.length ? normPeople : null
      } as any
    });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rearEnabled]);

  // rear preview generation (stack centered)
  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!rearEnabled) return;

      const d = loadOrderDraft();
      const eb: any = (d as any)?.editorBack || {};
      const ids: string[] = Array.isArray(eb.selectedGraphicsIds) ? eb.selectedGraphicsIds : [];
      const meta: Record<string, any> = eb.graphicsMeta || {};
      const ep: string[] = Array.isArray(eb.epitaphTexts) ? eb.epitaphTexts : [];

      // ORDER of graphics: as selectedGraphicsIds order (not uniq)
      const graphicsInOrder: string[] = ids.slice();

      // epitaphs order: as stored array order
      const epitaphsInOrder: string[] = ep.map((s) => String(s || "")).filter((s) => String(s || "").trim());

      // build stack items
      const items: StackItem[] = [];

      const p0 = rearPeopleForPreview[0];
      if (p0?.photo) items.push({ kind: "photo", url: p0.photo });

      if (p0 && (p0.lastName || p0.firstName || p0.middleName || p0.birthDate || p0.deathDate)) {
        const dates = [p0.birthDate, p0.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
        items.push({
          kind: "metrica",
          lastName: p0.lastName,
          firstName: p0.firstName,
          middleName: p0.middleName,
          dates
        });
      }

      // then graphics/text in order added: we interleave graphics and epitaph blocks as "in order of addition"
      // (you currently store graphics ids order separately and epitaphs separately; so we append graphics then epitaphs;
      // if you need true global interleaving you must store a unified timeline. For now: graphics first (in add order), then epitaphs.)
      for (const gid of graphicsInOrder) {
        const m = meta[gid] || {};
        const url = String(m.url || "").trim();
        if (url) items.push({ kind: "img", url });
      }

      for (const t of epitaphsInOrder) {
        items.push({ kind: "text", text: t });
      }

      if (items.length === 0) {
        saveOrderDraft({ editorBack: { previewUrl: null, previewHiUrl: null } as any });
        dispatchDraftUpdated();
        return;
      }

      const overlay = itemUrl ? await buildSilhouetteOverlayDataUrl({ src: itemUrl, W: PREVIEW_W, H: PREVIEW_H, mirrorX: true }) : null;

      const preview = await renderStackedCenteredPreview({
        W: PREVIEW_W,
        H: PREVIEW_H,
        bg: { type: "gradient" },
        bgFit: "cover",
        overlayPng: overlay,
        items
      });

      if (!alive) return;

      saveOrderDraft({ editorBack: { previewUrl: preview || null, previewHiUrl: null } as any });
      dispatchDraftUpdated();
    };

    const t = window.setTimeout(() => void run(), 420);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [rearEnabled, itemUrl, rearPeopleForPreview, rearIds, rearMeta, rearSelectedEpitaphs]);

  /* =========================
   * PLATE (extras)
   * ========================= */
  const [plateEnabled, setPlateEnabled] = useState<boolean>(() => !!extras0.headstonePlate);
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const initialPlateSelected = useMemo(() => {
    const d0 = loadOrderDraft();
    const ex: any = (d0 as any)?.extras || {};
    const arr: string[] | undefined = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : undefined;
    const single: string | undefined = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? ex.plateEpitaph.trim() : undefined;
    return uniqueByNorm((arr && arr.length ? arr : single ? [single] : []) as string[]);
  }, []);
  const [plateSelectedEpitaphs, setPlateSelectedEpitaphs] = useState<string[]>(initialPlateSelected);
  const [plateShowMore, setPlateShowMore] = useState(false);
  const [plateCustomText, setPlateCustomText] = useState("");
  const plateEpitaphList = useMemo(() => plateSelectedEpitaphs, [plateSelectedEpitaphs]);

  const plateCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    plateIds.forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [plateIds]);

  const addPlateGraphic = (g: any) => {
    if (!plateEnabled) return;
    const gid = String(g.id || g.relPath || g.url || g.name);
    if (!gid) return;
    const qty = plateCountsById[gid] || 0;
    if (qty >= 3) {
      window.alert("Нельзя добавить более трёх одинаковых изображений");
      return;
    }
    const nextIds = [...plateIds, gid];
    const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
    setPlateIds(nextIds);
    setPlateMeta(nextMeta);
    saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const removePlateGraphic = (gid: string) => {
    if (!plateEnabled) return;
    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = plateIds.slice();
    nextIds.splice(idx, 1);
    setPlateIds(nextIds);
    saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const chosenPlateList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta]);

  const togglePlateEpitaph = (text: string) => {
    if (!plateEnabled) return;
    const t = normEpitaph(text);
    if (!t) return;
    setPlateSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, t);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return prev.concat([text]);
    });
  };
  const addPlateCustom = () => {
    if (!plateEnabled) return;
    const raw = (plateCustomText || "").trim();
    const t = normEpitaph(raw);
    if (!t) return;
    setPlateSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
    setPlateCustomText("");
  };
  const removePlateEpitaph = (text: string) => {
    if (!plateEnabled) return;
    setPlateSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
  };

  const prevPlateEpiJsonRef = useRef<string>("");
  useEffect(() => {
    if (!plateEnabled) return;

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
    const snap = JSON.stringify(patchExtras);
    if (snap === prevPlateEpiJsonRef.current) return;
    prevPlateEpiJsonRef.current = snap;

    saveOrderDraft({ extras: patchExtras } as any);
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  }, [plateEnabled, plateSelectedEpitaphs]);

  useEffect(() => {
    saveOrderDraft({ extras: { headstonePlate: plateEnabled } as any });
    dispatchDraftUpdated();

    if (!plateEnabled) {
      saveOrderDraft({
        extras: {
          headstonePlate: false,
          plateGraphicsIds: null,
          plateGraphicsMeta: null,
          plateEpitaph: null,
          plateEpitaphs: null,
          plateEpitaphTexts: null,
          platePreviewUrl: null,
          platePreviewHiUrl: null
        } as any
      });
      dispatchDraftUpdated();
      return;
    }

    const list = uniqueByNorm(plateSelectedEpitaphs);
    const patchExtras: any = {
      headstonePlate: true,
      plateGraphicsIds: plateIds.length ? plateIds : null,
      plateGraphicsMeta: Object.keys(plateMeta || {}).length ? plateMeta : null
    };

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

    saveOrderDraft({ extras: patchExtras } as any);
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateEnabled]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!plateEnabled) return;

      const d = loadOrderDraft();
      const ex: any = (d as any)?.extras || {};
      const ids: string[] = Array.isArray(ex.plateGraphicsIds) ? ex.plateGraphicsIds : [];
      const meta: Record<string, any> = ex.plateGraphicsMeta || {};

      const arr: string[] = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : [];
      const one: string[] = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? [ex.plateEpitaph.trim()] : [];
      const epitaphsInOrder = [...one, ...arr].map((s) => String(s || "")).filter((s) => String(s || "").trim());

      const graphicsInOrder: string[] = ids.slice();

      const items: StackItem[] = [];
      for (const gid of graphicsInOrder) {
        const m = meta[gid] || {};
        const url = String(m.url || "").trim();
        if (url) items.push({ kind: "img", url });
      }
      for (const t of epitaphsInOrder) items.push({ kind: "text", text: t });

      if (items.length === 0) {
        saveOrderDraft({ extras: { platePreviewUrl: null, platePreviewHiUrl: null } as any });
        dispatchDraftUpdated();
        return;
      }

      const preview = await renderStackedCenteredPreview({
  W: PREVIEW_W,
  H: PREVIEW_H,
  bg: { type: "image", url: PLATE_BG_URL },
  bgFit: "contain", // важно для "фрейма" плиты
  overlayPng: null,
  items
});


      if (!alive) return;
      saveOrderDraft({ extras: { platePreviewUrl: preview || null, platePreviewHiUrl: null } as any });
      dispatchDraftUpdated();
    };

    const t = window.setTimeout(() => void run(), 420);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [plateEnabled, plateIds, plateMeta, plateSelectedEpitaphs]);

  const handleBack = useCallback(() => {
    try { if (rearEnabled) flushRearPeopleSaveNow(); } catch {}
    setOutro(true);
    setTimeout(() => onBack?.(), 320);
  }, [flushRearPeopleSaveNow, onBack, rearEnabled]);

  const handleContinue = useCallback(() => {
    try { if (rearEnabled) flushRearPeopleSaveNow(); } catch {}
    setOutro(true);
    setTimeout(() => onContinue?.(), 320);
  }, [flushRearPeopleSaveNow, onContinue, rearEnabled]);

  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease", maxWidth: 600, margin: "0 auto" }}>
      <TopBarWithIntro title="Тыл" />

      {/* Дополнительно */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <LoudAccordion title="Дополнительно" open={true} onToggle={() => void 0}>
          <div style={sectionBoxStyle()}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasPedestal}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHasPedestal(v);
                    saveOrderDraft({ extras: { tumba: v } as any });
                    dispatchDraftUpdated();
                    setDraft(loadOrderDraft());
                  }}
                />
                <span>Тумба</span>
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasFlowerbed}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHasFlowerbed(v);
                    saveOrderDraft({ extras: { flowerbed: v } as any });
                    dispatchDraftUpdated();
                    setDraft(loadOrderDraft());
                  }}
                />
                <span>Цветник</span>
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasVase}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setHasVase(v);
                    saveOrderDraft({ extras: { vase: v } as any });
                    dispatchDraftUpdated();
                    setDraft(loadOrderDraft());
                  }}
                />
                <span>Ваза</span>
              </label>
            </div>
          </div>
        </LoudAccordion>
      </section>

      {/* Тыльная сторона */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 12 }}>
        <SideLikePlateBlock
          title="Тыльная сторона"
          enabled={rearEnabled}
          onToggleEnabled={setRearEnabled}
          showPeople={true}
          people={rearPeople}
          setPeople={setRearPeople}
          transientPhotoUrlById={rearTransientPhotoUrlById}
          setPersonPhotoById={setRearPersonPhotoById}
          selectedEpitaphs={rearSelectedEpitaphs}
          setSelectedEpitaphs={setRearSelectedEpitaphs}
          showMore={rearShowMore}
          setShowMore={setRearShowMore}
          customText={rearCustomText}
          setCustomText={setRearCustomText}
          onToggleEpitaph={toggleRearEpitaph}
          onAddCustom={addRearCustom}
          onRemoveEpitaph={removeRearEpitaph}
          epitaphList={rearEpitaphList}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpenRear}
          setCatOpen={setCatOpenRear}
          addGraphic={addRearGraphic}
          removeGraphic={removeRearGraphic}
          ids={rearIds}
          chosenList={rearChosenList}
          onRemoveChosenItem={(gid) => removeRearGraphic(gid)}
        />
      </section>

      {/* Надгробная плита */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 12 }}>
        <SideLikePlateBlock
          title="Надгробная плита"
          enabled={plateEnabled}
          onToggleEnabled={setPlateEnabled}
          showPeople={false}
          people={[]}
          setPeople={() => void 0}
          transientPhotoUrlById={{}}
          setPersonPhotoById={() => void 0}
          selectedEpitaphs={plateSelectedEpitaphs}
          setSelectedEpitaphs={setPlateSelectedEpitaphs}
          showMore={plateShowMore}
          setShowMore={setPlateShowMore}
          customText={plateCustomText}
          setCustomText={setPlateCustomText}
          onToggleEpitaph={togglePlateEpitaph}
          onAddCustom={addPlateCustom}
          onRemoveEpitaph={removePlateEpitaph}
          epitaphList={plateEpitaphList}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpenPlate}
          setCatOpen={setCatOpenPlate}
          addGraphic={addPlateGraphic}
          removeGraphic={removePlateGraphic}
          ids={plateIds}
          chosenList={chosenPlateList}
          onRemoveChosenItem={(gid) => removePlateGraphic(gid)}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
      </div>
    </div>
  );
}
