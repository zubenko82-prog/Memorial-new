// src/screens/EditorStep.tsx
// Редактор элементов с надёжной инициализацией по правилам шаблона (без чтения DOM и без align).
//
// Что сделано:
// - Портрет строго 3:4 (ширина:высота = 3:4), компактнее по высоте, не «выталкивает» низ.
// - «Помним, любим, скорбим…» по умолчанию В СТРОКУ (лесенка только по переключателю).
// - Фреймы «плотно» вокруг контента: метрика и эпитафия — ниже и уже без лишнего воздуха.
// - Графика всегда прижата к нижнему краю; эпитафии строго над графикой с зазором и гарантированным минимумом высоты.
// - Исключены наложения фреймов (anti-overlap): после раскладки выполняется разводка пересечений, чтобы не мешать управлению.
// - DnD/resize, Alt+клик для выбора нижних элементов, автосейв и превью.
// - Исправлена «Maximum update depth exceeded»:
//   • Live-reload драфта не вызывает setDraft без фактических изменений (сигнатура драфта в ref).
//   • Эффект генерации превью ставится только при изменении входов (сигнатура входов), не сохраняем превью, если оно не менялось.

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
  staircase?: boolean; // «Помним, любим, скорбим…»
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

/* ===== Версионирование раскладки (для реинициализации при изменениях логики) ===== */
const LAYOUT_VERSION = "2025-01-EditorStep-v11";

/* ===== Сигнатуры контента (без размеров контейнера) ===== */
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
  return items
    .map((g, i) => `${i}:${g.id || g.url || g.name || ""}:${g.catSlug || g.catName || ""}`)
    .join("|");
}

