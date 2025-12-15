// src/screens/EditorStep.tsx
// Редактор по шаблонам из SketchTemplate: без мерцаний, с DnD/resize,
// предпросмотром и пожеланиями. Исправлено зацикливание обновлений:
// - refreshFromDraft не пишет в стор (только читает и синхронизирует state);
// - центральная подписка на события — стабильная (effect без deps + ref);
// - убраны ручные dispatch событий после сохранений;
// - запись в стор выполняется авто‑сейвом и по действиям пользователя.
// Визуальный слой эскиза строится компонентом SketchTemplate, сверху накладывается редактор (рамки/ручки).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import {
  loadOrderDraft,
  saveOrderDraft,
  type OrderDraft,
  DRAFT_UPDATED_EVENT
} from "../lib/order";

// Визуальный эскиз + пул шаблонов
import SketchTemplate from "../components/SketchTemplate";
import * as SketchComponent from "../components/SketchTemplate";
import { SketchTemplates as LibTemplates } from "../lib/sketchTemplates";

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
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type EditorEl = {
  id: string;
  type: ElType;
  x: number;
  y: number;
  w: number;
  h: number; // проценты
  z: number;
  title?: string;
  locked?: boolean;
  uppercase?: boolean;
  italic?: boolean;
  flipH?: boolean;
  bw?: boolean;
  staircase?: boolean;
};

type SketchTemplateType = {
  id: string;
  name: string;
  slots: {
    type: string;
    index?: number;
    rect: { x: number; y: number; w: number; h: number; padding?: number };
  }[];
};

/* ===== Helpers ===== */
const SKETCH_PAD = 8;
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 2, 100),
  h: clamp(h, 2, 100)
});
const SNAP_STEP_DEFAULT = 1;
const FONT_CENTURY = `"Century Schoolbook","Times New Roman",serif`;
const isCrossCategoryName = (s?: string) =>
  (s || "").toLowerCase().includes("крест") ||
  (s || "").toLowerCase().includes("cross");

function linesFromPerson(p: any) {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join(" ");
  const l3 = [p?.birthDate, p?.deathDate]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
const normRemember = (t?: string) =>
  (t || "")
    .toLowerCase()
    .replace(/[.,…!?:;]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
const isRememberLoveMourn = (t?: string) =>
  normRemember(t) === "помним любим скорбим";
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
  const bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим…").trim();
  return { top, mid, bot };
}

/* ===== Measuring helpers (для отрисовки превью) ===== */
let __measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (__measureCtx) return __measureCtx;
  const c = document.createElement("canvas");
  __measureCtx = c.getContext("2d");
  return __measureCtx!;
}
function setFontOnCtx(
  ctx: CanvasRenderingContext2D,
  italic: boolean,
  px: number,
  family: string
) {
  ctx.font = `${italic ? "italic " : ""}${Math.max(1, Math.round(px))}px ${family}`;
}
function measureTextAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  italic: boolean,
  family: string,
  sizePx: number
) {
  setFontOnCtx(ctx, italic, sizePx, family);
  return ctx.measureText(text).width;
}
function fitStairRLMFontPx({
  lines,
  boxW,
  boxH,
  italic,
  family,
  padX = 4,
  padY = 2,
  lineHeight = 1.15,
  minPx = 10,
  maxPx = 96
}: {
  lines: string[];
  boxW: number;
  boxH: number;
  italic: boolean;
  family: string;
  padX?: number;
  padY?: number;
  lineHeight?: number;
  minPx?: number;
  maxPx?: number;
}): number {
  const ctx = getMeasureCtx();
  const usableW = Math.max(8, boxW - padX * 2);
  const usableH = Math.max(8, boxH - padY * 2);
  const perLineH = usableH / Math.max(1, lines.length) / lineHeight;
  let fW = maxPx;
  for (const ln of lines.length ? lines : [" "]) {
    const w100 = Math.max(1, measureTextAt(ctx, ln, italic, family, 100));
    fW = Math.min(fW, (usableW * 100) / w100);
  }
  return clamp(Math.floor(Math.min(perLineH, fW, maxPx)), minPx, maxPx);
}
function fitMultilineFontPxGeneric({
  text,
  boxW,
  boxH,
  italic,
  family,
  padX = 4,
  padY = 2,
  lineHeight = 1.15,
  minPx = 10,
  maxPx = 96
}: {
  text: string;
  boxW: number;
  boxH: number;
  italic: boolean;
  family: string;
  padX?: number;
  padY?: number;
  lineHeight?: number;
  minPx?: number;
  maxPx?: number;
}) {
  const ctx = getMeasureCtx();
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const count = Math.max(1, lines.length);
  const usableW = Math.max(8, boxW - padX * 2);
  const usableH = Math.max(8, boxH - padY * 2);
  const fByH = usableH / (count * lineHeight);
  let fByW = maxPx;
  for (const ln of lines.length ? lines : [" "]) {
    const w100 = Math.max(1, measureTextAt(ctx, ln, italic, family, 100));
    const fLine = (usableW * 100) / w100;
    fByW = Math.min(fByW, fLine);
  }
  const fontPx = clamp(Math.floor(Math.min(fByH, fByW, maxPx)), minPx, maxPx);
  return { fontPx, lines: lines.length ? lines : [""] };
}
function fitMetricFontsPx({
  lines,
  boxW,
  boxH,
  italic,
  family,
  padX = 4,
  padY = 2,
  lineHeight = 1.12,
  minPx = 10,
  weights = [0.36, 0.3, 0.26]
}: {
  lines: string[];
  boxW: number;
  boxH: number;
  italic: boolean;
  family: string;
  padX?: number;
  padY?: number;
  lineHeight?: number;
  minPx?: number;
  weights?: number[];
}) {
  const ctx = getMeasureCtx();
  const L = Math.min(3, lines.length);
  if (L === 0) return [];
  const usableW = Math.max(8, boxW - padX * 2);
  const usableH = Math.max(8, boxH - padY * 2);
  const wSum = weights.slice(0, L).reduce((a, b) => a + b, 0);
  const baseByH = usableH / (lineHeight * wSum);
  const initial = Array.from({ length: L }, (_, i) => baseByH * weights[i]);
  let sW = 1;
  for (let i = 0; i < L; i++) {
    const ln = lines[i] || "";
    const w100 = Math.max(1, measureTextAt(ctx, ln, italic, family, 100));
    const maxFi = (usableW * 100) / w100;
    sW = Math.min(sW, maxFi / initial[i]);
  }
  return initial.map((sz) => Math.max(minPx, Math.floor(sz * sW)));
}

