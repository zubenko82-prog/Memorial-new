// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.

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

type CssSize = Partial<{ width: string; height: string; maxWidth: string; maxHeight: string }>;
type CssPos = Partial<{ top: string; left: string; right: string; bottom: string; transform: string }>;
type GridTweaksPortrait = Partial<{
  heightPctOfRow: number;
  widthPctOfColLimitPct: number;
  topExtraPctOfRow: number;
}>;
type GridTweaksMetric = Partial<{
  widthPctOfCol: number;
  maxHeightPctOfRow: number;
  topExtraPctOfRow: number;
}>;
type DisplayTweaks = Partial<{ scale: number }>;
type BlockSettings = {
  size?: CssSize;
  pos?: CssPos;
  grid?: GridTweaksPortrait | GridTweaksMetric;
  display?: DisplayTweaks;
};
type VariantKey = "one" | "two" | "many";
type BlockKey = "cross" | "portraits" | "metric" | "graphics" | "epitaphs";
type VariantSettings = Partial<Record<BlockKey, BlockSettings>>;
type OrientationSettings = Partial<Record<VariantKey, VariantSettings>>;
type TemplateSettings = {
  horizontal?: OrientationSettings;
  vertical?: OrientationSettings;
};

const TPL_SETTINGS: TemplateSettings = {
  // Горизонтальные шаблоны
  horizontal: {
    // 1 человек: портрет больше и с отступом сверху; метрика — мельче
    one: {
      portraits: {
        // Твики сетки 2×3 для портрета
        grid: {
          heightPctOfRow: 95,         // портрет занимает до 95% высоты ряда
          widthPctOfColLimitPct: 95,  // и не шире 95% ширины колонки
          topExtraPctOfRow: 18         // дополнительный сдвиг вниз от верхнего края ряда в процентах
        }
      },
      metric: {
        // Твики сетки 2×3 для метрики
        grid: {
          widthPctOfCol: 50,          // метрика — 70% ширины колонки (мельче)
          maxHeightPctOfRow: 60,      // высота метрики не более 90% высоты ряда
          topExtraPctOfRow: 0         // можно добавить сдвиг вниз в % ряда при необходимости
        },
        display: {
          scale: 0.6                 // визуальный масштаб метрики (<1 делает её компактнее)
        }
      }
      // cross/graphics/epitaphs для "one" — без индивидуальных правок (используем базовые CFG)
    },

    // 2 человека: графика (others) крупнее
    two: {
      graphics: {
        size: {
          maxHeight: "80px"           // делаем крупнее блоки графики
        }
      }
      // Остальные блоки — по базовым CFG
    }

    // many: без явных переопределений — используется базовый CFG
  },

  // Вертикальные шаблоны — без индивидуальных переопределений в рамках задачи
  vertical: {
    // one: {}, two: {}, many: {} — базовые CFG
  }
};
/* ======================= КОНЕЦ БЛОКА НАСТРОЕК (НЕ ВЫВОДИТЬ В UI) ======================= */

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
        cross: { pos: { top: "6%", left: "6%", transform: "translateX(-50%)" }, size: { width: "8%", height: "auto" }, margins: {} },
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

