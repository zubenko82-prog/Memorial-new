// src/screens/EditorStep.tsx
// Редактор элементов: объединённый шаг.
// - Расположение шаблонов берём из SketchTemplate (встроенная внутрь этого файла версия).
//   В скрытом контейнере рендерим шаблон и считываем координаты по data-атрибутам.
// - Функционал редактора берём из EditorStep: рамки, DnD/resize, мини-кнопки, рендер превью,
//   авто-синхронизация с драфтом, «лесенка» для «Помним, любим, скорбим…».
//
// Важно:
// - Ориентация берётся из драфта (size.orientation или legacy orientation). Если нет — по соотношению сторон изображения.
// - Считывание координат (инициализация рамок) выполняется ПОСЛЕ того, как шаблон и фон загрузились и разметка готова.
// - Инициализация позиционирования из шаблона выполняется один раз (не затирает ручные правки).

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback
} from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft, type OrderDraft } from "../lib/order";

/* ===== Общие стили/UI ===== */
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm") {
  const pad = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: pad[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)"
  } as React.CSSProperties;
}
function bottomUnderlayGradient(): React.CSSProperties {
  return {
    backgroundColor: "#000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  };
}

/* ===== Типы редактора ===== */
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type Align = "left" | "center" | "right";
type EditorEl = {
  id: string; // "{type}-{key}" где key = personId для portrait/metric, или индекс для остальных
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты от контентной области
  z: number;
  title?: string;
  locked?: boolean;
  // Контентные настройки
  align?: Align;           // для metric/epitaph
  uppercase?: boolean;     // для metric/epitaph
  italic?: boolean;        // для metric/epitaph
  flipH?: boolean;         // для graphic
  bw?: boolean;            // для portrait (ч/б)
  staircase?: boolean;     // для «Помним, любим, скорбим…»: строка/лесенка
};

/* ===== Хелперы ===== */
function isCrossCategoryName(s?: string) {
  const v = (s || "").toLowerCase();
  return v.includes("крест") || v.includes("cross") || v.includes("crosses");
}
function linesFromPerson(p: any) {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
const SKETCH_PAD = 8; // Должен совпадать с CFG.general.containerPadding в шаблоне
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 1, 100),
  h: clamp(h, 1, 100)
});
const snap = (v: number, step = 1) => Math.round(v / step) * step;

async function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

