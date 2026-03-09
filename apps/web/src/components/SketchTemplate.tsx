// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
//
// Правки (актуальные):
// - Горизонтальный 1 человек: НЕ увеличиваем (оставляем как было до правок).
// - Горизонтальный 2 человека: портрет крупный, но метрику уменьшаем.
// - Горизонтальный 3+ людей: немного увеличиваем портрет и метрику (мягко).
// - Для horizontal 2 и 3+ оставляем явный отступ между портретом и метрикой.
// - "Помним, любим, скорбим..." в горизонтальных шаблонах пишем В ОДНУ СТРОКУ.
// - Для 3+ людей уменьшаем gap между колонками.
// - Если крестов >= 3 и ориентация горизонтальная — размещаем кресты слева от портретов (колонкой), чтобы они не пропадали.
// - Лесенка "Помним, любим, скорбим..." сохраняется для вертикальных (как было).
//
// Остальная логика — как в вашем текущем файле.

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

function normEpitaph(t: string): string {
  return String(t || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function isPomnimLubenSkorbim(t: string): boolean {
  const x = normEpitaph(t)
    .toLowerCase()
    .replace(/[ ]+/g, " ");
  const canon1 = "помним, любим, скорбим...";
  const canon2 = "помним, любим, скорбим…";
  const canon3 = "помним,\nлюбим,\nскорбим...";
  const canon4 = "помним,\nлюбим,\nскорбим…";
  return x === canon1 || x === canon2 || x === canon3 || x === canon4;
}

function pomnimStairLines(): [string, string, string] {
  return ["Помним,", "любим,", "скорбим..."];
}

function pomnimSingleLine(): string {
  return "Помним, любим, скорбим...";
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

  const metricMeasureSigRef = useRef<string>("");
  const metricRafRef = useRef<number | null>(null);

  const epitaphMeasureRef = useRef<HTMLDivElement | null>(null);

  const metricMeasureRef = useRef<HTMLDivElement | null>(null);
  const [metricScaleH1, setMetricScaleH1] = useState(1);
  const metricH1SigRef = useRef<string>("");

  const [forcedOrientation, setForcedOrientation] = useState<Orientation | null>(null);

  useEffect(() => {
    const apply = () => {
      const draft = loadOrderDraft();
      const o = (draft.size?.orientation as Orientation | undefined) ?? ((draft as any).orientation as Orientation | null) ?? null;
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

  function PersonMetricText({ lines, sizeMult = 1 }: { lines: string[]; sizeMult?: number }) {
    const L = [(lines[0] || "").trim(), (lines[1] || "").trim(), (lines[2] || "").trim()];
    const toUp = (s: string) => s.toUpperCase();
    const S = (minPx: number, vw: number, maxPx: number) =>
      `clamp(${Math.round(minPx * sizeMult)}px, ${vw * sizeMult}vw, ${Math.round(maxPx * sizeMult)}px)`;
    const lineBase: React.CSSProperties = { wordBreak: "break-word", whiteSpace: "normal" };
    return (
      <div style={{ width: "100%", display: "grid", gap: 4, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
        {!!L[0] && <div style={{ ...lineBase, font: `700 ${S(14, 2.2, 22)} ${FONT_CENTURY}`, lineHeight: 1.14, letterSpacing: "0.3px" }}>{toUp(L[0])}</div>}
        {!!L[1] && <div style={{ ...lineBase, font: `600 ${S(13, 2.0, 20)} ${FONT_CENTURY}`, lineHeight: 1.14, letterSpacing: "0.25px" }}>{toUp(L[1])}</div>}
        {!!L[2] && (
          <div style={{ ...lineBase, font: `400 ${S(12, 1.8, 18)} ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.2px", opacity: 0.95 }}>
            {toUp(L[2])}
          </div>
        )}
      </div>
    );
  }

  // metricBottomPx больше не нужен для логики (как у вас раньше), но оставим измерение как “безопасный” side-effect,
  // чтобы не ломать возможные зависимости (в текущем коде он нигде не используется).
  useEffect(() => {
    if (!H || !W) return;
    const root = containerRef.current;
    if (!root) return;

    const sig = [H, W, isVertical ? "v" : "h", tplKey, peopleBlocks.map((p) => p.lines.join("|")).join("||")].join("::");
    if (metricMeasureSigRef.current === sig) return;
    metricMeasureSigRef.current = sig;

    if (metricRafRef.current) cancelAnimationFrame(metricRafRef.current);
    metricRafRef.current = requestAnimationFrame(() => {
      // no-op measure; раньше считали metricBottomPx
      // оставлено, чтобы не “дергался” layout при старых доп. фичах
      void root.getBoundingClientRect();
    });

    return () => {
      if (metricRafRef.current) cancelAnimationFrame(metricRafRef.current);
      metricRafRef.current = null;
    };
  }, [H, W, isVertical, tplKey, peopleBlocks]);

  // База размеров для horizontal (НЕ увеличиваем глобально, чтобы не вырос HorizontalOne)
  const hBase = useMemo(() => {
    if (!H || !W) return null;

    const topOffset = Math.round(0.06 * H);
    const gap = Math.max(10, Math.round(0.015 * H));

    let portraitH = Math.max(40, Math.round(0.40 * H));
    let portraitW = Math.round(portraitH * (3 / 4));

    if (portraitW > W * 0.9) {
      const k = (W * 0.9) / portraitW;
      portraitW = Math.max(40, Math.round(portraitW * k));
      portraitH = Math.max(40, Math.round(portraitH * k));
    }

    const metricTargetH = Math.max(24, Math.round(0.20 * H));
    const metricW = Math.round(W * 0.8);

    return { topOffset, gap, portraitW, portraitH, metricTargetH, metricW };
  }, [H, W]);

  const h1 = useMemo(() => {
    if (isVertical || tplKey !== "one" || !hBase) return null;
    const portraitTop = hBase.topOffset;
    const metricTop = portraitTop + hBase.portraitH + hBase.gap;
    return { ...hBase, portraitTop, metricTop };
  }, [isVertical, tplKey, hBase]);

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

  const CrossOverlay = () => {
    if (!crosses.length) return null;

    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";
    const isHorizontalMany = isHorizontal && tplKey === "many";

    const baseSize = (isVertical
      ? tplKey === "one"
        ? CFG.vertical.one.blocks.cross.size
        : tplKey === "two"
          ? CFG.vertical.two.blocks.cross.size
          : CFG.vertical.many.blocks.cross.size
      : tplKey === "one"
        ? CFG.horizontal.one.blocks.cross.size
        : tplKey === "two"
          ? CFG.horizontal.two.blocks.cross.size
          : CFG.horizontal.many.blocks.cross.size) as any;

    const baseFilter: React.CSSProperties = {
      objectFit: "contain",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      zIndex: 6,
      position: "absolute"
    };

    // ✅ если крестов >= 3 и ориентация горизонтальная — рисуем колонкой слева от портретов
    if (isHorizontal && crosses.length >= 3) {
      const sizeW = isHorizontalMany ? "6.5%" : "7.5%";
      return (
        <div
          style={{
            position: "absolute",
            left: "2.5%",
            top: "10%",
            bottom: "10%",
            width: sizeW,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            justifyContent: "flex-start",
            alignItems: "center",
            zIndex: 6,
            pointerEvents: "none"
          }}
        >
          {crosses.slice(0, 6).map((c, i) => (
            <img
              key={`cross-left-${i}`}
              data-sketch-el="cross"
              data-sketch-key={`${i}`}
              src={c.url}
              alt={c.name || "Крест"}
              style={{ ...baseFilter, width: "100%", height: "auto" }}
              draggable={false}
            />
          ))}
        </div>
      );
    }

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

    // (никогда)
    return null;
  };

  const HorizontalOne = () => {
    const p = peopleBlocks[0];
    if (!H || !W || !p || !h1) return null;
    const s = h1;

    return (
      <>
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
            <PersonMetricText lines={p.lines} />
          </div>
        </div>

        <div style={{ position: "absolute", left: -99999, top: -99999, width: s.metricW }}>
          <div ref={metricMeasureRef} style={{ width: s.metricW }}>
            <PersonMetricText lines={p.lines} />
          </div>
        </div>
      </>
    );
  };

  const HorizontalTwo = () => {
    if (!H || !W) return null;

    const topOffset = Math.round(0.08 * H);
    const gapSide = 16;

    // gap между колонками оставляем стандартный для 2
    const colGap = CFG.horizontal.layout.gap;

    const cols = 2;
    const availableW = Math.max(0, W - gapSide * 2 - colGap * (cols - 1));
    const colW = Math.floor(availableW / cols);

    const basePortraitH = Math.max(40, Math.round(0.65 * H));
    const basePortraitW = Math.round(basePortraitH * (3 / 4));

    const baseMetricH = Math.max(22, Math.round(0.20 * H));
    const baseMetricW = Math.round(W * 0.80);

    const kW = Math.min(1, colW / Math.max(1, Math.max(basePortraitW, baseMetricW)));
    const availableH = Math.max(1, H - topOffset - Math.round(0.08 * H));

    const gapBase = Math.max(16, Math.round(0.028 * H));
    const neededH = basePortraitH + gapBase + baseMetricH;

    const kH = Math.min(1, availableH / Math.max(1, neededH));
    const k = Math.min(kW, kH);

    const portraitW = Math.max(40, Math.round(basePortraitW * k));
    const portraitH = Math.max(40, Math.round(basePortraitH * k));
    const metricWpx = Math.max(80, Math.round(Math.min(colW, baseMetricW * k)));
    const metricHpx = Math.max(22, Math.round(baseMetricH * k));
    const portraitMetricGapPx = Math.max(16, Math.round(gapBase * k));

    const metricTextMult = 1.02;

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
          <div key={p.id} style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: portraitW, height: portraitH }}>
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

            <div style={{ height: portraitMetricGapPx, width: 1 }} />

            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: metricWpx, height: metricHpx, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PersonMetricText lines={p.lines} sizeMult={k * metricTextMult} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const HorizontalMany = () => {
    if (!H || !W) return null;

    const topOffset = Math.round(0.07 * H);
    const gapSide = 16;

    // ✅ меньше gap при 3+
    const colGap = Math.max(4, Math.round(CFG.horizontal.layout.gap * 0.5)); // было 12 -> станет 6 (примерно)

    // ✅ каждый в своей колонке (строго)
    const cols = Math.max(3, peopleBlocks.length);

    const availableW = Math.max(0, W - gapSide * 2 - colGap * (cols - 1));
    const colW = Math.floor(availableW / cols);

    const basePortraitH = Math.max(34, Math.round(0.62 * H));
    const basePortraitW = Math.round(basePortraitH * (3 / 4));

    const baseMetricH = Math.max(22, Math.round(0.28 * H));
    const baseMetricW = Math.round(W * 0.84);

    const kW = Math.min(1, colW / Math.max(1, Math.max(basePortraitW, baseMetricW)));
    const availableH = Math.max(1, H - topOffset - Math.round(0.08 * H));

    const gapBase = Math.max(14, Math.round(0.024 * H));
    const neededH = basePortraitH + gapBase + baseMetricH;

    const kH = Math.min(1, availableH / Math.max(1, neededH));
    const k = Math.min(kW, kH);

    const portraitW = Math.max(34, Math.round(basePortraitW * k));
    const portraitH = Math.max(34, Math.round(basePortraitH * k));
    const metricWpx = Math.max(70, Math.round(Math.min(colW, baseMetricW * k)));
    const metricHpx = Math.max(22, Math.round(baseMetricH * k));
    const portraitMetricGapPx = Math.max(14, Math.round(gapBase * k));

    const metricTextMult = 1.18;

    return (
      <div
        style={{
          position: "absolute",
          left: gapSide,
          right: gapSide,
          top: topOffset,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${colW}px)`,
          gap: colGap,
          alignItems: "start",
          justifyContent: "center",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.map((p) => (
          <div key={p.id} style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: portraitW, height: portraitH }}>
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

            <div style={{ height: portraitMetricGapPx, width: 1 }} />

            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: metricWpx, height: metricHpx, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PersonMetricText lines={p.lines} sizeMult={k * metricTextMult} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalOne = () => {
    const p = peopleBlocks[0];
    if (!p) return null;
    const metricGapPx = Math.max(10, Math.round(0.02 * H));

    return (
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            top: "12%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center"
          }}
        >
          <div style={{ width: "60%", maxWidth: 400 }}>
            <div
              data-sketch-el="portrait"
              data-sketch-key={p.id}
              style={{
                width: "100%",
                aspectRatio: "3 / 4",
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

          <div style={{ height: metricGapPx, width: 1 }} />

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
          <div
            key={p.id}
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              gridTemplateColumns: `45% 55%`,
              columnGap: 12,
              alignItems: "center",
              padding: "6px 8px",
              boxSizing: "border-box"
            }}
          >
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{
                  width: "60%",
                  aspectRatio: "3 / 4",
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
          <div
            key={p.id}
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              gridTemplateColumns: `42% 58%`,
              columnGap: 12,
              alignItems: "center",
              padding: "6px 8px",
              boxSizing: "border-box"
            }}
          >
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{
                  width: "52%",
                  aspectRatio: "3 / 4",
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

  const EpitaphAndGraphics = () => {
    if (!H || !W) return null;

    const gap = Math.round(0.015 * H);
    const bottomPadPx = Math.max(8, Math.round(0.02 * H));

    const isHorizontal = !isVertical;

    // в горизонтальных: "помним..." всегда в строку
    const hasPomnim = Array.isArray(epitaphs) && epitaphs.some((t) => isPomnimLubenSkorbim(t));
    const hasStair = !isHorizontal && hasPomnim;

    const epW = Math.round(W * (hasStair ? 0.62 : 0.88));
    const naturalEp = Math.max(1, epitaphMeasureRef.current?.scrollHeight || 1);

    const desiredGfxH = isVertical ? Math.round(0.12 * H) : Math.round(0.16 * H);
    const gfxH = desiredGfxH;
    const gfxTop = H - bottomPadPx - gfxH;

    const epMaxH = Math.round((hasStair ? 0.24 : 0.20) * H);
    const finalEpitaphScale = Math.min(1, epMaxH / naturalEp);
    const scaledEpH = Math.floor(naturalEp * finalEpitaphScale);

    const epTop = Math.max(Math.round(0.58 * H), gfxTop - gap - scaledEpH);

    const gfxWrapW = Math.floor(W * 0.9);
    const gfxGap = 10;
    const n = others.length;
    let perItemW = 0;
    if (n > 0) {
      const totalGaps = (n - 1) * gfxGap;
      perItemW = Math.max(12, Math.floor((gfxWrapW - totalGaps) / n));
    }
    const perItemMaxH = Math.max(16, Math.floor(gfxH * 0.9));

    const renderEpitaphText = (t: string, idx: number) => {
      if (isHorizontal && isPomnimLubenSkorbim(t)) {
        return (
          <div key={`ep-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ whiteSpace: "pre-wrap", textAlign: "center" }}>
            {pomnimSingleLine()}
          </div>
        );
      }

      if (!isHorizontal && isPomnimLubenSkorbim(t)) {
        const [a, b, c] = pomnimStairLines();
        return (
          <div key={`ep-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ display: "grid", gap: 4 }}>
            <div style={{ textAlign: "left", whiteSpace: "pre-wrap" }}>{a}</div>
            <div style={{ textAlign: "center", whiteSpace: "pre-wrap" }}>{b}</div>
            <div style={{ textAlign: "right", whiteSpace: "pre-wrap" }}>{c}</div>
          </div>
        );
      }

      return (
        <div key={`ep-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ whiteSpace: "pre-wrap", textAlign: "center" }}>
          {t}
        </div>
      );
    };

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
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              zIndex: 4,
              overflow: "hidden",
              pointerEvents: "none"
            }}
          >
            <div
              style={{
                fontStyle: "italic",
                textTransform: "none",
                fontFamily: FONT_CENTURY,
                lineHeight: 1.15,
                letterSpacing: "0.2px",
                fontSize: hasStair ? "clamp(16px, 3.4vw, 28px)" : "clamp(10px, 2.6vw, 20px)",
                display: "grid",
                gap: hasStair ? 4 : 8
              }}
            >
              {epitaphs.slice(0, 8).map((t, idx) => renderEpitaphText(t, idx))}
            </div>
          </div>
        )}

        {others.length > 0 && (
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
              zIndex: 3,
              pointerEvents: "none"
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

        <div style={{ position: "absolute", left: -99999, top: -99999, width: epW }}>
          <div ref={epitaphMeasureRef} style={{ width: epW }}>
            <div
              style={{
                fontStyle: "italic",
                textTransform: "none",
                fontFamily: FONT_CENTURY,
                lineHeight: 1.15,
                letterSpacing: "0.2px",
                fontSize: hasStair ? "clamp(16px, 3.4vw, 28px)" : "clamp(10px, 2.6vw, 20px)",
                display: "grid",
                gap: hasStair ? 4 : 8
              }}
            >
              {epitaphs?.slice(0, 8).map((t, idx) => renderEpitaphText(t, idx))}
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
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
        onLoad={() => requestAnimationFrame(recalc)}
      />

      {renderPeople()}
      <CrossOverlay />
      <EpitaphAndGraphics />
    </div>
  );
}