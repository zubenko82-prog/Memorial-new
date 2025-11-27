// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
// Изменения по требованию:
// - Горизонтальный шаблон 1 человек: портрет больше, добавлен отступ сверху у портрета; метрика мельче.
// - Горизонтальный шаблон 2 человека: графика (others) крупнее.
// - Добавлен блок "Настройки шаблона" для каждого шаблона (вертикальные/горизонтальные; 1, 2, >2 чел):
//   для каждого блока (крест, портрет, метрика, графика, эпитафия) редактируются размер (width/height/maxWidth/maxHeight) и положение (top/left/right/bottom/transform).
//   Настройки сохраняются в localStorage и применяются как оверрайды к базовому CFG.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

type Orientation = "vertical" | "horizontal";
type VariantKey = "one" | "two" | "many";
type BlockKey = "cross" | "portraits" | "metric" | "graphics" | "epitaphs";

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

// Базовая конфигурация
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

// Настройки (overrides)
type PosCfg = Partial<{ top: string; right: string; bottom: string; left: string; transform: string }>;
type SizeCfg = Partial<{ width: string; height: string; maxWidth: string; maxHeight: string }>;
type BlockOverride = { pos?: PosCfg; size?: SizeCfg };
type VariantOverride = Partial<Record<BlockKey, BlockOverride>>;
type OrientationOverrideCfg = Partial<Record<VariantKey, VariantOverride>>;
type TemplateOverrides = { horizontal?: OrientationOverrideCfg; vertical?: OrientationOverrideCfg };

const LS_SETTINGS_KEY = "memorial.sketch.settings.v1";

function loadOverrides(): TemplateOverrides {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TemplateOverrides;
  } catch {
    return {};
  }
}
function saveOverrides(data: TemplateOverrides) {
  try {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(data));
  } catch {}
}

// Мерджим pos/size
function mergeBlock(base: any, override?: BlockOverride) {
  if (!override) return base;
  return {
    ...base,
    pos: { ...(base.pos || {}), ...(override.pos || {}) },
    size: { ...(base.size || {}), ...(override.size || {}) },
    margins: { ...(base.margins || {}) },
    text: { ...(base.text || {}) } // для эпитафий
  };
}

function bottomUnderlayGradient(): React.CSSProperties {
  return {
    backgroundColor: "#000",
    backgroundImage: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  };
}

function pickTplKey(n: number): VariantKey {
  if (n <= 1) return "one";
  if (n === 2) return "two";
  return "many";
}

