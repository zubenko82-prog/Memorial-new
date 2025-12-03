// src/screens/EditorStep.tsx
// Редактор поверх того же шаблона, что и на предыдущих шагах (SketchTemplate):
// 1) Сначала строим эскиз через SketchTemplate и измеряем его DOM (data-sketch-el) → получаем точные фреймы.
// 2) Затем скрываем «контент» SketchTemplate (портреты/метрики/эпитафии/графику), оставляя фон изделия.
// 3) Рендерим СВОЙ контент поверх (по фреймам) — теперь фреймы «управляют» эскизом: двигаешь рамку → двигается элемент.
// 4) Правим ширину графики и метрики (субпиксельный дрифт) — небольшой auto-fit и доснятие ширины по реальному контейнеру.
//
// Важно:
// - Подсказку, которая встроена в SketchTemplate, на этом шаге скрываем;
// - Подсказку шага показываем свою (как просили);
// - Разметка фреймов «почти идеальна» — добавлен компенсационный шаг по ширине для graphic/metric,
//   чтобы совпало «в пиксель» (где было расхождение).

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
type Orientation = "vertical" | "horizontal";
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты в контентной области
  z: number;
  title?: string;
  locked?: boolean;
  uppercase?: boolean; // metric/epitaph
  italic?: boolean;    // metric/epitaph
  flipH?: boolean;     // graphic
  bw?: boolean;        // portrait
  staircase?: boolean; // «Помним, любим, скорбим…»
};

const SKETCH_PAD = 8;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 2, 100),
  h: clamp(h, 2, 100)
});
const snap = (v: number, step = 1) => Math.round(v / step) * step;

