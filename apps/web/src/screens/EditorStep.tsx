// src/screens/EditorStep.tsx
// Редактор элементов с надёжной инициализацией, построением эскиза по тем же правилам,
// что и в SketchTemplate (стабильная сетка), а поверх — редактор (рамки, dnd/resize, мини‑панели).
//
// Что сделано:
// - Портреты строго 3:4, устойчивые колонки/строки при 2+ людях (не «узкие/высокие»).
// - Эпитафии: один элемент может быть многострочным (whiteSpace: pre-wrap).
//   Текст автоматически подгоняется по ширине/высоте фрейма (учитываем внутренние отступы) — не вываливается.
// - Метрика: авто‑подгон по ширине и высоте фрейма (без «ухода» под рамку).
// - Превью (canvas) использует тот же алгоритм подгона, что и DOM.
// - Анти‑оверлап фреймов, Alt+клик для выбора нижнего элемента, DnD/resize, автосейв.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft, type OrderDraft } from "../lib/order";

/* ===== UI ===== */
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm") {
  const pad = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: pad[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)"
  } as React.CSSProperties;
}
function bottomUnderlayGradient(): React.CSSProperties {
  return {
    backgroundColor: "#000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  };
}

/* ===== Types ===== */
type Orientation = "vertical" | "horizontal";
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты от контентной области
  z: number;
  title?: string;
  locked?: boolean;
  uppercase?: boolean; // metric/epitaph
  italic?: boolean;    // metric/epitaph
  flipH?: boolean;     // graphic
  bw?: boolean;        // portrait
  staircase?: boolean; // «Помним, любим, скорбим…» — лесенка
};

/* ===== Helpers ===== */
function isCrossCategoryName(s?: string) {
  const v = (s || "").toLowerCase();
  return v.includes("крест") || v.includes("cross") || v.includes("crosses");
}
function linesFromPerson(p: any) {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
const SKETCH_PAD = 8; // синхронизирован со SketchTemplate
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 3, 100),
  h: clamp(h, 3, 100)
});
const snap = (v: number, step = 1) => Math.round(v / step) * step;

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

const normRemember = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim();
const isRememberLoveMourn = (t?: string) => normRemember(t) === "помним любим скорбим";
function splitRememberPreserve(text: string) {
  const t = (text || "").trim();
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    buf += ch;
    if (ch === ",") {
      parts.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  const top = parts[0] || "Помним,";
  const mid = parts[1] || "любим,";
  const bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим...").trim();
  return { top, mid, bot };
}

/* ===== Вспомогатели подбора шрифта (fit) ===== */
let __measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (__measureCtx) return __measureCtx;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  __measureCtx = ctx!;
  return __measureCtx!;
}
function setFontOnCtx(ctx: CanvasRenderingContext2D, italic: boolean, px: number, family: string) {
  ctx.font = `${italic ? "italic " : ""}${Math.max(1, Math.round(px))}px ${family}`;
}
function measureTextAt(ctx: CanvasRenderingContext2D, text: string, italic: boolean, family: string, sizePx: number): number {
  setFontOnCtx(ctx, italic, sizePx, family);
  return ctx.measureText(text).width;
}
function fitMultilineFontPx({
  text,
  boxW,
  boxH,
  italic,
  family,
  padX = 4,
  padY = 2,
  lineHeight = 1.15,
  minPx = 10,
  maxPx = 96
}: {
  text: string;
  boxW: number;
  boxH: number;
  italic: boolean;
  family: string;
  padX?: number;
  padY?: number;
  lineHeight?: number;
  minPx?: number;
  maxPx?: number;
}): { fontPx: number; lines: string[] } {
  const ctx = getMeasureCtx();
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const count = Math.max(1, lines.length);
  const usableW = Math.max(8, boxW - padX * 2);
  const usableH = Math.max(8, boxH - padY * 2);
  // ограничитель по высоте
  const fByH = usableH / (count * lineHeight);
  // ограничитель по ширине
  let fByW = maxPx;
  for (const ln of lines.length ? lines : [" "]) {
    const w100 = Math.max(1, measureTextAt(ctx, ln, italic, family, 100));
    const fLine = (usableW * 100) / w100;
    fByW = Math.min(fByW, fLine);
  }
  const fontPx = clamp(Math.floor(Math.min(fByH, fByW, maxPx)), minPx, maxPx);
  return { fontPx, lines: lines.length ? lines : [""] };
}
function fitMetricFontsPx({
  lines,
  boxW,
  boxH,
  italic,
  family,
  padX = 4,
  padY = 2,
  lineHeight = 1.12,
  minPx = 10,
  weights = [0.36, 0.30, 0.26]
}: {
  lines: string[];
  boxW: number;
  boxH: number;
  italic: boolean;
  family: string;
  padX?: number;
  padY?: number;
  lineHeight?: number;
  minPx?: number;
  weights?: number[];
}): number[] {
  const ctx = getMeasureCtx();
  const L = Math.min(3, lines.length);
  if (L === 0) return [];
  const usableW = Math.max(8, boxW - padX * 2);
  const usableH = Math.max(8, boxH - padY * 2);
  const wSum = weights.slice(0, L).reduce((a, b) => a + b, 0);
  const baseByH = usableH / (lineHeight * wSum);
  const initial = Array.from({ length: L }, (_, i) => baseByH * weights[i]);
  let sW = 1;
  for (let i = 0; i < L; i++) {
    const ln = lines[i] || "";
    if (!ln) continue;
    const w100 = Math.max(1, measureTextAt(ctx, ln, italic, family, 100));
    const maxFi = (usableW * 100) / w100;
    sW = Math.min(sW, maxFi / initial[i]);
  }
  return initial.map((sz) => Math.max(minPx, Math.floor(sz * sW)));
}

/* ===== Версионирование раскладки ===== */
const LAYOUT_VERSION = "2025-01-EditorStep-v15";

/* ===== Сигнатуры контента ===== */
function peopleSignature(engr: any): string {
  if (Array.isArray(engr?.persons) && engr.persons.length) {
    return engr.persons
      .map((p: any, i: number) => {
        const id = p.id || `person-${i}`;
        const lines = linesFromPerson(p).join("|");
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || "";
        return `${id}::${lines}::${photo ? "1" : "0"}`;
      })
      .join("||");
  }
  const legacy: string[] = [];
  if (engr?.fullName) legacy.push(String(engr.fullName));
  if (engr?.birthDate || engr?.deathDate) legacy.push([engr?.birthDate || "", engr?.deathDate || ""].join("—"));
  if (Array.isArray(engr?.lines)) legacy.push(...(engr.lines as string[]).filter(Boolean));
  const photo = engr?.photoPreview || engr?.photoDataUrl || engr?.photoUrl || engr?.photo || "";
  return `legacy::${legacy.join("|")}::${photo ? "1" : "0"}`;
}
function graphicsSignature(items: any[]): string {
  return items.map((g, i) => `${i}:${g.id || g.url || g.name || ""}:${g.catSlug || g.catName || ""}`).join("|");
}

