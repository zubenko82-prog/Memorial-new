// src/components/SketchTemplate.tsx
// Изменения:
// - Горизонтальный шаблон с одним человеком: портрет = 50% высоты изображения, метрика = 40% высоты.
//   Оба блока центрируются и гарантированно умещаются в пределах эскиза (масштабируются при необходимости).
// - Остальные шаблоны оставлены как в предыдущей версии.

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
  orientationOverride?: Orientation; // принудительная ориентация
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
    one: {
      blocks: {
        portraits: {
          pos: { top: "10%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "60%", maxWidth: "400px", height: "auto" },
          margins: { margin: "0 auto 16px auto" }
        },
        metric: {
          pos: { top: "auto", bottom: "auto", left: "50%", transform: "translateX(-50%)" },
          size: { width: "100%", maxWidth: "520px", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true,
            align: "center",
            l1: { font: `700 32px ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" },
            l2: { font: `600 26px ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" },
            l3: { font: `400 22px ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "6%", left: "50%", transform: "translateX(-50%)" }, size: { width: "8%", height: "auto" }, margins: {} },
        epitaphs: {
          pos: { bottom: "34%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "88%", height: "auto" },
          margins: { padding: "0 6px" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 3.0vw, 22px)", lineHeight: 1.2, letterSpacing: "0.3px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "7%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "80px", width: "auto" }, margins: { gap: "10px" } }
      }
    },
    two: {
      blocks: {
        portraits: { pos: { top: "8%", left: "50%", transform: "translateX(-50%)" }, size: { width: "45%", height: "auto" }, margins: { margin: "0 auto 8px auto" } },
        metric: {
          pos: { left: "50%", transform: "translateX(-50%)" },
          size: { width: "80%", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `500 24px ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.35px" },
            l2: { font: `400 20px ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.25px" },
            l3: { font: `300 18px ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "6%", left: "4%" }, size: { width: "8%", height: "auto" }, margins: {} },
        epitaphs: {
          pos: { bottom: "22%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "88%", height: "auto" },
          margins: { padding: "0 6px" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.8vw, 10px)", lineHeight: 1.15, letterSpacing: "0.25px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "4%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "42px", width: "auto" }, margins: { gap: "10px" } }
      }
    },
    many: {
      blocks: {
        portraits: { pos: { top: "8%", left: "50%", transform: "translateX(-50%)" }, size: { width: "78%", height: "auto" }, margins: { margin: "0 auto 6px auto" } },
        metric: {
          pos: { left: "50%", transform: "translateX(-50%)" },
          size: { width: "90%", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 20px ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.25px" },
            l2: { font: `600 18px ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px" },
            l3: { font: `400 16px ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "6%", left: "4%" }, size: { width: "7%", height: "auto" }, margins: {} },
        epitaphs: {
          pos: { bottom: "38%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "88%", height: "auto" },
          margins: { padding: "0 6px" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.2vw, 18px)", lineHeight: 1.15, letterSpacing: "0.2px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "5%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "64px", width: "auto" }, margins: { gap: "8px" } }
      }
    }
  },
  vertical: {
    layout: { rowsHeightFactor: 0.5, rowGapPx: 10 },
    one: {
      blocks: {
        portraits: { pos: { top: "12%", left: "50%", transform: "translateX(-50%)" }, size: { width: "60%", maxWidth: "400px", height: "auto" }, margins: { margin: "0 auto 16px auto" } },
        metric: {
          pos: { left: "50%", transform: "translateX(-50%)" },
          size: { width: "80%", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 32px ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" },
            l2: { font: `600 26px ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" },
            l3: { font: `400 22px ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.25px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "4%", left: "4%" }, size: { width: "14%", height: "auto" }, margins: {} },
        epitaphs: {
          pos: { bottom: "18%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "88%", height: "auto" },
          margins: { padding: "0 6px" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 3.2vw, 22px)", lineHeight: 1.2, letterSpacing: "0.3px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "6%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "80px", width: "auto" }, margins: { gap: "10px" } }
      }
    },
    two: {
      blocks: {
        portraits: { pos: {}, size: { width: "60%", height: "auto" }, margins: { margin: "0 auto" } },
        metric: {
          pos: {}, size: { width: "90%", height: "auto" }, margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 26px ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.35px" },
            l2: { font: `600 22px ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.25px" },
            l3: { font: `400 18px ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "4%", left: "4%" }, size: { width: "14%", height: "auto" }, margins: {} },
        epitaphs: {
          pos: { bottom: "20%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "88%", height: "auto" },
          margins: { padding: "0 6px" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.9vw, 20px)", lineHeight: 1.15, letterSpacing: "0.25px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "7%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "74px", width: "auto" }, margins: { gap: "10px" } }
      }
    },
    many: {
      blocks: {
        portraits: { pos: {}, size: { width: "52%", height: "auto" }, margins: { margin: "0 auto" } },
        metric: {
          pos: {}, size: { width: "92%", height: "auto" }, margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 24px ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.25px" },
            l2: { font: `600 20px ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px" },
            l3: { font: `400 18px ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "4%", left: "4%" }, size: { width: "13%", height: "auto" }, margins: {} },
        epitaphs: {
          pos: { bottom: "22%", left: "50%", transform: "translateX(-50%)" },
          size: { width: "88%", height: "auto" },
          margins: { padding: "0 6px" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.2vw, 18px)", lineHeight: 1.15, letterSpacing: "0.2px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "5%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "64px", width: "auto" }, margins: { gap: "8px" } }
      }
    }
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

function parsePercent(p?: string): number | null {
  if (!p) return null;
  const m = String(p).trim().match(/^(-?\d+(?:\.\d+)?)%$/);
  if (!m) return null;
  return parseFloat(m[1]) / 100;
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
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState({ w: 0, h: 0 });
  const [sketchH, setSketchH] = useState(CFG.general.minContainerHeight);
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
    setImgRect({ w: r.width, h: r.height });
    setSketchH(Math.max(CFG.general.minContainerHeight, Math.round(r.height + CFG.general.containerPadding * 2)));
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
  const tpl = useMemo(() => (isVertical ? (CFG.vertical as any)[tplKey] : (CFG.horizontal as any)[tplKey]), [isVertical, tplKey]);
  const layout = useMemo(() => (isVertical ? CFG.vertical.layout : CFG.horizontal.layout), [isVertical]);

  /* ===== Кресты (оставлено как в предыдущей версии с улучшениями) ===== */
  const CrossOverlay = () => {
    if (!crosses.length) return null;
    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";

    const baseSize = (tpl.blocks as any).cross.size;
    const css: React.CSSProperties = { position: "absolute", ...baseSize, objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))", zIndex: 3 };
    const topLeft: React.CSSProperties = { top: "6%", left: "4%" };
    const topCenter: React.CSSProperties = { top: "6%", left: "50%", transform: "translateX(-50%)" };
    const topRight: React.CSSProperties = { top: "6%", right: "4%" };

    if (crosses.length === 1) {
      const c = crosses[0];
      const pos = isHorizontalTwo ? topCenter : topLeft;
      return <img data-sketch-el="cross" data-sketch-key="0" src={c.url} alt={c.name || "Крест"} style={{ ...css, ...pos }} draggable={false} />;
    }
    if (crosses.length >= 2 && isHorizontalTwo) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...css, ...topLeft }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...css, ...topRight }} draggable={false} />
        </>
      );
    }
    if (crosses.length === 2) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...css, ...topLeft }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...css, ...topRight }} draggable={false} />
        </>
      );
    }
    return (
      <div style={{ position: "absolute", ...topLeft, display: "grid", gridAutoFlow: "row", rowGap: 6, width: baseSize.width, zIndex: 3 }}>
        {crosses.map((c, i) => (
          <img key={`cross-${i}`} data-sketch-el="cross" data-sketch-key={`${i}`} src={c.url} alt={c.name || "Крест"} style={{ width: "100%", height: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} />
        ))}
      </div>
    );
  };

  /* ===== Прочая графика ===== */
  const GraphicsOverlay = () =>
    others.length ? (
      <div
        style={{
          position: "absolute",
          ...tpl.blocks.graphics.pos,
          width: "90%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: tpl.blocks.graphics.margins.gap ?? "10px",
          flexWrap: "wrap",
          zIndex: 3
        }}
      >
        {others.map((g, i) => (
          <img key={`other-${i}`} data-sketch-el="graphic" data-sketch-key={`${i}`} src={g.url} alt={g.name || "Графика"} style={{ width: tpl.blocks.graphics.size.width ?? "auto", height: tpl.blocks.graphics.size.height ?? "auto", maxHeight: tpl.blocks.graphics.size.maxHeight ?? "80px", objectFit: "contain" }} draggable={false} />
        ))}
      </div>
    ) : null;

  /* ===== Эпитафии ===== */
  const EpitaphsOverlay = () =>
    Array.isArray(epitaphs) && epitaphs.length ? (
      <div
        style={{
          position: "absolute",
          ...tpl.blocks.epitaphs.pos,
          width: tpl.blocks.epitaphs.size.width,
          maxWidth: tpl.blocks.epitaphs.size.maxWidth,
          ...tpl.blocks.epitaphs.margins,
          textAlign: (tpl.blocks.epitaphs.text.align as any) ?? "center",
          color: "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          fontStyle: tpl.blocks.epitaphs.text.italic ? "italic" : "normal",
          textTransform: tpl.blocks.epitaphs.text.uppercase ? "uppercase" : "none",
          fontSize: (tpl.blocks.epitaphs.text.fontSizeClamp as any) ?? "clamp(10px, 3.2vw, 22px)",
          lineHeight: (tpl.blocks.epitaphs.text.lineHeight as any) ?? 1.2,
          letterSpacing: (tpl.blocks.epitaphs.text.letterSpacing as any) ?? "0",
          fontWeight: (tpl.blocks.epitaphs.text.fontWeight as any) ?? 400,
          fontFamily: tpl.blocks.epитaphs?.text?.fontFamily || FONT_CENTURY,
          display: "grid",
          gap: 8,
          zIndex: 4
        }}
      >
        {epitaphs.slice(0, 8).map((t, idx) => (
          <div key={`ep-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ whiteSpace: "pre-wrap" }}>
            {t}
          </div>
        ))}
      </div>
    ) : null;

  /* ===== Горизонтальный: 1 человек (портрет 50% H, метрика 40% H; всё влезает) ===== */
  const HorizontalOne = () => {
    const B = tpl.blocks;
    const p = peopleBlocks[0];
    const pad = CFG.general.containerPadding;

    // Область изображения
    const imgTop = pad;
    const imgBottom = pad + imgRect.h;

    // Начальная позиция сверху из конфигурации
    const topPct = parsePercent((CFG.horizontal.one.blocks.portraits.pos as any).top) ?? 0.1;
    let topY = imgTop + Math.round(imgRect.h * topPct);

    // Базовые высоты по требованию
    let portraitH = Math.max(40, Math.round(imgRect.h * 0.5));
    let metricH = Math.max(24, Math.round(imgRect.h * 0.4));
    let spacing = 12;

    // Ширина портрета по AR 3:4 с ограничением по ширине изображения
    let portraitW = Math.round(portraitH * (3 / 4));
    const maxW = imgRect.w;
    if (portraitW > maxW) {
      const kx = maxW / portraitW;
      portraitW = Math.max(40, Math.round(portraitW * kx));
      portraitH = Math.max(40, Math.round(portraitH * kx));
      metricH = Math.max(24, Math.round(metricH * kx));
      spacing = Math.round(spacing * kx);
    }

    // Проверка по высоте: всё должно поместиться
    const totalH0 = portraitH + spacing + metricH;
    if (topY + totalH0 > imgBottom) {
      const kh = (imgBottom - topY) / totalH0;
      if (kh > 0 && isFinite(kh)) {
        portraitH = Math.max(40, Math.round(portraitH * kh));
        metricH = Math.max(24, Math.round(metricH * kh));
        spacing = Math.max(0, Math.round(spacing * kh));
      }
    }
    // Если всё равно не влезло — подвинем вверх
    const totalH = portraitH + spacing + metricH;
    if (topY + totalH > imgBottom) {
      topY = Math.max(imgTop, imgBottom - totalH);
    }

    return (
      <div
        style={{
          position: "absolute",
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
          top: topY,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none"
        }}
      >
        <div style={{ width: portraitW, display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* Портрет */}
          <div style={{ width: portraitW, marginBottom: spacing }}>
            <div
              data-sketch-el="portrait"
              data-sketch-key={p.id}
              style={{
                width: portraitW,
                height: portraitH,
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

          {/* Метрика (контейнер фиксированной высоты, текст обрезается, чтобы не выходить за границы) */}
          <div
            data-sketch-el="metric"
            data-sketch-key={p.id}
            style={{
              width: portraitW,
              height: metricH,
              overflow: "hidden",
              color: "#fff",
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              display: "grid",
              alignContent: "start",
              gap: 6,
              textAlign: (B.metric.text.align as any) ?? "center"
            }}
          >
            {!!p.lines?.[0] && (
              <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>
                {p.lines[0]}
              </div>
            )}
            {!!p.lines?.[1] && (
              <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>
                {p.lines[1]}
              </div>
            )}
            {!!p.lines?.[2] && (
              <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>
                {p.lines[2]}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const HorizontalTwo = () => {
    const B = tpl.blocks;
    const colW = Math.min(320, Math.max((layout as any).columnMinW, Math.floor((imgRect.w - 32 - (layout as any).gap) / 2)));

    return (
      <div
        style={{
          position: "absolute",
          left: 16, right: 16,
          top: CFG.horizontal.one.blocks.portraits.pos.top,
          display: "grid",
          gridTemplateColumns: `repeat(2, ${colW}px)`,
          gap: (layout as any).gap,
          justifyContent: "center",
          alignItems: "start",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.slice(0, 2).map((p) => (
          <div key={p.id} style={{ width: colW, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: B.portraits.size.width, ...B.portraits.margins }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins }}>
              <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                {!!p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[0]}</div>}
                {!!p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[1]}</div>}
                {!!p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[2]}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const HorizontalMany = () => {
    const B = tpl.blocks;
    const cols = Math.min(4, Math.max(3, peopleBlocks.length));
    const perCol = Math.min(260, Math.max((layout as any).columnMinW, Math.floor((imgRect.w - 32) / cols)));

    return (
      <div
        style={{
          position: "absolute",
          left: 16, right: 16,
          top: CFG.horizontal.one.blocks.portraits.pos.top,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${perCol}px)`,
          gap: (layout as any).gap,
          alignItems: "start",
          justifyContent: "center",
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.map((p) => (
          <div key={p.id} style={{ width: perCol, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: B.portraits.size.width, ...B.portraits.margins }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins }}>
              <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                {!!p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[0]}</div>}
                {!!p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[1]}</div>}
                {!!p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[2]}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalOne = () => {
    const B = tpl.blocks;
    const p = peopleBlocks[0];

    return (
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: (B.portraits.pos as any).top ?? "12%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: B.portraits.size.width, maxWidth: B.portraits.size.maxWidth, ...B.portraits.margins }}>
            <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
              {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
            </div>
          </div>

          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, maxWidth: B.metric.size.maxWidth, ...B.metric.margins, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
            <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center" }}>
              {!!p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[0]}</div>}
              {!!p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[1]}</div>}
              {!!p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[2]}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const VerticalTwo = () => {
    const B = tpl.blocks;
    const rowsH = Math.max(100, Math.floor(imgRect.h * CFG.vertical.layout.rowsHeightFactor));

    return (
      <div
        style={{
          position: "absolute",
          top: CFG.vertical.one.blocks.portraits.pos.top,
          left: 16, right: 16,
          display: "grid",
          gridTemplateRows: `repeat(2, minmax(${Math.floor(rowsH / 2)}px, 1fr))`,
          rowGap: CFG.vertical.layout.rowGapPx,
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.slice(0, 2).map((p) => (
          <div key={p.id} style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `45% 55%`, columnGap: 12, alignItems: "center", padding: "6px 8px", boxSizing: "border-box" }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: B.portraits.size.width, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center" }}>
                  {!!p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[0]}</div>}
                  {!!p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[1]}</div>}
                  {!!p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[2]}</div>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalMany = () => {
    const B = tpl.blocks;
    const rowsH = Math.max(100, Math.floor(imgRect.h * CFG.vertical.layout.rowsHeightFactor));
    const rowCount = peopleBlocks.length;

    return (
      <div
        style={{
          position: "absolute",
          top: CFG.vertical.one.blocks.portraits.pos.top,
          left: 16, right: 16,
          display: "grid",
          gridTemplateRows: `repeat(${rowCount}, minmax(${Math.floor(rowsH / rowCount)}px, 1fr))`,
          rowGap: CFG.vertical.layout.rowGapPx,
          pointerEvents: "none"
        }}
      >
        {peopleBlocks.map((p) => (
          <div key={p.id} style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `42% 58%`, columnGap: 12, alignItems: "center", padding: "6px 8px", boxSizing: "border-box" }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: B.portraits.size.width, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center" }}>
                  {!!p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[0]}</div>}
                  {!!p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[1]}</div>}
                  {!!p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1, textTransform: (B.metric.text as any).uppercase ? "uppercase" : "none" }}>{p.lines[2]}</div>}
                </div>
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
      if (n === 1) return <HorizontalOne />;
      if (n === 2) return <HorizontalTwo />;
      return <HorizontalMany />;
    }
    if (n === 1) return <VerticalOne />;
    if (n === 2) return <VerticalTwo />;
    return <VerticalMany />;
  };

  return (
    <div
      style={{
        ...bottomUnderlayGradient(),
        borderRadius: 10,
        position: "relative",
        width: "100%",
        height: sketchH,
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
      <GraphicsOverlay />
      <EpitaphsOverlay />
    </div>
  );
}
