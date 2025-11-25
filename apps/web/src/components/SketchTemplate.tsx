// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
// Требования:
// - Горизонтальный шаблон «1 человек»: портрет = 40% от высоты изображения, метрика = 25% от высоты изображения,
//   оба блока центрируются и ГАРАНТИРОВАННО помещаются в эскиз (ограничения по ширине и высоте с масштабированием).
// - Кресты: если один крест — слева вверху на всех шаблонах, кроме горизонтального «два человека»;
//   для горизонтального «два человека»: 1 крест по центру, 2 — по краям.
// - Все элементы должны быть внутри границ эскиза.

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
        portraits: { pos: { top: "10%", left: "50%", transform: "translateX(-50%)" }, size: { width: "60%", maxWidth: "400px", height: "auto" }, margins: { margin: "0 auto 16px auto" } },
        metric: {
          pos: { top: "auto", bottom: "auto", left: "50%", transform: "translateX(-50%)" },
          size: { width: "100%", maxWidth: "520px", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 clamp(18px, 3.4vw, 32px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" },
            l2: { font: `600 clamp(16px, 3vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" },
            l3: { font: `400 clamp(14px, 2.6vw, 22px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.2px", opacity: 0.95 }
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
            l1: { font: `500 clamp(10px, 1.6vw, 24px) ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.35px" },
            l2: { font: `400 clamp(8px, 1.2vw, 20px) ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.25px" },
            l3: { font: `300 clamp(6px, 0.9vw, 18px) ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.2px", opacity: 0.95 }
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
            l1: { font: `700 clamp(14px, 1.8vw, 20px) ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.25px" },
            l2: { font: `600 clamp(12px, 1.6vw, 18px) ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px" },
            l3: { font: `400 clamp(11px, 1.5vw, 16px) ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px", opacity: 0.95 }
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
            l1: { font: `700 clamp(20px, 4vw, 32px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" },
            l2: { font: `600 clamp(18px, 3.4vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" },
            l3: { font: `400 clamp(16px, 3vw, 22px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.25px", opacity: 0.95 }
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
          pos: {},
          size: { width: "90%", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 clamp(18px, 3.2vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.35px" },
            l2: { font: `600 clamp(16px, 2.8vw, 22px) ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.25px" },
            l3: { font: `400 clamp(14px, 2.4vw, 18px) ${FONT_CENTURY}`, lineHeight: 1.12, letterSpacing: "0.2px", opacity: 0.95 }
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
            l1: { font: `700 clamp(16px, 2.8vw, 24px) ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.25px" },
            l2: { font: `600 clamp(14px, 2.4vw, 20px) ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px" },
            l3: { font: `400 clamp(12px, 2vw, 18px) ${FONT_CENTURY}`, lineHeight: 1.1, letterSpacing: "0.2px", opacity: 0.95 }
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

  /* ===== Кресты (с правилами размещения) ===== */
  const CrossOverlay = () => {
    if (!crosses.length) return null;

    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";

    const baseSize = (tpl.blocks as any).cross.size; // проценты
    const baseFilter: React.CSSProperties = {
      objectFit: "contain",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      zIndex: 3,
      position: "absolute"
    };

    // Используем процентные позиции для привязки к изображению (внутри оно точно помещается).
    const topLeftPos: React.CSSProperties = { top: "6%", left: "4%" };
    const topCenterPos: React.CSSProperties = { top: "6%", left: "50%", transform: "translateX(-50%)" };
    const topRightPos: React.CSSProperties = { top: "6%", right: "4%" };

    if (crosses.length === 1) {
      const c = crosses[0];
      const pos = isHorizontalTwo ? topCenterPos : topLeftPos;
      return (
        <img
          data-sketch-el="cross"
          data-sketch-key="0"
          src={c.url}
          alt={c.name || "Крест"}
          style={{ ...baseFilter, ...baseSize, ...pos }}
          draggable={false}
        />
      );
    }

    if (crosses.length >= 2 && isHorizontalTwo) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img
            data-sketch-el="cross"
            data-sketch-key="0"
            src={cL.url}
            alt={cL.name || "Крест"}
            style={{ ...baseFilter, ...baseSize, ...topLeftPos }}
            draggable={false}
          />
          <img
            data-sketch-el="cross"
            data-sketch-key="1"
            src={cR.url}
            alt={cR.name || "Крест"}
            style={{ ...baseFilter, ...baseSize, ...topRightPos }}
            draggable={false}
          />
        </>
      );
    }

    if (crosses.length === 2) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img
            data-sketch-el="cross"
            data-sketch-key="0"
            src={cL.url}
            alt={cL.name || "Крест"}
            style={{ ...baseFilter, ...baseSize, ...topLeftPos }}
            draggable={false}
          />
          <img
            data-sketch-el="cross"
            data-sketch-key="1"
            src={cR.url}
            alt={cR.name || "Крест"}
            style={{ ...baseFilter, ...baseSize, ...topRightPos }}
            draggable={false}
          />
        </>
      );
    }

    // >2 — столбик слева
    return (
      <div
        style={{
          position: "absolute",
          ...topLeftPos,
          display: "grid",
          gridAutoFlow: "row",
          rowGap: 6,
          width: baseSize.width,
          zIndex: 3
        }}
      >
        {crosses.map((c, i) => (
          <img
            key={`cross-${i}`}
            data-sketch-el="cross"
            data-sketch-key={`${i}`}
            src={c.url}
            alt={c.name || "Крест"}
            style={{ width: "100%", height: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
            draggable={false}
          />
        ))}
      </div>
    );
  };

  /* ===== Прочая графика (others) ===== */
  const GraphicsOverlay = () =>
    others.length > 0 ? (
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
        data-sketch-orient={isVertical ? "vertical" : "horizontal"}
      >
        {others.map((g, i) => (
          <img
            key={`other-${i}`}
            data-sketch-el="graphic"
            data-sketch-key={`${i}`}
            src={g.url}
            alt={g.name || "Графика"}
            style={{
              width: tpl.blocks.graphics.size.width ?? "auto",
              height: tpl.blocks.graphics.size.height ?? "auto",
              maxHeight: tpl.blocks.graphics.size.maxHeight ?? "80px",
              maxWidth: tpl.blocks.graphics.size.maxWidth,
              objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
              flex: "0 0 auto"
            }}
            draggable={false}
          />
        ))}
      </div>
    ) : null;

  /* ===== Эпитафии ===== */
  const EpitaphsOverlay = () =>
    Array.isArray(epitaphs) && epitaphs.length > 0 ? (
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
          fontFamily: tpl.blocks.epitaphs.text.fontFamily ?? FONT_CENTURY,
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

  function PersonMetricText({
    lines,
    align,
    textCfg
  }: {
    lines: string[];
    align: "center" | "left" | "right";
    textCfg: any;
  }) {
    const L = [(lines[0] || "").trim(), (lines[1] || "").trim(), (lines[2] || "").trim()];
    const toUp = (s: string) => (textCfg.uppercase ? s.toUpperCase() : s);

    return (
      <div style={{ width: "100%", display: "grid", gap: 6, textAlign: align, textShadow: "0 1px 2px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        {!!L[0] && (
          <div style={{ font: textCfg.l1.font, lineHeight: textCfg.l1.lineHeight, letterSpacing: textCfg.l1.letterSpacing }}>{toUp(L[0])}</div>
        )}
        {!!L[1] && (
          <div style={{ font: textCfg.l2.font, lineHeight: textCfg.l2.lineHeight, letterSpacing: textCfg.l2.letterSpacing }}>{toUp(L[1])}</div>
        )}
        {!!L[2] && (
          <div
            style={{ font: textCfg.l3.font, lineHeight: textCfg.l3.lineHeight, letterSpacing: textCfg.l3.letterSpacing, opacity: textCfg.l3.opacity ?? 1 }}
          >
            {toUp(L[2])}
          </div>
        )}
      </div>
    );
  }

  // Горизонтальный шаблон с ОДНИМ человеком: портрет 40% H, метрика 25% H, всё по центру и в пределах изображения.
  const HorizontalOne = () => {
    const B = tpl.blocks;
    const p = peopleBlocks[0];
    const pad = CFG.general.containerPadding;

    // Геометрия области изображения в контейнере
    const imageTop = pad;
    const imageBottom = pad + imgRect.h;
    const imageLeft = pad;
    const imageRight = pad + imgRect.w;
    const maxContentWidth = imgRect.w; // ширина внутри изображения

    // Начальная желаемая верхняя позиция по конфигу (процент от высоты)
    const topPct = parsePercent((CFG.horizontal.one.blocks.portraits.pos as any).top) ?? 0.1;
    let desiredTop = imageTop + Math.round(imgRect.h * topPct);

    // Базовые высоты по требованию
    let portraitH = Math.max(40, Math.round(imgRect.h * 0.40));
    let metricH = Math.max(24, Math.round(imgRect.h * 0.25));

    // Отступ между портретом и метрикой — из margins портрета (если есть)
    const mbMatch = String((B.portraits.margins as any)?.margin || "0 0 16px 0").match(/(?:^| )(\d+)px(?: |$)/g);
    let spacing = 16;
    if (mbMatch && mbMatch.length >= 3) {
      const b = parseInt(mbMatch[2], 10);
      if (!isNaN(b)) spacing = b;
    }

    // Проверка по ширине: портрет AR 3:4
    let portraitW = Math.round(portraitH * (3 / 4));
    if (portraitW > maxContentWidth) {
      const kx = maxContentWidth / portraitW;
      portraitW = Math.max(40, Math.round(portraitW * kx));
      portraitH = Math.max(40, Math.round(portraitH * kx));
      metricH = Math.max(24, Math.round(metricH * kx)); // сохраняем пропорции, чтобы оба поместились
    }

    // Проверка по высоте: всё должно уместиться ниже desiredTop
    let totalH = portraitH + spacing + metricH;
    const availableH = imageBottom - desiredTop;
    if (totalH > availableH) {
      const kh = availableH / totalH;
      portraitH = Math.max(40, Math.round(portraitH * kh));
      metricH = Math.max(24, Math.round(metricH * kh));
      spacing = Math.max(0, Math.round(spacing * kh));
      totalH = portraitH + spacing + metricH;
    }

    // Если всё ещё не влезает (из-за очень большого topPct) — подвинем вверх
    if (desiredTop + totalH > imageBottom) {
      desiredTop = Math.max(imageTop, imageBottom - totalH);
    }

    // Центрируем по горизонтали внутри изображения
    const wrapperStyle: React.CSSProperties = {
      position: "absolute",
      left: imageLeft,
      right: imageLeft, // одинаковый отступ слева/справа = padding, итого ширина = imgRect.w
      top: desiredTop,
      display: "flex",
      justifyContent: "center",
      pointerEvents: "none"
    };

    return (
      <div style={wrapperStyle}>
        <div style={{ width: portraitW, display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* Портрет — фикс. размер (чтобы точно помещался) */}
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
                <img
                  src={p.photo}
                  alt="Фото"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  draggable={false}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>
                  (нет фото)
                </div>
              )}
            </div>
          </div>

          {/* Метрика — фикс. высота, не вылезает за пределы */}
          <div
            data-sketch-el="metric"
            data-sketch-key={p.id}
            style={{
              width: portraitW,
              height: metricH,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
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
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
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
            <div style={{ width: (B.portraits.size.width as any) ?? "100%", ...B.portraits.margins }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? (
                  <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                )}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (B.metric.size.width as any) ?? "100%", ...B.metric.margins }}>
              <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
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
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
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
            <div style={{ width: (B.portraits.size.width as any) ?? "100%", ...B.portraits.margins }}>
              <div
                data-sketch-el="portrait"
                data-sketch-key={p.id}
                style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? (
                  <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                )}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (B.metric.size.width as any) ?? "100%", ...B.metric.margins }}>
              <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
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
            <div
              data-sketch-el="portrait"
              data-sketch-key={p.id}
              style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
            >
              {p.photo ? (
                <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
              )}
            </div>
          </div>

          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, maxWidth: B.metric.size.maxWidth, ...B.metric.margins, overflow: "hidden" }}>
            <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
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
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
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
                style={{ width: B.portraits.size.width, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? (
                  <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                )}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, overflow: "hidden" }}>
                <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
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
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
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
                style={{ width: B.portraits.size.width, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
              >
                {p.photo ? (
                  <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                )}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, overflow: "hidden" }}>
                <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
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