/* =========================================================================================
   computeSketchLayout — устойчивые шаблоны (как в SketchTemplate): портреты 3:4,
   устойчивые колонки/строки, эпитафии над графикой.
   ========================================================================================= */
function computeSketchLayout({
  stageW, stageH,
  orientation,
  people,
  crosses,
  graphics,
  epitaphs
}: {
  stageW: number; stageH: number;
  orientation: Orientation;
  people: Array<{ id: string; lines: string[]; photo?: string | null }>;
  crosses: Array<any>;
  graphics: Array<any>;
  epitaphs: string[];
}): Map<string, { x: number; y: number; w: number; h: number }> {
  const toPct = (px: number, total: number) => (total > 0 ? (px / total) * 100 : 0);
  const toBox = (leftPx: number, topPx: number, wPx: number, hPx: number) => ({
    x: Math.max(0, toPct(leftPx, stageW)),
    y: Math.max(0, toPct(topPx, stageH)),
    w: Math.max(1, toPct(wPx, stageW)),
    h: Math.max(1, toPct(hPx, stageH))
  });

  function capPortrait3x4FromWidth(pwInit: number, maxH: number) {
    let pw = pwInit;
    let ph = Math.round(pw * (4 / 3));
    if (ph > maxH) {
      ph = Math.max(1, Math.round(maxH));
      pw = Math.max(1, Math.round(ph * (3 / 4)));
    }
    return { pw, ph };
  }

  const m = new Map<string, { x: number; y: number; w: number; h: number }>();
  const n = people.length;
  const tplKey: "one" | "two" | "many" = n <= 1 ? "one" : n === 2 ? "two" : "many";

  const gapY = Math.round(0.012 * stageH);
  const gapSmall = Math.round(0.006 * stageH);
  const rowGapX = Math.round(0.010 * stageW);
  const top6 = Math.round(0.06 * stageH);
  const bottomPad = Math.max(8, Math.round(0.02 * stageH));

  const contentWidth = stageW - SKETCH_PAD * 2;
  const crossWpx = Math.round(stageW * (orientation === "vertical" ? 0.16 : 0.10));
  const crossHpx = crossWpx;

  const placeEpitaphsStack = (left: number, top: number, width: number, totalHeight: number) => {
    const count = Math.max(0, epitaphs.length);
    const Htot = Math.max(0, Math.floor(totalHeight));
    if (count === 0 || Htot <= 0) return;
    const gaps = Math.max(0, count - 1) * gapSmall;
    const per = Math.max(10, Math.floor((Htot - gaps) / Math.max(1, count)));
    let y = top;
    epitaphs.forEach((_, i) => {
      m.set(`epitaph-${i}`, toBox(left, y, width, per));
      y += per + gapSmall;
    });
  };
  const placeGraphicsRow = (left: number, top: number, width: number, height: number) => {
    const count = Math.max(0, graphics.length);
    const H = Math.max(0, height);
    if (count === 0 || H <= 0 || width <= 0) return;
    const totalGaps = Math.max(0, count - 1) * rowGapX;
    const perW = Math.max(14, Math.floor((width - totalGaps) / count));
    for (let i = 0; i < count; i++) {
      const x = left + i * (perW + rowGapX);
      m.set(`graphic-${i}`, toBox(x, top, perW, H));
    }
  };

  const desiredGfxH = orientation === "vertical" ? Math.round(0.12 * stageH) : Math.round(0.16 * stageH);
  const minEpTotal = Math.max(22, Math.round(0.06 * stageH));
  const gfxBandLeft = Math.round((stageW - Math.round(contentWidth * 0.92)) / 2);
  const gfxBandWidth = Math.round(contentWidth * 0.92);

  if (orientation === "horizontal" && tplKey === "one") {
    const pwInit = Math.round(contentWidth * 0.34);
    const maxPortraitH = Math.round(0.30 * stageH);
    const { pw, ph } = capPortrait3x4FromWidth(pwInit, maxPortraitH);
    const px = Math.round((stageW - pw) / 2);
    const py = top6;

    const mw = Math.round(contentWidth * 0.60);
    const mh = Math.max(18, Math.round(0.11 * stageH));

    let epTop = py + ph + gapY + mh + gapY;
    let gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
    let gfxTop = stageH - bottomPad - gfxH;
    let epTotal = gfxTop - gapY - epTop;
    if (epTotal < minEpTotal) {
      const takeG = Math.min(minEpTotal - epTotal, gfxH);
      gfxH -= takeG;
      gfxTop = stageH - bottomPad - gfxH;
      epTotal = gfxTop - gapY - epTop;
    }

    m.set(`portrait-${people[0]?.id || "p0"}`, toBox(px, py, pw, ph));
    m.set(`metric-${people[0]?.id || "p0"}`, toBox(Math.round((stageW - mw) / 2), py + ph + gapY, mw, mh));
    placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.86)) / 2), epTop, Math.round(contentWidth * 0.86), epTotal);
    placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);
    if (crosses[0]) m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx));
    if (crosses[1]) m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx));
  } else if (orientation === "horizontal" && tplKey === "two") {
    const gapCols = Math.round(0.010 * stageW);
    const colW = Math.min(320, Math.max(160, Math.floor((contentWidth - gapCols) / 2)));
    const totalW = colW * 2 + gapCols;
    const leftStart = Math.round((stageW - totalW) / 2);
    const top = Math.round(0.08 * stageH);
    const maxPortraitH = Math.round(0.34 * stageH);

    people.slice(0, 2).forEach((p, idx) => {
      const colLeft = leftStart + idx * (colW + gapCols);
      const ph = Math.min(Math.round(colW / 0.75), maxPortraitH);
      const pw = Math.round(ph * 0.75);
      const px = colLeft + Math.round((colW - pw) / 2);
      const py = top;
      m.set(`portrait-${p.id}`, toBox(px, py, pw, ph));

      const mw = Math.round(colW * 0.90);
      const mh = Math.max(18, Math.round(0.10 * stageH));
      const mx = colLeft + Math.round((colW - mw) / 2);
      const my = py + ph + Math.round(0.01 * stageH);
      m.set(`metric-${p.id}`, toBox(mx, my, mw, mh));
    });

    const metricsBottom = people.slice(0, 2).reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`); if (!b) return acc;
      const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
      return Math.max(acc, my + mh);
    }, 0);

    const epTop = metricsBottom + gapY;
    const gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
    const gfxTop = stageH - bottomPad - gfxH;
    placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.90)) / 2), epTop, Math.round(contentWidth * 0.90), Math.max(0, gfxTop - gapY - epTop));
    placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);
    if (crosses.length === 1) m.set("cross-0", toBox(Math.round((stageW - crossWpx) / 2), Math.round(0.06 * stageH), crossWpx, crossHpx));
    if (crosses.length >= 2) {
      m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx));
      m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx));
    }
  } else if (orientation === "horizontal" && tplKey === "many") {
    const cols = Math.min(4, Math.max(3, people.length));
    const colGap = Math.round(0.010 * stageW);
    const colW = Math.min(260, Math.max(150, Math.floor((contentWidth - (cols - 1) * colGap) / cols)));
    const totalW = colW * cols + (cols - 1) * colGap;
    const leftStart = Math.round((stageW - totalW) / 2);
    const top = Math.round(0.08 * stageH);
    const maxPortraitH = Math.round(0.30 * stageH);

    people.forEach((p, i) => {
      const colLeft = leftStart + i * (colW + colGap);
      const ph = Math.min(Math.round(colW / 0.75), maxPortraitH);
      const pw = Math.round(ph * 0.75);
      const px = colLeft + Math.round((colW - pw) / 2);
      const py = top;
      m.set(`portrait-${p.id}`, toBox(px, py, pw, ph));

      const mw = Math.round(colW * 0.88);
      const mh = Math.max(16, Math.round(0.10 * stageH));
      const mx = colLeft + Math.round((colW - mw) / 2);
      const my = py + ph + Math.round(0.008 * stageH);
      m.set(`metric-${p.id}`, toBox(mx, my, mw, mh));
    });

    const metricsBottom = people.reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`); if (!b) return acc;
      const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
      return Math.max(acc, my + mh);
    }, 0);

    const epTop = metricsBottom + gapY;
    const gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
    const gfxTop = stageH - bottomPad - gfxH;
    placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.92)) / 2), epTop, Math.round(contentWidth * 0.92), Math.max(0, gfxTop - gapY - epTop));
    placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);
    if (crosses[0]) m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx));
    if (crosses[1]) m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx));
  } else {
    // Вертикальные
    const topPortrait = Math.round(0.12 * stageH);

    if (tplKey === "one" && people[0]) {
      const pwInit = Math.round(contentWidth * 0.42);
      const maxPortraitH = Math.round(0.36 * stageH);
      const { pw, ph } = capPortrait3x4FromWidth(pwInit, maxPortraitH);
      const px = Math.round((stageW - pw) / 2);

      const mw = Math.round(contentWidth * 0.66);
      const mh = Math.max(22, Math.round(0.12 * stageH));
      const mx = Math.round((stageW - mw) / 2);
      const metricY = topPortrait + ph + Math.round(0.008 * stageH);

      const epTop = metricY + mh + gapY;
      const gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
      const gfxTop = stageH - bottomPad - gfxH;

      m.set(`portrait-${people[0].id}`, toBox(px, topPortrait, pw, ph));
      m.set(`metric-${people[0].id}`, toBox(mx, metricY, mw, mh));
      placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.86)) / 2), epTop, Math.round(contentWidth * 0.86), Math.max(0, gfxTop - gapY - epTop));
      placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);
      if (crosses[0]) m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.04 * stageH), crossWpx, crossHpx));
      if (crosses[1]) m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.04 * stageH), crossWpx, crossHpx));
    } else {
      // 2+ людей: строки
      const rows = tplKey === "two" ? 2 : n;
      const rowGapV = Math.round(0.01 * stageH);
      const gridTop = topPortrait;
      const rowH = Math.max(40, Math.floor((stageH - gridTop - bottomPad - (rows - 1) * rowGapV) / rows));

      people.forEach((p, i) => {
        const ry = gridTop + i * (rowH + rowGapV);
        const ph = Math.min(Math.round(rowH * 0.86), Math.round(0.34 * stageH));
        const pw = Math.round(ph * 0.75);
        const leftZoneW = Math.round(stageW * 0.46);
        const px = Math.round((leftZoneW - pw) / 2);
        const py = ry + Math.round((rowH - ph) / 2);
        m.set(`portrait-${p.id}`, toBox(px, py, pw, ph));

        const rightZoneX = Math.round(stageW * 0.50);
        const rightZoneW = Math.round(stageW * 0.46);
        const mw = Math.min(rightZoneW, Math.round(contentWidth * 0.46));
        const mh = Math.max(16, Math.round((tplKey === "two" ? 0.11 : 0.12) * stageH));
        const mx = rightZoneX + Math.round((rightZoneW - mw) / 2);
        const my = ry + Math.round((rowH - mh) / 2);
        m.set(`metric-${p.id}`, toBox(mx, my, mw, mh));
      });

      const metricsBottom = people.reduce((acc, p) => {
        const b = m.get(`metric-${p.id}`); if (!b) return acc;
        const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
        return Math.max(acc, my + mh);
      }, 0);

      const epTop = Math.round(metricsBottom + gapY);
      const gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
      const gfxTop = stageH - bottomPad - gfxH;
      placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.92)) / 2), epTop, Math.round(contentWidth * 0.92), Math.max(0, gfxTop - gapY - epTop));
      placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);
      if (crosses[0]) m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.04 * stageH), crossWpx, crossHpx));
      if (crosses[1]) m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.04 * stageH), crossWpx, crossHpx));
    }
  }

  // Анти‑оверлап фреймов
  const spacingPx = Math.round(0.006 * stageH);
  const priority = (id: string) =>
    id.startsWith("portrait") ? 0 :
    id.startsWith("metric") ? 1 :
    id.startsWith("epitaph") ? 2 :
    id.startsWith("graphic") ? 3 :
    id.startsWith("cross") ? 4 : 5;

  type PxBox = { id: string; x: number; y: number; w: number; h: number };
  const boxesPx: PxBox[] = Array.from(m.entries()).map(([id, b]) => ({
    id,
    x: (b.x / 100) * stageW,
    y: (b.y / 100) * stageH,
    w: (b.w / 100) * stageW,
    h: (b.h / 100) * stageH
  }));
  boxesPx.sort((a, b) => {
    const pr = priority(a.id) - priority(b.id);
    if (pr !== 0) return pr;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  const intersects = (a: PxBox, b: PxBox) =>
    !(a.x >= b.x + b.w + spacingPx ||
      a.x + a.w + spacingPx <= b.x ||
      a.y >= b.y + b.h + spacingPx ||
      a.y + a.h + spacingPx <= b.y);

  for (let i = 0; i < boxesPx.length; i++) {
    const cur = boxesPx[i];
    for (let j = 0; j < i; j++) {
      const prev = boxesPx[j];
      if (!intersects(cur, prev)) continue;

      const newY = prev.y + prev.h + spacingPx;
      if (newY + cur.h <= stageH - spacingPx) {
        cur.y = newY;
        continue;
      }
      const newX = prev.x + prev.w + spacingPx;
      if (newX + cur.w <= stageW - spacingPx) {
        cur.x = newX;
        continue;
      }
      const maxH = Math.max(8, stageH - spacingPx - newY);
      if (maxH < cur.h) {
        cur.y = Math.min(newY, stageH - spacingPx);
        cur.h = maxH;
      }
    }
    cur.x = Math.max(0, Math.min(cur.x, stageW - cur.w));
    cur.y = Math.max(0, Math.min(cur.y, stageH - cur.h));
  }

  for (const b of boxesPx) {
    m.set(b.id, {
      x: clamp((b.x / stageW) * 100, 0, 100),
      y: clamp((b.y / stageH) * 100, 0, 100),
      w: clamp((b.w / stageW) * 100, 1, 100),
      h: clamp((b.h / stageH) * 100, 1, 100)
    });
  }

  return m;
}

/* ===== Компонент редактора ===== */
type Props = {
  onBack?: () => void;
  onContinue?: (payload?: any) => void;
  onRearSide?: (payload?: any) => void;
  onSendOrder?: (payload?: any) => void;
};

export default function EditorStep({ onBack, onContinue, onRearSide, onSendOrder }: Props) {
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  const [outro, setOutro] = useState(false);

  const [elements, setElements] = useState<EditorEl[]>(
    () => (draft as any)?.editor?.elements || []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wishes, setWishes] = useState<string>(() => (draft as any)?.editor?.wishes || "");

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const wishesTimerRef = useRef<number | null>(null);

  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(
    () => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined),
    [imgWH]
  );

  // Защита от «петель»
  const isSavingRef = useRef(false);
  const touchSaving = (ms = 350) => {
    isSavingRef.current = true;
    window.setTimeout(() => (isSavingRef.current = false), ms);
  };
  const saveEditor = (updater: (prev: OrderDraft) => OrderDraft) => {
    const prev = loadOrderDraft();
    const next = updater(prev);
    const prevJson = JSON.stringify(prev.editor || {});
    const nextJson = JSON.stringify(next.editor || {});
    if (prevJson === nextJson) return;
    touchSaving();
    saveOrderDraft(next);
  };

  // Live reload драфта
  const lastDraftSigRef = useRef<string>("");
  useEffect(() => {
    const makeSig = (d: OrderDraft): string =>
      JSON.stringify({
        item: d?.item?.url || "",
        engraving: d?.engraving || null,
        graphics: Array.isArray(d?.graphics) ? d.graphics : [],
        editor: { elements: d?.editor?.elements || [], wishes: d?.editor?.wishes || "" }
      });

    lastDraftSigRef.current = makeSig(draft);

    const reload = () => {
      if (isSavingRef.current) return;
      const next = loadOrderDraft();
      const sig = makeSig(next);
      if (lastDraftSigRef.current === sig) return;
      lastDraftSigRef.current = sig;
      setDraft(next);
    };

    window.addEventListener("focus", reload);
    window.addEventListener("storage", reload);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reload());
    window.addEventListener("draft:updated" as any, reload);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", reload);
      document.removeEventListener("visibilitychange", () => {});
      window.removeEventListener("draft:updated" as any, reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Источники
  const item = draft?.item || null;
  const engr: any = draft?.engraving || {};
  const graphics: any[] = Array.isArray(draft?.graphics) ? (draft.graphics as any[]) : [];

  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engr?.persons) && engr.persons.length > 0) {
      return engr.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
    // legacy
    const legacyLines: string[] = [];
    if (engr?.fullName) legacyLines.push(String(engr.fullName));
    const dates: string[] = [];
    if (engr?.birthDate) dates.push(String(engr.birthDate));
    if (engr?.deathDate) dates.push(String(engr.deathDate));
    if (dates.length) legacyLines.push(dates.join(" — "));
    if (Array.isArray(engr?.lines)) legacyLines.push(...(engr.lines as string[]).filter(Boolean));
    const photo = engr?.photoPreview || engr?.photoDataUrl || engr?.photoUrl || engr?.photo || null;
    return legacyLines.length || photo ? [{ id: "legacy-0", lines: legacyLines, photo }] : [];
  }, [engr]);

  // Эпитафии: одна многострочная = один элемент
  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) {
      return (engr.epitaphs as string[]).filter(Boolean);
    }
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim()) {
      return [engr.epitaphText.trim()];
    }
    return [];
  }, [engr]);

  const crosses = useMemo(
    () => graphics.filter((g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)),
    [graphics]
  );
  const others = useMemo(
    () => graphics.filter((g) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)),
    [graphics]
  );

  /* ===== DnD/Resize ===== */
  const dragRef = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number;
    start: EditorEl;
  } | null>(null);

  function contentRect() {
    const host = wrapperRef.current?.getBoundingClientRect();
    if (!host) return null;
    return {
      x: host.left + SKETCH_PAD,
      y: host.top + SKETCH_PAD,
      w: Math.max(1, host.width - SKETCH_PAD * 2),
      h: Math.max(1, host.height - SKETCH_PAD * 2)
    };
  }

  const onPointerDownBox = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move"
  ) => {
    e.stopPropagation();
    if (e.altKey && wrapperRef.current) {
      const hitId = pickElementUnderPointer(e.clientX, e.clientY, id);
      if (hitId) setSelectedId(hitId);
      return;
    }
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const rect = contentRect();
    if (!rect) return;

    const dxPct = ((e.clientX - d.startX) / rect.w) * 100;
    const dyPct = ((e.clientY - d.startY) / rect.h) * 100;
    const withSnap = !e.altKey;
    const snapStep = e.shiftKey ? 1.5 : 1;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        let { x, y, w, h } = d.start;

        if (d.mode === "move") {
          let nx = x + dxPct;
          let ny = y + dyPct;
          if (withSnap) {
            nx = snap(nx, snapStep);
            ny = snap(ny, snapStep);
          }
          return { ...el, ...clampBox(nx, ny, w, h) };
        }

        const keepRatio = e.shiftKey;
        let nx = x, ny = y, nw = w, nh = h;
        const startRatio = w / h || 1;

        if (d.mode.includes("e")) nw = w + dxPct;
        if (d.mode.includes("s")) nh = h + dyPct;
        if (d.mode.includes("w")) { nx = x + dxPct; nw = w - dxPct; }
        if (d.mode.includes("n")) { ny = y + dyPct; nh = h - dyPct; }

        if (keepRatio) {
          if (["e", "w"].some((k) => d.mode.includes(k))) nh = nw / startRatio;
          if (["n", "s"].some((k) => d.mode.includes(k))) nw = nh * startRatio;
        }

        if (withSnap) {
          nx = snap(nx, snapStep);
          ny = snap(ny, snapStep);
          nw = snap(nw, snapStep);
          nh = snap(nh, snapStep);
        }

        return { ...el, ...clampBox(nx, ny, nw, nh) };
      })
    );
  };
  const onPointerUp = () => { dragRef.current = null; };

  function pickElementUnderPointer(clientX: number, clientY: number, currentTopId?: string | null): string | null {
    const rect = contentRect();
    if (!rect) return null;
    const px = clientX - rect.x;
    const py = clientY - rect.y;
    const list = elements
      .slice()
      .sort((a, b) => b.z - a.z)
      .filter((el) => {
        const ex = (el.x / 100) * rect.w;
        const ey = (el.y / 100) * rect.h;
        const ew = (el.w / 100) * rect.w;
        const eh = (el.h / 100) * rect.h;
        return px >= ex && px <= ex + ew && py >= ey && py <= ey + eh;
      })
      .map((el) => el.id);

    if (list.length === 0) return null;
    if (!currentTopId || !list.includes(currentTopId)) return list[0];
    const idx = list.indexOf(currentTopId);
    return list[(idx + 1) % list.length];
  }

  /* ===== Автосохранение ===== */
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveEditor((prev) => ({
        ...prev,
        editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
      } as OrderDraft));
    }, 240) as unknown as number;
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [elements, wishes]);

  useEffect(() => {
    if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current);
    wishesTimerRef.current = window.setTimeout(() => {
      saveEditor((prev) => {
        if (prev.editor?.wishes === wishes) return prev;
        return { ...prev, editor: { ...(prev.editor || {}), wishes, updatedAt: Date.now() } } as OrderDraft;
      });
    }, 320) as unknown as number;
    return () => { if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current); };
  }, [wishes]);

  /* ===== Инициализация (складки) ===== */
  const [layoutAppliedHash, setLayoutAppliedHash] = useState<string | null>(
    () => (draft as any)?.editor?.sketchInitHash || null
  );

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;

    const orientation: Orientation =
      (draft.size?.orientation as Orientation | undefined) ??
      ((draft as any).orientation as Orientation | undefined) ??
      (imgWH.w > imgWH.h ? "horizontal" : "vertical");

    const contentHash = [
      LAYOUT_VERSION,
      item?.url || "",
      orientation,
      peopleSignature(engr),
      epitaphs.join("||"),
      graphicsSignature(crosses),
      graphicsSignature(others)
    ].join("::");

    if (layoutAppliedHash === contentHash) return;

    const hostRect = host.getBoundingClientRect();
    const stageW = Math.max(1, Math.floor(hostRect.width - SKETCH_PAD * 2));
    const stageH = Math.max(1, Math.floor(hostRect.height - SKETCH_PAD * 2));
    if (stageW < 10 || stageH < 10) return;

    const layout = computeSketchLayout({
      stageW, stageH, orientation,
      people: peopleBlocks,
      crosses, graphics: others, epitaphs
    });
    if (layout.size === 0) return;

    const ensureMin = (b: { x: number; y: number; w: number; h: number }, minW = 3, minH = 3) => ({
      ...b, w: Math.max(b.w, minW), h: Math.max(b.h, minH)
    });

    setElements((prev) => {
      const prevMap = new Map(prev.map((e) => [e.id, e]));
      const used = new Set<string>();
      const next: EditorEl[] = [];

      // Люди
      peopleBlocks.forEach((p, i) => {
        const pid = `portrait-${p.id}`;
        const mid = `metric-${p.id}`;
        const pb = layout.get(pid);
        const mb = layout.get(mid);
        if (pb) {
          const safe = ensureMin(pb, 6, 8);
          const old = prevMap.get(pid);
          next.push(old ? { ...old, ...safe } : { id: pid, type: "portrait", ...safe, z: i * 10 + 1, title: pid, bw: true });
          used.add(pid);
        }
        if (mb) {
          const safe = ensureMin(mb, 12, 10);
          const old = prevMap.get(mid);
          next.push(old ? { ...old, ...safe } : { id: mid, type: "metric", ...safe, z: i * 10 + 2, title: mid, uppercase: true });
          used.add(mid);
        }
      });

      // Эпитафии
      epitaphs.forEach((_, idx) => {
        const id = `epitaph-${idx}`;
        const b = layout.get(id);
        if (!b) return;
        const safe = ensureMin(b, 12, 8);
        const old = prevMap.get(id);
        next.push(
          old
            ? { ...old, ...safe, staircase: old.staircase ?? false }
            : { id, type: "epitaph", ...safe, z: 100 + idx, title: id, staircase: false }
        );
        used.add(id);
      });

      // Кресты
      crosses.forEach((_, idx) => {
        const id = `cross-${idx}`;
        const b = layout.get(id);
        if (!b) return;
        const safe = ensureMin(b, 8, 8);
        const old = prevMap.get(id);
        next.push(old ? { ...old, ...safe } : { id, type: "cross", ...safe, z: 200 + idx, title: id });
        used.add(id);
      });

      // Графика — внизу
      others.forEach((_, idx) => {
        const id = `graphic-${idx}`;
        const b = layout.get(id);
        if (!b) return;
        const safe = ensureMin(b, 12, 12);
        const old = prevMap.get(id);
        next.push(old ? { ...old, ...safe } : { id, type: "graphic", ...safe, z: 300 + idx, title: id, flipH: false });
        used.add(id);
      });

      // Остальные переносим
      prev.forEach((el) => { if (!used.has(el.id)) next.push(el); });

      return next;
    });

    setLayoutAppliedHash(contentHash);
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), sketchInitHash: contentHash, layoutVersion: LAYOUT_VERSION, updatedAt: Date.now() }
    } as OrderDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.url, engr, crosses, others, epitaphs, draft?.size?.orientation, imgWH]);

  /* ===== Превью (canvas) ===== */
  const renderPreview = async (W: number, H: number): Promise<string | null> => {
    if (W <= 0 || H <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const pad = SKETCH_PAD;
    const CX = pad, CY = pad, CW = W - pad * 2, CH = H - pad * 2;

    const base = await loadImageSafe(item?.url);
    if (base) {
      const sr = base.width / base.height, dr = CW / CH;
      ctx.globalAlpha = 0.35;
      if (sr > dr) {
        const rw = CW, rh = Math.round(CW / sr), rx = CX, ry = CY + Math.round((CH - rh) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      } else {
        const rh = CH, rw = Math.round(CH * sr), ry = CY, rx = CX + Math.round((CW - rw) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      }
      ctx.globalAlpha = 1;
    }

    const fontFamily = `"Century Schoolbook","Times New Roman",serif`;
    const els = elements.slice().sort((a, b) => a.z - b.z);

    for (const el of els) {
      const r = { x: CX + (el.x / 100) * CW, y: CY + (el.y / 100) * CH, w: (el.w / 100) * CW, h: (el.h / 100) * CH };
      const key = el.id.split("-").slice(1).join("-");

      if (el.type === "portrait") {
        const p = peopleBlocks.find((pp) => pp.id === key);
        if (!p?.photo) continue;
        const im = await loadImageSafe(p.photo);
        if (!im) continue;
        const sr2 = im.width / im.height, dr2 = r.w / r.h;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.filter = el.bw ? "grayscale(100%)" : "none";
        if (sr2 > dr2) {
          const hh = r.h, ww = Math.round(hh * sr2), xx = Math.round(r.x + (r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const ww = r.w, hh = Math.round(ww / sr2), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
        ctx.filter = "none";
      } else if (el.type === "graphic") {
        const idx = Number(key);
        const g = Number.isFinite(idx) ? others[idx] : undefined;
        if (!g?.url) continue;
        const im = await loadImageSafe(g.url);
        if (!im) continue;
        ctx.save();
        if (el.flipH) {
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
          ctx.scale(-1, 1);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
        const sr2 = im.width / im.height, dr2 = r.w / r.h;
        if (sr2 > dr2) {
          const ww = r.w, hh = Math.round(ww / sr2), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const hh = r.h, ww = Math.round(hh * sr2), xx = r.x + Math.round((r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
      } else if (el.type === "cross") {
        const idx = Number(key);
        const c = Number.isFinite(idx) ? crosses[idx] : undefined;
        if (!c?.url) continue;
        const im = await loadImageSafe(c.url);
        if (!im) continue;
        const sr2 = im.width / im.height, dr2 = r.w / r.h;
        if (sr2 > dr2) {
          const ww = r.w, hh = Math.round(ww / sr2), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const hh = r.h, ww = Math.round(hh * sr2), xx = r.x + Math.round((r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        }
      } else if (el.type === "metric") {
        const p = peopleBlocks.find((pp) => pp.id === key);
        const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
        const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const padX = Math.max(4, Math.round(r.w * 0.04));
        const padY = Math.max(2, Math.round(r.h * 0.10));
        const fam = fontFamily;
        const fitted = fitMetricFontsPx({
          lines: lines.map(tf),
          boxW: r.w,
          boxH: r.h,
          italic: !!el.italic,
          family: fam,
          padX,
          padY,
          lineHeight: 1.12,
          minPx: 10
        });

        const totalH = fitted.reduce((a, b) => a + b * 1.12, 0);
        let y = r.y + (r.h - totalH) / 2 + (fitted[0] || 10) * 1.12 / 2;
        for (let i = 0; i < fitted.length; i++) {
          setFontOnCtx(ctx, !!el.italic, fitted[i], fam);
          ctx.fillText(tf(lines[i]), r.x + r.w / 2, y);
          y += fitted[i] * 1.12;
        }
        ctx.restore();
      } else if (el.type === "epitaph") {
        const idx = Number(key);
        const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
        const text = el.uppercase ? tRaw.toUpperCase() : tRaw;

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const fam = fontFamily;

        if (el.staircase && isRememberLoveMourn(text)) {
          const { top, mid, bot } = splitRememberPreserve(text);
          const padX = Math.max(4, Math.round(r.w * 0.04));
          const padY = Math.max(2, Math.round(r.h * 0.06));
          const all = `${top}\n${mid}\n${bot}`;
          const { fontPx } = fitMultilineFontPx({
            text: all,
            boxW: r.w,
            boxH: r.h,
            italic: !!el.italic,
            family: fam,
            padX,
            padY,
            lineHeight: 1.15
          });
          setFontOnCtx(ctx, !!el.italic, fontPx, fam);
          ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(top, r.x + padX, r.y + padY);
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(mid, r.x + r.w / 2, r.y + r.h / 2);
          ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(bot, r.x + r.w - padX, r.y + r.h - padY);
        } else {
          const padX = Math.max(4, Math.round(r.w * 0.04));
          const padY = Math.max(2, Math.round(r.h * 0.06));
          const { fontPx, lines } = fitMultilineFontPx({
            text,
            boxW: r.w,
            boxH: r.h,
            italic: !!el.italic,
            family: fam,
            padX,
            padY,
            lineHeight: 1.15
          });
          setFontOnCtx(ctx, !!el.italic, fontPx, fam);
          const count = Math.max(1, lines.length);
          const lineH = (r.h - padY * 2) / count;
          for (let i = 0; i < count; i++) {
            const yy = r.y + padY + lineH * (i + 0.5);
            ctx.fillText(lines[i], r.x + r.w / 2, yy);
          }
        }
        ctx.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", 0.9);
  };

  // Дебаунс-генерация превью
  const prevPreviewInputsRef = useRef<string>("");
  useEffect(() => {
  if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
  
    const inputsSig = JSON.stringify({
      item: item?.url || "",
      elements,
      people: peopleBlocks.map((p) => ({ id: p.id, l: p.lines, has: !!p.photo })),
      crosses: crosses.map((c) => c.url),
      others: others.map((o) => o.url),
      epitaphs,
      aspect,
      wishes
    });
    if (prevPreviewInputsRef.current === inputsSig) return;
    prevPreviewInputsRef.current = inputsSig;

    previewTimerRef.current = window.setTimeout(async () => {
      const wrap = wrapperRef.current;
      if (!wrap) return;

      const r = wrap.getBoundingClientRect();
      const miniW = Math.max(320, Math.floor(r.width));
      const miniH = Math.max(320, Math.floor(r.height));
      const mini = await renderPreview(miniW, miniH);

      const maxSide = 1600;
      const ratio = r.width / (r.height || 1);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await renderPreview(bigW, bigH);

      saveEditor((prev) => {
        const oldMini = (prev as any).editor?.previewUrl || null;
        const oldBig = (prev as any).editor?.previewHiUrl || null;
        if ((mini || null) === oldMini && (big || null) === oldBig) return prev;
        return {
          ...prev,
          editor: {
            ...(prev.editor || {}),
            previewUrl: mini || oldMini,
            previewHiUrl: big || oldBig,
            previewUpdatedAt: Date.now(),
            elements,
            wishes
          }
        } as OrderDraft;
      });
    }, 260) as unknown as number;

    return () => { if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current); };
  }, [item?.url, elements, peopleBlocks, crosses, others, epitaphs, aspect, wishes, layoutAppliedHash]);

  /* ===== Навигация ===== */
  const handleBack = () => {
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    } as OrderDraft));
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };
  const handleContinue = () => {
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    } as OrderDraft));
    const go = onRearSide || onSendOrder || onContinue;
    if (!go) return;
    setOutro(true);
    setTimeout(() => go({ elements, wishes }), 150);
  };

  /* ===== Рамки и мини‑панель ===== */
  const handleDot = (left: number | string, top: number | string, cursor: string): React.CSSProperties => ({
    position: "absolute",
    left, top,
    width: 10, height: 10,
    background: "#fff", border: "1px solid #000",
    borderRadius: 2, transform: "translate(-50%, -50%)",
    cursor
  });

  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const key = el.id.split("-").slice(1).join("-");
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
    let showStair = false;
    if (isEpitaph) {
      const idx = Number(key);
      const epText = Number.isFinite(idx) ? epitaphs[idx] || "" : "";
      showStair = isRememberLoveMourn(epText);
    }
    return (
      <div
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{
          position: "absolute", left: 0, top: -30,
          display: "flex", gap: 6,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 6, padding: "2px 6px",
          alignItems: "center", pointerEvents: "auto", zIndex: 3000
        }}
      >
        {isMetric && (
          <button
            type="button"
            style={btn}
            title={el.uppercase ? "Сделать строчные" : "Сделать ПРОПИСНЫЕ"}
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, uppercase: !e.uppercase } : e)))}
          >
            {el.uppercase ? "строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}
        {isEpitaph && showStair && (
          <button
            type="button"
            style={btn}
            title={el.staircase ? "Показать в одну строку" : "Показать лесенкой"}
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, staircase: !e.staircase } : e)))}
          >
            {el.staircase ? "В строку" : "Лесенкой"}
          </button>
        )}
        {isGraphic && (
          <button
            type="button"
            style={btn}
            title="Отразить по горизонтали"
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))}
          >
            Отразить ⇄
          </button>
        )}
      </div>
    );
  };

  const ContentOverlay = () => {
    const { w: cw, h: ch } = (function () {
      const r = wrapperRef.current?.getBoundingClientRect();
      if (!r) return { w: 1, h: 1 };
      return { w: Math.max(1, r.width - SKETCH_PAD * 2), h: Math.max(1, r.height - SKETCH_PAD * 2) };
    })();

    return (
      <>
        {elements
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((el) => {
            const key = el.id.split("-").slice(1).join("-");
            let content: React.ReactNode = null;

            if (el.type === "portrait") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const url = p?.photo || "";
              const filt = el.bw ? "grayscale(100%)" : "none";
              content = <img src={url} alt="Портрет" style={{ width: "100%", height: "100%", objectFit: "cover", filter: filt, display: "block", userSelect: "none", pointerEvents: "none" }} draggable={false} />;
            } else if (el.type === "metric") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
              const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;

              const boxWpx = (el.w / 100) * cw;
              const boxHpx = (el.h / 100) * ch;
              const padX = Math.max(4, Math.round(boxWpx * 0.04));
              const padY = Math.max(2, Math.round(boxHpx * 0.10));
              const fam = `"Century Schoolbook","Times New Roman",serif`;
              const fitted = fitMetricFontsPx({
                lines: lines.map(tf),
                boxW: boxWpx,
                boxH: boxHpx,
                italic: !!el.italic,
                family: fam,
                padX,
                padY,
                lineHeight: 1.12,
                minPx: 10
              });
              content = (
                <div style={{ width: "100%", height: "100%", color: "#fff", display: "grid", placeItems: "center", textAlign: "center", fontFamily: fam, fontStyle: el.italic ? "italic" : "normal", lineHeight: 1.12, textShadow: "0 1px 2px rgba(0,0,0,0.6)", padding: `${padY}px ${padX}px`, boxSizing: "border-box" }}>
                  <div style={{ display: "grid", gap: 2, width: "100%" }}>
                    {lines[0] && <div style={{ fontWeight: 700, fontSize: fitted[0] || 12 }}>{tf(lines[0])}</div>}
                    {lines[1] && <div style={{ fontWeight: 600, fontSize: fitted[1] || 11 }}>{tf(lines[1])}</div>}
                    {lines[2] && <div style={{ fontWeight: 400, fontSize: fitted[2] || 10, opacity: 0.95 }}>{tf(lines[2])}</div>}
                  </div>
                </div>
              );
            } else if (el.type === "epitaph") {
              const idx = Number(key);
              const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
              const txt = el.uppercase ? tRaw.toUpperCase() : tRaw;

              const boxWpx = (el.w / 100) * cw;
              const boxHpx = (el.h / 100) * ch;
              const padX = Math.max(4, Math.round(boxWpx * 0.04));
              const padY = Math.max(2, Math.round(boxHpx * 0.06));
              const fam = `"Century Schoolbook","Times New Roman",serif`;

              if (el.staircase && isRememberLoveMourn(txt)) {
                const { top, mid, bot } = splitRememberPreserve(txt);
                const { fontPx } = fitMultilineFontPx({
                  text: `${top}\n${mid}\n${bot}`,
                  boxW: boxWpx,
                  boxH: boxHpx,
                  italic: !!el.italic,
                  family: fam,
                  padX,
                  padY,
                  lineHeight: 1.15
                });
                const f = fontPx;
                content = (
                  <div style={{ position: "relative", width: "100%", height: "100%", color: "#fff", fontFamily: fam, fontStyle: el.italic ? "italic" : "normal", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    <div style={{ position: "absolute", top: padY / 2, left: padX, fontWeight: 600, fontSize: f, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{top}</div>
                    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontWeight: 600, fontSize: f, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mid}</div>
                    <div style={{ position: "absolute", right: padX, bottom: padY / 2, fontWeight: 600, fontSize: f, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bot}</div>
                  </div>
                );
              } else {
                const { fontPx, lines } = fitMultilineFontPx({
                  text: txt,
                  boxW: boxWpx,
                  boxH: boxHpx,
                  italic: !!el.italic,
                  family: fam,
                  padX,
                  padY,
                  lineHeight: 1.15
                });
                content = (
                  <div style={{ width: "100%", height: "100%", color: "#fff", display: "grid", placeItems: "center", textAlign: "center", fontFamily: fam, fontStyle: el.italic ? "italic" : "normal", lineHeight: 1.15, textShadow: "0 1px 2px rgba(0,0,0,0.6)", padding: `${padY}px ${padX}px`, boxSizing: "border-box" }}>
                    <div style={{ fontWeight: 600, fontSize: fontPx, whiteSpace: "pre-wrap" }} title={txt}>
                      {lines.join("\n")}
                    </div>
                  </div>
                );
              }
            } else if (el.type === "cross") {
              const idx = Number(key);
              const c = Number.isFinite(idx) ? crosses[idx] : undefined;
              if (c?.url) content = <img src={c.url} alt={c.name || "Крест"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} />;
            } else if (el.type === "graphic") {
              const idx = Number(key);
              const g = Number.isFinite(idx) ? others[idx] : undefined;
              if (g?.url) {
                const tr = el.flipH ? "scaleX(-1)" : "none";
                content = <img src={g.url} alt={g.name || "Графика"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", transform: tr, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} />;
              }
            }

            return (
              <div
                key={`content-${el.id}`}
                style={{
                  position: "absolute",
                  left: `${el.x}%`, top: `${el.y}%`,
                  width: `${el.w}%`, height: `${el.h}%`,
                  zIndex: el.z, pointerEvents: "none"
                }}
              >
                {content}
              </div>
            );
          })}
      </>
    );
  };

  const MAX_W = 600;

  return (
    <div
      style={{
        color: "#fff",
        padding: 12,
        opacity: outro ? 0 : 1,
        transition: "opacity 240ms ease",
        backgroundImage: `url(/data/bg.svg)`,
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundAttachment: "fixed"
      }}
    >
      <div style={{ width: "100%", maxWidth: MAX_W, margin: "0 auto" }}>
        <TopBarWithIntro title="Memorial - редактор" />

        {/* Подсказка */}
        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Разместите элементы условно. Укажите порядок и выравнивание (верх/низ, слева/справа). Финальный вариант сделает специалист исходя из технических требований и согласно этой схеме.
        </section>

        {/* Эскиз */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={wrapperRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDown={(e) => {
              if (e.altKey) {
                const hit = pickElementUnderPointer(e.clientX, e.clientY, null);
                if (hit) setSelectedId(hit);
              } else {
                setSelectedId(null);
              }
            }}
            style={{
              position: "relative",
              width: "100%",
              borderRadius: 10,
              overflow: "hidden",
              userSelect: "none",
              ...bottomUnderlayGradient(),
              aspectRatio: aspect,
              minHeight: aspect ? undefined : 540
            }}
          >
            {/* Фон — фото изделия (полупрозрачное) */}
            <img
              src={item?.url || ""}
              alt={item?.name || "Изделие"}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.35, userSelect: "none", pointerEvents: "none" }}
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => {
                if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 });
              }}
            />

            {/* Контент поверх */}
            <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, overflow: "hidden" }}>
              <ContentOverlay />
            </div>

            {/* Рамки + мини‑панели */}
            <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, zIndex: 1000, pointerEvents: "none" }}>
              {elements
                .slice()
                .sort((a, b) => a.z - b.z)
                .map((el) => {
                  const selected = el.id === selectedId;
                  return (
                    <div
                      key={el.id}
                      onPointerDown={(ev) => onPointerDownBox(ev, el.id, "move")}
                      style={{
                        position: "absolute",
                        left: `${el.x}%`, top: `${el.y}%`,
                        width: `${el.w}%`, height: `${el.h}%`,
                        border: selected ? "2px solid #8ab4ff" : "1px dashed rgba(255,255,255,0.85)",
                        borderRadius: 4,
                        boxShadow: selected ? "0 0 0 1px rgba(138,180,255,0.6)" : "none",
                        background: "transparent",
                        pointerEvents: "auto",
                        cursor: el.locked ? "not-allowed" : "move",
                        touchAction: "none"
                      }}
                      title={el.title || el.id}
                    >
                      {selected && <MiniToolbar el={el} />}

                      {selected && !el.locked && (
                        <>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={{ position: "absolute", left: 0, top: 0, ...handleDot(0, 0, "nwse-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={{ position: "absolute", left: "100%", top: 0, ...handleDot("100%", 0, "nesw-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={{ position: "absolute", left: "100%", top: "100%", ...handleDot("100%", "100%", "nwse-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={{ position: "absolute", left: 0, top: "100%", ...handleDot(0, "100%", "nesw-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={{ position: "absolute", left: "50%", top: 0, ...handleDot("50%", 0, "ns-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={{ position: "absolute", left: "100%", top: "50%", ...handleDot("100%", "50%", "ew-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={{ position: "absolute", left: "50%", top: "100%", ...handleDot("50%", "100%", "ns-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={{ position: "absolute", left: 0, top: "50%", ...handleDot(0, "50%", "ew-resize") }} />
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </section>

        {/* Пожелания */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <label htmlFor="wishes" style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>Пожелания по эскизу</label>
          <textarea
            id="wishes"
            value={wishes}
            onChange={(e) => setWishes(e.target.value)}
            rows={4}
            placeholder="Например: ещё уменьшить портрет, метрику сузить, эпитафию сделать лесенкой…"
            style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.35)", color: "#fff", padding: 10, resize: "vertical", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Пожелания будут учтены при подготовке финального макета.</div>
        </section>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