/* ===== Преобразование слотов SketchTemplate ===== */
type Norm = { x: number; y: number; w: number; h: number; padding?: number };
const toPct = (r: Norm): { x: number; y: number; w: number; h: number } => {
  const px = clamp(r.x * 100, 0, 100);
  const py = clamp(r.y * 100, 0, 100);
  const pw = clamp(r.w * 100, 0, 100);
  const ph = clamp(r.h * 100, 0, 100);
  return clampBox(px, py, Math.max(2, pw), Math.max(2, ph));
};
const unionNorm = (a?: Norm, b?: Norm): Norm | undefined => {
  if (!a && !b) return undefined;
  const A = a || b!;
  const B = b || a!;
  const left = Math.min(A.x, B.x),
    top = Math.min(A.y, B.y);
  const right = Math.max(A.x + A.w, B.x + B.w),
    bottom = Math.max(A.y + A.h, B.y + B.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
};

function slotsByType(tpl: SketchTemplateType, type: string) {
  return tpl.slots
    .filter((s) => s.type === type)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
function partitionSlot(base: Norm, count: number, direction: "v" | "h" = "v"): Norm[] {
  if (count <= 1) return [base];
  const out: Norm[] = [];
  for (let i = 0; i < count; i++) {
    if (direction === "v") {
      out.push({
        x: base.x,
        y: base.y + (base.h * i) / count,
        w: base.w,
        h: base.h / count
      });
    } else {
      out.push({
        x: base.x + (base.w * i) / count,
        y: base.y,
        w: base.w / count,
        h: base.h
      });
    }
  }
  return out;
}

/* ===== Компонент ===== */
type Props = {
  onBack?: () => void;
  onContinue?: (payload?: any) => void;
  onRearSide?: (payload?: any) => void;
  onSendOrder?: (payload?: any) => void;
};

export default function EditorStep({
  onBack,
  onContinue,
  onRearSide,
  onSendOrder
}: Props) {
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  const [outro, setOutro] = useState(false);

  const [elements, setElements] = useState<EditorEl[]>(
    () => ((draft as any)?.editor?.elements as EditorEl[]) || []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wishes, setWishes] = useState<string>(
    () => ((draft as any)?.editor?.wishes as string) || ""
  );

  const editorWrapRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  // Навигационные/сигнатурные рефы для детекции изменений
  const lastDataSigRef = useRef<string>("");
  const lastTemplateIdRef = useRef<string | null>(null);
  const isRefreshingRef = useRef(false);
  const lastStoreSigRef = useRef<string>("");

  // Стабильная ссылка на refresh для обработчиков (effect без deps)
  const refreshRef = useRef<(opts?: { force?: boolean }) => void>(() => {});

  // aspectRatio
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(
    () => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined),
    [imgWH]
  );

  // Источники
  const item = draft?.item || null;
  const engr: any = draft?.engraving || {};
  const graphics: any[] = Array.isArray(draft?.graphics)
    ? (draft.graphics as any[])
    : [];

  // Блоки людей
  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engr?.persons) && engr.persons.length > 0) {
      return engr.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo =
          p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
    const legacyLines: string[] = [];
    if (engr?.fullName) legacyLines.push(String(engr.fullName));
    const dates: string[] = [];
    if (engr?.birthDate) dates.push(String(engr.birthDate));
    if (engr?.deathDate) dates.push(String(engr.deathDate));
    if (dates.length) legacyLines.push(dates.join(" — "));
    if (Array.isArray(engr?.lines))
      legacyLines.push(...(engr.lines as string[]).filter(Boolean));
    const photo =
      engr?.photoPreview ||
      engr?.photoDataUrl ||
      engr?.photoUrl ||
      engr?.photo ||
      null;
    return legacyLines.length || photo
      ? [{ id: "legacy-0", lines: legacyLines, photo }]
      : [];
  }, [engr]);

  // Эпитафии — безопасно нормализуем массив и одиночную строку
  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) {
      return (engr.epitaphs as unknown[])
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter(Boolean) as string[];
    }
    const single =
      typeof engr?.epitaphText === "string" ? (engr.epitaphText as string).trim() : "";
    return single ? [single] : [];
  }, [engr?.epitaphs, engr?.epitaphText]);

  // Графика
  const crosses = useMemo(
    () =>
      graphics.filter(
        (g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)
      ),
    [graphics]
  );
  const others = useMemo(
    () =>
      graphics.filter(
        (g) =>
          !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)
      ),
    [graphics]
  );

  // Пул шаблонов для автоматической раскладки
  const TEMPLATE_POOL: SketchTemplateType[] = useMemo(() => {
    const maybe = (SketchComponent as any).TEMPLATES as
      | SketchTemplateType[]
      | undefined;
    return maybe && Array.isArray(maybe) && maybe.length > 0
      ? maybe
      : ((LibTemplates as unknown as SketchTemplateType[]) || []);
  }, []);
  const template: SketchTemplateType | null = useMemo(() => {
    const preferred =
      peopleBlocks.length > 1 ? "double_portrait" : "classic_single";
    return (
      TEMPLATE_POOL.find((t) => t.id === preferred) || TEMPLATE_POOL[0] || null
    );
  }, [peopleBlocks.length, TEMPLATE_POOL]);

  // ——— Компоновка по шаблону: массив (с сохранением флагов по id)
  const placeAllByTemplate = React.useCallback(
    (prev: EditorEl[]): EditorEl[] => {
      if (!template) return prev;
      const existById = new Map(prev.map((e) => [e.id, e]));
      const next: EditorEl[] = [];
      let z = 10;

      // Портреты
      const photoSlots = slotsByType(template, "photo");
      const photoRectsNorm: Norm[] =
        photoSlots.length >= peopleBlocks.length
          ? photoSlots.slice(0, peopleBlocks.length).map((s) => s.rect as Norm)
          : photoSlots.length > 0
          ? partitionSlot(photoSlots[0].rect as Norm, peopleBlocks.length, "h")
          : [];
      peopleBlocks.forEach((pb, i) => {
        const id = `portrait-${pb.id}`;
        const rn = photoRectsNorm[i];
        const rect = rn
          ? toPct(rn)
          : {
              x: 10 + (i * 80) / Math.max(1, peopleBlocks.length),
              y: 18,
              w: 30,
              h: 36
            };
        const old = existById.get(id);
        next.push({
          id,
          type: "portrait",
          ...clampBox(rect.x, rect.y, rect.w, rect.h),
          z: z++,
          bw: old?.bw ?? true,
          title: "Портрет"
        });
      });

      // Метрика
      const nameSlots = slotsByType(template, "personName");
      const dateSlots = slotsByType(template, "dates");
      const metricRectsNorm: Norm[] = peopleBlocks.map((_, i) => {
        const nm = (
          nameSlots.find((s) => (s.index ?? 0) === i) || nameSlots[i]
        )?.rect as Norm | undefined;
        const dt = (
          dateSlots.find((s) => (s.index ?? 0) === i) || dateSlots[i]
        )?.rect as Norm | undefined;
        return unionNorm(nm, dt) || nm || dt;
      });
      peopleBlocks.forEach((pb, i) => {
        const id = `metric-${pb.id}`;
        const rn = metricRectsNorm[i];
        const rect = rn
          ? toPct(rn)
          : {
              x: 8 + (i * 84) / Math.max(1, peopleBlocks.length),
              y: 56,
              w: 36,
              h: 18
            };
        const old = existById.get(id);
        next.push({
          id,
          type: "metric",
          ...clampBox(rect.x, rect.y, rect.w, rect.h),
          z: z++,
          uppercase: old?.uppercase ?? true,
          italic: old?.italic ?? false,
          title: "Метрика"
        });
      });

      // Эпитафии
      const epSlots = slotsByType(template, "epitaph");
      let epRectsNorm: Norm[] = [];
      if (epitaphs.length > 0) {
        if (epSlots.length >= epitaphs.length)
          epRectsNorm = epSlots
            .slice(0, epitaphs.length)
            .map((s) => s.rect as Norm);
        else if (epSlots.length === 1)
          epRectsNorm = partitionSlot(epSlots[0].rect as Norm, epitaphs.length, "v");
      }
      epitaphs.forEach((txt, i) => {
        const id = `epitaph-${i}`;
        const rn = epRectsNorm[i];
        const rect = rn
          ? toPct(rn)
          : {
              x: 10,
              y: 78 + i * 10,
              w: 80,
              h: 12
            };
        const old = existById.get(id);
        next.push({
          id,
          type: "epitaph",
          ...clampBox(rect.x, rect.y, rect.w, rect.h),
          z: 100 + i,
          uppercase: old?.uppercase ?? false,
          italic: old?.italic ?? false,
          staircase: old?.staircase ?? isRememberLoveMourn(txt),
          title: "Эпитафия"
        });
      });

      // Кресты
      const crossSlots = slotsByType(template, "cross");
      let crossRectsNorm: Norm[] = [];
      if (crosses.length > 0) {
        if (crossSlots.length >= crosses.length)
          crossRectsNorm = crossSlots
            .slice(0, crosses.length)
            .map((s) => s.rect as Norm);
        else if (crossSlots.length === 1)
          crossRectsNorm = partitionSlot(crossSlots[0].rect as Norm, crosses.length, "h");
      }
      for (let i = 0; i < crosses.length; i++) {
        const id = `cross-${i}`;
        const rn = crossRectsNorm[i];
        const rect = rn
          ? toPct(rn)
          : {
              x: 6 + i * 18,
              y: 5,
              w: 14,
              h: 14
            };
        next.push({
          id,
          type: "cross",
          ...clampBox(rect.x, rect.y, rect.w, rect.h),
          z: 200 + i,
          title: "Крест"
        });
      }

      // Прочая графика
      const decorSlots = template.slots
        .filter((s) => s.type === "decor" || s.type === "flower")
        .map((s) => s.rect as Norm);
      const decorRectsNorm: Norm[] =
        decorSlots.length >= others.length
          ? decorSlots.slice(0, others.length)
          : decorSlots.length === 1
          ? partitionSlot(decorSlots[0], others.length, "h")
          : [];
      for (let i = 0; i < others.length; i++) {
        const id = `graphic-${i}`;
        const rn = decorRectsNorm[i];
        const rect = rn
          ? toPct(rn)
          : {
              x: 12 + i * 22,
              y: 86,
              w: 20,
              h: 12
            };
        const old = existById.get(id);
        next.push({
          id,
          type: "graphic",
          ...clampBox(rect.x, rect.y, rect.w, rect.h),
          z: 300 + i,
          flipH: old?.flipH ?? false,
          title: "Графика"
        });
      }

      return next;
    },
    [template, peopleBlocks, epitaphs, crosses, others]
  );

  // ——— Удаление «осиротевших» элементов
  const pruneOrphans = React.useCallback(
    (els: EditorEl[]): EditorEl[] => {
      const personIds = new Set(peopleBlocks.map((p) => p.id));
      const validEpitaphIdx = epitaphs.map((_, i) => i);
      const validCrossIdx = crosses.map((_, i) => i);
      const validGraphicIdx = others.map((_, i) => i);

      const isValid = (e: EditorEl): boolean => {
        if (e.type === "portrait") {
          const pid = e.id.replace(/^portrait-/, "");
          return personIds.has(pid);
        }
        if (e.type === "metric") {
          const pid = e.id.replace(/^metric-/, "");
          return personIds.has(pid);
        }
        if (e.type === "epitaph") {
          const idx = Number(e.id.replace(/^epitaph-/, ""));
          return Number.isFinite(idx) && validEpitaphIdx.includes(idx);
        }
        if (e.type === "cross") {
          const idx = Number(e.id.replace(/^cross-/, ""));
          return Number.isFinite(idx) && validCrossIdx.includes(idx);
        }
        if (e.type === "graphic") {
          const idx = Number(e.id.replace(/^graphic-/, ""));
          return Number.isFinite(idx) && validGraphicIdx.includes(idx);
        }
        return true;
      };

      return els.filter(isValid);
    },
    [peopleBlocks, epitaphs, crosses, others]
  );

  // ——— Сигнатура состава данных (для принятия решения о пересборке)
  const dataSignature = useMemo(() => {
    const tp = template?.id || "none";
    const ppl = peopleBlocks.map((p) => p.id).join(",");
    const ep = epitaphs.join("||");
    const cr = String(crosses.length);
    const ot = String(others.length);
    return [tp, ppl, ep, cr, ot].join("::");
  }, [template?.id, peopleBlocks, epitaphs, crosses.length, others.length]);

  // ——— Рефреш из стора (без записи в стор!) — только синхронизация state
  const refreshFromDraft = React.useCallback(
    (opts?: { force?: boolean }) => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      try {
        const fresh = loadOrderDraft();

        // сравним значимые части стора, чтобы не дергать setDraft без нужды
        const storePick = {
          item: fresh?.item || null,
          engraving: fresh?.engraving || null,
          graphics: fresh?.graphics || null
        };
        const newSig = JSON.stringify(storePick);
        if (newSig !== lastStoreSigRef.current) {
          setDraft(fresh);
          lastStoreSigRef.current = newSig;
        }

        const currentEls = elements;
        const incomingEls: EditorEl[] =
          (((fresh as any)?.editor?.elements || []) as EditorEl[]) || [];
        const incomingWishes: string =
          (((fresh as any)?.editor?.wishes || "") as string) || "";

        const templateIdChanged =
          (template?.id || null) !== lastTemplateIdRef.current;
        const dataChanged = dataSignature !== lastDataSigRef.current;

        // 1) Подхват внешних изменений (только в state)
        let baseEls = opts?.force
          ? incomingEls
          : JSON.stringify(incomingEls) !== JSON.stringify(currentEls)
          ? incomingEls
          : currentEls;

        // 2) Чистка осиротевших
        const pruned = pruneOrphans(baseEls);

        // 3) Пересборка по шаблону при изменениях структуры/шаблона
        let finalEls = pruned;
        if (opts?.force || templateIdChanged || dataChanged) {
          finalEls = placeAllByTemplate(pruned);
        }

        // 4) Применить к state, но НЕ сохранять здесь (автосейв сделает это сам)
        const shouldSetEls =
          JSON.stringify(finalEls) !== JSON.stringify(currentEls);
        const shouldSetWishes =
          wishes !== incomingWishes &&
          (opts?.force ||
            JSON.stringify(incomingEls) !== JSON.stringify(currentEls));

        if (shouldSetEls) setElements(finalEls);
        if (shouldSetWishes) setWishes(incomingWishes || "");

        // обновим маркеры
        lastTemplateIdRef.current = template?.id || null;
        lastDataSigRef.current = dataSignature;
      } finally {
        isRefreshingRef.current = false;
      }
    },
    [elements, wishes, template?.id, dataSignature, pruneOrphans, placeAllByTemplate]
  );

  // ——— Стабилизируем ссылку на refresh, чтобы подписка была с пустыми deps
  useEffect(() => {
    refreshRef.current = refreshFromDraft;
  }, [refreshFromDraft]);

  // ——— Принудительная пересборка по шаблону (только state, без записи)
  const applyTemplateStrict = React.useCallback(() => {
    const built = placeAllByTemplate(elements);
    const changed = JSON.stringify(built) !== JSON.stringify(elements);
    if (changed) {
      setElements(built);
    }
    lastTemplateIdRef.current = template?.id || null;
    lastDataSigRef.current = dataSignature;
  }, [elements, template?.id, dataSignature, placeAllByTemplate]);

  // Первичный запуск/смена шаблона/структуры — пересборка
  useEffect(() => {
    const needTemplate =
      !elements?.length ||
      (template?.id || null) !== lastTemplateIdRef.current ||
      dataSignature !== lastDataSigRef.current;
    if (template && needTemplate) {
      applyTemplateStrict();
    }
  }, [template, dataSignature, elements?.length, applyTemplateStrict]);

  // Централизованная подписка (один раз): любые события → refreshFromDraft (без записи)
  useEffect(() => {
    const onAny = () => refreshRef.current();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };

    window.addEventListener(DRAFT_UPDATED_EVENT, onAny as any);
    window.addEventListener("storage", onAny);
    window.addEventListener("memorial:orderDraftUpdated", onAny as any);

    window.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onAny);
    window.addEventListener("pageshow", onAny as any);
    window.addEventListener("popstate", onAny);
    window.addEventListener("hashchange", onAny);

    // первичный форс-рефреш — привести state в консистентный вид
    refreshRef.current({ force: true });

    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onAny as any);
      window.removeEventListener("storage", onAny);
      window.removeEventListener("memorial:orderDraftUpdated", onAny as any);

      window.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onAny);
      window.removeEventListener("pageshow", onAny as any);
      window.removeEventListener("popstate", onAny);
      window.removeEventListener("hashchange", onAny);
    };
  }, []);

  /* ===== DnD / Resize с RAF‑троттлингом ===== */
  const dragRef = useRef<{
    id: string;
    mode:
      | "move"
      | "nw"
      | "n"
      | "ne"
      | "e"
      | "se"
      | "s"
      | "sw"
      | "w";
    startX: number;
    startY: number;
    start: EditorEl;
  } | null>(null);

  const rafMoveScheduled = useRef(false);
  const rafMovePayload = useRef<{ id: string; next: EditorEl } | null>(null);

  const scheduleMoveCommit = () => {
    if (rafMoveScheduled.current) return;
    rafMoveScheduled.current = true;
    requestAnimationFrame(() => {
      rafMoveScheduled.current = false;
      const payload = rafMovePayload.current;
      if (!payload) return;
      setElements((prev) =>
        prev.map((el) => (el.id === payload.id ? payload.next : el))
      );
      rafMovePayload.current = null;
    });
  };

  const onPointerDownBox = (
    e: React.PointerEvent,
    id: string,
    mode:
      | "move"
      | "nw"
      | "n"
      | "ne"
      | "e"
      | "se"
      | "s"
      | "sw"
      | "w" = "move"
  ) => {
    e.stopPropagation();
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...el }
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const rect = editorWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const contentW = rect.width - SKETCH_PAD * 2;
    const contentH = rect.height - SKETCH_PAD * 2;
    if (contentW <= 0 || contentH <= 0) return;

    const dxPct = ((e.clientX - d.startX) / contentW) * 100;
    const dyPct = ((e.clientY - d.startY) / contentH) * 100;

    const keepRatio = e.shiftKey;
    const snap = (v: number, step = SNAP_STEP_DEFAULT) =>
      Math.round(v / step) * step;

    const base = d.start;
    let nx = base.x,
      ny = base.y,
      nw = base.w,
      nh = base.h;

    if (d.mode === "move") {
      nx = snap(base.x + dxPct);
      ny = snap(base.y + dyPct);
    } else {
      const ratio = (base.w || 1) / (base.h || 1);
      if (d.mode.includes("e")) nw = snap(base.w + dxPct);
      if (d.mode.includes("s")) nh = snap(base.h + dyPct);
      if (d.mode.includes("w")) {
        nx = snap(base.x + dxPct);
        nw = snap(base.w - dxPct);
      }
      if (d.mode.includes("n")) {
        ny = snap(base.y + dyPct);
        nh = snap(base.h - dyPct);
      }
      if (keepRatio) {
        if (["e", "w"].some((s) => d.mode.includes(s))) nh = nw / ratio;
        if (["n", "s"].some((s) => d.mode.includes(s))) nw = nh * ratio;
      }
    }

    const clamped = clampBox(nx, ny, nw, nh);
    const nextEl: EditorEl = { ...base, ...clamped };

    rafMovePayload.current = { id: d.id, next: nextEl };
    scheduleMoveCommit();
  };

  const onPointerUp = () => {
    if (dragRef.current) {
      const cur = loadOrderDraft();
      const latest = elements;
      saveOrderDraft({
        ...cur,
        editor: {
          ...(cur as any).editor,
          elements: latest,
          wishes,
          updatedAt: Date.now()
        }
      });
      queuePreviewGeneration();
    }
    dragRef.current = null;
  };

  /* ===== Превью в драфт ===== */
  const queuePreviewGeneration = () => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(async () => {
      const wrap = editorWrapRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const pad = SKETCH_PAD;

      async function drawPreview(
        W: number,
        H: number
      ): Promise<string | null> {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(W));
        canvas.height = Math.max(1, Math.floor(H));
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        // фон
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#6e6e6e");
        grad.addColorStop(0.2, "#464545");
        grad.addColorStop(0.4, "#424242");
        grad.addColorStop(0.7, "#888888");
        grad.addColorStop(1.0, "#ffffff");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // изделие
        const base = await new Promise<HTMLImageElement | null>((resolve) => {
          const url = item?.url || "";
          if (!url) return resolve(null);
          const i = new Image();
          i.crossOrigin = "anonymous";
          i.loading = "eager";
          (i as any).fetchpriority = "high";
          i.decoding = "sync";
          i.onload = () => resolve(i);
          i.onerror = () => resolve(null);
          i.src = url;
        });

        const CX = pad,
          CY = pad,
          PW = W - pad * 2,
          PH = H - pad * 2;
        if (base) {
          const sr = base.width / base.height,
            dr = PW / PH;
          ctx.globalAlpha = 0.35;
          if (sr > dr) {
            const rw = PW,
              rh = Math.round(PW / sr),
              rx = CX,
              ry = CY + Math.round((PH - rh) / 2);
            ctx.drawImage(base, rx, ry, rw, rh);
          } else {
            const rh = PH,
              rw = Math.round(PH * sr),
              ry = CY,
              rx = CX + Math.round((PW - rw) / 2);
            ctx.drawImage(base, rx, ry, rw, rh);
          }
          ctx.globalAlpha = 1;
        }

        const fam = FONT_CENTURY;
        const safeIndex = (raw: string, max: number) => {
          const n = parseInt(raw, 10);
          if (!Number.isFinite(n) || n < 0) return 0;
          return Math.min(n, Math.max(0, max - 1));
        };

        for (const el of elements.slice().sort((a, b) => a.z - b.z)) {
          const rbox = {
            x: CX + (el.x / 100) * PW,
            y: CY + (el.y / 100) * PH,
            w: (el.w / 100) * PW,
            h: (el.h / 100) * PH
          };
          const key = el.id.split("-").slice(1).join("-");
          if (el.type === "portrait") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const url = p?.photo || "";
            if (!url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => {
              const i = new Image();
              i.crossOrigin = "anonymous";
              i.loading = "eager";
              (i as any).fetchpriority = "low";
              i.decoding = "async";
              i.onload = () => resolve(i);
              i.onerror = () => resolve(null);
              i.src = url;
            });
            if (!im) continue;
            const sr2 = im.width / im.height,
              dr2 = rbox.w / rbox.h;
            ctx.save();
            ctx.beginPath();
            ctx.rect(rbox.x, rbox.y, rbox.w, rbox.h);
            ctx.clip();
            if (el.bw) ctx.filter = "grayscale(100%)";
            if (sr2 > dr2) {
              const hh = rbox.h,
                ww = Math.round(hh * sr2),
                xx = Math.round(rbox.x + (rbox.w - ww) / 2),
                yy = rbox.y;
              ctx.drawImage(im, xx, yy, ww, hh);
            } else {
              const ww = rbox.w,
                hh = Math.round(ww / sr2),
                xx = rbox.x,
                yy = Math.round(rbox.y + (rbox.h - hh) / 2);
              ctx.drawImage(im, xx, yy, ww, hh);
            }
            ctx.restore();
            ctx.filter = "none";
          } else if (el.type === "metric") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
            const tf = el.uppercase
              ? (s: string) => s.toUpperCase()
              : (s: string) => s;
            ctx.save();
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04)),
              padY2 = Math.max(2, Math.round(rbox.h * 0.1));
            const fitted = fitMetricFontsPx({
              lines: lines.map(tf),
              boxW: rbox.w,
              boxH: rbox.h,
              italic: !!el.italic,
              family: fam,
              padX: padX2,
              padY: padY2,
              lineHeight: 1.12,
              minPx: 10
            });
            const totalH = fitted.reduce((a, b) => a + b * 1.12, 0);
            let y =
              rbox.y +
              (rbox.h - totalH) / 2 +
              ((fitted[0] || 10) * 1.12) / 2;
            for (let i = 0; i < fitted.length; i++) {
              setFontOnCtx(ctx, !!el.italic, fitted[i], fam);
              ctx.fillText(tf(lines[i]), rbox.x + rbox.w / 2, y);
              y += fitted[i] * 1.12;
            }
            ctx.restore();
          } else if (el.type === "epitaph") {
            const idx = safeIndex(key, epitaphs.length);
            const tRaw = epitaphs[idx] || "";
            const isRLM = isRememberLoveMourn(tRaw);
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04)),
              padY2 = Math.max(2, Math.round(rbox.h * 0.06));
            ctx.save();
            ctx.fillStyle = "#fff";
            ctx.textBaseline = "middle";
            if (isRLM && el.staircase) {
              const r = splitRememberPreserve(tRaw);
              const parts = [r.top, r.mid, r.bot];
              const fontPx = fitStairRLMFontPx({
                lines: parts,
                boxW: rbox.w,
                boxH: rbox.h,
                italic: !!el.italic,
                family: FONT_CENTURY,
                padX: padX2,
                padY: padY2,
                lineHeight: 1.15,
                minPx: 10,
                maxPx: 96
              });
              setFontOnCtx(ctx, !!el.italic, fontPx, FONT_CENTURY);
              const slotH = (rbox.h - padY2 * 2) / 3;
              ctx.textAlign = "left";
              ctx.fillText(
                parts[0],
                rbox.x + padX2,
                rbox.y + padY2 + slotH * 0.5
              );
              ctx.textAlign = "center";
              ctx.fillText(
                parts[1],
                rbox.x + rbox.w / 2,
                rbox.y + padY2 + slotH * 1.5
              );
              ctx.textAlign = "right";
              ctx.fillText(
                parts[2],
                rbox.x + rbox.w - padX2,
                rbox.y + padY2 + slotH * 2.5
              );
            } else {
              const { fontPx } = fitMultilineFontPxGeneric({
                text: tRaw,
                boxW: rbox.w,
                boxH: rbox.h,
                italic: !!el.italic,
                family: FONT_CENTURY,
                padX: padX2,
                padY: padY2,
                lineHeight: 1.15
              });
              setFontOnCtx(ctx, !!el.italic, fontPx, FONT_CENTURY);
              ctx.textAlign = "center";
              ctx.fillText(
                el.uppercase ? tRaw.toUpperCase() : tRaw,
                rbox.x + rbox.w / 2,
                rbox.y + rbox.h / 2
              );
            }
            ctx.restore();
          } else if (el.type === "graphic" || el.type === "cross") {
            const idx = Number(key);
            const list = el.type === "cross" ? crosses : others;
            const g = Number.isFinite(idx) ? list[idx] : null;
            if (!g?.url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => {
              const i = new Image();
              i.crossOrigin = "anonymous";
              i.loading = "eager";
              (i as any).fetchpriority = "low";
              i.decoding = "async";
              i.onload = () => resolve(i);
              i.onerror = () => resolve(null);
              i.src = g.url;
            });
            if (!im) continue;
            ctx.save();
            if (el.type === "graphic" && el.flipH) {
              ctx.translate(rbox.x + rbox.w / 2, rbox.y + rbox.h / 2);
              ctx.scale(-1, 1);
              ctx.translate(
                -(rbox.x + rbox.w / 2),
                -(rbox.y + rbox.h / 2)
              );
            }
            const sr2 = im.width / im.height,
              dr2 = rbox.w / rbox.h;
            if (sr2 > dr2) {
              const ww = rbox.w,
                hh = Math.round(ww / sr2),
                xx = rbox.x,
                yy = Math.round(rbox.y + (rbox.h - hh) / 2);
              ctx.drawImage(im, xx, yy, ww, hh);
            } else {
              const hh = rbox.h,
                ww = Math.round(hh * sr2),
                xx = rbox.x + Math.round((rbox.w - ww) / 2),
                yy = rbox.y;
              ctx.drawImage(im, xx, yy, ww, hh);
            }
            ctx.restore();
          }
        }
        return canvas.toDataURL("image/jpeg", 0.9);
      }

      const mini = await drawPreview(
        Math.max(320, Math.floor(r.width)),
        Math.max(320, Math.floor(r.height))
      );
      const maxSide = 1600,
        ratio = r.width / Math.max(1, r.height);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await drawPreview(bigW, bigH);

      const cur = loadOrderDraft();
      saveOrderDraft({
        ...cur,
        editor: {
          ...(cur as any).editor,
          previewUrl: mini || (cur as any).editor?.previewUrl || null,
          previewHiUrl: big || (cur as any).editor?.previewHiUrl || null,
          previewUpdatedAt: Date.now(),
          elements,
          wishes
        }
      });
    }, 300) as unknown as number;
  };

  // Автосохранение и превью при изменениях (без ручных dispatch)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const cur = loadOrderDraft();
      saveOrderDraft({
        ...cur,
        editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() }
      });
    }, 200) as unknown as number;
    queuePreviewGeneration();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [elements, wishes]);

  // aspectRatio для изделия
  useEffect(() => {
    if (!item?.url) return;
    const im = new Image();
    im.onload = () =>
      setImgWH({ w: im.naturalWidth || 4, h: im.naturalHeight || 3 });
    im.onerror = () => setImgWH({ w: 4, h: 3 });
    im.loading = "eager";
    (im as any).fetchpriority = "high";
    (im as any).decoding = "sync";
    im.src = item.url;
  }, [item?.url]);

  /* ===== Мини‑панель инструментов ===== */
  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = {
      ...glassButtonStyle("nano"),
      padding: "2px 6px",
      fontSize: 11
    };
    const stop = (e: React.PointerEvent | React.MouseEvent) => {
      e.stopPropagation();
    };

    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
    const isPortrait = el.type === "portrait";

    let canStair = false;
    if (isEpitaph) {
      const idx = Number(el.id.split("-")[1]);
      const tRaw = Number.isFinite(idx) ? epitaphs[idx] || "" : "";
      canStair = isRememberLoveMourn(tRaw);
    }

    return (
      <div
        onPointerDown={stop}
        onMouseDown={stop}
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
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              setElements((prev) =>
                prev.map((x) =>
                  x.id === el.id ? { ...x, uppercase: !x.uppercase } : x
                )
              );
            }}
          >
            {el.uppercase ? "строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}
        {isEpitaph && (
          <>
            <button
              type="button"
              style={btn}
              onPointerDown={stop}
              onMouseDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                setElements((prev) =>
                  prev.map((x) =>
                    x.id === el.id ? { ...x, italic: !x.italic } : x
                  )
                );
              }}
            >
              {el.italic ? "Обычный" : "Курсив"}
            </button>
            {canStair && (
              <button
                type="button"
                style={btn}
                onPointerDown={stop}
                onMouseDown={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  setElements((prev) =>
                    prev.map((x) =>
                      x.id === el.id
                        ? { ...x, staircase: !x.staircase }
                        : x
                    )
                  );
                }}
              >
                {el.staircase ? "В строку" : "Лесенкой"}
              </button>
            )}
          </>
        )}
        {isGraphic && (
          <button
            type="button"
            style={btn}
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              setElements((prev) =>
                prev.map((x) =>
                  x.id === el.id ? { ...x, flipH: !x.flipH } : x
                )
              );
            }}
          >
            Отразить ⇄
          </button>
        )}
        {isPortrait && (
          <button
            type="button"
            style={btn}
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={(e) => {
              e.stopPropagation();
              setElements((prev) =>
                prev.map((x) => (x.id === el.id ? { ...x, bw: !x.bw } : x))
              );
            }}
          >
            {el.bw ? "Цвет" : "Ч/Б"}
          </button>
        )}
      </div>
    );
  };

  const MAX_W = 600;

  // Ручки ресайза
  const KNOB_HIT = 28;
  const KNOB_VIS = 14;
  const knob = (left: string, top: string, cursor: string) =>
    ({
      position: "absolute",
      left,
      top,
      width: KNOB_HIT,
      height: KNOB_HIT,
      cursor,
      pointerEvents: "auto",
      display: "grid",
      placeItems: "center"
    } as React.CSSProperties);
  const knobDot: React.CSSProperties = {
    width: KNOB_VIS,
    height: KNOB_VIS,
    background: "#fff",
    border: "1px solid #000",
    borderRadius: 3,
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)"
  };

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
        <TopBarWithIntro title="Memorial" />

        <section
          style={{
            ...glassPanelStyle(),
            padding: "10px 12px",
            margin: "8px 0",
            fontSize: 13,
            lineHeight: 1.4
          }}
        >
          Схематично разместите элементы по шаблону. Финальную раскладку выполнит
          специалист. Укажите порядок и выравнивание (верх/низ, лево/право).
        </section>

        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={editorWrapRef}
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
            {/* Визуальный слой эскиза (по шаблонам) */}
            <div
              style={{
                position: "absolute",
                left: SKETCH_PAD,
                top: SKETCH_PAD,
                width: `calc(100% - ${SKETCH_PAD * 2}px)`,
                height: `calc(100% - ${SKETCH_PAD * 2}px)`,
                pointerEvents: "none"
              }}
            >
              <SketchTemplate
                item={item}
                peopleBlocks={peopleBlocks}
                crosses={crosses}
                others={others}
                epitaphs={epitaphs}
                carvingOpacity={0.35}
              />
            </div>

            {/* невидимая картинка для измерения пропорций */}
            <img
              src={item?.url || ""}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none"
              }}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight)
                  setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => {
                if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 });
              }}
            />

            {/* Рамки + ручки (редактор) */}
            <div
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSelectedId(null);
              }}
              style={{
                position: "absolute",
                left: SKETCH_PAD,
                top: SKETCH_PAD,
                right: SKETCH_PAD,
                bottom: SKETCH_PAD,
                zIndex: 1001,
                pointerEvents: "auto"
              }}
            >
              {elements
                .slice()
                .sort((a, b) => a.z - b.z)
                .map((el) => {
                  const selected = el.id === selectedId;
                  const frameStyle: React.CSSProperties = {
                    position: "absolute",
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.w}%`,
                    height: `${el.h}%`,
                    border: selected
                      ? "2px solid #8ab4ff"
                      : "1px dashed rgba(255,255,255,0.85)",
                    borderRadius: 4,
                    boxSizing: "border-box",
                    background: "transparent",
                    pointerEvents: "auto",
                    cursor: el.locked ? "not-allowed" : "move",
                    touchAction: "none"
                  };
                  return (
                    <div
                      key={el.id}
                      onPointerDown={(ev) => onPointerDownBox(ev, el.id, "move")}
                      style={frameStyle}
                      title={el.title || el.id}
                    >
                      {selected && <MiniToolbar el={el} />}
                      {selected && !el.locked && (
                        <>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "nw")
                            }
                            style={knob(`-${KNOB_HIT / 2}px`, `-${KNOB_HIT / 2}px`, "nwse-resize")}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "ne")
                            }
                            style={knob(
                              `calc(100% - ${KNOB_HIT / 2}px)`,
                              `-${KNOB_HIT / 2}px`,
                              "nesw-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "se")
                            }
                            style={knob(
                              `calc(100% - ${KNOB_HIT / 2}px)`,
                              `calc(100% - ${KNOB_HIT / 2}px)`,
                              "nwse-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "sw")
                            }
                            style={knob(
                              `-${KNOB_HIT / 2}px`,
                              `calc(100% - ${KNOB_HIT / 2}px)`,
                              "nesw-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "n")
                            }
                            style={knob(
                              `calc(50% - ${KNOB_HIT / 2}px)`,
                              `-${KNOB_HIT / 2}px`,
                              "ns-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "e")
                            }
                            style={knob(
                              `calc(100% - ${KNOB_HIT / 2}px)`,
                              `calc(50% - ${KNOB_HIT / 2}px)`,
                              "ew-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "s")
                            }
                            style={knob(
                              `calc(50% - ${KNOB_HIT / 2}px)`,
                              `calc(100% - ${KNOB_HIT / 2}px)`,
                              "ns-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
                          <div
                            onPointerDown={(ev) =>
                              onPointerDownBox(ev as any, el.id, "w")
                            }
                            style={knob(
                              `-${KNOB_HIT / 2}px`,
                              `calc(50% - ${KNOB_HIT / 2}px)`,
                              "ew-resize"
                            )}
                          >
                            <div style={knobDot} />
                          </div>
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
          <label
            htmlFor="wishes"
            style={{ display: "block", marginBottom: 6, opacity: 0.9 }}
          >
            Пожелания по эскизу
          </label>
          <textarea
            id="wishes"
            value={wishes}
            onChange={(e) => setWishes(e.target.value)}
            rows={4}
            placeholder="Например: портрет уменьшить, метрику сузить, эпитафию — лесенкой…"
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
              padding: 10,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box"
            }}
          />
        </section>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            margin: "10px 0",
            flexWrap: "wrap"
          }}
        >
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>
            Назад
          </button>
          <button
            type="button"
            onClick={handleContinue}
            style={glassButtonStyle("sm")}
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
