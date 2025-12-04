// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
//
// Обновлено (горизонтальные шаблоны для 2+ людей):
// - Портрет и метрика по высоте вместе занимают ≈90% высоты эскиза (H).
// - Метрика уменьшена и по ширине немного больше портрета (≈ +8%, с ограничением по ширине колонки).
// - Для 2 людей распределение по высоте: портрет ~55% C, метрика ~35% C (C = 90% H); для 3+ — портрет ~50% C, метрика ~40% C.
// - Ширина портрета сохраняет соотношение 3:4 (pw = ph*0.75); метрика шире портрета, но не шире колонки.
//
// Также сохранено:
// - Эпитафии располагаются над графикой, графика — у низа.
// - Анти-дребезг измерений: state меняется только при реальном изменении.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

type Orientation = "vertical" | "horizontal";

export type SketchTemplateProps = {
  item: { url?: string; name?: string } | null;
  peopleBlocks: Array<{ id: string; lines: string[]; photo?: string | null }>;
  crosses?: Array<{ url: string; name?: string }>;
  others?: Array<{ url: string; name?: string }>;
  epitaphs?: string[];
  carvingOpacity?: number;
  style?: React.CSSProperties;
  orientationOverride?: Orientation;
};

const FONT_CENTURY = `"Century Schoolbook","Times New Roman",serif`;

const CFG = {
  general: {
    minContainerHeight: 200,
    containerPadding: 8,
    carvingOpacityDefault: 0.4
  },
  horizontal: {
    layout: { gap: 12, columnMinW: 140 },
    one: { blocks: { cross: { size: { width: "8%", height: "auto" } } } },
    two: { blocks: { cross: { size: { width: "8%", height: "auto" } } } },
    many: { blocks: { cross: { size: { width: "7%", height: "auto" } } } }
  },
  vertical: {
    layout: { rowsHeightFactor: 0.5, rowGapPx: 10 },
    one: { blocks: { cross: { size: { width: "14%", height: "auto" } } } },
    two: { blocks: { cross: { size: { width: "14%", height: "auto" } } } },
    many: { blocks: { cross: { size: { width: "13%", height: "auto" } } } }
  }
} as const;

const EPS = 0.0005;
const pxChanged = (a: number, b: number, tol = 0.5) => Math.abs(a - b) > tol;

function bottomUnderlayGradient(): React.CSSProperties {
  return {
    backgroundColor: "#000",
    backgroundImage: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  };
}

function pickTplKey(n: number): "one" | "two" | "many" {
  if (n <= 1) return "one";
  if (n === 2) return "two";
  return "many";
}

