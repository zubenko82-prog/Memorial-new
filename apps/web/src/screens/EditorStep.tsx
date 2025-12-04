// src/screens/EditorStep.tsx
// Редактор поверх того же шаблона (SketchTemplate):
// - Один раз (и при изменении контента) снимаем «снимок» раскладки из SketchTemplate (DOM data-sketch-el).
// - Полностью скрываем контент SketchTemplate (чтобы не «просвечивал» и не мигал), оставляем только фон изделия.
// - Рисуем свой управляемый контент и фреймы поверх. Движение/ресайз фреймов двигает наш контент.
// - Сохраняем правки в драфт + генерируем превью и передаём его в TopBarWithIntro.
//
// Исправлено:
// - Метрика измеряется только по своему data-sketch-el (без родителя и без ширинной поправки).
// - Больше нет «отката к исходному» после перетаскивания: авто‑снятие раскладки не запускается во время редактирования
//   и вообще только при реальном изменении входного контента (item/people/graphics/epitaphs).
// - Подложка (контент SketchTemplate) скрыта жёстко через CSS и inline (не просвечивает при DnD).
// - Сохранение происходит по таймауту и по отпусканию мыши; превью уходит в TopBar (миниатюра).

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
  x: number; y: number; w: number; h: number; // проценты внутрь контентной области
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
const normRemember = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim();

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

  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const templateRootRef = useRef<HTMLDivElement | null>(null);
  const overlayFramesRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const wishesTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  // Для aspectRatio контейнера
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(() => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined), [imgWH]);

  // Сохранение без петель
  const isSavingRef = useRef(false);
  const touchSaving = (ms = 350) => { isSavingRef.current = true; window.setTimeout(() => (isSavingRef.current = false), ms); };
  const saveEditor = (updater: (prev: OrderDraft) => OrderDraft, andSetDraft = false) => {
    const prev = loadOrderDraft();
    const next = updater(prev);
    const prevJson = JSON.stringify(prev.editor || {});
    const nextJson = JSON.stringify(next.editor || {});
    if (prevJson === nextJson) return;
    touchSaving();
    saveOrderDraft(next);
    if (andSetDraft) setDraft(next);
  };

  // Live reload драфта (но авто-снятие раскладки не трогаем)
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

  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) return (engr.epitaphs as string[]).filter(Boolean);
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim()) return [engr.epitaphText.trim()];
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

  /* ===== Сигнатура контента (для запуска снятия раскладки) ===== */
  const contentSig = useMemo(() => {
    const ppl = peopleBlocks.map(p => ({ id: p.id, lines: p.lines.join("|"), has: !!p.photo })).map(x => `${x.id}:${x.lines}:${x.has?'1':'0'}`).join("||");
    const cr = crosses.map(c => c.url).join("|");
    const ot = others.map(o => o.url).join("|");
    const ep = epitaphs.join("||");
    const itemUrl = item?.url || "";
    return [itemUrl, ppl, cr, ot, ep].join("::");
  }, [item?.url, peopleBlocks, crosses, others, epitaphs]);
  const lastAppliedContentSigRef = useRef<string>("");

  // Когда юзер редактирует — запрещаем авто‑снятие раскладки
  const userEditingRef = useRef(false);

  /* ===== Скрытие подсказки/контента SketchTemplate (CSS правилом, чтобы не «откатывалось») ===== */
  const cssOnceRef = useRef(false);
  useEffect(() => {
    if (cssOnceRef.current) return;
    const st = document.createElement("style");
    st.setAttribute("data-editor-shadow-css", "1");
    st.innerHTML = `
      [data-editor-wrap] [data-sketch-el] { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }
    `;
    document.head.appendChild(st);
    cssOnceRef.current = true;
    return () => {
      document.head.removeChild(st);
      cssOnceRef.current = false;
    };
  }, []);

  /* ===== Измерение DOM SketchTemplate -> фреймы (только при изменении контента и если не редактируем) ===== */
  const measureAndApplyFrames = () => {
    const wrap = editorWrapRef.current;
    const root = templateRootRef.current;
    if (!wrap || !root) return;
    const wrapRect = wrap.getBoundingClientRect();
    const contentLeft = wrapRect.left + SKETCH_PAD;
    const contentTop = wrapRect.top + SKETCH_PAD;
    const contentW = Math.max(1, wrapRect.width - SKETCH_PAD * 2);
    const contentH = Math.max(1, wrapRect.height - SKETCH_PAD * 2);

    const nodes = root.querySelectorAll('[data-sketch-el]');
    const entries: EditorEl[] = [];

    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const kind = (el.getAttribute("data-sketch-el") || "").trim();
      const key = (el.getAttribute("data-sketch-key") || "").trim();
      if (!kind) return;

      let target: HTMLElement = el;
      // Только graphic может брать родителя (иногда родитель шире)
      if (kind === "graphic") {
        const p = el.parentElement as HTMLElement | null;
        if (p) {
          const pr = p.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          if (pr.width - er.width > 2) target = p;
        }
      }
      const r = target.getBoundingClientRect();
      let xPct = ((r.left - contentLeft) / contentW) * 100;
      let yPct = ((r.top - contentTop) / contentH) * 100;
      let wPct = (r.width / contentW) * 100;
      let hPct = (r.height / contentH) * 100;
      if (kind === "graphic") {
        wPct *= 1.006; // субпиксельная поправка
      }

      xPct = clamp(xPct, 0, 100);
      yPct = clamp(yPct, 0, 100);
      wPct = clamp(wPct, 0, 100);
      hPct = clamp(hPct, 0, 100);

      let id = "", type: ElType | null = null;
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

      entries.push({ id, type, x: xPct, y: yPct, w: Math.max(2, wPct), h: Math.max(2, hPct), z, title: id });
    });

    setElements((prev) => {
      const prevMap = new Map(prev.map((p) => [p.id, p]));
      // Если пользователь уже редактировал (расхождение по координатам с предыдущим), не перетирать!
      const next = entries.map((e) => {
        const old = prevMap.get(e.id);
        if (!old) return e;
        // Сохраняем пользовательские флаги
        return {
          ...e,
          uppercase: old.uppercase,
          italic: old.italic,
          flipH: old.flipH,
          bw: old.bw,
          staircase: old.staircase
        };
      });
      // переносим «нестандартные» (если есть)
      prev.forEach((p) => { if (!next.find((n) => n.id === p.id)) next.push(p); });
      return next;
    });
    lastAppliedContentSigRef.current = contentSig;
  };

  useEffect(() => {
    if (userEditingRef.current) return; // не мерить во время редактирования
    if (lastAppliedContentSigRef.current === contentSig) return;
    // Снимок раскладки только при реальном изменении входного контента
    requestAnimationFrame(() => {
      measureAndApplyFrames();
      // и гарантированно скрыть контент подложки
      const root = templateRootRef.current;
      if (root) {
        const hint = root.querySelector('[data-sketch-orient]')?.previousElementSibling as HTMLElement | null;
        if (hint) hint.style.display = "none";
        root.querySelectorAll('[data-sketch-el]').forEach((el) => {
          const n = el as HTMLElement;
          n.style.visibility = "hidden";
          n.style.opacity = "0";
          n.style.pointerEvents = "none";
        });
      }
    });
  }, [contentSig]);

  /* ===== DnD/Resize ===== */
  const dragRef = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number;
    start: EditorEl;
  } | null>(null);

  const onPointerDownBox = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move"
  ) => {
    e.stopPropagation();
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    userEditingRef.current = true;
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
  const onPointerUp = () => {
    if (dragRef.current) {
      // Сохранить и сгенерировать превью
      saveEditor((prev) => ({
        ...prev,
        editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
      } as OrderDraft), true);
      queuePreviewGeneration();
    }
    dragRef.current = null;
    userEditingRef.current = false;
  };

  // Автосохранение редактора (дополнительно к onPointerUp)
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveEditor((prev) => ({
        ...prev,
        editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
      } as OrderDraft), true);
    }, 300) as unknown as number;
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [elements, wishes]);

  useEffect(() => {
    if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current);
    wishesTimerRef.current = window.setTimeout(() => {
      saveEditor((prev) => {
        if (prev.editor?.wishes === wishes) return prev;
        return { ...prev, editor: { ...(prev.editor || {}), wishes, updatedAt: Date.now() } } as OrderDraft;
      }, true);
    }, 320) as unknown as number;
    return () => { if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current); };
  }, [wishes]);

  /* ===== Превью (мини/большое) для TopBar и драфта ===== */
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
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        // фон (градиент + фото изделия)
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#6e6e6e");
        grad.addColorStop(0.2, "#464545");
        grad.addColorStop(0.4, "#424242");
        grad.addColorStop(0.7, "#888888");
        grad.addColorStop(1.0, "#ffffff");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // фото
        const base = await new Promise<HTMLImageElement | null>((resolve) => {
          const url = item?.url || "";
          if (!url) return resolve(null);
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.onload = () => resolve(im);
          im.onerror = () => resolve(null);
          im.src = url;
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

        for (const el of elements.slice().sort((a, b) => a.z - b.z)) {
          const rbox = { x: CX + (el.x / 100) * PW, y: CY + (el.y / 100) * PH, w: (el.w / 100) * PW, h: (el.h / 100) * PH };
          const key = el.id.split("-").slice(1).join("-");
          if (el.type === "portrait") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const url = p?.photo || ""; if (!url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => {
              const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url;
            });
            if (!im) continue;
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            ctx.save(); ctx.beginPath(); ctx.rect(rbox.x, rbox.y, rbox.w, rbox.h); ctx.clip();
            if (el.bw) ctx.filter = "grayscale(100%)";
            if (sr2 > dr2) {
              const hh = rbox.h, ww = Math.round(hh * sr2), xx = Math.round(rbox.x + (rbox.w - ww) / 2), yy = rbox.y;
              ctx.drawImage(im, xx, yy, ww, hh);
            } else {
              const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2);
              ctx.drawImage(im, xx, yy, ww, hh);
            }
            ctx.restore(); ctx.filter = "none";
          } else if (el.type === "metric") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
            const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
            ctx.save();
            ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04));
            const padY2 = Math.max(2, Math.round(rbox.h * 0.10));
            const fitted = fitMetricFontsPx({ lines: lines.map(tf), boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.12, minPx: 10 });
            const totalH = fitted.reduce((a, b) => a + b * 1.12, 0);
            let y = rbox.y + (rbox.h - totalH) / 2 + (fitted[0] || 10) * 1.12 / 2;
            for (let i = 0; i < fitted.length; i++) {
              setFontOnCtx(ctx, !!el.italic, fitted[i], fam);
              ctx.fillText(tf(lines[i]), rbox.x + rbox.w / 2, y);
              y += fitted[i] * 1.12;
            }
            ctx.restore();
          } else if (el.type === "epitaph") {
            const idx = Number(key);
            const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
            const txt = el.uppercase ? tRaw.toUpperCase() : tRaw;
            ctx.save(); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04));
            const padY2 = Math.max(2, Math.round(rbox.h * 0.06));
            const { fontPx, lines } = fitMultilineFontPx({ text: txt, boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.15 });
            setFontOnCtx(ctx, !!el.italic, fontPx, fam);
            const count = Math.max(1, lines.length);
            const lineH = (rbox.h - padY2 * 2) / count;
            for (let i = 0; i < count; i++) {
              const yy = rbox.y + padY2 + lineH * (i + 0.5);
              ctx.fillText(lines[i], rbox.x + rbox.w / 2, yy);
            }
            ctx.restore();
          } else if (el.type === "graphic") {
            const idx = Number(key);
            const g = Number.isFinite(idx) ? others[idx] : undefined;
            if (!g?.url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => {
              const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = g.url;
            });
            if (!im) continue;
            ctx.save();
            if (el.flipH) { ctx.translate(rbox.x + rbox.w / 2, rbox.y + rbox.h / 2); ctx.scale(-1, 1); ctx.translate(-(rbox.x + rbox.w / 2), -(rbox.y + rbox.h / 2)); }
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            if (sr2 > dr2) {
              const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2);
              ctx.drawImage(im, xx, yy, ww, hh);
            } else {
              const hh = rbox.h, ww = Math.round(hh * sr2), xx = rbox.x + Math.round((rbox.w - ww) / 2), yy = rbox.y;
              ctx.drawImage(im, xx, yy, ww, hh);
            }
            ctx.restore();
          } else if (el.type === "cross") {
            const idx = Number(key);
            const c = Number.isFinite(idx) ? crosses[idx] : undefined;
            if (!c?.url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => {
              const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = c.url;
            });
            if (!im) continue;
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            if (sr2 > dr2) {
              const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2);
              ctx.drawImage(im, xx, yy, ww, hh);
            } else {
              const hh = rbox.h, ww = Math.round(hh * sr2), xx = rbox.x + Math.round((rbox.w - ww) / 2), yy = rbox.y;
              ctx.drawImage(im, xx, yy, ww, hh);
            }
          }
        }
        return canvas.toDataURL("image/jpeg", 0.9);
      }

      const mini = await drawPreview(Math.max(320, Math.floor(r.width)), Math.max(320, Math.floor(r.height)));
      const maxSide = 1600;
      const ratio = r.width / (r.height || 1);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await drawPreview(bigW, bigH);

      saveEditor((prev) => ({
        ...prev,
        editor: {
          ...(prev.editor || {}),
          previewUrl: mini || (prev.editor as any)?.previewUrl || null,
          previewHiUrl: big || (prev.editor as any)?.previewHiUrl || null,
          previewUpdatedAt: Date.now(),
          elements,
          wishes
        }
      } as OrderDraft), true);
    }, 280) as unknown as number;
  };

  useEffect(() => {
    queuePreviewGeneration();
    return () => { if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current); };
  }, [elements, peopleBlocks, crosses, others, epitaphs, aspect, wishes, item?.url]);

  /* ===== Контент поверх (им управляют фреймы) ===== */
  const ContentOverlay = () => {
    const fam = FONT_CENTURY;
    const wrap = editorWrapRef.current?.getBoundingClientRect();
    const contentW = Math.max(1, (wrap?.width || 1) - SKETCH_PAD * 2);
    const contentH = Math.max(1, (wrap?.height || 1) - SKETCH_PAD * 2);

    return (
      <div
        style={{
          position: "absolute",
          left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD,
          pointerEvents: "none", zIndex: 1000
        }}
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
                <div key={`content-${el.id}`} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, zIndex: el.z }}>
                  {url ? <img src={url} alt="Портрет" style={{ width: "100%", height: "100%", objectFit: "cover", filter: filt, display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.6 }}>(нет фото)</div>}
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
                <div key={`content-${el.id}`} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, zIndex: el.z, color: "#fff", fontFamily: fam, textAlign: "center" }}>
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
                <div key={`content-${el.id}`} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, zIndex: el.z, color: "#fff", fontFamily: fam, textAlign: "center" }}>
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", padding: `${padY}px ${padX}px`, boxSizing: "border-box", lineHeight: 1.15, fontStyle: el.italic ? "italic" : "normal", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                    <div style={{ fontWeight: 600, fontSize: fontPx, whiteSpace: "pre-wrap" }}>{lines.join("\n")}</div>
                  </div>
                </div>
              );
            } else if (el.type === "cross") {
              const idx = Number(key);
              const c = Number.isFinite(idx) ? crosses[idx] : undefined;
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, zIndex: el.z }}>
                  {c?.url ? <img src={c.url} alt={c.name || "Крест"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} /> : null}
                </div>
              );
            } else if (el.type === "graphic") {
              const idx = Number(key);
              const g = Number.isFinite(idx) ? others[idx] : undefined;
              const tr = el.flipH ? "scaleX(-1)" : "none";
              return (
                <div key={`content-${el.id}`} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, zIndex: el.z }}>
                  {g?.url ? <img src={g.url} alt={g.name || "Графика"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", transform: tr, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} /> : null}
                </div>
              );
            }
            return null;
          })}
      </div>
    );
  };

  /* ===== Мини‑панель и ручки resize ===== */
  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
    const isPortrait = el.type === "portrait";
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
        {isPortrait && (
          <button type="button" style={btn} onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, bw: !e.bw } : e)))}>
            {el.bw ? "Цвет" : "Ч/Б"}
          </button>
        )}
      </div>
    );
  };

  function handleDot(left: number | string, top: number | string, cursor: string): React.CSSProperties {
    return {
      position: "absolute",
      left, top,
      width: 10, height: 10,
      background: "#fff", border: "1px solid #000",
      borderRadius: 2, transform: "translate(-50%, -50%)",
      cursor
    };
  }

  /* ===== Навигация + превью в топбар ===== */
  const handleBack = () => {
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    } as OrderDraft), true);
    queuePreviewGeneration();
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };
  const handleContinue = () => {
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    } as OrderDraft), true);
    queuePreviewGeneration();
    const go = onRearSide || onSendOrder || onContinue;
    if (!go) return;
    setOutro(true);
    setTimeout(() => go({ elements, wishes }), 150);
  };

  const MAX_W = 600;
  const miniPreview = (draft as any)?.editor?.previewUrl || null;

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
        <TopBarWithIntro title="Memorial" previewUrl={miniPreview} />

        {/* Подсказка шага */}
        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Разместите элементы условно. Укажите порядок и выравнивание (крест слева/справа, направление бутонов, строчные/ПРОПИСНЫЕ). Финальный вариант сделает специалист исходя из технических требований и согласно этой схеме.
        </section>

        {/* Эскиз: подложка (SketchTemplate) + наш контент + фреймы */}
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

            {/* Наш управляемый контент */}
            <ContentOverlay />

            {/* Слой фреймов */}
            <div
              ref={overlayFramesRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={(e) => {
                // Сброс выбора только при клике по пустому месту контейнера фреймов
                if (e.target === e.currentTarget) {
                  if (e.altKey) {
                    const rect = editorWrapRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const contentW = rect.width - SKETCH_PAD * 2;
                    const contentH = rect.height - SKETCH_PAD * 2;
                    const cx = ((e.clientX - (rect.left + SKETCH_PAD)) / contentW) * 100;
                    const cy = ((e.clientY - (rect.top + SKETCH_PAD)) / contentH) * 100;
                    const under = elements
                      .slice()
                      .sort((a, b) => b.z - a.z)
                      .find((el) => cx >= el.x && cx <= el.x + el.w && cy >= el.y && cy <= el.y + el.h);
                    if (under) setSelectedId(under.id);
                  } else {
                    setSelectedId(null);
                  }
                }
              }}
              style={{
                position: "absolute",
                left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD,
                zIndex: 1001,
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
                          {/* Углы */}
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={handleDot(0, 0, "nwse-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={handleDot("100%", 0, "nesw-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={handleDot("100%", "100%", "nwse-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={handleDot(0, "100%", "nesw-resize")} />
                          {/* Стороны */}
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
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