// Парсер процентов (для горизонтального "1" с гридом 2×3)
function parsePct(v?: string, fallbackPct?: number): number | undefined {
  if (v == null || v === "") return fallbackPct;
  const m = String(v).trim().match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (!m) return fallbackPct;
  const n = parseFloat(m[1]);
  return isFinite(n) ? n : fallbackPct;
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
  const [overrides, setOverrides] = useState<TemplateOverrides>(() => loadOverrides());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

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

  // Применяем overrides к CFG для текущей ориентации/варианта
  const tpl = useMemo(() => {
    const base = isVertical ? (CFG.vertical as any)[tplKey] : (CFG.horizontal as any)[tplKey];
    const ov = (isVertical ? overrides.vertical : overrides.horizontal)?.[tplKey] || {};
    return {
      blocks: {
        cross: mergeBlock(base.blocks.cross, (ov as any).cross),
        portraits: mergeBlock(base.blocks.portraits, (ov as any).portraits),
        metric: mergeBlock(base.blocks.metric, (ov as any).metric),
        graphics: mergeBlock(base.blocks.graphics, (ov as any).graphics),
        epitaphs: mergeBlock(base.blocks.epitaphs, (ov as any).epitaphs)
      }
    };
  }, [isVertical, tplKey, overrides]);

  const layout = useMemo(() => (isVertical ? CFG.vertical.layout : CFG.horizontal.layout), [isVertical]);

  /* ===== Кресты (позиции+размер из tpl, с правилами для горизонтального "два") ===== */
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

    const topLeftPos: React.CSSProperties = { top: basePos.top ?? "6%", left: basePos.left ?? "4%", transform: basePos.transform };
    const topCenterPos: React.CSSProperties = { top: basePos.top ?? "6%", left: "50%", transform: "translateX(-50%)" };
    const topRightPos: React.CSSProperties = { top: basePos.top ?? "6%", right: "4%" };

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

  /* ===== Прочая графика (others) =====
     На горизонтальном "два" — увеличиваем до 80px, если нет переопределения через настройки. */
  const GraphicsOverlay = () => {
    if (others.length === 0) return null;

    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";

    const configuredMaxH = (tpl.blocks as any).graphics.size.maxHeight as string | undefined;
    // Если пользователь не задал maxHeight — применим увеличенный 80px для Horizontal Two
    const maxH = configuredMaxH ?? (isHorizontalTwo ? "80px" : undefined);

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
              maxHeight: maxH ?? (tpl.blocks as any).graphics.size.maxHeight ?? "80px",
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

  /* ===== Эпитафии ===== */
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
  // Сетка 2×3: портрет — верхний ряд, центр по горизонтали; метрика — нижний ряд, центр по горизонтали.
  // Добавлены оверрайды: portraits.size.height/width как % ряда/колонки; portraits.pos.top — доп. сдвиг % ряда;
  // metric.size.width — % колонки; metric.size.height — макс % ряда; metric.pos.top — доп. сдвиг % ряда.
  const HorizontalOne = () => {
    const p = peopleBlocks[0];
    if (!imgRect.h || !imgRect.w) return null;

    const cols = 2;
    const rows = 3;
    const cellW = imgRect.w / cols;
    const cellH = imgRect.h / rows;

    const ov = (overrides.horizontal?.one as VariantOverride | undefined) || {};
    const ovPortrait = ov.portraits;
    const ovMetric = ov.metric;

    // Портрет
    const phPct = parsePct(ovPortrait?.size?.height, 95) || 95; // % высоты ряда
    const pwPct = parsePct(ovPortrait?.size?.width, 95) || 95;  // % ширины колонки
    const pTopExtraPct = parsePct(ovPortrait?.pos?.top, 8) || 8; // % доп. сдвига вниз
    let portraitH = Math.max(50, Math.round((phPct / 100) * cellH));
    let portraitW = Math.round(portraitH * (3 / 4));
    const maxPortraitW = Math.round((pwPct / 100) * cellW);
    if (portraitW > maxPortraitW) {
      const k = maxPortraitW / portraitW;
      portraitW = Math.max(50, Math.round(portraitW * k));
      portraitH = Math.max(50, Math.round(portraitH * k));
    }
    let portraitTop = Math.round((cellH - portraitH) / 2 + (pTopExtraPct / 100) * cellH);
    portraitTop = Math.min(portraitTop, Math.max(0, Math.round(cellH - portraitH - 4)));

    // Метрика
    const mwPct = parsePct(ovMetric?.size?.width, 70) || 70;
    const mhPct = parsePct(ovMetric?.size?.height, 90) || 90;
    const mTopExtraPct = parsePct(ovMetric?.pos?.top, 0) || 0;

    const metricW = Math.max(100, Math.round((mwPct / 100) * cellW));
    const metricMaxH = Math.max(40, Math.round((mhPct / 100) * cellH));
    const metricTopBase = Math.round(2 * cellH + (cellH - metricMaxH) / 2);
    const metricTop = Math.round(metricTopBase + (mTopExtraPct / 100) * cellH);

    // Визуально немного уменьшенная метрика (как по требованию)
    const metricScale = 0.88;

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

        {/* Метрика (нижний ряд, центр) */}
        <div
          data-sketch-el="metric"
          data-sketch-key={p.id}
          style={{
            position: "absolute",
            top: metricTop,
            left: "50%",
            transform: "translateX(-50%)",
            width: metricW,
            maxHeight: metricMaxH,
            overflow: "hidden",
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
          top: (B.portraits.pos as any)?.top ?? (CFG.horizontal.one.blocks as any).portraits.pos.top,
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
          top: (B.portraits.pos as any)?.top ?? (CFG.horizontal.one.blocks as any).portraits.pos.top,
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
    const B = (tpl.blocks as any);
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
    const B = (tpl.blocks as any);
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

  // Панель настроек
  function setField(
    ori: Orientation,
    varKey: VariantKey,
    block: BlockKey,
    group: "pos" | "size",
    key: keyof (PosCfg & SizeCfg),
    value: string
  ) {
    setOverrides((prev) => {
      const next: TemplateOverrides = JSON.parse(JSON.stringify(prev || {}));
      if (!next[ori]) next[ori] = {};
      if (!(next[ori] as any)[varKey]) (next[ori] as any)[varKey] = {};
      const vRef = (next[ori] as any)[varKey] as VariantOverride;
      if (!vRef[block]) vRef[block] = {};
      if (!(vRef[block] as any)[group]) (vRef[block] as any)[group] = {};
      (vRef[block] as any)[group][key] = value;
      saveOverrides(next);
      return next;
    });
  }

  const panels: Array<{ ori: Orientation; title: string }> = [
    { ori: "vertical", title: "Вертикальные шаблоны" },
    { ori: "horizontal", title: "Горизонтальные шаблоны" }
  ];
  const variants: Array<{ key: VariantKey; title: string }> = [
    { key: "one", title: "1 человек" },
    { key: "two", title: "2 человека" },
    { key: "many", title: "Более 2 человек" }
  ];
  const blocks: Array<{ key: BlockKey; title: string }> = [
    { key: "cross", title: "Крест" },
    { key: "portraits", title: "Портрет" },
    { key: "metric", title: "Метрика" },
    { key: "graphics", title: "Графика" },
    { key: "epitaphs", title: "Эпитафия" }
  ];

  const SettingsPanel = () => (
    <div style={{ position: "absolute", right: 10, top: 10, zIndex: 20, maxWidth: 340 }}>
      <button
        onClick={() => setSettingsOpen((v) => !v)}
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(30,30,36,0.65)",
          color: "#fff",
          cursor: "pointer"
        }}
      >
        {settingsOpen ? "Скрыть настройки" : "Настройки шаблона"}
      </button>

      {settingsOpen && (
        <div
          style={{
            marginTop: 8,
            maxHeight: "68vh",
            overflow: "auto",
            background: "rgba(20,20,24,0.6)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 10,
            padding: 10,
            color: "#fff"
          }}
        >
          {panels.map((pnl) => {
            const oriOv = overrides[pnl.ori] || {};
            return (
              <div key={pnl.ori} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, margin: "6px 0 8px" }}>{pnl.title}</div>

                {variants.map((v) => {
                  const varOv = (oriOv as any)[v.key] || {};
                  return (
                    <div key={`${pnl.ori}-${v.key}`} style={{ marginBottom: 10, padding: 8, border: "1px dashed rgba(255,255,255,0.25)", borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{v.title}</div>

                      {blocks.map((b) => {
                        const bOv: BlockOverride = (varOv as any)[b.key] || {};
                        const pos = bOv.pos || {};
                        const size = bOv.size || {};
                        const Input = ({
                          label,
                          value,
                          onChange,
                          placeholder
                        }: {
                          label: string;
                          value?: string;
                          placeholder?: string;
                          onChange: (s: string) => void;
                        }) => (
                          <label style={{ display: "grid", gridTemplateColumns: "88px 1fr", alignItems: "center", gap: 6 }}>
                            <span style={{ opacity: 0.9 }}>{label}</span>
                            <input
                              value={value ?? ""}
                              placeholder={placeholder ?? ""}
                              onChange={(e) => onChange(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid rgba(255,255,255,0.25)",
                                background: "rgba(255,255,255,0.06)",
                                color: "#fff"
                              }}
                            />
                          </label>
                        );

                        return (
                          <div key={`${pnl.ori}-${v.key}-${b.key}`} style={{ margin: "8px 0", padding: 8, background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                            <div style={{ fontWeight: 500, marginBottom: 6 }}>{b.title}</div>
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ fontSize: 12, opacity: 0.85 }}>Размер (CSS значения: %, px и т.п.)</div>
                              <div style={{ display: "grid", gap: 6 }}>
                                <Input
                                  label="width"
                                  value={size.width}
                                  placeholder="например: 80% или 240px"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "size", "width", s)}
                                />
                                <Input
                                  label="height"
                                  value={size.height}
                                  placeholder="например: 90%"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "size", "height", s)}
                                />
                                <Input
                                  label="maxWidth"
                                  value={size.maxWidth}
                                  placeholder="например: 520px или 90%"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "size", "maxWidth", s)}
                                />
                                <Input
                                  label="maxHeight"
                                  value={size.maxHeight}
                                  placeholder="например: 80px или 90%"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "size", "maxHeight", s)}
                                />
                              </div>

                              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>Положение (CSS: top/left/right/bottom/transform)</div>
                              <div style={{ display: "grid", gap: 6 }}>
                                <Input
                                  label="top"
                                  value={pos.top}
                                  placeholder="например: 6% (для Horizontal 1 — доп. сдвиг в % ряда)"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "pos", "top", s)}
                                />
                                <Input
                                  label="left"
                                  value={pos.left}
                                  placeholder="например: 50% или 4%"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "pos", "left", s)}
                                />
                                <Input
                                  label="right"
                                  value={pos.right}
                                  placeholder="например: 4%"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "pos", "right", s)}
                                />
                                <Input
                                  label="bottom"
                                  value={pos.bottom}
                                  placeholder="например: 22%"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "pos", "bottom", s)}
                                />
                                <Input
                                  label="transform"
                                  value={pos.transform}
                                  placeholder="например: translateX(-50%)"
                                  onChange={(s) => setField(pnl.ori, v.key, b.key, "pos", "transform", s)}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

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
      {/* Панель настроек */}
      <SettingsPanel />

      {/* Бэкграунд-изображение стелы */}
      <img
        ref={imgRef}
        src={item?.url || ""}
        alt={item?.name || "Изделие"}
        style={{ display: "block", width: "100%", height: "auto", objectFit: "contain", borderRadius: 8, opacity: carvingOpacity }}
        draggable={false}
        onLoad={() => setTimeout(recalc, 0)}
      />

      {/* Контент поверх */}
      {renderPeople()}
      <CrossOverlay />
      <GraphicsOverlay />
      <EpitaphsOverlay />
    </div>
  );
}
