// src/screens/EditorStep.tsx
// Редактор поверх шаблона SketchTemplate.
// Исправления по жалобам:
// - Дубли («статичная копия» под фреймами): теперь всегда скрываем исходный контент SketchTemplate (data-sketch-el)
//   ТОЛЬКО ПОСЛЕ измерений и повторно при любых изменениях/перерисовках (MutationObserver + ResizeObserver).
// - «Редактируется только крест»: исправлено — снимаем раскладку ПОСЛЕ того, как контент действительно отрисовался
//   (двойной rAF + наблюдатели). Строим фреймы для портрета, метрики, эпитафии, графики и креста.
// - «Метрика и эпитафия только статичные и не на своём месте»: измерения повторяются до появления этих узлов;
//   фреймы строятся корректно, статичный слой скрывается.
// - Ручки ресайза: увеличены чувствительные области (hit-areas) — попадать с телефона стало проще.

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

/* ===== Fit helpers (canvas) ===== */
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

  /* ===== CSS подложки: НЕ скрываем сразу — только отключаем события ===== */
  const cssOnceRef = useRef(false);
  useEffect(() => {
    if (cssOnceRef.current) return;
    const st = document.createElement("style");
    st.setAttribute("data-editor-shadow-css", "1");
    st.innerHTML = `
      [data-editor-wrap] [data-sketch-el] { pointer-events: none !important; }
    `;
    document.head.appendChild(st);
    cssOnceRef.current = true;
    return () => {
      document.head.removeChild(st);
      cssOnceRef.current = false;
    };
  }, []);

  /* ===== Наблюдатели: следим за DOM/размером подложки, чтобы вовремя снять раскладку и скрыть её ===== */
  const moRef = useRef<MutationObserver | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const measureRafRef = useRef<number | null>(null);
  const scheduleMeasure = (delayRaf = true) => {
    if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
    measureRafRef.current = requestAnimationFrame(() => {
      if (delayRaf) {
        requestAnimationFrame(measureAndApplyFrames); // двойной rAF чтобы точно дождаться layout/painт
      } else {
        measureAndApplyFrames();
      }
    });
  };

  useEffect(() => {
    const root = templateRootRef.current;
    if (!root) return;
    // MutationObserver — появление/перемещение узлов data-sketch-el
    moRef.current = new MutationObserver(() => scheduleMeasure(true));
    moRef.current.observe(root, { subtree: true, childList: true, attributes: true });
    // ResizeObserver — изменения размеров
    roRef.current = new ResizeObserver(() => scheduleMeasure(false));
    roRef.current.observe(root);
    // Первая попытка снятия
    scheduleMeasure(true);

    return () => {
      moRef.current?.disconnect();
      roRef.current?.disconnect();
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
    };
  }, []);

  /* ===== Измерение DOM SketchTemplate -> фреймы ===== */
  const measureAndApplyFrames = () => {
    const wrap = editorWrapRef.current;
    const root = templateRootRef.current;
    if (!wrap || !root) return;

    const wrapRect = wrap.getBoundingClientRect();
    const contentLeft = wrapRect.left + SKETCH_PAD;
    const contentTop = wrapRect.top + SKETCH_PAD;
    const contentW = Math.max(1, wrapRect.width - SKETCH_PAD * 2);
    const contentH = Math.max(1, wrapRect.height - SKETCH_PAD * 2);

    const nodes = root.querySelectorAll("[data-sketch-el]");
    if (nodes.length === 0) return;

    const entries: EditorEl[] = [];

    nodes.forEach((node) => {
      const el = node as HTMLElement;
      const kind = (el.getAttribute("data-sketch-el") || "").trim();
      const key = (el.getAttribute("data-sketch-key") || "").trim();
      if (!kind) return;

      let target: HTMLElement = el;
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
        wPct *= 1.006;
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

    // Применяем измеренное
    setElements((prev) => {
      const prevMap = new Map(prev.map((p) => [p.id, p]));
      const next = entries.map((e) => {
        const old = prevMap.get(e.id);
        if (!old) return e;
        return {
          ...e,
          uppercase: old.uppercase,
          italic: old.italic,
          flipH: old.flipH,
          bw: old.bw,
          staircase: old.staircase
        };
      });
      prev.forEach((p) => { if (!next.find((n) => n.id === p.id)) next.push(p); });
      return next;
    });

    // ВАЖНО: скрыть исходный контент подложки (только после измерений)
    root.querySelectorAll("[data-sketch-el]").forEach((el) => {
      const n = el as HTMLElement;
      n.style.opacity = "0";
      n.style.visibility = "hidden";
      n.style.pointerEvents = "none";
    });

    lastAppliedContentSigRef.current = contentSig;
  };

  useEffect(() => {
    if (userEditingRef.current) return;
    // При смене контента переснимаем раскладку
    if (lastAppliedContentSigRef.current !== contentSig) {
      scheduleMeasure(true);
    }
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
        let { xdiv style={dotStyle("50%", 0)} />

                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={hitStyle("100%", "50%", "ew-resize", sideH, sideW)} />
                          <div style={dotStyle("100%", "50%")} />

                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={hitStyle("50%", "100%", "ns-resize", sideW, sideH)} />
                          <div style={dotStyle("50%", "100%")} />

                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={hitStyle(0, "50%", "ew-resize", sideH, sideW)} />
                          <div style={dotStyle(0, "50%")} />
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