/* ===== Fit helpers (для текста в превью/контенте) ===== */
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
function measureTextAt(ctx: CanvasRenderingContext2D, text: string, italic: boolean, family: string, sizePx: number): number {
  setFontOnCtx(ctx, italic, sizePx, family);
  return ctx.measureText(text).width;
}
function fitMultilineFontPx({
  text, boxW, boxH, italic, family, padX = 4, padY = 2, lineHeight = 1.15, minPx = 10, maxPx = 96
}: {
  text: string; boxW: number; boxH: number; italic: boolean; family: string;
  padX?: number; padY?: number; lineHeight?: number; minPx?: number; maxPx?: number;
}): { fontPx: number; lines: string[] } {
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
  lines: string[]; boxW: number; boxH: number; italic: boolean; family: string;
  padX?: number; padY?: number; lineHeight?: number; minPx?: number; weights?: number[];
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

/* ===== Компонент ===== */
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

  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayFramesRef = useRef<HTMLDivElement | null>(null);
  const overlayContentRef = useRef<HTMLDivElement | null>(null);
  const templateRootRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const wishesTimerRef = useRef<number | null>(null);

  // Для aspectRatio контейнера
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(() => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined), [imgWH]);

  // Автосейв без петель
  const isSavingRef = useRef(false);
  const touchSaving = (ms = 350) => { isSavingRef.current = true; window.setTimeout(() => (isSavingRef.current = false), ms); };
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
  useEffect(() => {
    const apply = () => setDraft(loadOrderDraft());
    window.addEventListener("focus", apply);
    window.addEventListener("storage", apply);
    window.addEventListener(DRAFT_UPDATED_EVENT, apply as any);
    return () => {
      window.removeEventListener("focus", apply);
      window.removeEventListener("storage", apply);
      window.removeEventListener(DRAFT_UPDATED_EVENT, apply as any);
    };
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

  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) return (engr.epitaphs as string[]).filter(Boolean);
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim()) return [engr.epitaphText.trim()];
    return [];
  }, [engr]);

  const crosses = useMemo(
    () => graphics.filter((g) => (g.catName || g.catSlug || "").toLowerCase().includes("крест") || (g.catName || g.catSlug || "").toLowerCase().includes("cross")),
    [graphics]
  );
  const others = useMemo(
    () => graphics.filter((g) => !((g.catName || g.catSlug || "").toLowerCase().includes("крест") || (g.catName || g.catSlug || "").toLowerCase().includes("cross"))),
    [graphics]
  );

  /* ===== Скрыть подсказку из SketchTemplate и сам контент (оставляем только фон) ===== */
  const hideTemplateHintsAndContent = () => {
    const root = templateRootRef.current;
    if (!root) return;
    // скрываем верхнюю подсказку (сосед перед data-sketch-orient)
    const container = root.querySelector('[data-sketch-orient]') as HTMLElement | null;
    if (container) {
      const hint = container.previousElementSibling as HTMLElement | null;
      if (hint) hint.style.display = "none";
    }
    // скрываем «контент» SketchTemplate (портрет/метрика/эпитафия/графика/крест), чтобы не дублировать
    const nodes = root.querySelectorAll('[data-sketch-el]');
    nodes.forEach((el) => ((el as HTMLElement).style.visibility = "hidden"));
  };

  useEffect(() => {
    const t = requestAnimationFrame(hideTemplateHintsAndContent);
    window.addEventListener("resize", hideTemplateHintsAndContent);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("resize", hideTemplateHintsAndContent);
    };
  }, [item?.url, peopleBlocks, crosses, others, epitaphs]);

  /* ===== Измерение DOM SketchTemplate -> фреймы редактора ===== */
  const lastMeasuredSigRef = useRef<string>("");

  const measureAndApplyFrames = () => {
    const wrap = editorWrapRef.current;
    if (!wrap) return;

    const wrapRect = wrap.getBoundingClientRect();
    const contentLeft = wrapRect.left + SKETCH_PAD;
    const contentTop = wrapRect.top + SKETCH_PAD;
    const contentW = Math.max(1, wrapRect.width - SKETCH_PAD * 2);
    const contentH = Math.max(1, wrapRect.height - SKETCH_PAD * 2);

    const tplRoot = templateRootRef.current;
    if (!tplRoot) return;

    const nodes = tplRoot.querySelectorAll('[data-sketch-el]');
    const entries: EditorEl[] = [];

    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const kind = (el.getAttribute("data-sketch-el") || "").trim() as ElType | string;
      const key = (el.getAttribute("data-sketch-key") || "").trim();
      if (!kind) return;

      // Для метрики и графики берём БЛИЖАЙШИЙ «контейнер» (иногда внутренние ноды имеют padding/scale)
      let target: HTMLElement = el;
      if (kind === "metric" || kind === "graphic") {
        const parent = el.parentElement as HTMLElement | null;
        if (parent && parent.hasAttribute("data-sketch-el") === false) {
          // используем ширину родителя, если он явно шире
          const pr = parent.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          if (pr.width > er.width) target = parent;
        }
      }

      const r = target.getBoundingClientRect();
      let xPct = ((r.left - contentLeft) / contentW) * 100;
      let yPct = ((r.top - contentTop) / contentH) * 100;
      let wPct = (r.width / contentW) * 100;
      let hPct = (r.height / contentH) * 100;

      // Небольшая компенсация для graphic и metric по ширине (±0.5%), чтобы попасть «в пиксель»
      if (kind === "graphic" || kind === "metric") {
        wPct = wPct * 1.005; // +0.5%
      }

      xPct = clamp(xPct, 0, 100);
      yPct = clamp(yPct, 0, 100);
      wPct = clamp(wPct, 0, 100);
      hPct = clamp(hPct, 0, 100);

      let id = "";
      let type: ElType | null = null;
      if (kind === "portrait") { id = `portrait-${key}`; type = "portrait"; }
      else if (kind === "metric") { id = `metric-${key}`; type = "metric"; }
      else if (kind === "epitaph") { id = `epitaph-${key}`; type = "epitaph"; }
      else if (kind === "graphic") { id = `graphic-${key}`; type = "graphic"; }
      else if (kind === "cross") { id = `cross-${key}`; type = "cross"; }
      if (!id || !type) return;

      let z = 0;
      if (type === "portrait") z = 10;
      else if (type === "metric") z = 20;
      else if (type === "epitaph") z = 30 + Number(key);
      else if (type === "cross") z = 40 + Number(key);
      else if (type === "graphic") z = 50 + Number(key);

      entries.push({
        id, type,
        x: xPct, y: yPct, w: Math.max(2, wPct), h: Math.max(2, hPct),
        z, title: id
      });
    });

    const sig = JSON.stringify(entries.map((e) => ({ id: e.id, x: +e.x.toFixed(2), y: +e.y.toFixed(2), w: +e.w.toFixed(2), h: +e.h.toFixed(2), z: e.z })));
    if (lastMeasuredSigRef.current === sig) return;
    lastMeasuredSigRef.current = sig;

    // Применяем фреймы (и переносим пользовательские флаги)
    setElements((prev) => {
      const prevMap = new Map(prev.map((p) => [p.id, p]));
      const next = entries.map((e) => {
        const old = prevMap.get(e.id);
        return old
          ? { ...e, uppercase: old.uppercase, italic: old.italic, flipH: old.flipH, bw: old.bw, staircase: old.staircase }
          : e;
      });
      // переносим прочие элементы
      prev.forEach((p) => { if (!next.find((n) => n.id === p.id)) next.push(p); });
      return next;
    });
  };

  // измеряем после построения шаблона
  useEffect(() => {
    const onRaf = () => {
      measureAndApplyFrames();
      hideTemplateHintsAndContent();
    };
    const id = requestAnimationFrame(onRaf);
    const onResize = () => requestAnimationFrame(onRaf);
    window.addEventListener("resize", onResize);
    window.addEventListener(DRAFT_UPDATED_EVENT, onResize as any);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
      window.removeEventListener(DRAFT_UPDATED_EVENT, onResize as any);
    };
  }, [item?.url, peopleBlocks, crosses, others, epitaphs]);

  /* ===== DnD/Resize — теперь фреймы двигают РЕНДЕР сверху (контент слоя overlayContent) ===== */
  const dragRef = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number;
    start: EditorEl;
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
    const wrap = editorWrapRef.current; if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const contentW = rect.width - SKETCH_PAD * 2;
    const contentH = rect.height - SKETCH_PAD * 2;
    if (contentW <= 0 || contentH <= 0) return;

    const dxPct = ((e.clientX - d.startX) / contentW) * 100;
    const dyPct = ((e.clientY - d.startY) / contentH) * 100;
    const withSnap = !e.altKey;
    const snapStep = e.shiftKey ? 1.5 : 1;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        let { x, y, w, h } = d.start;

        if (d.mode === "move") {
          let nx = x + dxPct, ny = y + dyPct;
          if (withSnap) { nx = snap(nx, snapStep); ny = snap(ny, snapStep); }
          return { ...el, ...clampBox(nx, ny, w, h) };
        }

        const keepRatio = e.shiftKey;
        let nx = x, ny = y, nw = w, nh = h;
        const ratio = w / h || 1;

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
      })
    );
  };
  const onPointerUp = () => { dragRef.current = null; };

  // Автосохранение редактора
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

  /* ===== Контент поверх (управляется фреймами) ===== */
  const ContentOverlay = () => {
    const fam = `"Century Schoolbook","Times New Roman",serif`;
    const wrap = editorWrapRef.current?.getBoundingClientRect();
    const contentW = Math.max(1, (wrap?.width || 1) - SKETCH_PAD * 2);
    const contentH = Math.max(1, (wrap?.height || 1) - SKETCH_PAD * 2);

    return (
      <div
        ref={overlayContentRef}
        style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, pointerEvents: "none" }}
      >
        {elements
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((el) => {
            const key = el.id.split("-").slice(1).join("-");
            const boxPx = { x: (el.x / 100) * contentW, y: (el.y / 100) * contentH, w: (el.w / 100) * contentW, h: (el.h / 100) * contentH };

            if (el.type === "portrait") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const url = p?.photo || "";
              const filt = el.bw ? "grayscale(100%)" : "none";
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: el.x + "%", top: el.y + "%", width: el.w + "%", height: el.h + "%", zIndex: el.z, pointerEvents: "none" }}>
                  {url ? (
                    <img src={url} alt="Портрет" style={{ width: "100%", height: "100%", objectFit: "cover", filter: filt, display: "block" }} draggable={false} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.6 }}>(нет фото)</div>
                  )}
                </div>
              );
            } else if (el.type === "metric") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
              const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
              const padX = Math.max(4, Math.round(boxPx.w * 0.04));
              const padY = Math.max(2, Math.round(boxPx.h * 0.10));
              const fitted = fitMetricFontsPx({ lines: lines.map(tf), boxW: boxPx.w, boxH: boxPx.h, italic: !!el.italic, family: fam, padX, padY, lineHeight: 1.12, minPx: 10 });
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: el.x + "%", top: el.y + "%", width: el.w + "%", height: el.h + "%", zIndex: el.z, color: "#fff", fontFamily: fam, textAlign: "center", pointerEvents: "none" }}>
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: `${padY}px ${padX}px`, boxSizing: "border-box", lineHeight: 1.12, fontStyle: el.italic ? "italic" : "normal", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    <div style={{ display: "grid", gap: 2, width: "100%" }}>
                      {lines[0] && <div style={{ fontWeight: 700, fontSize: fitted[0] || 12 }}>{tf(lines[0])}</div>}
                      {lines[1] && <div style={{ fontWeight: 600, fontSize: fitted[1] || 11 }}>{tf(lines[1])}</div>}
                      {lines[2] && <div style={{ fontWeight: 400, fontSize: fitted[2] || 10, opacity: 0.95 }}>{tf(lines[2])}</div>}
                    </div>
                  </div>
                </div>
              );
            } else if (el.type === "epitaph") {
              const idx = Number(key);
              const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
              const txt = el.uppercase ? tRaw.toUpperCase() : tRaw;
              const padX = Math.max(4, Math.round(boxPx.w * 0.04));
              const padY = Math.max(2, Math.round(boxPx.h * 0.06));
              const { fontPx, lines } = fitMultilineFontPx({ text: txt, boxW: boxPx.w, boxH: boxPx.h, italic: !!el.italic, family: fam, padX, padY, lineHeight: 1.15 });
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: el.x + "%", top: el.y + "%", width: el.w + "%", height: el.h + "%", zIndex: el.z, color: "#fff", fontFamily: fam, textAlign: "center", pointerEvents: "none" }}>
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: `${padY}px ${padX}px`, boxSizing: "border-box", lineHeight: 1.15, fontStyle: el.italic ? "italic" : "normal", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    <div style={{ fontWeight: 600, fontSize: fontPx, whiteSpace: "pre-wrap" }}>{lines.join("\n")}</div>
                  </div>
                </div>
              );
            } else if (el.type === "cross") {
              const idx = Number(key);
              const c = Number.isFinite(idx) ? crosses[idx] : undefined;
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: el.x + "%", top: el.y + "%", width: el.w + "%", height: el.h + "%", zIndex: el.z, pointerEvents: "none" }}>
                  {c?.url ? <img src={c.url} alt={c.name || "Крест"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} /> : null}
                </div>
              );
            } else if (el.type === "graphic") {
              const idx = Number(key);
              const g = Number.isFinite(idx) ? others[idx] : undefined;
              const tr = el.flipH ? "scaleX(-1)" : "none";
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: el.x + "%", top: el.y + "%", width: el.w + "%", height: el.h + "%", zIndex: el.z, pointerEvents: "none" }}>
                  {g?.url ? <img src={g.url} alt={g.name || "Графика"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", transform: tr, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} /> : null}
                </div>
              );
            }
            return null;
          })}
      </div>
    );
  };

  /* ===== Мини‑панель на фреймах ===== */
  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
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
          <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, italic: !e.italic } : e)))}>
            {el.italic ? "Обычный" : "Курсив"}
          </button>
        )}
        {isGraphic && (
          <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))}>
            Отразить ⇄
          </button>
        )}
      </div>
    );
  };

  const handleDot = (left: number | string, top: number | string, cursor: string): React.CSSProperties => ({
    position: "absolute",
    left, top, width: 10, height: 10,
    background: "#fff", border: "1px solid #000",
    borderRadius: 2, transform: "translate(-50%, -50%)",
    cursor
  });

  /* ===== Разметка ===== */
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

        {/* Подсказка шага — только эта (подсказку SketchTemplate скрываем программно) */}
        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Разместите элементы условно. Укажите порядок и выравнивание (крест слева/справа, направление бутонов, строчные/ПРОПИСНЫЕ). Финальный вариант сделает специалист исходя из технических требований и согласно этой схеме.
        </section>

        {/* Эскиз: подложка (SketchTemplate) + наш контент + фреймы */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={editorWrapRef}
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
            {/* Подложка (как на предыдущих шагах) */}
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

            {/* Технический img, чтобы узнать естественное соотношение */}
            <img
              src={item?.url || ""}
              alt=""
              style={{ position: "absolute", inset: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => {
                if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 });
              }}
            />

            {/* Наш контент (рисуется по фреймам) */}
            <ContentOverlay />

            {/* Слой фреймов */}
            <div
              ref={overlayFramesRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={(e) => {
                if (!editorWrapRef.current) return;
                if (e.altKey) {
                  // Alt+клик — выбрать нижний под курсором
                  const rect = editorWrapRef.current.getBoundingClientRect();
                  const contentW = rect.width - SKETCH_PAD * 2;
                  const contentH = rect.height - SKETCH_PAD * 2;
                  const cx = ((e.clientX - (rect.left + SKETCH_PAD)) / contentW) * 100;
                  const cy = ((e.clientY - (rect.top + SKETCH_PAD)) / contentH) * 100;
                  const under = elements.slice().sort((a, b) => b.z - a.z).find((el) => cx >= el.x && cx <= el.x + el.w && cy >= el.y && cy <= el.y + el.h);
                  if (under) setSelectedId(under.id);
                } else {
                  setSelectedId(null);
                }
              }}
              style={{
                position: "absolute",
                left: SKETCH_PAD,
                top: SKETCH_PAD,
                right: SKETCH_PAD,
                bottom: SKETCH_PAD,
                zIndex: 1000,
                pointerEvents: "none"
              }}
            >
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
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={handleDot(0, 0, "nwse-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={handleDot("100%", 0, "nesw-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={handleDot("100%", "100%", "nwse-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={handleDot(0, "100%", "nesw-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={handleDot("50%", 0, "ns-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={handleDot("100%", "50%", "ew-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={handleDot("50%", "100%", "ns-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={handleDot(0, "50%", "ew-resize")} />
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
          <button type="button" onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
