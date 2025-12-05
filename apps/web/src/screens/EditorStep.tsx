// src/screens/EditorStep.tsx
// Редактор поверх SketchTemplate, БЕЗ измерения DOM:
// - Контент для размещения берём из драфта (люди, эпитафии, графика/кресты).
// - Контент SketchTemplate скрываем (виден только фон изделия), подсказку из шаблона тоже скрываем.
// - Наш слой: портрет/метрика/эпитафии/графика/кресты с перетаскиванием и ресайзом.
// - Узлы ресайза увеличены (проще попасть на телефоне).
// - «Помним, любим, скорбим…»: вернул переключатель «Лесенкой/В строку» для эпитафии.
// - Устранено мерцание графики/крестов: позиционируем в пикселях + GPU-акселерация, не ремонтируем картинки.
// - Превью эскиза сохраняем в драфт (TopBar не трогаем).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, type OrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

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
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты
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
const SKETCH_PAD = 8;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 2, 100),
  h: clamp(h, 2, 100)
});
const snap = (v: number, step = 1) => Math.round(v / step) * step;
const FONT_CENTURY = `"Century Schoolbook","Times New Roman",serif`;
const isCrossCategoryName = (s?: string) => (s || "").toLowerCase().includes("крест") || (s || "").toLowerCase().includes("cross");

function linesFromPerson(p: any) {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
const normRemember = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim();
const isRememberLoveMourn = (t?: string) => normRemember(t) === "помним любим скорбим";
function splitRememberPreserve(text: string) {
  // Сохраняем запятые/многоточие, если есть
  const t = (text || "").trim();
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    buf += ch;
    if (ch === ",") { parts.push(buf.trim()); buf = ""; }
  }
  if (buf.trim()) parts.push(buf.trim());
  const top = parts[0] || "Помним,";
  const mid = parts[1] || "любим,";
  const bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим…").trim();
  return { top, mid, bot };
}