// Применяем внутренние CSS-настройки (size/pos) к базовому CFG-блоку
function mergeBlockCss(base: any, override?: BlockSettings) {
  if (!override) return base;
  return {
    ...base,
    pos: { ...(base.pos || {}), ...(override.pos || {}) },
    size: { ...(base.size || {}), ...(override.size || {}) },
    margins: { ...(base.margins || {}) } // оставляем margins из CFG
  };
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

  // Применяем ВНУТРЕННИЕ настройки (CSS) к базовой схеме CFG для текущей ориентации/варианта
  const tpl = useMemo(() => {
    const base = (isVertical ? (CFG.vertical as any)[tplKey] : (CFG.horizontal as any)[tplKey]) || {};
    const ovOri = isVertical ? TPL_SETTINGS.vertical : TPL_SETTINGS.horizontal;
    const ovVariant: VariantSettings | undefined = ovOri?.[tplKey];

    if (!ovVariant) return base;

    return {
      blocks: {
        cross: mergeBlockCss(base.blocks.cross, ovVariant.cross),
        portraits: mergeBlockCss(base.blocks.portraits, ovVariant.portraits),
        metric: mergeBlockCss(base.blocks.metric, ovVariant.metric),
        graphics: mergeBlockCss(base.blocks.graphics, ovVariant.graphics),
        epitaphs: mergeBlockCss(base.blocks.epitaphs, ovVariant.epitaphs)
      }
    };
  }, [isVertical, tplKey]);

  const layout = useMemo(() => (isVertical ? CFG.vertical.layout : CFG.horizontal.layout), [isVertical]);

  /* ===== Кресты (как прежде, но учитывают внутренние CSS-настройки из tpl) ===== */
  const CrossOverlay = () => {
    if (!crosses.length) return null;

    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";

    const baseSize = (tpl.blocks as any).cross.size;
    const basePos = (tpl.blocks as any).cross.pos;

    const baseFilter: React.CSSProperties = {
      objectFit: "contain",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      zIndex: 3,
      position: "absolute"
    };

    // Позиции с учётом возможных override'ов
    const topLeftPos: React.CSSProperties = { top: basePos.top ?? "6%", left: basePos.left ?? "4%", transform: basePos.transform };
    const topCenterPos: React.CSSProperties = { top: basePos.top ?? "6%", left: "50%", transform: "translateX(-50%)" };
    const topRightPos: React.CSSProperties = { top: basePos.top ?? "6%", right: basePos.right ?? "4%" };

    if (crosses.length === 1) {
      const c = crosses[0];
      const pos = isHorizontalTwo ? topCenterPos : topLeftPos;
      return <img data-sketch-el="cross" data-sketch-key="0" src={c.url} alt={c.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...pos }} draggable={false} />;
    }

    if (crosses.length >= 2 && isHorizontalTwo) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topLeftPos }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topRightPos }} draggable={false} />
        </>
      );
    }

    if (crosses.length === 2) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topLeftPos }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...baseFilter, ...baseSize, ...topRightPos }} draggable={false} />
        </>
      );
    }

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

  /* ===== Прочая графика (others)
     На "горизонтальный — 2 человека" — maxHeight может быть увеличен настройками. ===== */
  const GraphicsOverlay = () => {
    if (others.length === 0) return null;

    return (
      <div
        style={{
          position: "absolute",
          ...((tpl.blocks as any).graphics.pos as React.CSSProperties),
          width: "90%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: (tpl.blocks as any).graphics.margins?.gap ?? "10px",
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
              width: (tpl.blocks as any).graphics.size.width ?? "auto",
              height: (tpl.blocks as any).graphics.size.height ?? "auto",
              maxHeight: (tpl.blocks as any).graphics.size.maxHeight ?? "80px",
              maxWidth: (tpl.blocks as any).graphics.size.maxWidth,
              objectFit: "contain",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
              flex: "0 0 auto"
            }}
            draggable={false}
          />
        ))}
      </div>
    );
  };

  /* ===== Эпитафии (позиции/размеры также учитывают внутренние настройки через tpl) ===== */
  const EpitaphsOverlay = () =>
    Array.isArray(epitaphs) && epitaphs.length > 0 ? (
      <div
        style={{
          position: "absolute",
          ...((tpl.blocks as any).epitaphs.pos as React.CSSProperties),
          width: (tpl.blocks as any).epitaphs.size.width,
          maxWidth: (tpl.blocks as any).epitaphs.size.maxWidth,
          ...((tpl.blocks as any).epitaphs.margins as React.CSSProperties),
          textAlign: ((tpl.blocks as any).epitaphs.text.align as any) ?? "center",
          color: "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          fontStyle: (tpl.blocks as any).epitaphs.text.italic ? "italic" : "normal",
          textTransform: (tpl.blocks as any).epitaphs.text.uppercase ? "uppercase" : "none",
          fontSize: ((tpl.blocks as any).epitaphs.text.fontSizeClamp as any) ?? "clamp(10px, 3.2vw, 22px)",
          lineHeight: ((tpl.blocks as any).epitaphs.text.lineHeight as any) ?? 1.2,
          letterSpacing: ((tpl.blocks as any).epitaphs.text.letterSpacing as any) ?? "0",
          fontWeight: ((tpl.blocks as any).epitaphs.text.fontWeight as any) ?? 400,
          fontFamily: (tpl.blocks as any).epitaphs.text.fontFamily ?? FONT_CENTURY,
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
      <div style={{ width: "100%", display: "grid", gap: 6, textAlign: align, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
        {!!L[0] && <div style={{ font: textCfg.l1.font, lineHeight: textCfg.l1.lineHeight, letterSpacing: textCfg.l1.letterSpacing }}>{toUp(L[0])}</div>}
        {!!L[1] && <div style={{ font: textCfg.l2.font, lineHeight: textCfg.l2.lineHeight, letterSpacing: textCfg.l2.letterSpacing }}>{toUp(L[1])}</div>}
        {!!L[2] && <div style={{ font: textCfg.l3.font, lineHeight: textCfg.l3.lineHeight, letterSpacing: textCfg.l3.letterSpacing, opacity: textCfg.l3.opacity ?? 1 }}>{toUp(L[2])}</div>}
      </div>
    );
  }

  // Горизонтальный шаблон: 1 человек — портрет больше + отступ сверху, метрика мельче.
  // Сетка 2×3: портрет — верхний ряд (центр), метрика — нижний ряд (центр).
  const HorizontalOne = () => {
    const p = peopleBlocks[0];
    if (!imgRect.h || !imgRect.w) return null;

    const cols = 2;
    const rows = 3;
    const cellW = imgRect.w / cols;
    const cellH = imgRect.h / rows;

    // Читаем скрытые твики для "horizontal.one"
    const sVar = TPL_SETTINGS.horizontal?.one;
    const sPortrait = sVar?.portraits?.grid as GridTweaksPortrait | undefined;
    const sMetric = sVar?.metric?.grid as GridTweaksMetric | undefined;
    const sMetricDisplay = sVar?.metric?.display as DisplayTweaks | undefined;

    // Портрет: высота/ограничение ширины/сдвиг сверху в процентах ряда
    const phPct = sPortrait?.heightPctOfRow ?? 95;
    const pwLimitPct = sPortrait?.widthPctOfColLimitPct ?? 95;
    const pTopExtraPct = sPortrait?.topExtraPctOfRow ?? 8;

    let portraitH = Math.max(50, Math.round((phPct / 100) * cellH));
    let portraitW = Math.round(portraitH * (3 / 4));
    const maxPortraitW = Math.round((pwLimitPct / 100) * cellW);
    if (portraitW > maxPortraitW) {
      const k = maxPortraitW / portraitW;
      portraitW = Math.max(50, Math.round(portraitW * k));
      portraitH = Math.max(50, Math.round(portraitH * k));
    }

    let portraitTop = Math.round((cellH - portraitH) / 2 + (pTopExtraPct / 100) * cellH);
    portraitTop = Math.min(portraitTop, Math.max(0, Math.round(cellH - portraitH - 4)));

    // Метрика: ширина/макс. высота/сдвиг сверху (в % ряда) и визуальный scale
    const mwPct = sMetric?.widthPctOfCol ?? 70;
    const mhPct = sMetric?.maxHeightPctOfRow ?? 90;
    const mTopExtraPct = sMetric?.topExtraPctOfRow ?? 0;
    const metricScale = sMetricDisplay?.scale ?? 0.88;

    const metricW = Math.max(100, Math.round((mwPct / 100) * cellW));
    const metricMaxH = Math.max(40, Math.round((mhPct / 100) * cellH));
    const metricTopBase = Math.round(2 * cellH + (cellH - metricMaxH) / 2);
    const metricTop = Math.round(metricTopBase + (mTopExtraPct / 100) * cellH);

    return (
      <>
        {/* Портрет (верхний ряд, центр) */}
        <div
          style={{
            position: "absolute",
            top: portraitTop,
            left: "50%",
            transform: "translateX(-50%)",
            width: portraitW,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none"
          }}
        >
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

        {/* Метрика (нижний ряд, центр) — уменьшенная */}
        <div
          data-sketch-el="metric"
          data-sketch-key={p.id}
          style={{
            position: "absolute",
            top: metricTop,
            left: "50%",
            transform: "translateX(-50%)",
            width: metricW,
            pointerEvents: "none",
            display: "flex",
            justifyContent: "center"
          }}
        >
          <div style={{ transform: `scale(${metricScale})`, transformOrigin: "top center", width: "100%" }}>
            <PersonMetricText
              lines={p.lines}
              textCfg={(CFG.horizontal.one.blocks as any).metric.text}
              align={((CFG.horizontal.one.blocks as any).metric.text.align as any) ?? "center"}
            />
          </div>
        </div>
      </>
    );
  };

  const HorizontalTwo = () => {
    const B = (tpl.blocks as any);
    const colW = Math.min(320, Math.max((layout as any).columnMinW, Math.floor((imgRect.w - 32 - (layout as any).gap) / 2)));

    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: (CFG.horizontal.one.blocks as any).portraits.pos.top,
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
            <div style={{ width: B.portraits.size.width, ...(B.portraits.margins || {}) }}>
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
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...(B.metric.margins || {}) }}>
              <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const HorizontalMany = () => {
    const B = (tpl.blocks as any);
    const cols = Math.min(4, Math.max(3, peopleBlocks.length));
    const perCol = Math.min(260, Math.max((layout as any).columnMinW, Math.floor((imgRect.w - 32) / cols)));

    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: (CFG.horizontal.one.blocks as any).portraits.pos.top,
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
            <div style={{ width: B.portraits.size.width, ...(B.portraits.margins || {}) }}>
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
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...(B.metric.margins || {}) }}>
              <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalOne = () => {
    const B = (tpl.blocks as any);
    const p = peopleBlocks[0];

    return (
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: (B.portraits.pos as any).top ?? "12%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: B.portraits.size.width, maxWidth: B.portraits.size.maxWidth, ...(B.portraits.margins || {}) }}>
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

          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, maxWidth: B.metric.size.maxWidth, ...(B.metric.margins || {}) }}>
            <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
          </div>
        </div>
      </div>
    );
  };

  const VerticalTwo = () => {
    const B = (CFG.vertical.two.blocks as any);
    const rowsH = Math.max(100, Math.floor(imgRect.h * CFG.vertical.layout.rowsHeightFactor));

    return (
      <div
        style={{
          position: "absolute",
          top: (CFG.vertical.one.blocks as any).portraits.pos.top,
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
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...(B.metric.margins || {}) }}>
                <PersonMetricText lines={p.lines} textCfg={B.metric.text} align={B.metric.text.align ?? "center"} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalMany = () => {
    const B = (CFG.vertical.many.blocks as any);
    const rowsH = Math.max(100, Math.floor(imgRect.h * CFG.vertical.layout.rowsHeightFactor));
    const rowCount = peopleBlocks.length;

    return (
      <div
        style={{
          position: "absolute",
          top: (CFG.vertical.one.blocks as any).portraits.pos.top,
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
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...(B.metric.margins || {}) }}>
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
