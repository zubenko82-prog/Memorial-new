// src/screens/EditorStep.tsx
// Редактор элементов: надёжная инициализация позиций из шаблона.
//
// Проблема:
// - Чтение позиций через скрытый DOM SketchTemplate давало схлопнутые рамки (у элементов без явной высоты),
//   криво считались области эпитафии, «графика» терялась, кресты сжимались и "появлялись" только после растягивания.
// Решение (устойчиво и повторяемо):
// - НЕ читаем DOM. Вместо этого вычисляем те же координаты, что и шаблон, программно.
// - Внутри этого файла реализован computeSketchLayout(...) — единая функция построения раскладки
//   (по тем же правилам, что в SketchTemplate: портрет, метрика, эпитафия под метрикой, графика у низа,
//   кресты слева/справа, особый случай для горизонтального «2 человека»).
// - Инициализация редактора: когда известны размеры «сцены» (контентной области) — берём layout и
//   создаём/обновляем рамки. Применяем один раз (сохраняем хэш в драфт), ручные правки не затираем.
//
// Дополнительно:
// - Рамкам крестов задаём квадратные боксы (на основе ширины), чтобы не схлопывались.
// - Эпитафия получает разумную высоту (часть оставшейся области), чтобы всегда быть активной и «ровной».
// - «Графика» всегда у нижнего края с минимальным отступом.
// - Сохраняем превью и синхронизацию, мини-кнопки и DnD/resize без изменений.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft, type OrderDraft } from "../lib/order";

/* ===== UI ===== */
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

/* ===== Types ===== */
type Orientation = "vertical" | "horizontal";
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type Align = "left" | "center" | "right";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты (от контентной области)
  z: number;
  title?: string;
  locked?: boolean;
  align?: Align;
  uppercase?: boolean;
  italic?: boolean;
  flipH?: boolean;
  bw?: boolean;
  staircase?: boolean;
};

/* ===== Helpers ===== */
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
const SKETCH_PAD = 8; // должен совпадать с SketchTemplate
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

// «Помним, любим, скорбим…»
const normRemember = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim();
const isRememberLoveMourn = (t?: string) => normRemember(t) === "помним любим скорбим";

/* =========================================================================================
   computeSketchLayout: ЕДИНАЯ ПРОГРАММНАЯ РАСКЛАДКА (без чтения DOM)
   Вход:
   - stageW, stageH — размеры контентной области (без внутренних паддингов)
   - orientation — "horizontal" | "vertical"
   - people, crosses, graphics, epitaphs — массивы контента
   Выход:
   - Map<id, box> где id = `${type}-${key}` (key = personId | index), box = {x,y,w,h} в процентах.
   Логика синхронизирована с SketchTemplate:
   - Горизонтальный «1»: портрет 40% H отступ 6% сверху; метрика 20% H под ним; эпитафия под метрикой;
     графика у самого низа; кресты: один слева, два — по краям; особый случай H «2»: один крест по центру, два по краям.
   - Прочие режимы — лэйаут колонок/строк аналогичен видимой версии.
   ========================================================================================= */