// Нормализация фразы «Помним, любим, скорбим…»
const normRemember = (t?: string) =>
  (t || "")
    .toLowerCase()
    .replace(/[.,…!?:;]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isRememberLoveMourn = (t?: string) => normRemember(t) === "помним любим скорбим";

function splitRememberPreserve(text: string) {
  const t = (text || "").trim();
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    buf += ch;
    if (ch === ",") {
      parts.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  const top = parts[0] || "Помним,";
  const mid = parts[1] || "любим,";
  const bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим...").trim();
  return { top, mid, bot };
}

/* ===== Конфигурация шаблона (из SketchTemplate) ===== */
type Orientation = "vertical" | "horizontal";
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
        portraits: { pos: { top: "10%", left: "50%", transform: "translateX(-50%)" }, size: { width: "60%", maxWidth: "400px", height: "auto" } },
        metric: {
          pos: { left: "50%", transform: "translateX(-50%)" },
          size: { width: "100%", maxWidth: "520px", height: "auto" },
          text: {
            uppercase: true, align: "center",
            l1: { font: `700 clamp(18px, 3.4vw, 32px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.4px" },
            l2: { font: `600 clamp(16px, 3vw, 26px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.3px" },
            l3: { font: `400 clamp(14px, 2.6vw, 22px) ${FONT_CENTURY}`, lineHeight: 1.15, letterSpacing: "0.2px", opacity: 0.95 }
          }
        },
        cross: { pos: { top: "6%", left: "50%", transform: "translateX(-50%)" }, size: { width: "8%", height: "auto" } },
        epitaphs: {
          size: { width: "88%", height: "auto" },
          text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 3.0vw, 22px)", lineHeight: 1.2, letterSpacing: "0.3px", fontWeight: 400, fontFamily: FONT_CENTURY, italic: true }
        },
        graphics: { pos: { bottom: "7%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "80px", width: "auto" } }
      }
    },
    two: {
      blocks: {
        portraits: { pos: { top: "8%", left: "50%", transform: "translateX(-50%)" }, size: { width: "45%", height: "auto" } },
        metric: { pos: { left: "50%", transform: "translateX(-50%)" }, size: { width: "80%", height: "auto" } },
        cross: { pos: { top: "6%", left: "4%" }, size: { width: "8%", height: "auto" } },
        epitaphs: { size: { width: "88%", height: "auto" }, text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.8vw, 10px)", lineHeight: 1.15 } },
        graphics: { pos: { bottom: "4%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "42px", width: "auto" } }
      }
    },
    many: {
      blocks: {
        portraits: { pos: { top: "8%", left: "50%", transform: "translateX(-50%)" }, size: { width: "78%", height: "auto" } },
        metric: { pos: { left: "50%", transform: "translateX(-50%)" }, size: { width: "90%", height: "auto" } },
        cross: { pos: { top: "6%", left: "4%" }, size: { width: "7%", height: "auto" } },
        epitaphs: { size: { width: "88%", height: "auto" }, text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.2vw, 18px)", lineHeight: 1.15 } },
        graphics: { pos: { bottom: "5%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "64px", width: "auto" } }
      }
    }
  },
  vertical: {
    layout: { rowsHeightFactor: 0.5, rowGapPx: 10 },
    one: {
      blocks: {
        portraits: { pos: { top: "12%", left: "50%", transform: "translateX(-50%)" }, size: { width: "60%", maxWidth: "400px", height: "auto" } },
        metric: { pos: { left: "50%", transform: "translateX(-50%)" }, size: { width: "80%", height: "auto" } },
        cross: { pos: { top: "4%", left: "4%" }, size: { width: "14%", height: "auto" } },
        epitaphs: { size: { width: "88%", height: "auto" }, text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 3.2vw, 22px)", lineHeight: 1.2 } },
        graphics: { pos: { bottom: "6%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "80px", width: "auto" } }
      }
    },
    two: {
      blocks: {
        portraits: { pos: {}, size: { width: "60%", height: "auto" } },
        metric: { pos: {}, size: { width: "90%", height: "auto" } },
        cross: { pos: { top: "4%", left: "4%" }, size: { width: "14%", height: "auto" } },
        epitaphs: { size: { width: "88%", height: "auto" }, text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.9vw, 20px)", lineHeight: 1.15 } },
        graphics: { pos: { bottom: "7%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "74px", width: "auto" } }
      }
    },
    many: {
      blocks: {
        portraits: { pos: {}, size: { width: "52%", height: "auto" } },
        metric: { pos: {}, size: { width: "92%", height: "auto" } },
        cross: { pos: { top: "4%", left: "4%" }, size: { width: "13%", height: "auto" } },
        epitaphs: { size: { width: "88%", height: "auto" }, text: { uppercase: true, align: "center", fontSizeClamp: "clamp(10px, 2.2vw, 18px)", lineHeight: 1.15 } },
        graphics: { pos: { bottom: "5%", left: "50%", transform: "translateX(-50%)" }, size: { maxHeight: "64px", width: "auto" } }
      }
    }
  }
} as const;

/* ===== Встроенный шаблон для скрытого рендера и считывания позиций ===== */
function pickTplKey(n: number): "one" | "two" | "many" {
  if (n <= 1) return "one";
  if (n === 2) return "two";
  return "many";
}

function SketchTemplateHidden({
  item,
  peopleBlocks,
  crosses = [],
  others = [],
  epitaphs = [],
  carvingOpacity = CFG.general.carvingOpacityDefault,
  orientationOverride
}: {
  item: { url?: string; name?: string } | null;
  peopleBlocks: Array<{ id: string; lines: string[]; photo?: string | null }>;
  crosses?: Array<{ url: string; name?: string }>;
  others?: Array<{ url: string; name?: string }>;
  epitaphs?: string[];
  carvingOpacity?: number;
  orientationOverride?: Orientation;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState({ w: 0, h: 0 });

  const [forcedOrientation, setForcedOrientation] = useState<Orientation | null>(null);

  useEffect(() => {
    const d = loadOrderDraft();
    const o = (d.size?.orientation as Orientation | undefined) ?? (d as any).orientation ?? null;
    setForcedOrientation(o);
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
  const H = imgRect.h;
  const W = imgRect.w;

  // Горизонтальный 1: портрет+метрика — как в основной версии
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

  // Нижние блоки: эпитафия и графика
  const epitaphW = Math.round(W * 0.88);
  const bottomPadPx = Math.max(8, Math.round(0.02 * H));
  const graphicsMaxHDefault = Math.round(0.18 * H);

  // Кресты
  const crossTop = "6%";

  // Рендер скрытно (важны только data-sketch-el с размерами bbox)
  return (
    <div
      ref={containerRef}
      style={{
        ...bottomUnderlayGradient(),
        position: "relative",
        width: "100%",
        height: Math.max(CFG.general.minContainerHeight, H + CFG.general.containerPadding * 2),
        overflow: "hidden",
        userSelect: "none",
        padding: CFG.general.containerPadding,
        boxSizing: "border-box",
        color: "#fff"
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

      {/* Люди */}
      {!isVertical ? (
        tplKey === "one" ? (
          <>
            {/* Портрет */}
            {peopleBlocks[0] && (
              <div
                style={{
                  position: "absolute",
                  top: portraitTop,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: portraitW,
                  pointerEvents: "none"
                }}
              >
                <div
                  data-sketch-el="portrait"
                  data-sketch-key={peopleBlocks[0].id}
                  style={{
                    width: portraitW,
                    height: portraitH,
                    borderRadius: 4,
                    overflow: "hidden",
                    background: "rgba(255,255,255,0.04)"
                  }}
                />
              </div>
            )}

            {/* Метрика */}
            {peopleBlocks[0] && (
              <div
                data-sketch-el="metric"
                data-sketch-key={peopleBlocks[0].id}
                style={{
                  position: "absolute",
                  top: metricTop,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: metricW,
                  height: metricTargetH
                }}
              />
            )}
          </>
        ) : tplKey === "two" ? (
          // Горизонтальный: 2 человека — две колонки по B
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              top: (CFG.horizontal.one.blocks as any).portraits.pos.top,
              display: "grid",
              gridTemplateColumns: `repeat(2, minmax(${(CFG.horizontal.layout as any).columnMinW}px, 320px))`,
              gap: (CFG.horizontal.layout as any).gap,
              justifyContent: "center",
              alignItems: "start",
              pointerEvents: "none"
            }}
          >
            {peopleBlocks.slice(0, 2).map((p) => (
              <div key={p.id} style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: (CFG.horizontal.two.blocks as any).portraits.size.width }}>
                  <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4" }} />
                </div>
                <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (CFG.horizontal.two.blocks as any).metric.size.width }} />
              </div>
            ))}
          </div>
        ) : (
          // Горизонтальный many
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              top: (CFG.horizontal.one.blocks as any).portraits.pos.top,
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(4, Math.max(3, peopleBlocks.length))}, minmax(${(CFG.horizontal.layout as any).columnMinW}px, 260px))`,
              gap: (CFG.horizontal.layout as any).gap,
              alignItems: "start",
              justifyContent: "center",
              pointerEvents: "none"
            }}
          >
            {peopleBlocks.map((p) => (
              <div key={p.id} style={{ width: "100%", maxWidth: 260, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: (CFG.horizontal.many.blocks as any).portraits.size.width }}>
                  <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: "100%", aspectRatio: "3 / 4" }} />
                </div>
                <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (CFG.horizontal.many.blocks as any).metric.size.width }} />
              </div>
            ))}
          </div>
        )
      ) : tplKey === "one" ? (
        // Вертикальный 1
        <>
          {peopleBlocks[0] && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                top: (CFG.vertical.one.blocks as any).portraits.pos.top ?? "12%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                pointerEvents: "none"
              }}
            >
              <div style={{ width: (CFG.vertical.one.blocks as any).portraits.size.width, maxWidth: (CFG.vertical.one.blocks as any).portraits.size.maxWidth }}>
                <div data-sketch-el="portrait" data-sketch-key={peopleBlocks[0].id} style={{ width: "100%", aspectRatio: "3 / 4" }} />
              </div>
              <div data-sketch-el="metric" data-sketch-key={peopleBlocks[0].id} style={{ width: (CFG.vertical.one.blocks as any).metric.size.width, maxWidth: (CFG.vertical.one.blocks as any).metric.size.maxWidth }} />
            </div>
          )}
        </>
      ) : tplKey === "two" ? (
        // Вертикальный 2 (две строки-ряды)
        <div
          style={{
            position: "absolute",
            top: (CFG.vertical.one.blocks as any).portraits.pos.top,
            left: 16,
            right: 16,
            display: "grid",
            gridTemplateRows: `repeat(2, 1fr)`,
            rowGap: (CFG.vertical.layout as any).rowGapPx,
            pointerEvents: "none"
          }}
        >
          {peopleBlocks.slice(0, 2).map((p) => (
            <div key={p.id} style={{ width: "100%", display: "grid", gridTemplateColumns: `45% 55%`, columnGap: 12, alignItems: "center" }}>
              <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: (CFG.vertical.two.blocks as any).portraits.size.width, aspectRatio: "3 / 4" }} />
              </div>
              <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (CFG.vertical.two.blocks as any).metric.size.width }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Вертикальный many
        <div
          style={{
            position: "absolute",
            top: (CFG.vertical.one.blocks as any).portraits.pos.top,
            left: 16,
            right: 16,
            display: "grid",
            gridTemplateRows: `repeat(${peopleBlocks.length}, 1fr)`,
            rowGap: (CFG.vertical.layout as any).rowGapPx,
            pointerEvents: "none"
          }}
        >
          {peopleBlocks.map((p) => (
            <div key={p.id} style={{ width: "100%", display: "grid", gridTemplateColumns: `42% 58%`, columnGap: 12, alignItems: "center" }}>
              <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <div data-sketch-el="portrait" data-sketch-key={p.id} style={{ width: (CFG.vertical.many.blocks as any).portraits.size.width, aspectRatio: "3 / 4" }} />
              </div>
              <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <div data-sketch-el="metric" data-sketch-key={p.id} style={{ width: (CFG.vertical.many.blocks as any).metric.size.width }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Кресты: правила — по умолчанию слева; 2 — слева и справа; H two: 1 центр, 2 края */}
      {(!isVertical && tplKey === "two") ? (
        <>
          {crosses[0] && (
            <div data-sketch-el="cross" data-sketch-key="0" style={{ position: "absolute", top: crossTop, left: "50%", transform: "translateX(-50%)", width: (CFG.horizontal.two.blocks as any).cross.size.width }} />
          )}
          {crosses[1] && (
            <div data-sketch-el="cross" data-sketch-key="1" style={{ position: "absolute", top: crossTop, right: "4%", width: (CFG.horizontal.two.blocks as any).cross.size.width }} />
          )}
          {crosses.length >= 2 && (
            <div data-sketch-el="cross" data-sketch-key="0" style={{ position: "absolute", top: crossTop, left: "4%", width: (CFG.horizontal.two.blocks as any).cross.size.width }} />
          )}
        </>
      ) : (
        <>
          {crosses[0] && (
            <div data-sketch-el="cross" data-sketch-key="0" style={{ position: "absolute", top: crossTop, left: "4%", width: (CFG.horizontal.one.blocks as any).cross.size.width }} />
          )}
          {crosses[1] && (
            <div data-sketch-el="cross" data-sketch-key="1" style={{ position: "absolute", top: crossTop, right: "4%", width: (CFG.horizontal.one.blocks as any).cross.size.width }} />
          )}
        </>
      )}

      {/* Эпитафии — общий контейнер (под метрикой, будет измерен объединённо в редакторе) */}
      {Array.isArray(epitaphs) &&
        epitaphs.map((_, idx) => (
          <div key={`epitaph-${idx}`} data-sketch-el="epitaph" data-sketch-key={`${idx}`} style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }} />
        ))}

      {/* Графика — внизу (у шаблона мы её показываем внизу; в редакторе она будет «у самого низа») */}
      {others.map((_, idx) => (
        <div key={`graphic-${idx}`} data-sketch-el="graphic" data-sketch-key={`${idx}`} style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }} />
      ))}
    </div>
  );
}

/* ===== Компонент редактора ===== */
type Props = {
  onBack?: () => void;
  onContinue?: (payload?: any) => void;
  onRearSide?: (payload?: any) => void;
  onSendOrder?: (payload?: any) => void;
};

export default function EditorStep({ onBack, onContinue, onRearSide, onSendOrder }: Props) {
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  const [outro, setOutro] = useState(false);

  const [elements, setElements] = useState<EditorEl[]>(
    () => (draft as any)?.editor?.elements || []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wishes, setWishes] = useState<string>(() => (draft as any)?.editor?.wishes || "");

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const wishesTimerRef = useRef<number | null>(null);

  const [containerW, setContainerW] = useState(1);
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(
    () => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined),
    [imgWH]
  );

  // draft live reload
  useEffect(() => {
    const reload = () => setDraft(loadOrderDraft());
    const onFocus = () => reload();
    const onStorage = () => reload();
    const onVis = () => document.visibilityState === "visible" && reload();
    const onDraftUpdated = () => reload();

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("draft:updated" as any, onDraftUpdated);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("draft:updated" as any, onDraftUpdated);
    };
  }, []);

  // sources
  const item = draft?.item || null;
  const engr: any = draft?.engraving || {};
  const graphics: any[] = Array.isArray(draft?.graphics) ? (draft.graphics as any[]) : [];

  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engr?.persons) && engr.persons.length > 0) {
      return engr.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
    // legacy fallback
    const legacyLines: string[] = [];
    if (engr?.fullName) legacyLines.push(String(engr.fullName));
    const dates: string[] = [];
    if (engr?.birthDate) dates.push(String(engr.birthDate));
    if (engr?.deathDate) dates.push(String(engr.deathDate));
    if (dates.length) legacyLines.push(dates.join(" — "));
    if (Array.isArray(engr?.lines)) legacyLines.push(...(engr.lines as string[]).filter(Boolean));
    const photo = engr?.photoPreview || engr?.photoDataUrl || engr?.photoUrl || engr?.photo || null;
    return legacyLines.length || photo ? [{ id: "legacy-0", lines: legacyLines, photo }] : [];
  }, [engr]);

  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) return engr.epitaphs.filter(Boolean);
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim())
      return engr.epitaphText.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    return [];
  }, [engr]);

  const crosses = useMemo(
    () => graphics.filter((g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)),
    [graphics]
  );
  const others = useMemo(
    () => graphics.filter((g) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)),
    [graphics]
  );

  // width observer
  useEffect(() => {
    const measure = () => {
      const r = wrapperRef.current?.getBoundingClientRect();
      setContainerW(Math.max(1, Math.floor(r?.width || 1)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* ===== DnD/Resize ===== */
  const dragRef = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number;
    start: EditorEl;
  } | null>(null);

  const contentWH = () => {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!r) return { w: 1, h: 1 };
    const w = Math.max(1, r.width - SKETCH_PAD * 2);
    const h = Math.max(1, r.height - SKETCH_PAD * 2);
    return { w, h };
  };

  const onPointerDownBox = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move"
  ) => {
    e.stopPropagation();
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const { w: cw, h: ch } = contentWH();
    const dxPct = ((e.clientX - d.startX) / cw) * 100;
    const dyPct = ((e.clientY - d.startY) / ch) * 100;
    const withSnap = !e.altKey;
    const snapStep = e.shiftKey ? 1.5 : 1;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        let { x, y, w, h } = d.start;

        if (d.mode === "move") {
          let nx = x + dxPct;
          let ny = y + dyPct;
          if (withSnap) {
            nx = snap(nx, snapStep);
            ny = snap(ny, snapStep);
          }
          return { ...el, ...clampBox(nx, ny, w, h) };
        }

        // resize
        const keepRatio = e.shiftKey;
        let nx = x, ny = y, nw = w, nh = h;
        const startRatio = w / h || 1;

        if (d.mode.includes("e")) nw = w + dxPct;
        if (d.mode.includes("s")) nh = h + dyPct;
        if (d.mode.includes("w")) { nx = x + dxPct; nw = w - dxPct; }
        if (d.mode.includes("n")) { ny = y + dyPct; nh = h - dxPct; }

        if (keepRatio) {
          if (["e", "w"].some((k) => d.mode.includes(k))) nh = nw / startRatio;
          if (["n", "s"].some((k) => d.mode.includes(k))) nw = nh * startRatio;
        }

        if (withSnap) {
          nx = snap(nx, snapStep);
          ny = snap(ny, snapStep);
          nw = snap(nw, snapStep);
          nh = snap(nh, snapStep);
        }

        return { ...el, ...clampBox(nx, ny, nw, nh) };
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current = null;
  };

  /* ===== Автосохранение и wishes ===== */
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      saveOrderDraft({
        ...prev,
        editor: {
          ...(prev.editor || {}),
          elements,
          wishes,
          updatedAt: Date.now()
        }
      });
    }, 200) as unknown as number;

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [elements, wishes]);

  useEffect(() => {
    if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current);
    wishesTimerRef.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      if (prev.editor?.wishes !== wishes) {
        saveOrderDraft({
          ...prev,
          editor: { ...(prev.editor || {}), wishes, updatedAt: Date.now() }
        });
      }
    }, 300) as unknown as number;

    return () => {
      if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current);
    };
  }, [wishes]);

  /* ===== «Лесенка» по умолчанию ===== */
  const initStaircaseAppliedRef = useRef(false);
  useEffect(() => {
    if (initStaircaseAppliedRef.current) return;
    if (!elements || elements.length === 0) return;

    let changed = false;
    const next = elements.map((el) => {
      if (el.type !== "epitaph" || typeof el.staircase !== "undefined") return el;
      const key = el.id.split("-").slice(1).join("-");
      const idx = Number(key);
      const t = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
      if (isRememberLoveMourn(t)) {
        changed = true;
        return { ...el, staircase: true };
      }
      return el;
    });

    if (changed) setElements(next);
    initStaircaseAppliedRef.current = true;
  }, [elements, epitaphs]);

  /* ===== СКРЫТЫЙ рендер шаблона и считывание координат ===== */
  const hiddenSketchRef = useRef<HTMLDivElement | null>(null);
  const sketchDefaultsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const measureRetryTimerRef = useRef<number | null>(null);
  const [sketchReady, setSketchReady] = useState(false);
  const appliedSketchDefaultsRef = useRef(false);

  const measureHiddenSketch = useCallback(() => {
    const rootHost = hiddenSketchRef.current;
    if (!rootHost) return false;

    const sketchRoot = rootHost.querySelector("[data-sketch-orient]") as HTMLElement | null;
    if (!sketchRoot) return false;

    // Проверяем, что картинка уже разложилась (есть реальные размеры)
    const img = sketchRoot.querySelector("img") as HTMLImageElement | null;
    const imgLoaded =
      img && img.naturalWidth > 0 && img.naturalHeight > 0 && img.clientWidth > 0 && img.clientHeight > 0;
    if (!imgLoaded) return false;

    const rootRect = sketchRoot.getBoundingClientRect();
    if (rootRect.height < 10 || rootRect.width < 10) return false;

    const content = {
      left: rootRect.left + SKETCH_PAD,
      top: rootRect.top + SKETCH_PAD,
      width: Math.max(1, rootRect.width - SKETCH_PAD * 2),
      height: Math.max(1, rootRect.height - SKETCH_PAD * 2)
    };

    const map = new Map<string, { x: number; y: number; w: number; h: number }>();

    const pushBox = (elType: ElType, key: string, r: DOMRect) => {
      const x = clamp(((r.left - content.left) / content.width) * 100, 0, 100);
      const y = clamp(((r.top - content.top) / content.height) * 100, 0, 100);
      const w = clamp((r.width / content.width) * 100, 1, 100);
      const h = clamp((r.height / content.height) * 100, 1, 100);
      map.set(`${elType}-${key}`, clampBox(x, y, w, h));
    };

    rootHost.querySelectorAll<HTMLElement>('[data-sketch-el="portrait"]').forEach((n) => {
      const key = n.dataset.sketchKey || "";
      if (!key) return;
      pushBox("portrait", key, n.getBoundingClientRect());
    });

    rootHost.querySelectorAll<HTMLElement>('[data-sketch-el="metric"]').forEach((n) => {
      const key = n.dataset.sketchKey || "";
      if (!key) return;
      pushBox("metric", key, n.getBoundingClientRect());
    });

    const epNodes = Array.from(rootHost.querySelectorAll<HTMLElement>('[data-sketch-el="epitaph"]'));
    if (epNodes.length) {
      const grouped = new Map<string, DOMRect[]>();
      for (const n of epNodes) {
        const key = n.dataset.sketchKey || "";
        if (!key) continue;
        const list = grouped.get(key) || [];
        list.push(n.getBoundingClientRect());
        grouped.set(key, list);
      }
      grouped.forEach((rects, key) => {
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const box = new DOMRect(left, top, right - left, bottom - top);
        pushBox("epitaph", key, box);
      });
    }

    rootHost.querySelectorAll<HTMLElement>('[data-sketch-el="cross"]').forEach((n) => {
      const key = n.dataset.sketchKey || "";
      if (!key) return;
      pushBox("cross", key, n.getBoundingClientRect());
    });

    rootHost.querySelectorAll<HTMLElement>('[data-sketch-el="graphic"]').forEach((n) => {
      const key = n.dataset.sketchKey || "";
      if (!key) return;
      pushBox("graphic", key, n.getBoundingClientRect());
    });

    sketchDefaultsRef.current = map;
    return map.size > 0;
  }, []);

  const ensureSketchMeasured = useCallback(() => {
    if (measureRetryTimerRef.current) {
      window.clearTimeout(measureRetryTimerRef.current);
      measureRetryTimerRef.current = null;
    }
    let attempts = 0;
    const tick = () => {
      attempts++;
      const ok = measureHiddenSketch();
      if (ok) {
        setSketchReady(true);
        return;
      }
      if (attempts < 40) {
        measureRetryTimerRef.current = window.setTimeout(tick, 50) as unknown as number;
      } else {
        setSketchReady(true);
      }
    };
    tick();
  }, [measureHiddenSketch]);

  useEffect(() => {
    setSketchReady(false);
    ensureSketchMeasured();
    return () => {
      if (measureRetryTimerRef.current) {
        window.clearTimeout(measureRetryTimerRef.current);
        measureRetryTimerRef.current = null;
      }
    };
  }, [ensureSketchMeasured, containerW, peopleBlocks, epitaphs, crosses, others, draft?.size?.orientation]);

  /* ===== Синхронизация состав элементов + одноразовое применение координат шаблона ===== */
  const desiredIds = useMemo(() => {
    const ids: string[] = [];
    for (const p of peopleBlocks) {
      ids.push(`portrait-${p.id}`);
      ids.push(`metric-${p.id}`);
    }
    for (let i = 0; i < epitaphs.length; i++) ids.push(`epitaph-${i}`);
    for (let i = 0; i < crosses.length; i++) ids.push(`cross-${i}`);
    for (let i = 0; i < others.length; i++) ids.push(`graphic-${i}`);
    return new Set(ids);
  }, [peopleBlocks, epitaphs, crosses, others]);

  // Состав
  useEffect(() => {
    setElements((prev) => {
      const prevMap = new Map(prev.map((e) => [e.id, e]));
      const currentIds = new Set(prev.map((e) => e.id));
      const desired = desiredIds;

      let changed = false;
      const kept: EditorEl[] = [];

      for (const id of currentIds) {
        if (desired.has(id)) {
          kept.push(prevMap.get(id)!);
        } else {
          changed = true;
          if (selectedId === id) setSelectedId(null);
        }
      }

      const missing: string[] = [];
      for (const id of desired) {
        if (!currentIds.has(id)) missing.push(id);
      }
      if (missing.length) changed = true;

      const maxZ = kept.reduce((m, e) => Math.max(m, e.z), 0);
      const added: EditorEl[] = missing.map((id, i) => {
        const [type] = id.split("-");
        const elType = type as ElType;
        // Пока дефолт грубый; позже заменим координатами шаблона
        let x = 10, y = 10, w = 30, h = 20;
        const idx = Number(id.slice(elType.length + 1));
        switch (elType) {
          case "portrait": x = 8; y = 10; w = 32; h = 45; break;
          case "metric": x = 10; y = 58; w = 80; h = 24; break;
          case "epitaph": {
            w = 80; h = 14; x = 10;
            const baseY = 80; const offset = Number.isFinite(idx) ? idx * (h + 2) : 0;
            y = clamp(baseY + offset, 0, 100 - h); break;
          }
          case "cross": w = 18; h = 18; y = 6; x = (idx % 2 === 0) ? 6 : 76; break;
          case "graphic": w = 24; h = 24; y = 60; x = (idx % 2 === 0) ? 6 : 70; break;
        }
        const base: EditorEl = { id, type: elType, ...clampBox(x, y, w, h), z: maxZ + i + 1, title: id };
        if (elType === "portrait") base.bw = true;
        if (elType === "metric") base.uppercase = true;
        if (elType === "graphic") base.flipH = false;
        if (elType === "epitaph") {
          if (Number.isFinite(idx) && isRememberLoveMourn(epitaphs[idx])) base.staircase = true;
        }
        return base;
      });

      if (!changed) return prev;
      return kept.concat(added);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredIds]);

  // Применение координат из шаблона один раз
  useEffect(() => {
    if (!sketchReady || appliedSketchDefaultsRef.current) return;
    if (sketchDefaultsRef.current.size === 0) {
      appliedSketchDefaultsRef.current = true;
      return;
    }
    setElements((prev) => {
      const map = sketchDefaultsRef.current;
      const updated = prev.map((el) => {
        const m = map.get(el.id);
        if (!m) return el;
        return { ...el, ...m };
      });
      const existing = new Set(updated.map((e) => e.id));
      const toAdd: EditorEl[] = [];
      let maxZ = updated.reduce((m, e) => Math.max(m, e.z), 0);
      map.forEach((m, id) => {
        if (!existing.has(id)) {
          const [type] = id.split("-");
          const elType = type as ElType;
          const base: EditorEl = { id, type: elType, ...m, z: ++maxZ, title: id };
          if (elType === "portrait") base.bw = true;
          if (elType === "metric") base.uppercase = true;
          if (elType === "graphic") base.flipH = false;
          if (elType === "epitaph") {
            const idx = Number(id.split("-")[1]);
            if (Number.isFinite(idx) && isRememberLoveMourn(epitaphs[idx])) base.staircase = true;
          }
          toAdd.push(base);
        }
      });
      return updated.concat(toAdd);
    });
    appliedSketchDefaultsRef.current = true;
  }, [sketchReady, epitaphs]);

  /* ===== Превью (canvas) ===== */
  const renderPreview = async (W: number, H: number): Promise<string | null> => {
    if (W <= 0 || H <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const pad = SKETCH_PAD;
    const CX = pad, CY = pad, CW = W - pad * 2, CH = H - pad * 2;

    const base = await loadImageSafe(item?.url);
    if (base) {
      const sr = base.width / base.height, dr = CW / CH;
      ctx.globalAlpha = 0.35;
      if (sr > dr) {
        const rw = CW, rh = Math.round(CW / sr), rx = CX, ry = CY + Math.round((CH - Math.round(CW / sr)) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      } else {
        const rh = CH, rw = Math.round(CH * sr), ry = CY, rx = CX + Math.round((CW - Math.round(CH * sr)) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      }
      ctx.globalAlpha = 1;
    }

    const fontFamily = `"Century Schoolbook","Times New Roman",serif`;
    const els = elements.slice().sort((a, b) => a.z - b.z);
    for (const el of els) {
      const r = { x: CX + (el.x / 100) * CW, y: CY + (el.y / 100) * CH, w: (el.w / 100) * CW, h: (el.h / 100) * CH };
      const key = el.id.split("-").slice(1).join("-");

      if (el.type === "portrait") {
        const p = peopleBlocks.find((pp) => pp.id === key);
        if (!p?.photo) continue;
        const im = await loadImageSafe(p.photo);
        if (!im) continue;
        const sr = im.width / im.height, dr = r.w / r.h;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.filter = el.bw ? "grayscale(100%)" : "none";
        if (sr > dr) {
          const hh = r.h, ww = Math.round(hh * sr), xx = Math.round(r.x + (r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const ww = r.w, hh = Math.round(ww / sr), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
        ctx.filter = "none";
      } else if (el.type === "graphic") {
        const idx = Number(key);
        const g = Number.isFinite(idx) ? others[idx] : undefined;
        if (!g?.url) continue;
        const im = await loadImageSafe(g.url);
        if (!im) continue;
        ctx.save();
        if (el.flipH) {
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
          ctx.scale(-1, 1);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
        const sr = im.width / im.height, dr = r.w / r.h;
        if (sr > dr) {
          const ww = r.w, hh = Math.round(ww / sr), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const hh = r.h, ww = Math.round(hh * sr), xx = r.x + Math.round((r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
      } else if (el.type === "cross") {
        const idx = Number(key);
        const c = Number.isFinite(idx) ? crosses[idx] : undefined;
        if (!c?.url) continue;
        const im = await loadImageSafe(c.url);
        if (!im) continue;
        const sr = im.width / im.height, dr = r.w / r.h;
        if (sr > dr) {
          const ww = r.w, hh = Math.round(ww / sr), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const hh = r.h, ww = Math.round(hh / sr), xx = r.x + Math.round((r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        }
      } else if (el.type === "metric") {
        const p = peopleBlocks.find((pp) => pp.id === key);
        const lines = (p?.lines || []).filter(Boolean);
        const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const f1 = Math.max(10, Math.round(r.h * 0.26));
        const f2 = Math.max(10, Math.round(r.h * 0.22));
        const f3 = Math.max(10, Math.round(r.h * 0.18));
        const sizes = [f1, f2, f3];
        const lh = Math.max(10, Math.round(r.h / Math.max(1, lines.length)));
        const startY = r.y + r.h / 2 - ((lines.length - 1) * lh) / 2;
        const X = r.x + r.w / 2;
        lines.forEach((ln, i) => {
          ctx.font = `${el.italic ? "italic " : ""}${sizes[i] || sizes[sizes.length - 1]}px ${fontFamily}`;
          ctx.fillText(tf(ln), X, startY + i * lh, r.w);
        });
        ctx.restore();
      } else if (el.type === "epitaph") {
        const idx = Number(key);
        const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
        const text = el.uppercase ? tRaw.toUpperCase() : tRaw;
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        const f = Math.max(10, Math.round(r.h * 0.32));
        ctx.font = `${el.italic ? "italic " : ""}${f}px ${fontFamily}`;

        if (el.staircase && isRememberLoveMourn(text)) {
          const { top, mid, bot } = splitRememberPreserve(text);
          ctx.textAlign = "left";
          ctx.fillText(top, r.x + 4, r.y + f / 1.5, r.w - 8);
          ctx.textAlign = "center";
          ctx.fillText(mid, r.x + r.w / 2, r.y + r.h / 2, r.w - 8);
          ctx.textAlign = "right";
          ctx.fillText(bot, r.x + r.w - 4, r.y + r.h - f / 2, r.w - 8);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2, r.w - 8);
        }
        ctx.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", 0.9);
  };

  useEffect(() => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(async () => {
      const wrap = wrapperRef.current;
      if (!wrap) return;

      const r = wrap.getBoundingClientRect();
      const miniW = Math.max(320, Math.floor(r.width));
      const miniH = Math.max(320, Math.floor(r.height));
      const mini = await renderPreview(miniW, miniH);

      const maxSide = 1600;
      const ratio = r.width / (r.height || 1);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await renderPreview(bigW, bigH);

      const prev = loadOrderDraft();
      const needSave =
        (!!mini && mini !== (prev as any).editor?.previewUrl) ||
        (!!big && big !== (prev as any).editor?.previewHiUrl);

      if (needSave) {
        saveOrderDraft({
          ...prev,
          editor: {
            ...(prev.editor || {}),
            previewUrl: mini || prev.editor?.previewUrl,
            previewHiUrl: big || prev.editor?.previewHiUrl,
            previewUpdatedAt: Date.now(),
            elements,
            wishes
          }
        });
      }
    }, 250) as unknown as number;

    return () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    };
  }, [elements, item?.url, peopleBlocks, crosses, others, epitaphs, containerW, wishes]);

  /* ===== Back/Continue ===== */
  const handleBack = () => {
    const prev = loadOrderDraft();
    saveOrderDraft({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    });
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };

  const handleContinue = () => {
    const prev = loadOrderDraft();
    saveOrderDraft({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    });

    const go = onRearSide || onSendOrder || onContinue;
    if (!go) {
      console.warn("EditorStep: нет обработчика перехода (onRearSide/onSendOrder/onContinue)");
      return;
    }

    setOutro(true);
    setTimeout(() => go({ elements, wishes }), 150);
  };

  /* ===== Мини тулбар ===== */
  const handleDot = (left: number | string, top: number | string, cursor: string): React.CSSProperties => ({
    position: "absolute",
    left,
    top,
    width: 10,
    height: 10,
    background: "#fff",
    border: "1px solid #000",
    borderRadius: 2,
    transform: "translate(-50%, -50%)",
    cursor
  });

  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const key = el.id.split("-").slice(1).join("-");
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";

    let showStair = false;
    if (isEpitaph) {
      const idx = Number(key);
      const epText = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
      showStair = isRememberLoveMourn(epText);
    }

    return (
      <div
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{
          position: "absolute",
          left: 0,
          top: -30,
          display: "flex",
          gap: 6,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 6,
          padding: "2px 6px",
          alignItems: "center",
          pointerEvents: "auto",
          zIndex: 3000
        }}
      >
        {isMetric && (
          <button
            type="button"
            style={btn}
            title={el.uppercase ? "Сделать строчные" : "Сделать ПРОПИСНЫЕ"}
            onClick={() =>
              setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, uppercase: !e.uppercase } : e)))
            }
          >
            {el.uppercase ? "строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}

        {isEpitaph && showStair && (
          <button
            type="button"
            style={btn}
            title={el.staircase ? "Показать в одну строку" : "Показать лесенкой"}
            onClick={() =>
              setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, staircase: !e.staircase } : e)))
            }
          >
            {el.staircase ? "В строку" : "Лесенкой"}
          </button>
        )}

        {isGraphic && (
          <button
            type="button"
            style={btn}
            title="Отразить по горизонтали"
            onClick={() =>
              setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))
            }
          >
            Отразить ⇄
          </button>
        )}
      </div>
    );
  };

  /* ===== Контент поверх (WYSIWYG) ===== */
  const ContentOverlay = () => {
    const fontFamily = `"Century Schoolbook","Times New Roman",serif`;
    const { h: ch } = contentWH();
    return (
      <>
        {elements
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((el) => {
            const key = el.id.split("-").slice(1).join("-");
            let content: React.ReactNode = null;

            if (el.type === "portrait") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const url = p?.photo || "";
              const filt = el.bw ? "grayscale(100%)" : "none";
              content = (
                <img
                  src={url}
                  alt="Портрет"
                  style={{ width: "100%", height: "100%", objectFit: "cover", filter: filt, display: "block", userSelect: "none", pointerEvents: "none" }}
                  draggable={false}
                />
              );
            } else if (el.type === "metric") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const lines = (p?.lines || []).filter(Boolean);
              const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
              const boxHpx = (el.h / 100) * ch;
              const f1 = Math.max(10, Math.round(boxHpx * 0.26));
              const f2 = Math.max(10, Math.round(boxHpx * 0.22));
              const f3 = Math.max(10, Math.round(boxHpx * 0.18));
              content = (
                <div
                  style={{
                    width: "100%", height: "100%", color: "#fff",
                    display: "grid", placeItems: "center",
                    textAlign: "center", fontFamily, fontStyle: el.italic ? "italic" : "normal",
                    lineHeight: 1.12, textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                  }}
                >
                  <div style={{ display: "grid", gap: 4, width: "100%" }}>
                    {lines[0] && <div style={{ fontWeight: 700, fontSize: f1 }}>{tf(lines[0])}</div>}
                    {lines[1] && <div style={{ fontWeight: 600, fontSize: f2 }}>{tf(lines[1])}</div>}
                    {lines[2] && <div style={{ fontWeight: 400, fontSize: f3, opacity: 0.95 }}>{tf(lines[2])}</div>}
                  </div>
                </div>
              );
            } else if (el.type === "epitaph") {
              const idx = Number(key);
              const tRaw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
              const txt = el.uppercase ? tRaw.toUpperCase() : tRaw;
              const boxHpx = (el.h / 100) * ch;
              const f = Math.max(10, Math.round(boxHpx * 0.32));

              if (el.staircase && isRememberLoveMourn(txt)) {
                const { top, mid, bot } = splitRememberPreserve(txt);
                content = (
                  <div
                    style={{
                      position: "relative",
                      width: "100%", height: "100%", color: "#fff",
                      fontFamily, fontStyle: el.italic ? "italic" : "normal",
                      textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                    }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 4, fontWeight: 600, fontSize: f }}>{top}</div>
                    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontWeight: 600, fontSize: f }}>{mid}</div>
                    <div style={{ position: "absolute", right: 4, bottom: 0, fontWeight: 600, fontSize: f }}>{bot}</div>
                  </div>
                );
              } else {
                content = (
                  <div
                    style={{
                      width: "100%", height: "100%", color: "#fff",
                      display: "grid", placeItems: "center",
                      textAlign: "center", fontFamily, fontStyle: el.italic ? "italic" : "normal",
                      lineHeight: 1.2, textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: f, padding: "0 4px" }}>{txt}</div>
                  </div>
                );
              }
            } else if (el.type === "cross") {
              const idx = Number(key);
              const c = Number.isFinite(idx) ? crosses[idx] : undefined;
              if (c?.url) {
                content = (
                  <img
                    src={c.url}
                    alt={c.name || "Крест"}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    draggable={false}
                  />
                );
              }
            } else if (el.type === "graphic") {
              const idx = Number(key);
              const g = Number.isFinite(idx) ? others[idx] : undefined;
              if (g?.url) {
                const tr = el.flipH ? "scaleX(-1)" : "none";
                content = (
                  <img
                    src={g.url}
                    alt={g.name || "Графика"}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", transform: tr, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    draggable={false}
                  />
                );
              }
            }

            return (
              <div
                key={`content-${el.id}`}
                style={{
                  position: "absolute",
                  left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
                  zIndex: el.z, pointerEvents: "none"
                }}
              >
                {content}
              </div>
            );
          })}
      </>
    );
  };

  const MAX_W = 600;
  const orientationOverride = (draft.size?.orientation as Orientation | undefined) ?? (draft as any).orientation ?? undefined;

  return (
    <div
      style={{
        color: "#fff",
        padding: 12,
        opacity: outro ? 0 : 1,
        transition: "opacity 240ms ease",
        backgroundImage: `url(/data/bg.svg)`,
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundAttachment: "fixed"
      }}
    >
      {/* Скрытый скетч для измерений (НЕ виден пользователю) */}
      <div
        ref={hiddenSketchRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -99999,
          top: -99999,
          width: Math.max(320, containerW),
          pointerEvents: "none",
          visibility: "hidden",
          zIndex: -1
        }}
      >
        <SketchTemplateHidden
          item={item}
          peopleBlocks={peopleBlocks}
          crosses={crosses}
          others={others}
          epitaphs={epitaphs}
          carvingOpacity={0.4}
          orientationOverride={orientationOverride || undefined}
        />
      </div>

      <div style={{ width: "100%", maxWidth: MAX_W, margin: "0 auto" }}>
        <TopBarWithIntro title="Memorial - редактор" />

        {/* Подсказка (замена по требованию) */}
        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Не старайтесь идеально расположить элементы, не страшно если они пересекаются или вызодят за край — эскиз схематичный. Исправьте ключевые позиции
          (крест слева/справа, направление бутонов, строчные/ПРОПИСНЫЕ) и опишите пожелания.
          Финальную обработку выполнит специалист.
        </section>

        {/* Эскиз с редактором */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={wrapperRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDown={() => setSelectedId(null)}
            style={{
              position: "relative",
              width: "100%",
              borderRadius: 10,
              overflow: "hidden",
              userSelect: "none",
              ...bottomUnderlayGradient(),
              aspectRatio: aspect,
              minHeight: aspect ? undefined : 540
            }}
          >
            {/* База — фото изделия */}
            <img
              src={item?.url || ""}
              alt={item?.name || "Изделие"}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.35, userSelect: "none", pointerEvents: "none" }}
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => { if (!aspect) setImgWH({ w: 4, h: 3 }); }}
            />

            {/* Контент поверх (WYSIWYG) */}
            <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, overflow: "hidden" }}>
              <ContentOverlay />
            </div>

            {/* Рамки + мини-кнопки */}
            <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, zIndex: 1000, pointerEvents: "none" }}>
              {elements
                .slice()
                .sort((a, b) => a.z - b.z)
                .map((el) => {
                  const selected = el.id === selectedId;
                  return (
                    <div
                      key={el.id}
                      onPointerDown={(ev) => onPointerDownBox(ev, el.id, "move")}
                      style={{
                        position: "absolute",
                        left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
                        border: selected ? "2px solid #8ab4ff" : "1px dashed rgba(255,255,255,0.85)",
                        borderRadius: 4,
                        boxShadow: selected ? "0 0 0 1px rgba(138,180,255,0.6)" : "none",
                        background: "transparent",
                        pointerEvents: "auto",
                        cursor: el.locked ? "not-allowed" : "move",
                        touchAction: "none"
                      }}
                      title={el.title || el.id}
                    >
                      {selected && <MiniToolbar el={el} />}
                      {selected && !el.locked && (
                        <>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={handleDot(0, 0, "nwse-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={handleDot("50%", 0, "ns-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={handleDot("100%", 0, "nesw-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={handleDot("100%", "50%", "ew-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={handleDot("100%", "100%", "nwse-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={handleDot("50%", "100%", "ns-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={handleDot(0, "100%", "nesw-resize")} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={handleDot(0, "50%", "ew-resize")} />
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </section>

        {/* Пожелания */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <label htmlFor="wishes" style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>Пожелания по эскизу</label>
          <textarea
            id="wishes"
            value={wishes}
            onChange={(e) => setWishes(e.target.value)}
            rows={4}
            placeholder="Например: добавить ещё одну эпитафию, графику расположить справа, метрику сделать ПРОПИСНОЙ…"
            style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.35)", color: "#fff", padding: 10, resize: "vertical", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Будем учитывать ваши пожелания при подготовке финального макета.</div>
        </section>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
