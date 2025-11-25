// src/components/SketchTemplate.tsx
// Правки по требованиям:
// - Горизонтальный шаблон (1 человек): портрет = 40% высоты изображения, метрика = 25% высоты изображения.
//   Оба блока центрируются и гарантированно умещаются внутри эскиза.
//   Для метрики сделана растеризация текста в canvas с авто-подгонкой размера, чтобы точно вписать текст.
// - Кресты: правила сохранены (1 крест слева сверху, кроме horizontal/two -> по центру; 2 креста на horizontal/two — по краям).
// - Все элементы держим в пределах области изображения.

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
    one: {
      blocks: {
        portraits: { pos: { top: "10%", left: "50%", transform: "translateX(-50%)" }, size: { width: "60%", maxWidth: "400px", height: "auto" }, margins: { margin: "0 auto 16px auto" } },
        metric: {
          pos: { top: "auto", bottom: "auto", left: "50%", transform: "translateX(-50%)" },
          size: { width: "100%", maxWidth: "520px", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            uppercase: true, align: "center",
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
function parsePx(str?: string): number | null {
  if (!str) return null;
  const m = String(str).match(/(-?\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : null;
}

/* ===== Растеризация метрики в Canvas с авто-подгонкой ===== */
type MetricStyleCfg = {
  uppercase?: boolean;
  align?: "center" | "left" | "right";
  l1: { font: string; lineHeight: number; letterSpacing?: string };
  l2: { font: string; lineHeight: number; letterSpacing?: string };
  l3: { font: string; lineHeight: number; letterSpacing?: string; opacity?: number };
};

function rasterizeMetricToDataURL(params: {
  lines: string[];
  widthCssPx: number;
  heightCssPx: number;
  cfg: MetricStyleCfg;
  color?: string;
  shadow?: { color: string; blur: number; offsetX?: number; offsetY?: number };
}): string | null {
  const { lines, widthCssPx, heightCssPx, cfg } = params;
  if (widthCssPx <= 0 || heightCssPx <= 0) return null;

  const dpr = Math.max(1, Math.min(3, (window.devicePixelRatio || 1)));
  const W = Math.floor(widthCssPx * dpr);
  const H = Math.floor(heightCssPx * dpr);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // bg transparent
  ctx.clearRect(0, 0, widthCssPx, heightCssPx);

  const padX = Math.max(6, Math.round(widthCssPx * 0.04));
  const padY = Math.max(4, Math.round(heightCssPx * 0.06));

  const text = cfg.uppercase
    ? lines.map((s) => (s || "").toUpperCase())
    : lines.map((s) => s || "");

  // Базовые размеры из cfg (px) -> будем масштабировать
  const baseSizes = [
    parsePx(cfg.l1.font) ?? 24,
    parsePx(cfg.l2.font) ?? 20,
    parsePx(cfg.l3.font) ?? 16
  ];
  const lineHeights = [cfg.l1.lineHeight || 1.15, cfg.l2.lineHeight || 1.12, cfg.l3.lineHeight || 1.1];
  const letterSpacingPx = [
    parsePx(cfg.l1.letterSpacing || "0px") ?? 0,
    parsePx(cfg.l2.letterSpacing || "0px") ?? 0,
    parsePx(cfg.l3.letterSpacing || "0px") ?? 0
  ];

  // Предположим, что высота блока займёт ~90% доступной высоты (оставляя паддинги)
  const availW = Math.max(1, widthCssPx - padX * 2);
  const availH = Math.max(1, heightCssPx - padY * 2);

  // Стартовый масштаб от высоты (чтобы суммарная высота 3 строк влезла)
  // Доли высоты между строками (примерно как в дизайне): 0.42 / 0.35 / 0.23
  const shares = [0.42, 0.35, 0.23];
  let sizes = baseSizes.slice();

  // Подбор по высоте
  const heightBasedScale = Math.min(
    (availH * shares[0]) / (baseSizes[0] * lineHeights[0]),
    (availH * shares[1]) / (baseSizes[1] * lineHeights[1]),
    (availH * shares[2]) / (baseSizes[2] * lineHeights[2])
  );
  sizes = sizes.map((s) => s * heightBasedScale);

  // Измерение ширины с учётом letterSpacing
  function setFont(i: number) {
    const weight = i === 0 ? "700" : i === 1 ? "600" : "400";
    ctx.font = `${weight} ${Math.max(1, sizes[i]).toFixed(2)}px ${FONT_CENTURY}`;
  }
  function measureWithSpacing(i: number, s: string): number {
    setFont(i);
    const w = ctx.measureText(s).width;
    const extra = Math.max(0, s.length - 1) * (letterSpacingPx[i] || 0);
    return w + extra;
  }

  // Подгонка по ширине (если хоть одна строка шире availW — уменьшаем масштаб)
  const widths = text.map((t, i) => measureWithSpacing(i, t));
  const widest = Math.max(1, ...widths);
  if (widest > availW) {
    const kw = availW / widest;
    sizes = sizes.map((s) => s * kw);
  }

  // Финальные метрики
  const heightsPx = sizes.map((sz, i) => sz * lineHeights[i]);
  const totalH = heightsPx.reduce((a, b) => a + b, 0);
  const gap = Math.max(2, Math.round(sizes[2] * 0.25)); // небольшой зазор между строками
  const totalHWithGaps = totalH + gap * (text.filter(Boolean).length - 1);
  let startY = padY + (availH - totalHWithGaps) / 2 + sizes[0]; // первая строка baseline

  // Тени/цвета
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  // Отрисовка с посимвольным letterSpacing и выравниванием
  function drawLine(i: number, s: string, y: number) {
    setFont(i);
    const ls = letterSpacingPx[i] || 0;
    // ширина со spacing
    const w = measureWithSpacing(i, s);
    let x = padX;
    if ((cfg.align || "center") === "center") x = padX + (availW - w) / 2;
    else if (cfg.align === "right") x = padX + (availW - w);

    // посимвольно
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + ls;
    }
  }

  // Заливка фона прозрачная — только текст
  let y = startY;
  const present = text.filter((t) => t && t.trim().length > 0);
  const t0 = text[0] || "";
  const t1 = text[1] || "";
  const t2 = text[2] || "";

  if (t0) {
    drawLine(0, t0, y);
    y += heightsPx[0] + gap;
  }
  if (t1) {
    drawLine(1, t1, y);
    y += heightsPx[1] + gap;
  }
  if (t2) {
    drawLine(2, t2, y);
  }

  return canvas.toDataURL("image/png");
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
      const d = loadOrderDraft();
      const o = (d.size?.orientation as Orientation | undefined) ?? (d as any).orientation ?? null;
      setForcedOrientation(o);
    };
    apply();
    const h = () => apply();
    window.addEventListener(DRAFT_UPDATED_EVENT, h as EventListener);
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, h as EventListener);
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

  /* ===== Кресты по правилам ===== */
  const CrossOverlay = () => {
    if (!crosses.length) return null;

    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";
    const baseSize = (tpl.blocks as any).cross.size;
    const baseCss: React.CSSProperties = { position: "absolute", ...baseSize, objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))", zIndex: 3 };

    const topLeft: React.CSSProperties = { top: "6%", left: "4%" };
    const topCenter: React.CSSProperties = { top: "6%", left: "50%", transform: "translateX(-50%)" };
    const topRight: React.CSSProperties = { top: "6%", right: "4%" };

    if (crosses.length === 1) {
      const c = crosses[0];
      const pos = isHorizontalTwo ? topCenter : topLeft;
      return <img data-sketch-el="cross" data-sketch-key="0" src={c.url} alt={c.name || "Крест"} style={{ ...baseCss, ...pos }} draggable={false} />;
    }
    if (crosses.length >= 2 && isHorizontalTwo) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...baseCss, ...topLeft }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...baseCss, ...topRight }} draggable={false} />
        </>
      );
    }
    if (crosses.length === 2) {
      const [cL, cR] = [crosses[0], crosses[1]];
      return (
        <>
          <img data-sketch-el="cross" data-sketch-key="0" src={cL.url} alt={cL.name || "Крест"} style={{ ...baseCss, ...topLeft }} draggable={false} />
          <img data-sketch-el="cross" data-sketch-key="1" src={cR.url} alt={cR.name || "Крест"} style={{ ...baseCss, ...topRight }} draggable={false} />
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

  /* ===== Горизонтальный: 1 человек (портрет 40% H, метрика 25% H; всё помещается) ===== */
  const HorizontalOne = () => {
    const B = tpl.blocks;
    const p = peopleBlocks[0];
    const pad = CFG.general.containerPadding;

    const imgTop = pad;
    const imgBottom = pad + imgRect.h;
    const imgLeft = pad;

    // Верхний отступ из конфига (процент)
    const topPct = parsePercent((CFG.horizontal.one.blocks.portraits.pos as any).top) ?? 0.1;
    let topY = imgTop + Math.round(imgRect.h * topPct);

    // Базовые высоты
    let portraitH = Math.max(40, Math.round(imgRect.h * 0.40));
    let metricH = Math.max(24, Math.round(imgRect.h * 0.25));
    let spacing = 12;

    // Ширина портрета по AR 3:4 и ограничение по доступной ширине
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
    // Если всё равно не влезло из-за большого topPct — сдвинуть вверх
    const totalH = portraitH + spacing + metricH;
    if (topY + totalH > imgBottom) {
      topY = Math.max(imgTop, imgBottom - totalH);
    }

    // Растер-метрика как картинка (всегда впишется)
    const metricUrl = useMemo(() => {
      return rasterizeMetricToDataURL({
        lines: [p.lines?.[0] || "", p.lines?.[1] || "", p.lines?.[2] || ""],
        widthCssPx: portraitW,
        heightCssPx: metricH,
        cfg: CFG.horizontal.two.blocks.metric.text as MetricStyleCfg
      }) || undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [portraitW, metricH, p?.lines?.[0], p?.lines?.[1], p?.lines?.[2], imgRect.w, imgRect.h, window.devicePixelRatio]);

    return (
      <div
        style={{
          position: "absolute",
          left: imgLeft,
          right: imgLeft,
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

          {/* Метрика (растеризованная) */}
          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: portraitW, height: metricH, overflow: "hidden" }}>
            {metricUrl ? (
              <img src={metricUrl} alt="Метрика" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} draggable={false} />
            ) : null}
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
            <div style={{ width: B.portraits.size.width, ...B.portraits.margins }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, overflow: "hidden" }}>
              {/* В 2-х людях оставляем обычный текст (влезает по ширине колонки) */}
              <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)", color: "#fff" }}>
                {p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[0].toUpperCase() : p.lines[0]}</div>}
                {p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[1].toUpperCase() : p.lines[1]}</div>}
                {p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1 }}>{(B.metric.text as any).uppercase ? p.lines[2].toUpperCase() : p.lines[2]}</div>}
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
            <div style={{ width: B.portraits.size.width, ...B.portraits.margins }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>
            <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, overflow: "hidden" }}>
              <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)", color: "#fff" }}>
                {p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[0].toUpperCase() : p.lines[0]}</div>}
                {p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[1].toUpperCase() : p.lines[1]}</div>}
                {p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1 }}>{(B.metric.text as any).uppercase ? p.lines[2].toUpperCase() : p.lines[2]}</div>}
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
          <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, maxWidth: B.metric.size.maxWidth, ...B.metric.margins, overflow: "hidden", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
            <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center" }}>
              {p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[0].toUpperCase() : p.lines[0]}</div>}
              {p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[1].toUpperCase() : p.lines[1]}</div>}
              {p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1 }}>{(B.metric.text as any).uppercase ? p.lines[2].toUpperCase() : p.lines[2]}</div>}
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
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
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
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, overflow: "hidden", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center" }}>
                  {p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[0].toUpperCase() : p.lines[0]}</div>}
                  {p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[1].toUpperCase() : p.lines[1]}</div>}
                  {p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1 }}>{(B.metric.text as any).uppercase ? p.lines[2].toUpperCase() : p.lines[2]}</div>}
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
          left: CFG.general.containerPadding,
          right: CFG.general.containerPadding,
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
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: B.metric.size.width, ...B.metric.margins, overflow: "hidden", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                <div style={{ width: "100%", display: "grid", gap: 6, textAlign: (B.metric.text.align as any) ?? "center" }}>
                  {p.lines?.[0] && <div style={{ font: (B.metric.text.l1.font as any), lineHeight: B.metric.text.l1.lineHeight, letterSpacing: B.metric.text.l1.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[0].toUpperCase() : p.lines[0]}</div>}
                  {p.lines?.[1] && <div style={{ font: (B.metric.text.l2.font as any), lineHeight: B.metric.text.l2.lineHeight, letterSpacing: B.metric.text.l2.letterSpacing }}>{(B.metric.text as any).uppercase ? p.lines[1].toUpperCase() : p.lines[1]}</div>}
                  {p.lines?.[2] && <div style={{ font: (B.metric.text.l3.font as any), lineHeight: B.metric.text.l3.lineHeight, letterSpacing: B.metric.text.l3.letterSpacing, opacity: B.metric.text.l3.opacity ?? 1 }}>{(B.metric.text as any).uppercase ? p.lines[2].toUpperCase() : p.lines[2]}</div>}
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
