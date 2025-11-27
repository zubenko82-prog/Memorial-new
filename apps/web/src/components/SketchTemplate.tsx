// src/components/SketchTemplate.tsx
// Общий шаблон предпросмотра для шагов Engraving/Graphics/Epitaph.
//
// Обновления:
// - Над эскизом добавлен текст-пояснение (без упоминания наложений).
// - На ВСЕХ шаблонах порядок строго такой: Метрика → Эпитафия → Графика (в самом низу, минимальный отступ).
//   Эпитафия всегда располагается под метрикой, графика — у нижнего края.
// - Наложение элементов запрещено: размеры/масштабы динамически подгоняются, чтобы всё уместилось.
// - Горизонтальный шаблон (1 человек) БЕЗ сетки:
//   • Портрет по центру верхней половины, отступ сверху 6% высоты изображения,
//     высота портрета 40% высоты изображения.
//   • Метрика под портретом, высота контейнера 20% высоты изображения,
//     в метрике строго 3 строки: 1 — Фамилия, 2 — Имя Отчество, 3 — Даты (порядок фиксирован).
//     Если строки не помещаются, метрика масштабируется (уменьшается).
//   • Далее — Эпитафия (ниже метрики, масштабируется при нехватке места).
//   • Графика — в самом низу (минимальный отступ от низа), высота ограничена, чтобы не пересекаться с эпитафией.
//
// Примечание: портреты/метрики во всех прочих шаблонах оставлены как в конфиге, но
// эпитафия и графика теперь рендерятся общим модулем «снизу» без пересечений.

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
          pos: { left: "50%", transform: "translateX(-50%)" },
          size: { width: "100%", maxWidth: "520px", height: "auto" },
          margins: { margin: "0 auto" },
          text: {
            // Настройка метрики (комментарий):
            // Строго 3 строки: 1 — Фамилия, 2 — Имя Отчество, 3 — Даты (порядок фиксирован).
            uppercase: true, align: "center",
            l1: { font: `700 clamp(18px, 3.4vw, 32px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" },
            l2: { font: `600 clamp(16px, 3vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" },
            l3: { font: `400 clamp(14px, 2.6vw, 22px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "6%", left: "50%", transform: "translateX(-50%)" }, size: { width: "8%", height: "auto" }, margins: {} },
        epitaphs: {
          // Исторические значения (не используются для позиционирования, порядок фиксируем кодом)
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState({ w: 0, h: 0 });

  // Общие измерители для запрета пересечений
  const [metricBottomPx, setMetricBottomPx] = useState(0); // нижняя граница метрик внутри изображения
  const epitaphMeasureRef = useRef<HTMLDivElement | null>(null); // offscreen естественная высота эпитафии
  const [epitaphScale, setEpitaphScale] = useState(1);

  // Для HorizontalOne: динамическая метрика (масштаб, чтобы влезла в 20% высоты)
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
    setImgRect({ w: r.width, h: r.height });
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
  const H = imgRect.h;
  const W = imgRect.w;

  /* ===== Измеряем нижнюю границу всех блоков метрики внутри контейнера (для всех шаблонов) ===== */
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Ждём, чтобы DOM успел разложить метрики
    const t = setTimeout(() => {
      const rootRect = root.getBoundingClientRect();
      const nodes = root.querySelectorAll('[data-sketch-el="metric"]');
      let maxBottom = 0;
      nodes.forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const bottom = r.bottom - rootRect.top;
        if (bottom > maxBottom) maxBottom = bottom;
      });
      setMetricBottomPx(Math.max(0, Math.min(maxBottom, H))); // clamp в пределах изображения
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

  // Масштаб метрики (HorizontalOne) — чтобы три строки влезли в containerHeight = 20% H
  useEffect(() => {
    if (!h1) return;
    const holder = metricMeasureRef.current;
    if (!holder) return;
    const t = setTimeout(() => {
      const natural = holder.scrollHeight || holder.offsetHeight || 1;
      const scale = Math.min(1, h1.metricTargetH / natural);
      setMetricScaleH1(scale);
    }, 0);
    return () => clearTimeout(t);
  }, [h1, peopleBlocks[0]?.lines?.join("|")]);

  /* ===== Унифицированная эпитафия + графика (для всех шаблонов):
         — Эпитафия сразу под метрикой и растягивается (масштабируется), чтобы поместиться над графикой.
         — Графика у самого низа (минимальный отступ), высота ограничена. ===== */
  const epitaphW = Math.round(W * 0.88);
  const bottomPadPx = Math.max(8, Math.round(0.02 * H)); // минимальный отступ от низа
  const graphicsMaxHDefault = Math.round(0.18 * H);      // верхняя граница высоты блока графики

  // Измеряем естественную высоту эпитафии, чтобы вычислить масштаб (идёт под метрикой)
  useEffect(() => {
    const holder = epitaphMeasureRef.current;
    if (!holder) return setEpitaphScale(1);
    const t = setTimeout(() => {
      const natural = holder.scrollHeight || holder.offsetHeight || 1;
      // временно возьмём максимально допустимую высоту эпитафии «без пересечения» с графикой:
      // оставим под графику graphicsMaxH (может быть уменьшена далее при фактическом рендере).
      const graphicsMaxH = graphicsMaxHDefault;
      const available = Math.max(0, H - bottomPadPx - graphicsMaxH - (metricBottomPx + Math.round(0.015 * H)));
      const scale = Math.min(1, available / natural);
      setEpitaphScale(scale > 0 ? scale : 1);
    }, 0);
    return () => clearTimeout(t);
  }, [H, W, metricBottomPx, epitaphs?.join("|")]);

  /* ===== Кресты =====
     Правила:
     - По умолчанию: один — слева, два — слева и справа.
     - Горизонтальный (2 человека): один — по центру, два — по краям. */
  const CrossOverlay = () => {
    if (!crosses.length) return null;

    const isHorizontalTwo = !isVertical && tplKey === "two";
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

  function PersonMetricText({
    lines,
    align,
    textCfg
  }: {
    lines: string[];
    align: "center" | "left" | "right";
    textCfg: any;
  }) {
    // Порядок жёстко фиксирован: Фамилия / Имя Отчество / Даты
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

  /* ===== PEOPLE ===== */

  // Horizontal: 1 person — без сетки (портрет → метрика)
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

        {/* Метрика (строго 3 строки) — контейнер 20% H, контент масштабируется */}
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
            <PersonMetricText
              lines={[p.lines?.[0] ?? "", p.lines?.[1] ?? "", p.lines?.[2] ?? ""]}
              textCfg={(CFG.horizontal.one.blocks as any).metric.text}
              align={((CFG.horizontal.one.blocks as any).metric.text.align as any) ?? "center"}
            />
          </div>
        </div>

        {/* Offscreen измеритель метрики (натуральная высота) */}
        <div style={{ position: "absolute", left: -99999, top: -99999, width: s.metricW }}>
          <div ref={metricMeasureRef} style={{ width: s.metricW }}>
            <PersonMetricText
              lines={[p.lines?.[0] ?? "", p.lines?.[1] ?? "", p.lines?.[2] ?? ""]}
              textCfg={(CFG.horizontal.one.blocks as any).metric.text}
              align={((CFG.horizontal.one.blocks as any).metric.text.align as any) ?? "center"}
            />
          </div>
        </div>
      </>
    );
  };

  // Horizontal: 2 — как было (портреты и метрики), эпитафия/графика — общим модулем снизу
  const HorizontalTwo = () => {
    const B = (CFG.horizontal.two.blocks as any);
    const colW = Math.min(320, Math.max((CFG.horizontal.layout as any).columnMinW, Math.floor((W - 32 - (CFG.horizontal.layout as any).gap) / 2)));
    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: (CFG.horizontal.one.blocks as any).portraits.pos.top,
          display: "grid",
          gridTemplateColumns: `repeat(2, ${colW}px)`,
          gap: (CFG.horizontal.layout as any).gap,
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
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
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
    const perCol = Math.min(260, Math.max((CFG.horizontal.layout as any).columnMinW, Math.floor((W - 32) / cols)));
    return (
      <div
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: (CFG.horizontal.one.blocks as any).portraits.pos.top,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${perCol}px)`,
          gap: (CFG.horizontal.layout as any).gap,
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
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
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
            <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
              {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
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
    const rowsH = Math.max(100, Math.floor(H * CFG.vertical.layout.rowsHeightFactor));
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
          <div key={p.id} style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `45% 55%`, columnGap: 12, alignItems: "center", padding: "6px 8px", boxSizing: "border-box" }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: (CFG.vertical.two.blocks as any).portraits.size.width, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (CFG.vertical.two.blocks as any).metric.size.width, ...((CFG.vertical.two.blocks as any).metric.margins || {}) }}>
                <PersonMetricText lines={p.lines} textCfg={(CFG.vertical.two.blocks as any).metric.text} align={(CFG.vertical.two.blocks as any).metric.text.align ?? "center"} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const VerticalMany = () => {
    const rowsH = Math.max(100, Math.floor(H * CFG.vertical.layout.rowsHeightFactor));
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
          <div key={p.id} style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: `42% 58%`, columnGap: 12, alignItems: "center", padding: "6px 8px", boxSizing: "border-box" }}>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: (CFG.vertical.many.blocks as any).portraits.size.width, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)", boxShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                {p.photo ? <img src={p.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} /> : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>}
              </div>
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (CFG.vertical.many.blocks as any).metric.size.width, ...((CFG.vertical.many.blocks as any).metric.margins || {}) }}>
                <PersonMetricText lines={p.lines} textCfg={(CFG.vertical.many.blocks as any).metric.text} align={(CFG.vertical.many.blocks as any).metric.text.align ?? "center"} />
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

  /* ===== ЕДИНЫЙ нижний модуль: Эпитафия (под метрикой) и Графика (у самого низа) ===== */
  const EpitaphAndGraphics = () => {
    if (!H || !W) return null;

    // Позиция эпитафии: сразу под метрикой
    const gap = Math.round(0.015 * H);
    const epitaphTop = Math.max(metricBottomPx + gap, 0);

    // Графика: в самом низу (минимальный отступ)
    let graphicsMaxH = graphicsMaxHDefault;
    // Гарантия, что эпитафии хватит места: если не хватает — уменьшаем высоту графики
    const reservedForEpitaph = (epitaphMeasureRef.current?.scrollHeight || 0) * epitaphScale;
    const minGraphicsTop = epitaphTop + reservedForEpitaph + gap;
    const maxGraphicsTop = H - bottomPadPx - graphicsMaxH;
    const finalGraphicsTop = Math.max(minGraphicsTop, maxGraphicsTop);
    graphicsMaxH = Math.max(0, H - bottomPadPx - finalGraphicsTop);

    // Пересчёт масштаба эпитафии с учётом финальной высоты графики (на случай ужатия)
    const availableForEpitaph = Math.max(0, H - bottomPadPx - graphicsMaxH - epitaphTop);
    const naturalEp = Math.max(1, epitaphMeasureRef.current?.scrollHeight || 1);
    const finalEpitaphScale = Math.min(1, availableForEpitaph / naturalEp);

    return (
      <>
        {/* Эпитафия — всегда под метрикой, масштабируется при нехватке места */}
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

        {/* Графика — в самом низу, минимальный отступ от низа, без пересечения с эпитафией */}
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

        {/* Offscreen измеритель эпитафии (натуральная высота без масштаба) */}
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
        {/* Фоновое изображение изделия */}
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
        <EpitaphAndGraphics />
      </div>
    </>
  );
}
