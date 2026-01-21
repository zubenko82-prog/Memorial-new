// src/screens/BackEditorStep.tsx
// ТЫЛЬНАЯ СТОРОНА — выбор (графика/эпитафии/усопшие) + автогенерация preview тыла (editorBack.previewUrl/previewHiUrl)
// НИЖЕ — Дополнительно/Надгробная плита (как было на Review) + автогенерация preview плиты
//
// УСЛОВИЕ СКРЫТИЯ ЭСКИЗОВ НА ОБЗОРЕ:
// - если на тыле нет элементов (нет graphics и нет epitaphs) => previewUrl/previewHiUrl = null
// - если на плите нет элементов (нет graphics и нет epitaphs, или headstonePlate=false) => platePreviewUrl/platePreviewHiUrl = null
//
// ВАЖНО:
// - сохранение в draft только патчами (saveOrderDraft({ editorBack: ... }) / saveOrderDraft({ extras: ... }))
// - удаление через null (ваш обновлённый lib/order.ts это поддерживает)
// - редактора (drag/resize) НЕТ

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
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
  for (const t of list) {
    if (!hasByNorm(out, t)) out.push(t);
  }
  return out;
}

/* ========= Canvas helpers ========= */
const PLATE_BG_URL = "/images/carvings/Резные/Прямой вертикально.png";

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

function wrapLinesCanvas(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
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

async function renderStackedPreview(params: {
  W: number;
  H: number;
  bg?: { type: "gradient" } | { type: "image"; url: string };
  graphics: { url?: string; preview?: string }[];
  epitaphs: string[];
}): Promise<string | null> {
  const { W, H, bg, graphics, epitaphs } = params;
  if (W <= 0 || H <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // background
  if (!bg || bg.type === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.type === "image") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const im = await loadImageSafe(bg.url);
    if (im) {
      // contain
      const sr = im.width / im.height;
      const dr = W / H;
      let dw = W, dh = H, dx = 0, dy = 0;
      if (sr > dr) {
        dh = Math.round(W / sr);
        dy = Math.round((H - dh) / 2);
      } else {
        dw = Math.round(H * sr);
        dx = Math.round((W - dw) / 2);
      }
      ctx.drawImage(im, dx, dy, dw, dh);
    }
  }

  const items: { kind: "g" | "t"; url?: string; text?: string }[] = [];
  for (const g of graphics) items.push({ kind: "g", url: g.preview || g.url });
  for (const t of epitaphs) items.push({ kind: "t", text: t });

  if (items.length === 0) return null;

  // layout: centered column, width 35%
  const pad = Math.round(Math.min(W, H) * 0.06);
  const top = pad;
  const bottom = H - pad;
  const gap = Math.round(Math.min(W, H) * 0.02);
  const usable = Math.max(10, bottom - top);
  const blockH = Math.max(60, Math.floor((usable - gap * (items.length - 1)) / items.length));
  const totalH = items.length * blockH + gap * (items.length - 1);
  let y = Math.max(top, Math.floor((H - totalH) / 2));

  const blockW = Math.floor(W * 0.35);
  const x = Math.floor((W - blockW) / 2);

  for (const it of items) {
    const r = { x, y, w: blockW, h: blockH };

    if (it.kind === "g" && it.url) {
      const im = await loadImageSafe(it.url);
      if (im) {
        const sr = im.width / im.height;
        const dr = r.w / r.h;
        let dw = r.w, dh = r.h, dx = r.x, dy = r.y;
        if (sr > dr) {
          dh = Math.round(r.w / sr);
          dy = r.y + Math.round((r.h - dh) / 2);
        } else {
          dw = Math.round(r.h * sr);
          dx = r.x + Math.round((r.w - dw) / 2);
        }
        ctx.drawImage(im, dx, dy, dw, dh);
      }
    }

    if (it.kind === "t" && it.text) {
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fontSize = Math.max(14, Math.floor(r.h * 0.18));
      ctx.font = `${fontSize}px "Times New Roman", serif`;
      const maxW = r.w - 12;
      const lines = wrapLinesCanvas(ctx, it.text, maxW);
      const lh = Math.round(fontSize * 1.2);
      const total = lines.length * lh;
      let ty = r.y + Math.round(r.h / 2 - total / 2 + lh / 2);
      for (const line of lines) {
        ctx.fillText(line, r.x + r.w / 2, ty);
        ty += lh;
      }
      ctx.restore();
    }

    y += blockH + gap;
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

/* ========= Rear (editorBack) helpers ========= */
function normalizeRearGraphic(it: any) {
  const id = String(it?.id || it?.relPath || it?.url || it?.name || "");
  return {
    id,
    name: it?.name || id,
    url: it?.url || "",
    preview: it?.preview || it?.url || ""
  };
}

type RearPerson = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoPreview?: string | null; // dataUrl
};

function makeBlankRearPerson(id?: string): RearPerson {
  return {
    id: id ?? `p-${Date.now()}`,
    lastName: "",
    firstName: "",
    middleName: "",
    birthDate: "",
    deathDate: "",
    photoPreview: null
  };
}

async function fileToDataUrl(file: File): Promise<string> {
  const rd = new FileReader();
  return await new Promise<string>((resolve, reject) => {
    rd.onload = () => resolve(String(rd.result || ""));
    rd.onerror = () => reject(new Error("read error"));
    rd.readAsDataURL(file);
  });
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

/* ========= PlateBlock ========= */
function PlateBlock(props: {
  extraPlate: boolean;
  setExtraPlate: (v: boolean) => void;

  plateSize: string;
  setPlateSize: (v: string) => void;
  plateCustomSize: string;
  setPlateCustomSize: (v: string) => void;
}) {
  // временная заглушка, чтобы файл компилировался.
  // ВАЖНО: дальше нужно вернуть полный PlateBlock (тело функции и остальные поля props),
  // потому что сейчас ваш файл ОБРЕЗАН и заканчивается посреди объявления.
  return null as any;
}