/* =========================================================================================
   computeSketchLayout — портрет 3:4, плотные рамки, анти‑наложения, эпитафии над графикой
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
    const per = Math.max(8, Math.floor((Htot - gaps) / count));
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
  const minEpTotal = Math.max(20, Math.round(0.06 * stageH)); // минимум под эпитафии (вся колонна)
  const gfxBandLeft = Math.round((stageW - Math.round(contentWidth * 0.92)) / 2);
  const gfxBandWidth = Math.round(contentWidth * 0.92);

  /* ===== Горизонтальные ===== */
  if (orientation === "horizontal" && tplKey === "one") {
    // Портрет 3:4 — из ширины (компактно)
    let pw = Math.round(contentWidth * 0.34);
    let ph = Math.round(pw * (4 / 3));
    const px = Math.round((stageW - pw) / 2);
    const py = top6;

    // Метрика плотнее
    const mw = Math.round(contentWidth * 0.62);
    const mh = Math.max(18, Math.round(0.12 * stageH));

    // Эпитафии над графикой
    let epTop = py + ph + gapY + mh + gapY;
    let gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
    let gfxTop = stageH - bottomPad - gfxH;
    let epTotal = gfxTop - gapY - epTop;

    if (epTotal < minEpTotal) {
      const takeG = Math.min(minEpTotal - epTotal, gfxH);
      gfxH -= takeG;
      gfxTop = stageH - bottomPad - gfxH;
      epTotal = gfxTop - gapY - epTop;

      if (epTotal < minEpTotal) {
        const need = minEpTotal - epTotal;
        const shrink = Math.min(need, Math.round(ph * 0.4));
        ph = Math.max(40, ph - shrink);
        epTop = py + ph + gapY + mh + gapY;
        gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
        gfxTop = stageH - bottomPad - gfxH;
        epTotal = gfxTop - gapY - epTop;
      }
    }

    m.set(`portrait-${people[0]?.id}`, toBox(px, py, pw, ph));
    m.set(`metric-${people[0]?.id}`, toBox(Math.round((stageW - mw) / 2), py + ph + gapY, mw, mh));
    placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.86)) / 2), epTop, Math.round(contentWidth * 0.86), epTotal);
    placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);

    if (crosses[0]) m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx));
    if (crosses[1]) m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx));

  } else if (orientation === "horizontal" && tplKey === "two") {
    const gapCols = Math.round(0.010 * stageW);
    const colW = Math.min(300, Math.max(140, Math.floor((contentWidth - gapCols) / 2)));
    const totalW = colW * 2 + gapCols;
    const leftStart = Math.round((stageW - totalW) / 2);
    const top = Math.round(0.08 * stageH);

    people.slice(0, 2).forEach((p, idx) => {
      const px = leftStart + idx * (colW + gapCols);
      const pw = colW;
      const ph = Math.round(pw * (4 / 3));
      m.set(`portrait-${p.id}`, toBox(px, top, pw, ph));

      const mw = Math.round(colW * 0.66);
      const mh = Math.max(16, Math.round(0.10 * stageH));
      const mx = px + Math.round((colW - mw) / 2);
      const my = top + ph + Math.round(0.008 * stageH);
      m.set(`metric-${p.id}`, toBox(mx, my, mw, mh));
    });

    const metricsBottom = people.slice(0, 2).reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`); if (!b) return acc;
      const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
      return Math.max(acc, my + mh);
    }, 0);

    const epTop = metricsBottom + gapY;
    let gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
    let gfxTop = stageH - bottomPad - gfxH;
    let epTotal = gfxTop - gapY - epTop;
    if (epTotal < minEpTotal) {
      const dec = Math.min(minEpTotal - epTotal, gfxH);
      gfxH -= dec;
      gfxTop = stageH - bottomPad - gfxH;
      epTotal = gfxTop - gapY - epTop;
    }

    placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.86)) / 2), epTop, Math.round(contentWidth * 0.86), epTotal);
    placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);

    if (crosses.length === 1) m.set("cross-0", toBox(Math.round((stageW - crossWpx) / 2), Math.round(0.06 * stageH), crossWpx, crossHpx));
    if (crosses.length >= 2) {
      m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx));
      m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx));
    }

  } else if (orientation === "horizontal" && tplKey === "many") {
    const cols = Math.min(4, Math.max(3, people.length));
    const colGap = Math.round(0.010 * stageW);
    const colW = Math.min(240, Math.max(140, Math.floor((contentWidth - (cols - 1) * colGap) / cols)));
    const totalW = colW * cols + (cols - 1) * colGap;
    const leftStart = Math.round((stageW - totalW) / 2);
    const top = Math.round(0.08 * stageH);

    people.forEach((p, i) => {
      const cx = leftStart + i * (colW + colGap);
      const pw = colW;
      const ph = Math.round(pw * (4 / 3));
      m.set(`portrait-${p.id}`, toBox(cx, top, pw, ph));

      const mw = Math.round(colW * 0.66);
      const mh = Math.max(16, Math.round(0.10 * stageH));
      const mx = cx + Math.round((colW - mw) / 2);
      const my = top + ph + Math.round(0.008 * stageH);
      m.set(`metric-${p.id}`, toBox(mx, my, mw, mh));
    });

    const metricsBottom = people.reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`); if (!b) return acc;
      const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
      return Math.max(acc, my + mh);
    }, 0);

    const epTop = metricsBottom + gapY;
    let gfxH = Math.max(0, Math.min(desiredGfxH, stageH - bottomPad - (epTop + minEpTotal + gapY)));
    let gfxTop = stageH - bottomPad - gfxH;
    let epTotal = gfxTop - gapY - epTop;
    if (epTotal < minEpTotal) {
      const dec = Math.min(minEpTotal - epTotal, gfxH);
      gfxH -= dec;
      gfxTop = stageH - bottomPad - gfxH;
      epTotal = gfxTop - gapY - epTop;
    }

    placeEpitaphsStack(Math.round((stageW - Math.round(contentWidth * 0.86)) / 2), epTop, Math.round(contentWidth * 0.86), epTotal);
    placeGraphicsRow(gfxBandLeft, gfxTop, gfxBandWidth, gfxH);

    if (crosses[0]) m.set("cross-0", toBox(Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx));
    if (crosses[1]) m.set("cross-1", toBox(Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx));
  } else {
    /* ===== Вертикальные ===== */
    const topPortrait = Math.round(0.12 * stageH);

    if (tplKey === "one" && people[0]) {
      // Портрет 3:4 — из ширины (узко)
      let pw = Math.round(contentWidth * 0.42);
      let ph = Math.round(pw * (4 / 3));
      const px = Math.round((stageW - pw) / 2);

      const mw = Math.round(contentWidth * 0.66);
      const mh = Math.max(22, Math.round(0s: string) => s;
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const f1 = Math.max(10, Math.round(r.h * 0.28));
        const f2 = Math.max(10, Math.round(r.h * 0.24));
        const f3 = Math.max(10, Math.round(r.h * 0.20));
        const sizes = [f1, f2, f3];
        const lh = Math.max(10, Math.round(r.h / Math.max(1, lines.length)));
        const startY = r.y + r.h / 2 - ((lines.length - 1) * lh) / 2;
        const X = r.x + r.w / 2;
        lines.forEach((ln, i) => {
          ctx.font = `${el.italic ? "italic " : ""}${sizes[i] || sizes[sizes.length - 1]}px ${fontFamily}`;
          ctx.fillText(tf(ln), X, startY + i * lh, r.w);
        });
        ctx.restore();
      } else if (el.type === "epitaph") {
        const idx = Number(key);
        const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
        const text = el.uppercase ? tRaw.toUpperCase() : tRaw;

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        const f = Math.max(10, Math.round(r.h * 0.34));
        ctx.font = `${el.italic ? "italic " : ""}${f}px ${fontFamily}`;
        if (el.staircase) {
          const { top, mid, bot } = splitRememberPreserve(text);
          ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(top, r.x + 4, r.y + 2, r.w - 8);
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(mid, r.x + r.w / 2, r.y + r.h / 2, r.w - 8);
          ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(bot, r.x + r.w - 4, r.y + r.h - 2, r.w - 8);
        } else {
          ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2, r.w - 8);
        }
        ctx.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", 0.9);
  };

  // Дебаунс-генерация превью с фильтрацией входов
  const prevPreviewInputsRef = useRef<string>("");
  const prevSavedPreviewRef = useRef<{ mini?: string | null; big?: string | null }>({});
  useEffect(() => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);

    // Входы для превью — берём только значимое
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

      const prevSaved = prevSavedPreviewRef.current;
      if ((mini || null) === (prevSaved.mini || null) && (big || null) === (prevSaved.big || null)) return;
      prevSavedPreviewRef.current = { mini, big };

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

    return () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    };
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
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt, margin: "12px 0" }}>
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