function computeSketchLayout({
  stageW, stageH,
  orientation,
  people,
  crosses,
  graphics,
  epitaphs
}: {
  stageW: number; stageH: number;
  orientation: Orientation;
  people: Array<{ id: string; lines: string[]; photo?: string | null }>;
  crosses: Array<any>;
  graphics: Array<any>;
  epitaphs: string[];
}): Map<string, { x: number; y: number; w: number; h: number }> {
  const toPct = (px: number, total: number) => clamp((px / total) * 100, 0, 100);
  const m = new Map<string, { x: number; y: number; w: number; h: number }>();
  const gap = Math.round(0.015 * stageH);
  const top6 = Math.round(0.06 * stageH);
  const bottomPad = Math.max(8, Math.round(0.02 * stageH));
  const add = (id: string, leftPx: number, topPx: number, wPx: number, hPx: number) => {
    m.set(id, clampBox(toPct(leftPx, stageW), toPct(topPx, stageH), toPct(wPx, stageW), toPct(hPx, stageH)));
  };

  const n = people.length;
  const tplKey: "one" | "two" | "many" = n <= 1 ? "one" : n === 2 ? "two" : "many";

  // Кресты: размеры (ширина в % сцены), зададим квадрат (во избежание схлопываний)
  const crossWpctHorizontal = 0.08; // 8% ширины сцены
  const crossWpctVertical = orientation === "vertical" ? 0.14 : crossWpctHorizontal;
  const crossWpx = Math.round(stageW * crossWpctVertical);
  const crossHpx = crossWpx; // квадрат

  if (orientation === "horizontal" && tplKey === "one") {
    // Портрет
    const portraitH = Math.round(0.40 * stageH);
    let portraitW = Math.round(portraitH * (3 / 4));
    if (portraitW > stageW * 0.9) {
      const k = (stageW * 0.9) / portraitW;
      portraitW = Math.max(40, Math.round(portraitW * k));
    }
    const portraitX = Math.round((stageW - portraitW) / 2);
    const portraitY = top6;
    if (people[0]) add(`portrait-${people[0].id}`, portraitX, portraitY, portraitW, portraitH);

    // Метрика
    const metricH = Math.max(24, Math.round(0.20 * stageH));
    const metricW = Math.round(stageW * 0.8);
    const metricX = Math.round((stageW - metricW) / 2);
    const metricY = portraitY + portraitH + gap;
    if (people[0]) add(`metric-${people[0].id}`, metricX, metricY, metricW, metricH);

    // Эпитафия (под метрикой), графика у низа
    const epitaphTop = metricY + metricH + gap;
    const graphicsMaxH = Math.round(0.18 * stageH);
    const graphicsH = Math.max(0, Math.min(graphicsMaxH, stageH - bottomPad - epitaphTop - gap));
    const graphicsTop = stageH - bottomPad - graphicsH;
    const epW = Math.round(stageW * 0.88);
    const epX = Math.round((stageW - epW) / 2);
    const epH = Math.max(20, Math.round((graphicsTop - gap) - epitaphTop));
    epitaphs.forEach((_, i) => add(`epitaph-${i}`, epX, epitaphTop, epW, epH));

    if (graphics.length > 0 && graphicsH > 0) {
      const gw = Math.round(stageW * 0.9);
      const gx = Math.round((stageW - gw) / 2);
      // один общий блок графики (рамка для группы); далее в редакторе можно дробить
      add(`graphic-0`, gx, graphicsTop, gw, graphicsH);
      // остальные графические элементы как «этажи» в той же рамке — разместятся вручную
      for (let i = 1; i < graphics.length; i++) {
        add(`graphic-${i}`, gx, graphicsTop, gw, graphicsH);
      }
    }

    // Кресты (по умолчанию: один слева, два — по краям)
    if (crosses[0]) add(`cross-0`, Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx);
    if (crosses[1]) add(`cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx);

  } else if (orientation === "horizontal" && tplKey === "two") {
    // Две колонки
    const gapCols = Math.round(0.012 * stageW);
    const colW = Math.min(320, Math.max(140, Math.floor((stageW - gapCols) / 2)));
    const totalW = colW * 2 + gapCols;
    const leftStart = Math.round((stageW - totalW) / 2);
    const portraitW = colW;
    const portraitH = Math.round(portraitW * (4 / 3));
    const top = Math.round(0.08 * stageH);

    people.slice(0, 2).forEach((p, idx) => {
      const px = leftStart + idx * (colW + gapCols);
      add(`portrait-${p.id}`, px, top, portraitW, portraitH);
      // метрика под портретом (заданная высота относительно портретной колонки)
      const mW = Math.round(colW * 0.8);
      const mX = px + Math.round((colW - mW) / 2);
      const mH = Math.max(30, Math.round(0.16 * stageH));
      const mY = top + portraitH + Math.round(0.01 * stageH);
      add(`metric-${p.id}`, mX, mY, mW, mH);
    });

    // Эпитафии (внизу, над графикой)
    const metricsBottom = people.slice(0, 2).reduce((acc, p) => {
      const m = m.get(`metric-${p.id}`)!;
      const my = (m.y / 100) * stageH, mh = (m.h / 100) * stageH;
      return Math.max(acc, my + mh);
    }, 0);
    const epitaphTop = Math.round(metricsBottom + gap);
    const graphicsMaxH = Math.round(0.14 * stageH);
    const graphicsH = Math.max(0, Math.min(graphicsMaxH, stageH - bottomPad - epitaphTop - gap));
    const graphicsTop = stageH - bottomPad - graphicsH;
    const epW = Math.round(stageW * 0.88);
    const epX = Math.round((stageW - epW) / 2);
    const epH = Math.max(20, Math.round((graphicsTop - gap) - epitaphTop));
    epitaphs.forEach((_, i) => add(`epitaph-${i}`, epX, epitaphTop, epW, epH));

    if (graphics.length > 0 && graphicsH > 0) {
      const gw = Math.round(stageW * 0.9);
      const gx = Math.round((stageW - gw) / 2);
      add(`graphic-0`, gx, graphicsTop, gw, graphicsH);
      for (let i = 1; i < graphics.length; i++) add(`graphic-${i}`, gx, graphicsTop, gw, graphicsH);
    }

    // Кресты для H-two: 1 — по центру, 2 — по краям
    if (crosses.length === 1) {
      const x = Math.round((stageW - crossWpx) / 2);
      const y = Math.round(0.06 * stageH);
      add(`cross-0`, x, y, crossWpx, crossHpx);
    } else if (crosses.length >= 2) {
      add(`cross-0`, Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx);
      add(`cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx);
    }

  } else if (orientation === "horizontal" && tplKey === "many") {
    // 3..4 колонок
    const cols = Math.min(4, Math.max(3, people.length));
    const colGap = Math.round(0.012 * stageW);
    const colW = Math.min(260, Math.max(140, Math.floor((stageW - (cols - 1) * colGap) / cols)));
    const totalW = colW * cols + (cols - 1) * colGap;
    const leftStart = Math.round((stageW - totalW) / 2);
    const top = Math.round(0.08 * stageH);
    const portraitW = colW;
    const portraitH = Math.round(portraitW * (4 / 3));

    people.forEach((p, i) => {
      const cx = leftStart + i * (colW + colGap);
      add(`portrait-${p.id}`, cx, top, portraitW, portraitH);
      const mW = Math.round(colW * 0.8);
      const mX = cx + Math.round((colW - mW) / 2);
      const mH = Math.max(28, Math.round(0.14 * stageH));
      const mY = top + portraitH + Math.round(0.008 * stageH);
      add(`metric-${p.id}`, mX, mY, mW, mH);
    });

    // Низ — как у H-two
    const metricsBottom = people.reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`)!;
      const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
      return Math.max(acc, my + mh);
    }, 0);
    const epitaphTop = Math.round(metricsBottom + gap);
    const graphicsMaxH = Math.round(0.14 * stageH);
    const graphicsH = Math.max(0, Math.min(graphicsMaxH, stageH - bottomPad - epitaphTop - gap));
    const graphicsTop = stageH - bottomPad - graphicsH;
    const epW = Math.round(stageW * 0.88);
    const epX = Math.round((stageW - epW) / 2);
    const epH = Math.max(20, Math.round((graphicsTop - gap) - epitaphTop));
    epitaphs.forEach((_, i) => add(`epitaph-${i}`, epX, epitaphTop, epW, epH));
    if (graphics.length > 0 && graphicsH > 0) {
      const gw = Math.round(stageW * 0.9);
      const gx = Math.round((stageW - gw) / 2);
      add(`graphic-0`, gx, graphicsTop, gw, graphicsH);
      for (let i = 1; i < graphics.length; i++) add(`graphic-${i}`, gx, graphicsTop, gw, graphicsH);
    }
    // Кресты (по умолчанию)
    if (crosses[0]) add(`cross-0`, Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx);
    if (crosses[1]) add(`cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx);

  } else {
    // ВЕРТИКАЛЬНЫЕ шаблоны (упрощённо, но надёжно)
    const topPortrait = Math.round(0.12 * stageH);
    if (tplKey === "one" && people[0]) {
      const p = people[0];
      const pw = Math.round(stageW * 0.6);
      const ph = Math.round(pw * (4 / 3));
      const px = Math.round((stageW - pw) / 2);
      add(`portrait-${p.id}`, px, topPortrait, pw, ph);

      const mw = Math.round(stageW * 0.8);
      const mh = Math.max(32, Math.round(0.18 * stageH));
      const mx = Math.round((stageW - mw) / 2);
      const my = topPortrait + ph + Math.round(0.01 * stageH);
      add(`metric-${p.id}`, mx, my, mw, mh);

      const metricsBottom = my + mh;
      const epitaphTop = metricsBottom + gap;
      const graphicsMaxH = Math.round(0.18 * stageH);
      const graphicsH = Math.max(0, Math.min(graphicsMaxH, stageH - bottomPad - epitaphTop - gap));
      const graphicsTop = stageH - bottomPad - graphicsH;
      const epW = Math.round(stageW * 0.88);
      const epX = Math.round((stageW - epW) / 2);
      const epH = Math.max(20, Math.round((graphicsTop - gap) - epitaphTop));
      epitaphs.forEach((_, i) => add(`epitaph-${i}`, epX, epitaphTop, epW, epH));
      if (graphics.length > 0 && graphicsH > 0) {
        const gw = Math.round(stageW * 0.9);
        const gx = Math.round((stageW - gw) / 2);
        add(`graphic-0`, gx, graphicsTop, gw, graphicsH);
        for (let i = 1; i < graphics.length; i++) add(`graphic-${i}`, gx, graphicsTop, gw, graphicsH);
      }
      if (crosses[0]) add(`cross-0`, Math.round(0.04 * stageW), Math.round(0.04 * stageH), crossWpx, crossHpx);
      if (crosses[1]) add(`cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.04 * stageH), crossWpx, crossHpx);
    } else {
      // two/many — сетка строк
      const rows = tplKey === "two" ? 2 : people.length;
      const rowGap = Math.round(0.01 * stageH);
      const gridTop = topPortrait;
      const rowH = Math.floor((stageH - gridTop - bottomPad - (rows - 1) * rowGap) / rows);
      people.forEach((p, i) => {
        const ry = gridTop + i * (rowH + rowGap);
        const pw = Math.round(stageW * 0.45);
        const ph = Math.round(pw * (4 / 3));
        const px = Math.round((stageW * 0.42 - pw) / 2) + Math.round(stageW * 0.03);
        add(`portrait-${p.id}`, px, ry + Math.round((rowH - ph) / 2), pw, ph);

        const mw = Math.round(stageW * 0.5);
        const mh = Math.max(24, Math.round(0.16 * stageH));
        const mx = Math.round(stageW * 0.48);
        const my = ry + Math.round((rowH - mh) / 2);
        add(`metric-${p.id}`, mx, my, mw, mh);
      });

      const metricsBottom = people.reduce((acc, p) => {
        const b = m.get(`metric-${p.id}`)!;
        const my = (b.y / 100) * stageH, mh = (b.h / 100) * stageH;
        return Math.max(acc, my + mh);
      }, 0);
      const epitaphTop = Math.round(metricsBottom + gap);
      const graphicsMaxH = Math.round(0.16 * stageH);
      const graphicsH = Math.max(0, Math.min(graphicsMaxH, stageH - bottomPad - epitaphTop - gap));
      const graphicsTop = stageH - bottomPad - graphicsH;
      const epW = Math.round(stageW * 0.88);
      const epX = Math.round((stageW - epW) / 2);
      const epH = Math.max(20, Math.round((graphicsTop - gap) - epitaphTop));
      epitaphs.forEach((_, i) => add(`epitaph-${i}`, epX, epitaphTop, epW, epH));
      if (graphics.length > 0 && graphicsH > 0) {
        const gw = Math.round(stageW * 0.9);
        const gx = Math.round((stageW - gw) / 2);
        add(`graphic-0`, gx, graphicsTop, gw, graphicsH);
        for (let i = 1; i < graphics.length; i++) add(`graphic-${i}`, gx, graphicsTop, gw, graphicsH);
      }
      if (crosses[0]) add(`cross-0`, Math.round(0.04 * stageW), Math.round(0.04 * stageH), crossWpx, crossHpx);
      if (crosses[1]) add(`cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.04 * stageH), crossWpx, crossHpx);
    }
  }

  return m;
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

  // live reload draft
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
    // legacy
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

  // watch wrapper width
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

  /* ===== Инициализация позиций по шаблону (без DOM) ===== */
  const [layoutAppliedHash, setLayoutAppliedHash] = useState<string | null>(
    () => (draft as any)?.editor?.sketchInitHash || null
  );

  useEffect(() => {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!r) return;

    const stageW = Math.max(1, r.width - SKETCH_PAD * 2);
    const stageH = Math.max(1, r.height - SKETCH_PAD * 2);

    const orientation: Orientation =
      (draft.size?.orientation as Orientation | undefined) ??
      ((draft as any).orientation as Orientation | undefined) ??
      (imgWH.w > imgWH.h ? "horizontal" : "vertical");

    const hash =
      [
        item?.url || "",
        orientation,
        peopleBlocks.map((p) => p.id).join(","),
        crosses.length,
        others.length,
        epitaphs.join("|"),
        Math.round(stageW),
        Math.round(stageH)
      ].join("::");

    // Если уже применяли для данного состояния — выходим
    if (layoutAppliedHash === hash) return;

    const layout = computeSketchLayout({
      stageW,
      stageH,
      orientation,
      people: peopleBlocks,
      crosses,
      graphics: others,
      epitaphs
    });

    if (layout.size === 0) return;

    // Применяем: обновляем существующие элементы (если есть в layout), отсутствующие — создаём.
    setElements((prev) => {
      const prevMap = new Map(prev.map((e) => [e.id, e]));
      const used = new Set<string>();
      const next: EditorEl[] = [];

      // Сначала — люди (сохраняем порядок z)
      peopleBlocks.forEach((p, i) => {
        for (const type of ["portrait", "metric"] as const) {
          const id = `${type}-${p.id}`;
          const box = layout.get(id);
          if (!box) return;
          used.add(id);
          const old = prevMap.get(id);
          const base: EditorEl = old
            ? { ...old, ...box }
            : {
                id,
                type,
                ...box,
                z: i * 10 + (type === "portrait" ? 1 : 2),
                title: id,
                ...(type === "portrait" ? { bw: true } : { uppercase: true })
              };
          next.push(base);
        }
      });

      // Эпитафии
      epitaphs.forEach((_, idx) => {
        const id = `epitaph-${idx}`;
        const box = layout.get(id);
        if (!box) return;
        used.add(id);
        const old = prevMap.get(id);
        next.push(
          old
            ? { ...old, ...box }
            : {
                id,
                type: "epitaph",
                ...box,
                z: 100 + idx,
                title: id,
                staircase: isRememberLoveMourn(epitaphs[idx]) ? true : undefined
              }
        );
      });

      // Кресты
      crosses.forEach((_, idx) => {
        const id = `cross-${idx}`;
        const box = layout.get(id);
        if (!box) return;
        used.add(id);
        const old = prevMap.get(id);
        next.push(
          old
            ? { ...old, ...box }
            : { id, type: "cross", ...box, z: 200 + idx, title: id }
        );
      });

      // Графика
      others.forEach((_, idx) => {
        const id = `graphic-${idx}`;
        const box = layout.get(id);
        if (!box) return;
        used.add(id);
        const old = prevMap.get(id);
        next.push(
          old
            ? { ...old, ...box }
            : { id, type: "graphic", ...box, z: 300 + idx, title: id, flipH: false }
        );
      });

      // Переносим любые старые элементы, которых нет в новом layout (например, пользовательские)
      prev.forEach((el) => {
        if (!used.has(el.id)) next.push(el);
      });

      return next;
    });

    setLayoutAppliedHash(hash);
    // Сохраняем хэш в драфт (чтобы не переинициализироваться при возврате)
    const prev = loadOrderDraft();
    saveOrderDraft({
      ...prev,
      editor: {
        ...(prev.editor || {}),
        sketchInitHash: hash,
        updatedAt: Date.now()
      }
    });
  }, [wrapperRef.current, item?.url, peopleBlocks, crosses, others, epitaphs, imgWH, draft?.size?.orientation, layoutAppliedHash]);

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
          ctx.font = `${el.italic ? "italic " : ""}${sizes[i] || sizes[sizes.length - 1]}px "Century Schoolbook","Times New Roman",serif`;
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
        ctx.font = `${el.italic ? "italic " : ""}${f}px "Century Schoolbook","Times New Roman",serif`;

        if (isRememberLoveMourn(text)) {
          const parts = text.split(",");
          const top = (parts[0] || "Помним").trim() + ",";
          const mid = (parts[1] || "любим").trim() + ",";
          const bot = (parts.slice(2).join(",") || "скорбим...").trim();
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
    }, 300) as unknown as number;

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

  /* ===== Мини-toolbar и контент ===== */
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

              if (isRememberLoveMourn(txt)) {
                const parts = txt.split(",");
                const top = (parts[0] || "Помним").trim() + ",";
                const mid = (parts[1] || "любим").trim() + ",";
                const bot = (parts.slice(2).join(",") || "скорбим...").trim();
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
      <div style={{ width: "100%", maxWidth: MAX_W, margin: "0 auto" }}>
        <TopBarWithIntro title="Memorial - редактор" />

        {/* Подсказка */}
        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Не старайтесь идеально расположить элементы, не страшно если они пересекаются или вызодят за край — эскиз схематичный. Исправьте ключевые позиции
          (крест слева/справа, направление бутонов, строчные/ПРОПИСНЫЕ) и опишите пожелания.
          Финальную обработку выполнит специалист.
        </section>

        {/* Эскиз */}
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

            {/* Контент поверх */}
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
                      {selected && (
                        <div
                          onPointerDown={(ev) => ev.stopPropagation()}
                          style={{
                            position: "absolute",
                            left: 0, top: -30,
                            display: "flex", gap: 6,
                            background: "rgba(0,0,0,0.6)",
                            border: "1px solid rgba(255,255,255,0.25)",
                            borderRadius: 6, padding: "2px 6px",
                            alignItems: "center",
                            pointerEvents: "auto", zIndex: 3000
                          }}
                        >
                          {el.type === "metric" && (
                            <button
                              type="button"
                              style={{ ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 }}
                              title={el.uppercase ? "Сделать строчные" : "Сделать ПРОПИСНЫЕ"}
                              onClick={() =>
                                setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, uppercase: !e.uppercase } : e)))
                              }
                            >
                              {el.uppercase ? "строчные" : "ПРОПИСНЫЕ"}
                            </button>
                          )}
                          {el.type === "epitaph" && isRememberLoveMourn(epitaphs[Number(el.id.split("-")[1])] || "") && (
                            <button
                              type="button"
                              style={{ ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 }}
                              title={el.staircase ? "Показать в одну строку" : "Показать лесенкой"}
                              onClick={() =>
                                setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, staircase: !e.staircase } : e)))
                              }
                            >
                              {el.staircase ? "В строку" : "Лесенкой"}
                            </button>
                          )}
                          {el.type === "graphic" && (
                            <button
                              type="button"
                              style={{ ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 }}
                              title="Отразить по горизонтали"
                              onClick={() =>
                                setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))
                              }
                            >
                              Отразить ⇄
                            </button>
                          )}
                        </div>
                      )}
                      {selected && !el.locked && (
                        <>
                          <div style={handleDot(0, 0, "nwse-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} />
                          <div style={handleDot("50%", 0, "ns-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} />
                          <div style={handleDot("100%", 0, "nesw-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} />
                          <div style={handleDot("100%", "50%", "ew-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} />
                          <div style={handleDot("100%", "100%", "nwse-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} />
                          <div style={handleDot("50%", "100%", "ns-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} />
                          <div style={handleDot(0, "100%", "nesw-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} />
                          <div style={handleDot(0, "50%", "ew-resize")} onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} />
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