export default function SketchTemplate({
  item,
  peopleBlocks,
  crosses = [],
  others = [],
  epitaphs = [],
  carvingOpacity = CFG.general.carvingOpacityDefault,
  style,
  orientationOverride
}: SketchTemplateProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState({ w: 0, h: 0 });

  // Измерители (с защитами)
  const [metricBottomPx, setMetricBottomPx] = useState(0);
  const metricMeasureSigRef = useRef<string>("");
  const metricRafRef = useRef<number | null>(null);

  const epitaphMeasureRef = useRef<HTMLDivElement | null>(null);

  // Масштаб метрики (только горизонтальный шаблон на одного)
  const metricMeasureRef = useRef<HTMLDivElement | null>(null);
  const [metricScaleH1, setMetricScaleH1] = useState(1);
  const metricH1SigRef = useRef<string>("");

  const [forcedOrientation, setForcedOrientation] = useState<Orientation | null>(null);

  useEffect(() => {
    const apply = () => {
      const draft = loadOrderDraft();
      const o = (draft.size?.orientation as Orientation | undefined) ?? (draft as any).orientation ?? null;
      setForcedOrientation(o);
    };
    apply();
    const handler = () => apply();
    window.addEventListener(DRAFT_UPDATED_EVENT, handler as EventListener);
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, handler as EventListener);
  }, []);

  const recalc = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    setImgRect((prev) => (prev.w !== r.width || prev.h !== r.height ? { w: r.width, h: r.height } : prev));
  }, []);

  useEffect(() => {
    const onResize = () => recalc();
    window.addEventListener("resize", onResize);
    const RO = (window as any).ResizeObserver as typeof ResizeObserver | undefined;
    let ro: ResizeObserver | null = null;
    if (RO && imgRef.current) {
      ro = new RO(onResize);
      ro.observe(imgRef.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [recalc]);

  const isVerticalByImage = imgRect.h > imgRect.w;
  const orientation: Orientation | null = orientationOverride ?? forcedOrientation ?? null;
  const isVertical = orientation ? orientation === "vertical" : isVerticalByImage;

  const tplKey = pickTplKey(peopleBlocks.length);
  const H = imgRect.h;
  const W = imgRect.w;

  // Метрика (общая версия + увеличенная/уменьшенная)
  function MetricThreeLines({ lines }: { lines: string[] }) {
    const L = [(lines[0] || "").trim(), (lines[1] || "").trim(), (lines[2] || "").trim()];
    const toUp = (s: string) => s.toUpperCase();
    return (
      <div style={{ width: "100%", display: "grid", gap: 6, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
        {!!L[0] && <div style={{ font: `700 clamp(18px, 3.4vw, 32px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" }}>{toUp(L[0])}</div>}
        {!!L[1] && <div style={{ font: `600 clamp(16px, 3vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" }}>{toUp(L[1])}</div>}
        {!!L[2] && (
          <div
            style={{
              font: `400 clamp(14px, 2.6vw, 22px) ${FONT_CENTURY}`,
              lineHeight: 1.15,
              letterSpacing: "0.2px",
              opacity: 0.95,
              whiteSpace: "nowrap",
              wordBreak: "keep-all",
              overflow: "hidden"
            }}
          >
            {toUp(L[2])}
          </div>
        )}
      </div>
    );
  }

  function PersonMetricText({ lines, sizeMult = 1 }: { lines: string[]; sizeMult?: number }) {
    const L = [(lines[0] || "").trim(), (lines[1] || "").trim(), (lines[2] || "").trim()];
    const toUp = (s: string) => s.toUpperCase();
    const S = (minPx: number, vw: number, maxPx: number) => `clamp(${Math.round(minPx * sizeMult)}px, ${vw * sizeMult}vw, ${Math.round(maxPx * sizeMult)}px)`;
    return (
      <div style={{ width: "100%", display: "grid", gap: 6, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
        {!!L[0] && <div style={{ font: `700 ${S(18, 3.4, 32)} ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" }}>{toUp(L[0])}</div>}
        {!!L[1] && <div style={{ font: `600 ${S(16, 3.0, 26)} ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" }}>{toUp(L[1])}</div>}
        {!!L[2] && <div style={{ font: `400 ${S(14, 2.6, 22)} ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.2px", opacity: 0.95 }}>{toUp(L[2])}</div>}
      </div>
    );
  }

  /* ===== Измерение нижней границы метрики (без циклов) ===== */
  useEffect(() => {
    if (!H || !W) return;
    const root = containerRef.current;
    if (!root) return;

    const sig = [H, W, isVertical ? "v" : "h", tplKey, peopleBlocks.map((p) => p.lines.join("|")).join("||")].join("::");
    if (metricMeasureSigRef.current === sig) return;
    metricMeasureSigRef.current = sig;

    if (metricRafRef.current) cancelAnimationFrame(metricRafRef.current);
    metricRafRef.current = requestAnimationFrame(() => {
      const rootRect = root.getBoundingClientRect();
      const nodes = root.querySelectorAll('[data-sketch-el="metric"]');
      let maxBottom = 0;
      nodes.forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const bottom = r.bottom - rootRect.top;
        if (bottom > maxBottom) maxBottom = bottom;
      });
      const next = Math.max(0, Math.min(maxBottom, H));
      setMetricBottomPx((prev) => (pxChanged(prev, next) ? next : prev));
    });

    return () => {
      if (metricRafRef.current) cancelAnimationFrame(metricRafRef.current);
      metricRafRef.current = null;
    };
  }, [H, W, isVertical, tplKey, peopleBlocks]);

  /* ===== Горизонтальный 1 ===== */
  const h1 = useMemo(() => {
    if (isVertical || tplKey !== "one") return null;
    const gap = Math.round(0.015 * H);
    const topOffset = Math.round(0.06 * H);
    let portraitH = Math.max(40, Math.round(0.40 * H));
    let portraitW = Math.round(portraitH * (3 / 4));
    if (portraitW > W * 0.9) {
      const k = (W * 0.9) / portraitW;
      portraitW = Math.max(40, Math.round(portraitW * k));
      portraitH = Math.max(40, Math.round(portraitH * k));
    }
    const portraitTop = topOffset;
    const metricTargetH = Math.max(24, Math.round(0.20 * H));
    const metricTop = portraitTop + portraitH + gap;
    const metricW = Math.round(W * 0.8);
    return { gap, portraitH, portraitW, portraitTop, metricTargetH, metricTop, metricW };
  }, [isVertical, tplKey, H, W]);

  useEffect(() => {
    if (!h1) return;
    const holder = metricMeasureRef.current;
    if (!holder) return;
    const sig = [h1.metricTargetH, peopleBlocks[0]?.lines?.join("|") || ""].join("::");
    if (metricH1SigRef.current === sig) return;
    metricH1SigRef.current = sig;
    const t = requestAnimationFrame(() => {
      const natural = holder.scrollHeight || holder.offsetHeight || 1;
      const available = Math.max(1, h1.metricTargetH - 2);
      const next = Math.min(1, available / natural);
      setMetricScaleH1((prev) => (Math.abs(prev - next) > EPS ? next : prev));
    });
    return () => cancelAnimationFrame(t);
  }, [h1, peopleBlocks]);

  /* ===== Кресты ===== */
  const CrossOverlay = () => {
    if (!crosses.length) return null;
    const isHorizontalTwo = !isVertical && tplKey === "two";
    const baseSize = (isVertical
      ? (tplKey === "one" ? CFG.vertical.one.blocks.cross.size : tplKey === "two" ? CFG.vertical.two.blocks.cross.size : CFG.vertical.many.blocks.cross.size)
      : (tplKey === "one" ? CFG.horizontal.one.blocks.cross.size : tplKey === "two" ? CFG.horizontal.two.blocks.cross.size : CFG.horizontal.many.blocks.cross.size)
    ) as any;

    const baseFilter: React.CSSProperties = {
      objectFit: "contain",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      zIndex: 3,
      position: "absolute"
    };

    const topLeftPos: React.CSSProperties = { top: "6%", left: "4%" };
    const topCenterPos: React.CSSProperties = { top: "6%", left: "50%", transform: "translateX(-50%)" };
    const topRightPos: React.CSSProperties = { top: "6%", right: "4%" };

    if (isHorizontalTwo) {
      if (crosses.length === 1) {
        const c = crosses[0];
        return <img data-sketch-el="cross" data-sketch-key="0" src={c.url} alt={c.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topCenterPos }} draggable={false} />;
      }
      if (crosses.length >= 2) {
        const [cL, cR] = [crosses[0], crosses[1]];
        return (
          <>
            <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topLeftPos }} draggable={false} />
            <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topRightPos }} draggable={false} />
          </>
        );
      }
    }

    if (crosses.length === 1) {
      const c = crosses[0];
      return <img data-sketch-el="cross" data-sketch-key="0" src={c.url} alt={c.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topLeftPos }} draggable={false} />;
    }
    if (crosses.length >= 2) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topLeftPos }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topRightPos }} draggable={false} />
        </>
      );
    }
    return null;
  };

  /* ===== PEOPLE ===== */

  const HorizontalOne = () => {
    const p = peopleBlocks[0];
    if (!H || !W || !p) return null;
    const s = h1!;
    return (
      <>
        {/* Портрет */}
        <div
          style={{
            position: "absolute",
            top: s.portraitTop,
            left: "50%",
            transform: "translateX(-50%)",
            width: s.portraitW,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none"
          }}
        >
          <div
            data-sketch-el="portrait"
            data-sketch-key={p.id}
            style={{
              width: s.portraitW,
              height: s.portraitH,
              borderRadius: 4,
              overflow: "hidden",
              background: "rgba(255,255,255,0.04)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.35)"
            }}
          >
            {p.photo ? (
              <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
            )}
          </div>
        </div>

        {/* Метрика */}
        <div
          data-sketch-el="metric"
          data-sketch-key={p.id}
          style={{
            position: "absolute",
            top: s.metricTop,
            left: "50%",
            transform: "translateX(-50%)",
            width: s.metricW,
            height: s.metricTargetH,
            overflow: "hidden",
            pointerEvents: "none",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start"
          }}
        >
          <div style={{ transform: `scale(${metricScaleH1})`, transformOrigin: "top center", width: "100%" }}>
            <MetricThreeLines lines={[p.lines?.[0] ?? "", p.lines?.[1] ?? "", p.lines?.[2] ?? ""]} />
          </div>
        </div>

        {/* Offscreen измеритель метрики */}
        <div style={{ position: "absolute", left: -99999, top: -99999, width: s.metricW }}>
          <div ref={metricMeasureRef} style={{ width: s.metricW }}>
            <MetricThreeLines lines={[p.lines?.[0] ?? "", p.lines?.[1] ?? "", p.lines?.[2] ?? ""]} />
          </div>
        </div>
      </>
    );
  };

  // Горизонтальный: ДВОЕ — суммарно портрет+метрика ≈ 90% H; метрика чуть шире портрета
  const HorizontalTwo = () => {
    if (!H || !W) return null;
    const topOffset = Math.round(0.06 * H);
    const C = Math.round(0.90 * H); // целевая высота под портрет+метрику
    const gapSide = 16;
    const colGap = CFG.horizontal.layout.gap;
    const availableW = Math.max(0, W - gapSide * 2 - colGap);
    const colW = Math.min(320, Math.max(CFG.horizontal.layout.columnMinW, Math.floor(availableW / 2)));

    const interGap = Math.max(6, Math.round(0.02 * H));
    // портрет: ~55% C, метрика: остальное
    const ph = Math.min(Math.round(C * 0.55), Math.round(colW / 0.75)); // ограничение по ширине колонки (3:4)
    const pw = Math.round(ph * 0.75);
    const mh = Math.max(24, C - ph - interGap);
    const metricWpx = Math.min(colW, Math.round(pw * 1.08)); // на ~8% шире портрета

    return (
      <div
        style={{
          position: "absolute",
          left: gapSide,
          right: gapSide,
          top: topOffset,
          display: "grid",
          gridTemplateColumns: `repeat(2, ${colW}px)`,
          gap: colGap,
          justifyContent: "center",
          alignItems: "start",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.slice(0, 2).map((p) => (
          <div key={p.id} style={{ width: colW, height: C, display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* Портрет (≈55% C) */}
            <div style={{ width: pw, height: ph }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: 4,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.04)",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.35)"
                }}
              >
                {p.photo ? (
                  <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                )}
              </div>
            </div>

            {/* Зазор */}
            <div style={{ height: interGap, width: 1 }} />

            {/* Метрика (оставшаяся часть до 90% C), ширина чуть больше портрета */}
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: metricWpx, height: mh, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PersonMetricText lines={p.lines} sizeMult={0.88} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Горизонтальный: 3+ — суммарно портрет+метрика ≈ 90% H; метрика чуть шире портрета
  const HorizontalMany = () => {
    if (!H || !W) return null;
    const topOffset = Math.round(0.06 * H);
    const C = Math.round(0.90 * H); // целевая высота под портрет+метрику
    const gapSide = 16;
    const colGap = CFG.horizontal.layout.gap;
    const cols = Math.min(4, Math.max(3, peopleBlocks.length));
    const availableW = Math.max(0, W - gapSide * 2 - colGap * (cols - 1));
    const perCol = Math.min(260, Math.max(CFG.horizontal.layout.columnMinW, Math.floor(availableW / cols)));

    const interGap = Math.max(6, Math.round(0.02 * H));
    return (
      <div
        style={{
          position: "absolute",
          left: gapSide,
          right: gapSide,
          top: topOffset,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${perCol}px)`,
          gap: colGap,
          alignItems: "start",
          justifyContent: "center",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.map((p) => {
          // портрет ~50% C, метрика — остальное
          const ph = Math.min(Math.round(C * 0.50), Math.round(perCol / 0.75));
          const pw = Math.round(ph * 0.75);
          const mh = Math.max(24, C - ph - interGap);
          const metricWpx = Math.min(perCol, Math.round(pw * 1.08));
          return (
            <div key={p.id} style={{ width: perCol, height: C, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: pw, height: ph }}>
                <div
                  data-sketch-el="portrait"
                  data-sketch-key={p.id}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 4,
                    overflow: "hidden",
                    background: "rgba(255,255,255,0.04)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.35)"
                  }}
                >
                  {p.photo ? (
                    <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                  )}
                </div>
              </div>

              <div style={{ height: interGap, width: 1 }} />

              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: metricWpx, height: mh, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <PersonMetricText lines={p.lines} sizeMult={0.85} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /* ===== Вертикальные раскладки (без изменений) ===== */
  const VerticalOne = () => {
    const p = peopleBlocks[0];
    if (!p) return null;
    return (
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: "12%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: "60%", maxWidth: 400 }}>
            <div
              data-sketch-el="portrait"
              data-sketch-key={p.id}
              style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
            >
              {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
            </div>
          </div>
          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "82%", maxWidth: 560 }}>
            <PersonMetricText lines={p.lines} sizeMult={1.12} />
          </div>
        </div>
      </div>
    );
  };

  const VerticalTwo = () => {
    const rowsH = Math.max(100, Math.floor(H * (CFG.vertical.layout as any).rowsHeightFactor));
    return (
      <div
        style={{
          position: "absolute",
          top: "12%",
          left: 16,
          right: 16,
          display: "grid",
          gridTemplateRows: `repeat(2, minmax(${Math.floor(rowsH / 2)}px, 1fr))`,
          rowGap: CFG.vertical.layout.rowGapPx,
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.slice(0, 2).map((p) => (
          <div key={p.id} style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `45% 55%`, columnGap: 12, alignItems: "center", padding: "6px 8px", boxSizing: "border-box" }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{ width: "60%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "92%" }}>
                <PersonMetricText lines={p.lines} sizeMult={0.9} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalMany = () => {
    const rowsH = Math.max(100, Math.floor(H * (CFG.vertical.layout as any).rowsHeightFactor));
    const rowCount = peopleBlocks.length;
    return (
      <div
        style={{
          position: "absolute",
          top: "12%",
          left: 16,
          right: 16,
          display: "grid",
          gridTemplateRows: `repeat(${rowCount}, minmax(${Math.floor(rowsH / rowCount)}px, 1fr))`,
          rowGap: CFG.vertical.layout.rowGapPx,
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.map((p) => (
          <div key={p.id} style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `42% 58%`, columnGap: 12, alignItems: "center", padding: "6px 8px", boxSizing: "border-box" }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{ width: "52%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "92%" }}>
                <PersonMetricText lines={p.lines} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderPeople = () => {
    const n = peopleBlocks.length;
    if (n === 0) return null;
    if (!isVertical) {
      if (tplKey === "one") return <HorizontalOne />;
      if (tplKey === "two") return <HorizontalTwo />;
      return <HorizontalMany />;
    }
    if (tplKey === "one") return <VerticalOne />;
    if (tplKey === "two") return <VerticalTwo />;
    return <VerticalMany />;
  };

  /* ===== Эпитафия + графика ===== */
  const EpitaphAndGraphics = () => {
    if (!H || !W) return null;

    const gap = Math.round(0.015 * H);
    const bottomPadPx = Math.max(8, Math.round(0.02 * H));
    const epW = Math.round(W * 0.88);

    const naturalEp = Math.max(1, epitaphMeasureRef.current?.scrollHeight || 1);

    const desiredGfxH = isVertical ? Math.round(0.12 * H) : Math.round(0.18 * H);

    const minEpPx = 16;

    const topAfterMetric = Math.max(metricBottomPx + gap, 0);
    const availableContent = Math.max(0, H - bottomPadPx - topAfterMetric);

    let gfxH = Math.max(0, Math.min(desiredGfxH, availableContent - (minEpPx + gap)));
    const gfxTop = H - bottomPadPx - gfxH;

    const availableForEpitaph = Math.max(0, gfxTop - gap - topAfterMetric);

    const finalEpitaphScale = naturalEp > 0 ? Math.min(1, availableForEpitaph / naturalEp) : 1;

    const scaledEpH = Math.floor(naturalEp * finalEpitaphScale);
    const epTop = gfxTop - gap - scaledEpH;

    const gfxWrapW = Math.floor(W * 0.9);
    const gfxGap = 10;
    const n = others.length;
    let perItemW = 0;
    if (n > 0) {
      const totalGaps = (n - 1) * gfxGap;
      perItemW = Math.max(12, Math.floor((gfxWrapW - totalGaps) / n));
    }
    const perItemMaxH = Math.max(16, Math.floor(gfxH * 0.9));

    return (
      <>
        {Array.isArray(epitaphs) && epitaphs.length > 0 && finalEpitaphScale > 0 && (
          <div
            style={{
              position: "absolute",
              top: epTop,
              left: "50%",
              transform: `translateX(-50%) scale(${finalEpitaphScale})`,
              transformOrigin: "top center",
              width: epW,
              color: "#fff",
              textAlign: "center" as const,
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              zIndex: 4,
              overflow: "hidden"
            }}
          >
            <div
              style={{
                fontStyle: "italic",
                textTransform: "uppercase",
                fontFamily: FONT_CENTURY,
                lineHeight: 1.2,
                letterSpacing: "0.3px",
                fontSize: "clamp(10px, 3.0vw, 22px)",
                display: "grid",
                gap: 8
              }}
            >
              {epitaphs.slice(0, 8).map((t, idx) => (
                <div key={`ep-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ whiteSpace: "pre-wrap" }}>
                  {t}
                </div>
              ))}
            </div>
          </div>
        )}

        {others.length > 0 && gfxH > 0 && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              top: gfxTop,
              width: "90%",
              height: gfxH,
              maxHeight: gfxH,
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: `${gfxGap}px`,
              flexWrap: "nowrap",
              zIndex: 3
            }}
          >
            {others.map((g, i) => (
              <img
                key={`other-bottom-${i}`}
                data-sketch-el="graphic"
                data-sketch-key={`${i}`}
                src={g.url}
                alt={g.name || "Графика"}
                style={{
                  width: perItemW ? `${perItemW}px` : "auto",
                  height: "auto",
                  maxHeight: `${perItemMaxH}px`,
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                  flex: "0 0 auto"
                }}
                draggable={false}
              />
            ))}
          </div>
        )}

        {/* Offscreen: измеритель эпитафии (натуральная высота) */}
        <div style={{ position: "absolute", left: -99999, top: -99999, width: epW }}>
          <div ref={epitaphMeasureRef} style={{ width: epW }}>
            <div
              style={{
                fontStyle: "italic",
                textTransform: "uppercase",
                fontFamily: FONT_CENTURY,
                lineHeight: 1.2,
                letterSpacing: "0.3px",
                fontSize: "clamp(10px, 3.0vw, 22px)",
                display: "grid",
                gap: 8
              }}
            >
              {epitaphs?.slice(0, 8).map((t, idx) => (
                <div key={`ep-measure-${idx}`} style={{ whiteSpace: "pre-wrap" }}>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      {/* Пояснение над эскизом */}
      <div
        style={{
          color: "#fff",
          opacity: 0.9,
          fontSize: 13,
          lineHeight: 1.25,
          margin: "6px 0 8px",
          textAlign: "center"
        }}
      >
        Предварительный набросок, допустимо наложение объектов. Финальное расположение сделает специалист. Принципиальные моменты скорректируем позже.
      </div>

      <div
        ref={containerRef}
        style={{
          ...bottomUnderlayGradient(),
          borderRadius: 10,
          position: "relative",
          width: "100%",
          height: Math.max(CFG.general.minContainerHeight, H + CFG.general.containerPadding * 2),
          overflow: "hidden",
          userSelect: "none",
          padding: CFG.general.containerPadding,
          boxSizing: "border-box",
          color: "#fff",
          ...style
        }}
        data-sketch-orient={isVertical ? "vertical" : "horizontal"}
        data-sketch-orient-source={orientation ? "draft" : "image"}
      >
        {/* Фоновое изображение изделия */}
        <img
          ref={imgRef}
          src={item?.url || ""}
          alt={item?.name || "Изделие"}
          style={{ display: "block", width: "100%", height: "auto", objectFit: "contain", borderRadius: 8, opacity: carvingOpacity }}
          draggable={false}
          onLoad={() => requestAnimationFrame(recalc)}
        />

        {/* Контент */}
        {renderPeople()}
        <CrossOverlay />
        <EpitaphAndGraphics />
      </div>
    </>
  );
}
