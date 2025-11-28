// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
//
// Фиксы (бесконечные ререндеры/Maximum update depth exceeded):
// - Все эффекты, где есть setState по результатам измерений (metricBottomPx, epitaphScale, metricScaleH1),
//   теперь ставят состояние ТОЛЬКО при фактическом изменении (сравнение с прошлым значением с порогом).
//   Это устраняет циклы, когда малые колебания высот/округлений вызывали бесконечные обновления.
// - Вся типографика использует безопасное выравнивание "center", не обращаемся к .align в конфигурациях.
//
// Порядок блоков: Метрика → Эпитафия → Графика (у нижнего края). На шаблоне HorizontalOne третья строка — даты —
// в одну строку (nowrap) и метрика масштабируется по offscreen-замеру с небольшим припуском.

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

  // Измерители
  const [metricBottomPx, setMetricBottomPx] = useState(0);
  const epitaphMeasureRef = useRef<HTMLDivElement | null>(null);
  const [epitaphScale, setEpitaphScale] = useState(1);

  // HorizontalOne: масштаб метрики
  const metricMeasureRef = useRef<HTMLDivElement | null>(null);
  const [metricScaleH1, setMetricScaleH1] = useState(1);

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
    // set только при изменении, чтобы не триггерить лишние эффекты
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

  // Три строки метрики (безопасный center)
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

  function PersonMetricText({ lines }: { lines: string[] }) {
    const L = [(lines[0] || "").trim(), (lines[1] || "").trim(), (lines[2] || "").trim()];
    const toUp = (s: string) => s.toUpperCase();

    return (
      <div style={{ width: "100%", display: "grid", gap: 6, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
        {!!L[0] && <div style={{ font: `700 clamp(18px, 3.4vw, 32px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" }}>{toUp(L[0])}</div>}
        {!!L[1] && <div style={{ font: `600 clamp(16px, 3vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" }}>{toUp(L[1])}</div>}
        {!!L[2] && <div style={{ font: `400 clamp(14px, 2.6vw, 22px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.2px", opacity: 0.95 }}>{toUp(L[2])}</div>}
      </div>
    );
  }

  /* ===== Нижняя граница метрик (для позиции эпитафии) — ставим state только при изменении ===== */
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const t = setTimeout(() => {
      const rootRect = root.getBoundingClientRect();
      const nodes = root.querySelectorAll('[data-sketch-el="metric"]');
      let maxBottom = 0;
      nodes.forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const bottom = r.bottom - rootRect.top;
        if (bottom > maxBottom) maxBottom = bottom;
      });
      const next = Math.max(0, Math.min(maxBottom, H));
      setMetricBottomPx((prev) => (prev !== next ? next : prev));
    }, 0);
    return () => clearTimeout(t);
  }, [H, W, isVertical, tplKey, peopleBlocks.map((p) => p.lines.join("|")).join("||")]);

  /* ===== Горизонтальный 1: вычисления портрета/метрики (без сетки) ===== */
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
    return { gap, topOffset, portraitH, portraitW, portraitTop, metricTargetH, metricTop, metricW };
  }, [isVertical, tplKey, H, W]);

  // Масштаб метрики (HorizontalOne) с припуском, ставим state только при значимой дельте
  useEffect(() => {
    if (!h1) return;
    const holder = metricMeasureRef.current;
    if (!holder) return;
    const t = setTimeout(() => {
      const natural = holder.scrollHeight || holder.offsetHeight || 1;
      const available = Math.max(1, h1.metricTargetH - 2);
      const next = Math.min(1, available / natural);
      setMetricScaleH1((prev) => (Math.abs(prev - next) > 0.0005 ? next : prev));
    }, 0);
    return () => clearTimeout(t);
  }, [h1, peopleBlocks[0]?.lines?.join("|")]);

  /* ===== Нижние блоки: эпитафия (масштаб) + графика (у низа) ===== */
  const epitaphW = Math.round(W * 0.88);
  const bottomPadPx = Math.max(8, Math.round(0.02 * H));
  const graphicsMaxHDefault = Math.round(0.18 * H);

  useEffect(() => {
    const holder = epitaphMeasureRef.current;
    if (!holder) return setEpitaphScale(1);
    const t = setTimeout(() => {
      const natural = holder.scrollHeight || holder.offsetHeight || 1;
      const graphicsMaxH = graphicsMaxHDefault;
      const available = Math.max(0, H - bottomPadPx - graphicsMaxH - (metricBottomPx + Math.round(0.015 * H)));
      const next = Math.min(1, available / natural);
      setEpitaphScale((prev) => (Math.abs(prev - next) > 0.0005 ? (next > 0 ? next : 1) : prev));
    }, 0);
    return () => clearTimeout(t);
  }, [H, W, metricBottomPx, epitaphs?.join("|")]);

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
    if (!H || !W) return null;
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

  const HorizontalTwo = () => {
    const colW = Math.min(320, Math.max(CFG.horizontal.layout.columnMinW, Math.floor((W - 32 - CFG.horizontal.layout.gap) / 2)));
    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: "8%",
          display: "grid",
          gridTemplateColumns: `repeat(2, ${colW}px)`,
          gap: CFG.horizontal.layout.gap,
          justifyContent: "center",
          alignItems: "start",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.slice(0, 2).map((p) => (
          <div key={p.id} style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: "100%" }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "100%" }}>
              <PersonMetricText lines={p.lines} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const HorizontalMany = () => {
    const cols = Math.min(4, Math.max(3, peopleBlocks.length));
    const perCol = Math.min(260, Math.max(CFG.horizontal.layout.columnMinW, Math.floor((W - 32) / cols)));
    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: "8%",
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${perCol}px)`,
          gap: CFG.horizontal.layout.gap,
          alignItems: "start",
          justifyContent: "center",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.map((p) => (
          <div key={p.id} style={{ width: perCol, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: "100%" }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "100%" }}>
              <PersonMetricText lines={p.lines} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalOne = () => {
    const p = peopleBlocks[0];
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
          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "80%", maxWidth: 520 }}>
            <PersonMetricText lines={p.lines} />
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
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: "90%" }}>
                <PersonMetricText lines={p.lines} />
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

  /* ===== Эпитафия (под метрикой) и графика (у нижнего края) ===== */
  const EpitaphAndGraphics = () => {
    if (!H || !W) return null;

    const gap = Math.round(0.015 * H);
    const epitaphTop = Math.max(metricBottomPx + gap, 0);

    let graphicsMaxH = graphicsMaxHDefault;
    const reservedForEpitaph = (epitaphMeasureRef.current?.scrollHeight || 0) * epitaphScale;
    const minGraphicsTop = epitaphTop + reservedForEpitaph + gap;
    const maxGraphicsTop = H - bottomPadPx - graphicsMaxH;
    const finalGraphicsTop = Math.max(minGraphicsTop, maxGraphicsTop);
    graphicsMaxH = Math.max(0, H - bottomPadPx - finalGraphicsTop);

    const availableForEpitaph = Math.max(0, H - bottomPadPx - graphicsMaxH - epitaphTop);
    const naturalEp = Math.max(1, epitaphMeasureRef.current?.scrollHeight || 1);
    const finalEpitaphScale = Math.min(1, availableForEpitaph / naturalEp);

    return (
      <>
        {Array.isArray(epitaphs) && epitaphs.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: epitaphTop,
              left: "50%",
              transform: `translateX(-50%) scale(${finalEpitaphScale})`,
              transformOrigin: "top center",
              width: epitaphW,
              color: "#fff",
              textAlign: "center",
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

        {others.length > 0 && graphicsMaxH > 0 && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              top: H - bottomPadPx - graphicsMaxH,
              width: "90%",
              maxHeight: graphicsMaxH,
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
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
                  width: "auto",
                  height: "auto",
                  maxHeight: Math.max(24, Math.round(graphicsMaxH * 0.9)),
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                  flex: "0 0 auto"
                }}
                draggable={false}
              />
            ))}
          </div>
        )}

        {/* Offscreen измеритель эпитафии */}
        <div style={{ position: "absolute", left: -99999, top: -99999, width: epitaphW }}>
          <div ref={epitaphMeasureRef} style={{ width: epitaphW }}>
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
        Предварительный макет. Финальное расположение сделает специалист. Принципиальные моменты скорректируем позже.
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
        <img
          ref={imgRef}
          src={item?.url || ""}
          alt={item?.name || "Изделие"}
          style={{ display: "block", width: "100%", height: "auto", objectFit: "contain", borderRadius: 8, opacity: carvingOpacity }}
          draggable={false}
          onLoad={() => setTimeout(recalc, 0)}
        />

        {renderPeople()}
        <CrossOverlay />
        <EpitaphAndGraphics />
      </div>
    </>
  );
}
