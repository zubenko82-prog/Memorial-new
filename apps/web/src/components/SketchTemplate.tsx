// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
//
// Что изменили по требованию:
// 1) Над эскизом добавлен текст-пояснение о предварительном макете.
// 2) Горизонтальный шаблон «1 человек» БЕЗ сетки:
//    - Портрет по центру верхней половины, отступ сверху 6% высоты изображения, высота портрета 40% высоты изображения.
//    - Метрика под портретом, высота 20% высоты изображения. В метрике строго 3 строки:
//      1 — Фамилия; 2 — Имя Отчество; 3 — Даты (в таком порядке, без переносов между строками!).
//      Чтобы строки не обрезались, мы динамически уменьшаем масштаб метрики (scale), если ей не хватает места.
//    - Под метрикой — графика; под графикой — эпитафия.
//    - Наложение элементов запрещено: все секции «идут друг за другом», а тексты (метрика/эпитафия) динамически уменьшаются,
//      чтобы уместиться в отведённое место. Если места мало, контент масштабируется, а не наезжает.
// 3) Кресты:
//    - По умолчанию: один — слева, два — слева и справа.
//    - Исключение: Горизонтальный шаблон «2 человека»: один крест по центру, два — по краям.
// 4) Прочие шаблоны оставлены без перестроения логики, но в них изначально блоки разнесены так, чтобы не пересекаться.
//    (Если потребуется, можно аналогично добавить измерение и масштабирование для метрики/эпитафии и в остальных шаблонах.)

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
            // Комментарий по настройкам метрики:
            // Три строки строго: [0] Фамилия, [1] Имя Отчество, [2] Даты — без перестановок.
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

  // Измерение естественных высот для масштабирования (чтобы ничего не налезало)
  const metricMeasureRef = useRef<HTMLDivElement | null>(null);
  const epitaphMeasureRef = useRef<HTMLDivElement | null>(null);
  const [metricScale, setMetricScale] = useState(1);
  const [epitaphScale, setEpitaphScale] = useState(1);

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

  /* ===== Кресты =====
     Правила:
     - По умолчанию: один — слева, два — слева и справа.
     - Горизонтальный (2 человека): один — по центру, два — по краям. */
  const CrossOverlay = () => {
    if (!crosses.length) return null;

    const isHorizontal = !isVertical;
    const isHorizontalTwo = isHorizontal && tplKey === "two";

    const baseSize = (tpl.blocks as any).cross.size;

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

  /* ===== Прочая графика — для всех шаблонов, кроме HorizontalOne (там отдельная логика ниже) ===== */
  const GraphicsOverlay = () =>
    others.length > 0 ? (
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
    ) : null;

  /* ===== Эпитафии — для всех шаблонов, кроме HorizontalOne (там отдельная логика ниже) ===== */
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
    // Комментарий по строкам:
    // lines[0] — Фамилия
    // lines[1] — Имя Отчество
    // lines[2] — Даты
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

  /* ===== Горизонтальный шаблон: 1 человек (без сетки, с динамическим масштабированием, без наложений) ===== */
  const HorizontalOne = () => {
    const p = peopleBlocks[0];
    if (!imgRect.h || !imgRect.w) return null;

    const H = imgRect.h;
    const W = imgRect.w;

    const gap = Math.round(0.015 * H); // технологический зазор ~1.5% высоты
    const topOffset = Math.round(0.06 * H); // 6% сверху

    // Портрет: высота 40% H, ширина по AR 3:4 (с ограничением по ширине экрана)
    let portraitH = Math.max(40, Math.round(0.40 * H));
    let portraitW = Math.round(portraitH * (3 / 4));
    if (portraitW > W * 0.9) {
      const k = (W * 0.9) / portraitW;
      portraitW = Math.max(40, Math.round(portraitW * k));
      portraitH = Math.max(40, Math.round(portraitH * k));
    }
    const portraitTop = topOffset;
    const portraitBottom = portraitTop + portraitH;

    // Метрика: высота 20% H (контейнер), но контент может быть больше — тогда уменьшим scale, чтобы поместить 3 строки.
    const metricTargetH = Math.max(24, Math.round(0.20 * H));
    const metricTop = portraitBottom + gap;
    const metricW = Math.round(W * 0.8);

    // После изменения размеров/контента — измеряем естественную высоту метрики (без масштаба)
    useEffect(() => {
      if (!metricMeasureRef.current) return;
      // Естественная высота
      const natural = metricMeasureRef.current.scrollHeight || metricMeasureRef.current.offsetHeight || 1;
      const scale = Math.min(1, metricTargetH / natural);
      setMetricScale(scale);
    }, [metricTargetH, metricW, p?.lines?.join("|"), imgRect.w, imgRect.h]);

    const metricBottom = metricTop + metricTargetH * metricScale;

    // Графика: под метрикой. Высоту ограничиваем оставшимся местом с запасом под эпитафию.
    const graphicsTop = Math.round(metricBottom + gap);
    // Эпитафию измерим отдельно и масштабируем, если не помещается.
    const epitaphW = Math.round(W * 0.88);

    // Измеряем естественную высоту эпитафии
    useEffect(() => {
      if (!epitaphMeasureRef.current) return;
      const natural = epitaphMeasureRef.current.scrollHeight || epitaphMeasureRef.current.offsetHeight || 1;
      // Сколько места осталось под эпитафию (после графики, которую ограничим ниже)
      const remainingAfterGraphics = H - graphicsTop - gap;
      // Для первичной оценки берем весь остаток под эпитафию (графику зажмем ниже, чтобы точно не было пересечений)
      const scale = Math.min(1, remainingAfterGraphics / natural);
      setEpitaphScale(scale > 0 ? scale : 1);
    }, [epitaphs?.join("|"), epitaphW, graphicsTop, H]);

    // Теперь рассчитаем разумную высоту графики с учётом того, что эпитафия должна помещаться после неё.
    const epitaphNaturalForCalc = (() => {
      // если масштаба < 1, значит natural > remaining; нам важнее оставить место — возьмем требуемое место как natural*scale
      // но scale уже вычислен по remainingAfterGraphics (верхняя оценка), что гарантирует непересечение.
      if (!epitaphMeasureRef.current) return 0;
      const natural = epitaphMeasureRef.current.scrollHeight || epitaphMeasureRef.current.offsetHeight || 0;
      return natural * epitaphScale;
    })();

    const availableForGraphics = Math.max(0, H - graphicsTop - gap - epitaphNaturalForCalc);
    const graphicsMaxH = Math.max(0, Math.min(Math.round(0.18 * H), availableForGraphics));
    const epitaphTop = graphicsTop + graphicsMaxH + gap;

    return (
      <>
        {/* Портрет */}
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

        {/* Метрика (строго 3 строки: Фамилия / Имя Отчество / Даты) с динамическим масштабом */}
        <div
          data-sketch-el="metric"
          data-sketch-key={p.id}
          style={{
            position: "absolute",
            top: metricTop,
            left: "50%",
            transform: "translateX(-50%)",
            width: metricW,
            height: metricTargetH,
            overflow: "hidden",
            pointerEvents: "none",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start"
          }}
        >
          <div style={{ transform: `scale(${metricScale})`, transformOrigin: "top center", width: "100%" }}>
            <PersonMetricText
              lines={[p.lines?.[0] ?? "", p.lines?.[1] ?? "", p.lines?.[2] ?? ""]}
              textCfg={(CFG.horizontal.one.blocks as any).metric.text}
              align={((CFG.horizontal.one.blocks as any).metric.text.align as any) ?? "center"}
            />
          </div>
        </div>

        {/* Графика — строго под метрикой, высота зависит от оставшегося места (чтобы не наезжать на эпитафию) */}
        {others.length > 0 && graphicsMaxH > 0 && (
          <div
            style={{
              position: "absolute",
              top: graphicsTop,
              left: "50%",
              transform: "translateX(-50%)",
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
                key={`other-h1-${i}`}
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

        {/* Эпитафия — под графикой; если не помещается, уменьшаем масштаб (epitaphScale), чтобы не было наложений */}
        {Array.isArray(epitaphs) && epitaphs.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: epitaphTop,
              left: "50%",
              transform: "translateX(-50%)",
              width: epitaphW,
              color: "#fff",
              textAlign: "center" as const,
              textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              zIndex: 4,
              overflow: "hidden"
            }}
          >
            <div
              style={{
                transform: `scale(${epitaphScale})`,
                transformOrigin: "top center",
                width: "100%"
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
                  <div key={`ep-h1-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ whiteSpace: "pre-wrap" }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Offscreen-измерители (не видны пользователю) */}
        <div style={{ position: "absolute", left: -99999, top: -99999, width: 0, height: 0, overflow: "hidden" }}>
          {/* Метрика (естественная высота без масштаба) */}
          <div ref={metricMeasureRef} style={{ width: metricW }}>
            <PersonMetricText
              lines={[p.lines?.[0] ?? "", p.lines?.[1] ?? "", p.lines?.[2] ?? ""]}
              textCfg={(CFG.horizontal.one.blocks as any).metric.text}
              align={((CFG.horizontal.one.blocks as any).metric.text.align as any) ?? "center"}
            />
          </div>
          {/* Эпитафия (естественная высота без масштаба) */}
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

  const HorizontalTwo = () => {
    const B = (CFG.horizontal.two.blocks as any);
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
    const B = (CFG.horizontal.many.blocks as any);
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
    const B = (CFG.vertical.one.blocks as any);
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

  const isHorizontalOne = !isVertical && tplKey === "one";

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
        Предварительный макет. Изображения могут накладываться — это допустимо. Финальное расположение сделает специалист. Принципиальные моменты скорректируем позже.
      </div>

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
        {/* Изображение изделия */}
        <img
          ref={imgRef}
          src={item?.url || ""}
          alt={item?.name || "Изделие"}
          style={{ display: "block", width: "100%", height: "auto", objectFit: "contain", borderRadius: 8, opacity: carvingOpacity }}
          draggable={false}
          onLoad={() => setTimeout(recalc, 0)}
        />

        {/* Слои поверх */}
        {renderPeople()}
        <CrossOverlay />

        {/* Во всех шаблонах, КРОМЕ HorizontalOne, графика/эпитафия остаются по старой схеме (без наложений по дизайну). */}
        {!isHorizontalOne && (
          <>
            <GraphicsOverlay />
            <EpitaphsOverlay />
          </>
        )}
      </div>
    </>
  );
}