/* ===== Fit helpers ===== */
let __measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (__measureCtx) return __measureCtx;
  const c = document.createElement("canvas");
  __measureCtx = c.getContext("2d");
  return __measureCtx!;
}
function setFontOnCtx(ctx: CanvasRenderingContext2D, italic: boolean, px: number, family: string) {
  ctx.font = `${italic ? "italic " : ""}${Math.max(1, Math.round(px))}px ${family}`;
}
function measureTextAt(ctx: CanvasRenderingContext2D, text: string, italic: boolean, family: string, sizePx: number) {
  setFontOnCtx(ctx, italic, sizePx, family);
  return ctx.measureText(text).width;
}
function fitMultilineFontPx({
  text, boxW, boxH, italic, family, padX = 4, padY = 2, lineHeight = 1.15, minPx = 10, maxPx = 96
}: {
  text: string; boxW: number; boxH: number; italic: boolean; family: string; padX?: number; padY?: number; lineHeight?: number; minPx?: number; maxPx?: number;
}) {
  const ctx = getMeasureCtx();
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const count = Math.max(1, lines.length);
  const usableW = Math.max(8, boxW - padX * 2);
  const usableH = Math.max(8, boxH - padY * 2);
  const fByH = usableH / (count * lineHeight);
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
  lines, boxW, boxH, italic, family, padX = 4, padY = 2, lineHeight = 1.12, minPx = 10, weights = [0.36, 0.30, 0.26]
}: {
  lines: string[]; boxW: number; boxH: number; italic: boolean; family: string; padX?: number; padY?: number; lineHeight?: number; minPx?: number; weights?: number[];
}) {
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

/* ===== Компонент ===== */
type Props = { onBack?: () => void; onContinue?: (payload?: any) => void; onRearSide?: (payload?: any) => void; onSendOrder?: (payload?: any) => void; };

export default function EditorStep({ onBack, onContinue, onRearSide, onSendOrder }: Props) {
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  const [outro, setOutro] = useState(false);

  const [elements, setElements] = useState<EditorEl[]>(() => (draft as any)?.editor?.elements || []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wishes, setWishes] = useState<string>(() => (draft as any)?.editor?.wishes || "");

  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const templateRootRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  // aspectRatio
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(() => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined), [imgWH]);

  // Источники
  const item = draft?.item || null;
  const engr: any = draft?.engraving || {};
  const graphics: any[] = Array.isArray(draft?.graphics) ? (draft.graphics as any[]) : [];

  // Блоки людей
  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engr?.persons) && engr.persons.length > 0) {
      return engr.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
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

  // Эпитафии
  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) return (engr.epitaphs as string[]).filter(Boolean);
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim()) return [engr.epitaphText.trim()];
    return [];
  }, [engr]);

  // Графика
  const crosses = useMemo(() => graphics.filter((g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)), [graphics]);
  const others = useMemo(() => graphics.filter((g) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)), [graphics]);

  /* ===== Скрыть контент/подсказку SketchTemplate (оставить фон) ===== */
  useEffect(() => {
    const st = document.createElement("style");
    st.setAttribute("data-editor-suppression", "1");
    st.innerHTML = `
      [data-editor-wrap] [data-sketch-el]{visibility:hidden!important;opacity:0!important;pointer-events:none!important}
      [data-editor-wrap] [data-sketch-hint], 
      [data-editor-wrap] .sketch-hint,
      [data-editor-wrap] .hint{display:none!important}
    `;
    document.head.appendChild(st);
    return () => { document.head.removeChild(st); };
  }, []);

  // На всякий случай скрываем «соседнюю» подсказку, если она отдельным узлом перед контейнером
  useEffect(() => {
    const root = templateRootRef.current;
    if (!root) return;
    const orient = root.querySelector("[data-sketch-orient]") as HTMLElement | null;
    const hint = orient?.previousElementSibling as HTMLElement | null;
    if (hint) hint.style.display = "none";
  }, [item?.url]);

  /* ===== Построение элементов по данным драфта (шаблоны) ===== */
  const buildOrMergeElements = React.useCallback(() => {
    setElements((prev) => {
      const existById = new Map(prev.map((e) => [e.id, e]));
      const next: EditorEl[] = [];

      // Люди: портрет + метрика — колонки
      const cnt = peopleBlocks.length || 0;
      const cw = cnt > 0 ? 100 / cnt : 100;
      let z = 10;

      peopleBlocks.forEach((pb, i) => {
        const pid = pb.id;
        const pidPortrait = `portrait-${pid}`;
        if (existById.has(pidPortrait)) next.push(existById.get(pidPortrait)!);
        else {
          const w = cw * 0.8, h = 35, x = i * cw + (cw - w) / 2, y = 12;
          next.push({ id: pidPortrait, type: "portrait", x, y, w, h, z: z++, bw: false, title: "Портрет" });
        }
        const pidMetric = `metric-${pid}`;
        if (existById.has(pidMetric)) next.push(existById.get(pidMetric)!);
        else {
          const w = cw * 0.9, h = 20, x = i * cw + (cw - w) / 2, y = 12 + 35 + 4;
          next.push({ id: pidMetric, type: "metric", x, y, w, h, z: z++, uppercase: false, italic: false, title: "Метрика" });
        }
      });

      // Эпитафии
      const hasPhotoOrMetric = next.some((e) => e.type === "portrait" || e.type === "metric");
      let underY = 0;
      if (hasPhotoOrMetric) {
        next.forEach((e) => { if (e.type === "portrait" || e.type === "metric") underY = Math.max(underY, e.y + e.h); });
      }
      epitaphs.forEach((_, i) => {
        const id = `epitaph-${i}`;
        if (existById.has(id)) next.push(existById.get(id)!);
        else {
          let x = 10, y = hasPhotoOrMetric ? Math.min(95, underY + 4) : 30, w = 80, h = hasPhotoOrMetric ? 16 : 18;
          next.push({ id, type: "epitaph", x, y, w, h, z: z++, uppercase: false, italic: false, staircase: false, title: "Эпитафия" });
        }
      });

      // Кресты
      const anyContent = next.length > 0;
      crosses.forEach((_, i) => {
        const id = `cross-${i}`;
        if (existById.has(id)) next.push(existById.get(id)!);
        else {
          const w = anyContent ? 18 : 28, h = anyContent ? 18 : 28;
          const x = anyContent ? 4 : (50 - w / 2);
          const y = anyContent ? 4 : 30;
          next.push({ id, type: "cross", x, y, w, h, z: z++, title: "Крест" });
        }
      });

      // Прочая графика
      others.forEach((_, i) => {
        const id = `graphic-${i}`;
        if (existById.has(id)) next.push(existById.get(id)!);
        else {
          const empty = !anyContent && crosses.length === 0 && epitaphs.length === 0;
          const w = empty ? 40 : 50, h = empty ? 28 : 18;
          const x = 50 - w / 2;
          const y = empty ? 30 : Math.max(0, 100 - h - 4);
          next.push({ id, type: "graphic", x, y, w, h, z: z++, flipH: false, title: "Графика" });
        }
      });

      // Сохраняем пользовательские флаги, удаляем отсутствующие
      const kept = next.map((e) => {
        const old = existById.get(e.id);
        return old
          ? {
              ...e,
              uppercase: old.uppercase ?? e.uppercase,
              italic: old.italic ?? e.italic,
              flipH: old.flipH ?? e.flipH,
              bw: old.bw ?? e.bw,
              staircase: old.staircase ?? e.staircase
            }
          : e;
      });

      const cur = loadOrderDraft();
      saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements: kept, wishes, updatedAt: Date.now() } });
      return kept;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleBlocks, epitaphs, crosses, others]);

  useEffect(() => { buildOrMergeElements(); }, [buildOrMergeElements]);

  /* ===== DnD / Resize ===== */
  const dragRef = useRef<{
    id: string; mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number; start: EditorEl;
  } | null>(null);

  const onPointerDownBox = (e: React.PointerEvent, id: string, mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move") => {
    e.stopPropagation();
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    e.preventDefault();
    const rect = editorWrapRef.current?.getBoundingClientRect(); if (!rect) return;
    const contentW = rect.width - SKETCH_PAD * 2;
    const contentH = rect.height - SKETCH_PAD * 2;
    if (contentW <= 0 || contentH <= 0) return;

    const dxPct = ((e.clientX - d.startX) / contentW) * 100;
    const dyPct = ((e.clientY - d.startY) / contentH) * 100;

    const withSnap = !e.altKey;
    const snapStep = e.shiftKey ? 1.5 : 1;

    setElements((prev) => prev.map((el) => {
      if (el.id !== d.id) return el;
      let { x, y, w, h } = d.start;
      if (d.mode === "move") {
        let nx = x + dxPct, ny = y + dyPct;
        if (withSnap) { nx = snap(nx, snapStep); ny = snap(ny, snapStep); }
        return { ...el, ...clampBox(nx, ny, w, h) };
      }
      const keepRatio = e.shiftKey;
      let nx = x, ny = y, nw = w, nh = h;
      const ratio = (w || 1) / (h || 1);
      if (d.mode.includes("e")) nw = w + dxPct;
      if (d.mode.includes("s")) nh = h + dyPct;
      if (d.mode.includes("w")) { nx = x + dxPct; nw = w - dxPct; }
      if (d.mode.includes("n")) { ny = y + dyPct; nh = h - dyPct; }
      if (keepRatio) {
        if (["e","w"].some((s) => d.mode.includes(s))) nh = nw / ratio;
        if (["n","s"].some((s) => d.mode.includes(s))) nw = nh * ratio;
      }
      if (withSnap) { nx = snap(nx, snapStep); ny = snap(ny, snapStep); nw = snap(nw, snapStep); nh = snap(nh, snapStep); }
      return { ...el, ...clampBox(nx, ny, nw, nh) };
    }));
  };

  const onPointerUp = () => {
    if (dragRef.current) {
      const cur = loadOrderDraft();
      saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
      queuePreviewGeneration();
    }
    dragRef.current = null;
  };

  /* ===== Превью (мини/большое) в драфт ===== */
  const queuePreviewGeneration = () => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(async () => {
      const wrap = editorWrapRef.current; if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const pad = SKETCH_PAD;

      async function drawPreview(W: number, H: number): Promise<string | null> {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(W));
        canvas.height = Math.max(1, Math.floor(H));
        const ctx = canvas.getContext("2d"); if (!ctx) return null;

        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#6e6e6e"); grad.addColorStop(0.2, "#464545"); grad.addColorStop(0.4, "#424242");
        grad.addColorStop(0.7, "#888888"); grad.addColorStop(1.0, "#ffffff");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

        const base = await new Promise<HTMLImageElement | null>((resolve) => {
          const url = item?.url || ""; if (!url) return resolve(null);
          const i = new Image(); i.crossOrigin = "anonymous";
          i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url;
        });

        const CX = pad, CY = pad, PW = W - pad * 2, PH = H - pad * 2;
        if (base) {
          const sr = base.width / base.height, dr = PW / PH;
          ctx.globalAlpha = 0.35;
          if (sr > dr) {
            const rw = PW, rh = Math.round(PW / sr), rx = CX, ry = CY + Math.round((PH - rh) / 2);
            ctx.drawImage(base, rx, ry, rw, rh);
          } else {
            const rh = PH, rw = Math.round(PH * sr), ry = CY, rx = CX + Math.round((PW - rw) / 2);
            ctx.drawImage(base, rx, ry, rw, rh);
          }
          ctx.globalAlpha = 1;
        }

        const fam = FONT_CENTURY;
        const safeIndex = (raw: string, max: number) => {
          const n = parseInt(raw, 10); if (!Number.isFinite(n) || n < 0) return 0;
          return Math.min(n, Math.max(0, max - 1));
        };

        for (const el of elements.slice().sort((a, b) => a.z - b.z)) {
          const rbox = { x: CX + (el.x / 100) * PW, y: CY + (el.y / 100) * PH, w: (el.w / 100) * PW, h: (el.h / 100) * PH };
          const key = el.id.split("-").slice(1).join("-");
          if (el.type === "portrait") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const url = p?.photo || ""; if (!url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url; });
            if (!im) continue;
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            ctx.save(); ctx.beginPath(); ctx.rect(rbox.x, rbox.y, rbox.w, rbox.h); ctx.clip();
            if (el.bw) ctx.filter = "grayscale(100%)";
            if (sr2 > dr2) { const hh = rbox.h, ww = Math.round(hh * sr2), xx = Math.round(rbox.x + (rbox.w - ww) / 2), yy = rbox.y; ctx.drawImage(im, xx, yy, ww, hh); }
            else { const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2); ctx.drawImage(im, xx, yy, ww, hh); }
            ctx.restore(); ctx.filter = "none";
          } else if (el.type === "metric") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
            const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
            ctx.save(); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04)); const padY2 = Math.max(2, Math.round(rbox.h * 0.10));
            const fitted = fitMetricFontsPx({ lines: lines.map(tf), boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.12, minPx: 10 });
            const totalH = fitted.reduce((a, b) => a + b * 1.12, 0);
            let y = rbox.y + (rbox.h - totalH) / 2 + (fitted[0] || 10) * 1.12 / 2;
            for (let i = 0; i < fitted.length; i++) { setFontOnCtx(ctx, !!el.italic, fitted[i], fam); ctx.fillText(tf(lines[i]), rbox.x + rbox.w / 2, y); y += fitted[i] * 1.12; }
            ctx.restore();
          } else if (el.type === "epitaph") {
            const idx = safeIndex(key, epitaphs.length);
            const tRaw = epitaphs[idx] || ""; const txt = el.uppercase ? tRaw.toUpperCase() : tRaw;
            ctx.save(); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04)); const padY2 = Math.max(2, Math.round(rbox.h * 0.06));
            // Учтём «лесенку»
            let textForFit = txt;
            const isRLM = isRememberLoveMourn(tRaw);
            if (isRLM && el.staircase) {
              const r = splitRememberPreserve(tRaw);
              textForFit = `${r.top}\n${r.mid}\n${r.bot}`;
            }
            const { fontPx, lines } = fitMultilineFontPx({ text: textForFit, boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.15 });
            setFontOnCtx(ctx, !!el.italic, fontPx, fam);
            const count = Math.max(1, lines.length); const lineH = (rbox.h - padY2 * 2) / count;
            for (let i = 0; i < count; i++) { const yy = rbox.y + padY2 + lineH * (i + 0.5); ctx.fillText(lines[i], rbox.x + rbox.w / 2, yy); }
            ctx.restore();
          } else if (el.type === "graphic") {
            const idx = safeIndex(key, others.length); const g = others[idx]; if (!g?.url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = g.url; });
            if (!im) continue;
            ctx.save(); if (el.flipH) { ctx.translate(rbox.x + rbox.w / 2, rbox.y + rbox.h / 2); ctx.scale(-1, 1); ctx.translate(-(rbox.x + rbox.w / 2), -(rbox.y + rbox.h / 2)); }
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            if (sr2 > dr2) { const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2); ctx.drawImage(im, xx, yy, ww, hh); }
            else { const hh = rbox.h, ww = Math.round(hh * sr2), xx = rbox.x + Math.round((rbox.w - ww) / 2), yy = rbox.y; ctx.drawImage(im, xx, yy, ww, hh); }
            ctx.restore();
          } else if (el.type === "cross") {
            const idx = safeIndex(key, crosses.length); const c = crosses[idx]; if (!c?.url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = c.url; });
            if (!im) continue;
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            if (sr2 > dr2) { const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2); ctx.drawImage(im, xx, yy, ww, hh); }
            else { const hh = rbox.h, ww = Math.round(hh * sr2), xx = rbox.x + Math.round((rbox.w - ww) / 2), yy = rbox.y; ctx.drawImage(im, xx, yy, ww, hh); }
          }
        }
        return canvas.toDataURL("image/jpeg", 0.9);
      }

      const mini = await drawPreview(Math.max(320, Math.floor(r.width)), Math.max(320, Math.floor(r.height)));
      const maxSide = 1600, ratio = r.width / Math.max(1, r.height);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await drawPreview(bigW, bigH);

      const cur = loadOrderDraft();
      saveOrderDraft({
        ...cur,
        editor: {
          ...(cur as any).editor,
          previewUrl: mini || (cur as any).editor?.previewUrl || null,
          previewHiUrl: big || (cur as any).editor?.previewHiUrl || null,
          previewUpdatedAt: Date.now(),
          elements,
          wishes
        }
      });
    }, 280) as unknown as number;
  };

  // Сохранять при изменениях
  useEffect(() => { buildOrMergeElements(); }, [peopleBlocks, epitaphs, crosses, others]);

  useEffect(() => {
    const onUpd = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
      window.removeEventListener("storage", onUpd);
    };
  }, []);

  // DnD автосейв и превью
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const cur = loadOrderDraft();
      saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
    }, 300) as unknown as number;

    queuePreviewGeneration();
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [elements, wishes, item?.url, peopleBlocks, crosses, others, epitaphs]);

  /* ===== Мини‑панель инструментов ===== */
  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
    const isPortrait = el.type === "portrait";

    // Для эпитафии «помним, любим, скорбим…» показываем переключатель лесенка/строка
    let canStair = false;
    let epitaphIndex = -1;
    if (isEpitaph) {
      const key = el.id.split("-").slice(1).join("-");
      const idx = Number(key);
      epitaphIndex = Number.isFinite(idx) ? idx : -1;
      const tRaw = epitaphIndex >= 0 ? (epitaphs[epitaphIndex] || "") : "";
      canStair = isRememberLoveMourn(tRaw);
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
          <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, uppercase: !e.uppercase } : e)))}>
            {el.uppercase ? "строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}
        {isEpitaph && (
          <>
            <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, italic: !e.italic } : e)))}>
              {el.italic ? "Обычный" : "Курсив"}
            </button>
            {canStair && (
              <button
                type="button"
                style={btn}
                onClick={() =>
                  setElements((prev) =>
                    prev.map((e) => (e.id === el.id ? { ...e, staircase: !e.staircase } : e))
                  )
                }
              >
                {el.staircase ? "В строку" : "Лесенкой"}
              </button>
            )}
          </>
        )}
        {isGraphic && (
          <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))}>
            Отразить ⇄
          </button>
        )}
        {isPortrait && (
          <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, bw: !e.bw } : e)))}>
            {el.bw ? "Цвет" : "Ч/Б"}
          </button>
        )}
      </div>
    );
  };

  /* ===== Контент поверх (рисуем по драфту) ===== */
  const ContentOverlay = () => {
    const fam = FONT_CENTURY;
    const wrap = editorWrapRef.current?.getBoundingClientRect();
    const contentW = Math.max(1, (wrap?.width || 1) - SKETCH_PAD * 2);
    const contentH = Math.max(1, (wrap?.height || 1) - SKETCH_PAD * 2);
    const safeIndex = (raw: string, max: number) => {
      const n = parseInt(raw, 10); if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, Math.max(0, max - 1));
    };

    return (
      <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, pointerEvents: "none", zIndex: 1000 }}>
        {elements.slice().sort((a, b) => a.z - b.z).map((el) => {
          const key = el.id.split("-").slice(1).join("-");
          const boxPx = { x: (el.x / 100) * contentW, y: (el.y / 100) * contentH, w: (el.w / 100) * contentW, h: (el.h / 100) * contentH };

          // Общие пиксельные позиции для устранения мерцания
          const wrapperStyle: React.CSSProperties = {
            position: "absolute",
            left: boxPx.x,
            top: boxPx.y,
            width: boxPx.w,
            height: boxPx.h,
            zIndex: el.z,
            pointerEvents: "none",
            willChange: "transform",
            contain: "layout paint style",
            backfaceVisibility: "hidden"
          };

          if (el.type === "portrait") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const url = p?.photo || "";
            const filt = el.bw ? "grayscale(100%)" : "none";
            return (
              <div key={`content-${el.id}`} style={wrapperStyle}>
                {url ? (
                  <img
                    src={url}
                    alt="Портрет"
                    style={{
                      width: "100%", height: "100%",
                      objectFit: "cover",
                      filter: filt, display: "block",
                      transform: "translateZ(0)",
                      willChange: "transform",
                      pointerEvents: "none"
                    }}
                    decoding="async"
                    draggable={false}
                  />
                ) : null}
              </div>
            );
          }

          if (el.type === "metric") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
            const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
            const padX = Math.max(4, Math.round(boxPx.w * 0.04));
            const padY = Math.max(2, Math.round(boxPx.h * 0.10));
            const fitted = fitMetricFontsPx({ lines: lines.map(tf), boxW: boxPx.w, boxH: boxPx.h, italic: !!el.italic, family: fam, padX, padY, lineHeight: 1.12, minPx: 10 });
            return (
              <div key={`content-${el.id}`} style={{ ...wrapperStyle, color: "#fff", fontFamily: fam, textAlign: "center" }}>
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: `${padY}px ${padX}px`, boxSizing: "border-box", lineHeight: 1.12, fontStyle: el.italic ? "italic" : "normal", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  <div style={{ display: "grid", gap: 2, width: "100%" }}>
                    {lines[0] && <div style={{ fontWeight: 700, fontSize: fitted[0] || 12 }}>{tf(lines[0])}</div>}
                    {lines[1] && <div style={{ fontWeight: 600, fontSize: fitted[1] || 11 }}>{tf(lines[1])}</div>}
                    {lines[2] && <div style={{ fontWeight: 400, fontSize: fitted[2] || 10, opacity: 0.95 }}>{tf(lines[2])}</div>}
                  </div>
                </div>
              </div>
            );
          }

          if (el.type === "epitaph") {
            const idx = safeIndex(key, epitaphs.length);
            const tRaw = epitaphs[idx] || "";
            const isRLM = isRememberLoveMourn(tRaw);
            const textDisplay = (() => {
              if (!isRLM) return el.uppercase ? tRaw.toUpperCase() : tRaw;
              const r = splitRememberPreserve(tRaw);
              const ladder = `${r.top}\n${r.mid}\n${r.bot}`;
              return el.staircase ? (el.uppercase ? ladder.toUpperCase() : ladder) : (el.uppercase ? tRaw.toUpperCase() : tRaw);
            })();
            const padX = Math.max(4, Math.round(boxPx.w * 0.04));
            const padY = Math.max(2, Math.round(boxPx.h * 0.06));
            const { fontPx, lines } = fitMultilineFontPx({ text: textDisplay, boxW: boxPx.w, boxH: boxPx.h, italic: !!el.italic, family: FONT_CENTURY, padX, padY, lineHeight: 1.15 });
            return (
              <div key={`content-${el.id}`} style={{ ...wrapperStyle, color: "#fff", fontFamily: FONT_CENTURY, textAlign: "center" }}>
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: `${padY}px ${padX}px`, boxSizing: "border-box", lineHeight: 1.15, fontStyle: el.italic ? "italic" : "normal", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  <div style={{ fontWeight: 600, fontSize: fontPx, whiteSpace: "pre-wrap" }}>{lines.join("\n")}</div>
                </div>
              </div>
            );
          }

          if (el.type === "cross") {
            const idx = safeIndex(key, crosses.length);
            const c = crosses[idx];
            return (
              <div key={`content-${el.id}`} style={wrapperStyle}>
                {c?.url ? (
                  <img
                    src={c.url}
                    alt={c.name || "Крест"}
                    style={{
                      width: "100%", height: "100%",
                      objectFit: "contain",
                      display: "block",
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                      transform: "translateZ(0)",
                      willChange: "transform",
                      pointerEvents: "none"
                    }}
                    decoding="async"
                    draggable={false}
                  />
                ) : null}
              </div>
            );
          }

          if (el.type === "graphic") {
            const idx = safeIndex(key, others.length);
            const g = others[idx];
            const tr = el.flipH ? "scaleX(-1) translateZ(0)" : "translateZ(0)";
            return (
              <div key={`content-${el.id}`} style={wrapperStyle}>
                {g?.url ? (
                  <img
                    src={g.url}
                    alt={g.name || "Графика"}
                    style={{
                      width: "100%", height: "100%",
                      objectFit: "contain",
                      display: "block",
                      transform: tr,
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                      willChange: "transform",
                      pointerEvents: "none"
                    }}
                    decoding="async"
                    draggable={false}
                  />
                ) : null}
              </div>
            );
          }

          return null;
        })}
      </div>
    );
  };

  /* ===== Узлы/ручки: увеличенный размер и зона попадания ===== */
  const KNOB_HIT = 28;
  const KNOB_VIS = 14;
  const knobWrapStyle = (left: number | string, top: number | string, cursor: string): React.CSSProperties => ({
    position: "absolute",
    left, top,
    width: KNOB_HIT,
    height: KNOB_HIT,
    transform: "translate(-50%, -50%)",
    cursor,
    background: "rgba(255,255,255,0.001)",
    pointerEvents: "auto",
    display: "grid",
    placeItems: "center",
    touchAction: "none"
  });
  const knobVisualStyle: React.CSSProperties = {
    width: KNOB_VIS,
    height: KNOB_VIS,
    background: "#fff",
    border: "1px solid #000",
    borderRadius: 3,
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)"
  };

  /* ===== Навигация ===== */
  const handleBack = () => {
    const cur = loadOrderDraft();
    saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };
  const handleContinue = () => {
    const cur = loadOrderDraft();
    saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
    const go = onRearSide || onSendOrder || onContinue; if (!go) return;
    setOutro(true);
    setTimeout(() => go({ elements, wishes }), 150);
  };

  const MAX_W = 600;

  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 240ms ease", backgroundImage: `url(/data/bg.svg)`, backgroundSize: "cover", backgroundPosition: "center center", backgroundAttachment: "fixed" }}>
      <div style={{ width: "100%", maxWidth: MAX_W, margin: "0 auto" }}>
        <TopBarWithIntro title="Memorial" />

        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Разместите элементы условно. Укажите порядок и выравнивание. Финальный вариант сделает специалист согласно этой схеме.
        </section>

        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={editorWrapRef}
            data-editor-wrap
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
            {/* Подложка (скрываем её контент/подсказки, оставляем фон) */}
            <div ref={templateRootRef}>
              <SketchTemplate
                item={item}
                peopleBlocks={peopleBlocks}
                crosses={crosses as any}
                others={others as any}
                epitaphs={epitaphs}
                carvingOpacity={0.35}
              />
            </div>

            {/* aspectRatio по натуральному изображению */}
            <img
              src={item?.url || ""}
              alt=""
              style={{ position: "absolute", inset: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => { if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 }); }}
            />

            {/* Контент и фреймы */}
            <ContentOverlay />

            <div
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
              style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, zIndex: 1001, pointerEvents: "none" }}
            >
              {elements.slice().sort((a, b) => a.z - b.z).map((el) => {
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
                        {/* Узлы-углы */}
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={knobWrapStyle(0, 0, "nwse-resize")}><div style={knobVisualStyle} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={knobWrapStyle("100%", 0, "nesw-resize")}><div style={knobVisualStyle} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={knobWrapStyle("100%", "100%", "nwse-resize")}><div style={knobVisualStyle} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={knobWrapStyle(0, "100%", "nesw-resize")}><div style={knobVisualStyle} /></div>
                        {/* Узлы-стороны */}
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={knobWrapStyle("50%", 0, "ns-resize")}><div style={knobVisualStyle} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={knobWrapStyle("100%", "50%", "ew-resize")}><div style={knobVisualStyle} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={knobWrapStyle("50%", "100%", "ns-resize")}><div style={knobVisualStyle} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={knobWrapStyle(0, "50%", "ew-resize")}><div style={knobVisualStyle} /></div>
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
        </section>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
