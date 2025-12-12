// src/screens/EditorStep.tsx
// Редактор с нуля: точная раскладка по SketchTemplate, без мерцаний,
// с сохранением прежнего функционала (DnD, resize, предпросмотр, пожелания).
//
// Дополнено:
// - Надёжная синхронизация при переходах и внешних изменениях драфта:
//   • Реконсиляция элементов (reconcileElements) при изменении людей/эпитафий/графики/шаблона,
//     а также по сигналам focus/pageshow/visibilitychange/DRAFT_UPDATED_EVENT.
//   • Удаляем «осиротевшие» рамки, добиваемся полноты состава (добавляем отсутствующие).
//   • При смене состава (людей/эпитафий/графики/шаблона) — умное перестроение:
//       частично: добавляем/удаляем без сдвига существующих,
//       полностью: если структура сильно изменилась — перекладываем всё по шаблону.
// - После реконсиляции сразу сохраняем в драфт и регенерируем превью.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft, type OrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

// Шаблоны из компонента (с фолбэком на lib)
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
  x: number; y: number; w: number; h: number;
  z: number;
  title?: string;
  locked?: boolean;
  uppercase?: boolean;
  italic?: boolean;
  flipH?: boolean;
  bw?: boolean;
  staircase?: boolean;
};

type SketchTemplate = {
  id: string;
  name: string;
  slots: { type: string; index?: number; rect: { x: number; y: number; w: number; h: number; padding?: number } }[];
};

/* ===== Helpers ===== */
const SKETCH_PAD = 8;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 2, 100),
  h: clamp(h, 2, 100)
});
const SNAP_STEP_DEFAULT = 1;
const FONT_CENTURY = `"Century Schoolbook","Times New Roman",serif`;
const isCrossCategoryName = (s?: string) => (s || "").toLowerCase().includes("крест") || (s || "").toLowerCase().includes("cross");

function linesFromPerson(p: any) {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
const normRemember = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim();
const isRememberLoveMourn = (t?: string) => normRemember(t) === "помним любим скорбим";
function splitRememberPreserve(text: string) {
  const t = (text || "").trim();
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    buf += ch;
    if (ch === ",") { parts.push(buf.trim()); buf = ""; }
  }
  if (buf.trim()) parts.push(buf.trim());
  const top = parts[0] || "Помним,";
  const mid = parts[1] || "любим,";
  const bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим…").trim();
  return { top, mid, bot };
}

/* ===== Measure helpers ===== */
let __measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (__measureCtx) return __measureCtx;
  const c = document.createElement("canvas");
  __measureCtx = c.getContext("2d");
  return __measureCtx!;
}
function setFontOnCtx(ctx: CanvasRenderingContext2D, italic: boolean, px: number, family: string) {
  ctx.font = `${italic ? "italic " : ""}${Math.max(1, Math.round(px))}px ${family}`;
}
function measureTextAt(ctx: CanvasRenderingContext2D, text: string, italic: boolean, family: string, sizePx: number) {
  setFontOnCtx(ctx, italic, sizePx, family);
  return ctx.measureText(text).width;
}
function fitStairRLMFontPx({
  lines, boxW, boxH, italic, family, padX = 4, padY = 2, lineHeight = 1.15, minPx = 10, maxPx = 96
}: {
  lines: string[]; boxW: number; boxH: number; italic: boolean; family: string;
  padX?: number; padY?: number; lineHeight?: number; minPx?: number; maxPx?: number;
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
  text, boxW, boxH, italic, family, padX = 4, padY = 2, lineHeight = 1.15, minPx = 10, maxPx = 96
}: {
  text: string; boxW: number; boxH: number; italic: boolean; family: string; padX?: number; padY?: number; lineHeight?: number; minPx?: number; maxPx?: number;
}) {
  const ctx = getMeasureCtx();
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
  lines, boxW, boxH, italic, family, padX = 4, padY = 2, lineHeight = 1.12, minPx = 10, weights = [0.36, 0.30, 0.26]
}: {
  lines: string[]; boxW: number; boxH: number; italic: boolean; family: string; padX?: number; padY?: number; lineHeight?: number; minPx?: number; weights?: number[];
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
  const left = Math.min(A.x, B.x), top = Math.min(A.y, B.y);
  const right = Math.max(A.x + A.w, B.x + B.w), bottom = Math.max(A.y + A.h, B.y + B.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
};

function slotsByType(tpl: SketchTemplate, type: string) {
  return tpl.slots
    .filter(s => s.type === type)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
function partitionSlot(base: Norm, count: number, direction: "v" | "h" = "v"): Norm[] {
  if (count <= 1) return [base];
  const out: Norm[] = [];
  for (let i = 0; i < count; i++) {
    if (direction === "v") {
      out.push({ x: base.x, y: base.y + base.h * (i / count), w: base.w, h: base.h / count });
    } else {
      out.push({ x: base.x + base.w * (i / count), y: base.y, w: base.w / count, h: base.h });
    }
  }
  return out;
}

/* ===== Компонент ===== */
type Props = { onBack?: () => void; onContinue?: (payload?: any) => void; onRearSide?: (payload?: any) => void; onSendOrder?: (payload?: any) => void; };

export default function EditorStep({ onBack, onContinue, onRearSide, onSendOrder }: Props) {
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  const [outro, setOutro] = useState(false);

  const [elements, setElements] = useState<EditorEl[]>(() => (draft as any)?.editor?.elements || []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wishes, setWishes] = useState<string>(() => (draft as any)?.editor?.wishes || "");

  const editorWrapRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  const rafMoveScheduled = useRef(false);
  const rafMovePayload = useRef<{ id: string; next: EditorEl } | null>(null);

  // aspectRatio
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(() => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined), [imgWH]);

  // Источники
  const item = draft?.item || null;
  const engr: any = draft?.engraving || {};
  const graphics: any[] = Array.isArray(draft?.graphics) ? (draft.graphics as any[]) : [];

  // Блоки людей
  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engr?.persons) && engr.persons.length > 0) {
      return engr.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
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

  // Эпитафии
  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) return (engr.epitaphs as string[]).filter(Boolean);
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim()) return [engr.epitaphText.trim()];
    return [];
  }, [engr]);

  // Графика
  const crosses = useMemo(() => graphics.filter((g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)), [graphics]);
  const others = useMemo(() => graphics.filter((g) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)), [graphics]);

  // Шаблон: из компонента (фолбэк на lib)
  const TEMPLATE_POOL: SketchTemplate[] = useMemo(() => {
    const maybe = (SketchComponent as any).TEMPLATES as SketchTemplate[] | undefined;
    return maybe && Array.isArray(maybe) && maybe.length > 0 ? maybe : (LibTemplates as unknown as SketchTemplate[]);
  }, []);
  const template: SketchTemplate | null = useMemo(() => {
    const preferred = peopleBlocks.length > 1 ? "double_portrait" : "classic_single";
    return TEMPLATE_POOL.find(t => t.id === preferred) || TEMPLATE_POOL[0] || null;
  }, [peopleBlocks.length, TEMPLATE_POOL]);

  /* ===== Помощники для ID/состава ===== */
  const expectedIds = useMemo(() => {
    const list: string[] = [];
    peopleBlocks.forEach((p) => {
      list.push(`portrait-${p.id}`);
      list.push(`metric-${p.id}`);
    });
    for (let i = 0; i < epitaphs.length; i++) list.push(`epitaph-${i}`);
    for (let i = 0; i < crosses.length; i++) list.push(`cross-${i}`);
    for (let i = 0; i < others.length; i++) list.push(`graphic-${i}`);
    return list;
  }, [peopleBlocks, epitaphs, crosses, others]);

  function idsEqual(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    const as = [...a].sort(); const bs = [...b].sort();
    for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return false;
    return true;
  }

  /* ===== Построение геометрии по шаблону для всех ожидаемых элементов ===== */
  const buildTemplateGeometry = React.useCallback((): Record<string, { x: number; y: number; w: number; h: number; z: number; type: ElType; title?: string; def?: Partial<EditorEl> }> => {
    const geo: Record<string, any> = {};
    if (!template) return geo;
    let z = 10;

    // photo
    const photoSlots = slotsByType(template, "photo");
    const photoRectsNorm: Norm[] =
      photoSlots.length >= peopleBlocks.length
        ? photoSlots.slice(0, peopleBlocks.length).map(s => s.rect as Norm)
        : (photoSlots.length > 0 ? partitionSlot(photoSlots[0].rect as Norm, peopleBlocks.length, "h") : []);
    peopleBlocks.forEach((pb, i) => {
      const id = `portrait-${pb.id}`;
      const rn = photoRectsNorm[i];
      const rect = rn ? toPct(rn) : { x: 10 + i * (80 / Math.max(1, peopleBlocks.length)), y: 18, w: 30, h: 36 };
      geo[id] = { ...rect, z: z++, type: "portrait", title: "Портрет", def: { bw: true } };
    });

    // metric
    const nameSlots = slotsByType(template, "personName");
    const dateSlots = slotsByType(template, "dates");
    peopleBlocks.forEach((pb, i) => {
      const id = `metric-${pb.id}`;
      const nm = (nameSlots.find(s => (s.index ?? 0) === i) || nameSlots[i])?.rect as Norm | undefined;
      const dt = (dateSlots.find(s => (s.index ?? 0) === i) || dateSlots[i])?.rect as Norm | undefined;
      const u = unionNorm(nm, dt);
      const rect = u ? toPct(u) : { x: 8 + i * (84 / Math.max(1, peopleBlocks.length)), y: 56, w: 36, h: 18 };
      geo[id] = { ...rect, z: z++, type: "metric", title: "Метрика", def: { uppercase: true, italic: false } };
    });

    // epitaph
    const epSlots = slotsByType(template, "epitaph");
    const E = epitaphs.length;
    let epRects: Norm[] = [];
    if (E > 0) {
      if (epSlots.length >= E) epRects = epSlots.slice(0, E).map(s => s.rect as Norm);
      else if (epSlots.length === 1) epRects = partitionSlot(epSlots[0].rect as Norm, E, "v");
    }
    for (let i = 0; i < E; i++) {
      const id = `epitaph-${i}`;
      const rn = epRects[i];
      const rect = rn ? toPct(rn) : { x: 10, y: 78 + i * 10, w: 80, h: 12 };
      const txt = epitaphs[i] || "";
      geo[id] = { ...rect, z: 100 + i, type: "epitaph", title: "Эпитафия", def: { staircase: isRememberLoveMourn(txt) } };
    }

    // cross
    const crossSlots = slotsByType(template, "cross");
    let crossRectsNorm: Norm[] = [];
    if (crosses.length > 0) {
      if (crossSlots.length >= crosses.length) crossRectsNorm = crossSlots.slice(0, crosses.length).map(s => s.rect as Norm);
      else if (crossSlots.length === 1) crossRectsNorm = partitionSlot(crossSlots[0].rect as Norm, crosses.length, "h");
    }
    crosses.forEach((_, i) => {
      const id = `cross-${i}`;
      const rn = crossRectsNorm[i];
      const rect = rn ? toPct(rn) : { x: 6 + i * 18, y: 5, w: 14, h: 14 };
      geo[id] = { ...rect, z: 200 + i, type: "cross", title: "Крест" };
    });

    // graphics
    const decorRects = template.slots.filter(s => s.type === "decor" || s.type === "flower").map(s => s.rect as Norm);
    let gfxRectsNorm: Norm[] = [];
    if (decorRects.length >= others.length) gfxRectsNorm = decorRects.slice(0, others.length);
    else if (decorRects.length === 1) gfxRectsNorm = partitionSlot(decorRects[0], others.length, "h");
    others.forEach((_, i) => {
      const id = `graphic-${i}`;
      const rn = gfxRectsNorm[i];
      const rect = rn ? toPct(rn) : { x: 12 + i * 22, y: 86, w: 20, h: 12 };
      geo[id] = { ...rect, z: 300 + i, type: "graphic", title: "Графика" };
    });

    return geo;
  }, [template, peopleBlocks, epitaphs, crosses, others]);

  /* ===== Реконсиляция элементов при изменениях / переходах ===== */
  const reconcileElements = React.useCallback((reason: string = "auto") => {
    if (!template) return;

    const geo = buildTemplateGeometry();
    const wantIds = Object.keys(geo);
    const haveIds = elements.map(e => e.id);

    // Наличие «сильного» изменения состава (люди/эпитафии/графика/шаблон)
    const strongChange =
      !idsEqual(wantIds, haveIds) ||
      (draft as any)?.editor?.autoPlacedByTemplate !== template.id;

    setElements((prev) => {
      let next: EditorEl[] = [];

      if (strongChange) {
        // Полное перестроение: убираем осиротевшие, создаём недостающие, существующие не переносим (чистая раскладка).
        next = wantIds.map((id) => {
          const g = geo[id];
          const def: Partial<EditorEl> = g.def || {};
          return {
            id,
            type: g.type,
            x: g.x, y: g.y, w: g.w, h: g.h, z: g.z,
            title: g.title,
            uppercase: def.uppercase as any,
            italic: def.italic as any,
            flipH: def.flipH as any,
            bw: def.bw as any,
            staircase: def.staircase as any
          } as EditorEl;
        });
      } else {
        // Частичная: оставляем существующие ожидаемые, удаляем осиротевшие, добавляем отсутствующие по шаблону
        const keepMap = new Map(prev.filter(e => wantIds.includes(e.id)).map(e => [e.id, e]));
        // Добавим недостающие
        wantIds.forEach((id) => {
          if (!keepMap.has(id)) {
            const g = geo[id];
            const def: Partial<EditorEl> = g.def || {};
            keepMap.set(id, {
              id,
              type: g.type,
              x: g.x, y: g.y, w: g.w, h: g.h,
              z: g.z,
              title: g.title,
              uppercase: def.uppercase as any,
              italic: def.italic as any,
              flipH: def.flipH as any,
              bw: def.bw as any,
              staircase: def.staircase as any
            } as EditorEl);
          }
        });
        next = Array.from(keepMap.values()).sort((a, b) => a.z - b.z);
      }

      // Если состав реально изменился — сохраняем и регенерируем превью
      const norm = (arr: EditorEl[]) =>
        arr.map(({ id, type, x, y, w, h, z, uppercase, italic, flipH, bw, staircase }) => ({
          id, type, x, y, w, h, z, uppercase: !!uppercase, italic: !!italic, flipH: !!flipH, bw: !!bw, staircase: !!staircase
        })).sort((a, b) => a.id.localeCompare(b.id));

      const changed = JSON.stringify(norm(next)) !== JSON.stringify(norm(prev));
      if (changed) {
        const cur = loadOrderDraft();
        saveOrderDraft({
          ...cur,
          editor: { ...(cur as any).editor, elements: next, wishes, autoPlacedByTemplate: template.id, updatedAt: Date.now() }
        });
        queuePreviewGeneration();
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, buildTemplateGeometry, elements, draft, wishes]);

  /* Первичное размещение/реконсиляция */
  useEffect(() => {
    // При первом рендере и на каждое изменение состава — реконсилируем
    reconcileElements("mount/compose-change");
  }, [reconcileElements, peopleBlocks, epitaphs, crosses, others, template?.id]);

  /* Рефреш при переходах/возврате в вкладку/из истории */
  useEffect(() => {
    const onFocus = () => { setDraft(loadOrderDraft()); reconcileElements("focus/pageshow"); };
    const onVisible = () => { if (document.visibilityState === "visible") { setDraft(loadOrderDraft()); reconcileElements("visible"); } }
    const onPop = () => { setDraft(loadOrderDraft()); reconcileElements("popstate/hashchange"); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus as any);
    window.addEventListener("visibilitychange", onVisible);
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus as any);
      window.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, [reconcileElements]);

  /* Подписка на внешние обновления драфта */
  useEffect(() => {
    const onUpd = () => { setDraft(loadOrderDraft()); reconcileElements("DRAFT_UPDATED_EVENT"); };
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
      window.removeEventListener("storage", onUpd);
    };
  }, [reconcileElements]);

  /* ===== DnD / Resize с RAF-троттлингом ===== */
  const dragRef = useRef<{
    id: string; mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number; start: EditorEl;
  } | null>(null);

  const scheduleMoveCommit = () => {
    if (rafMoveScheduled.current) return;
    rafMoveScheduled.current = true;
    requestAnimationFrame(() => {
      rafMoveScheduled.current = false;
      const payload = rafMovePayload.current;
      if (!payload) return;
      setElements((prev) => prev.map((el) => (el.id === payload.id ? payload.next : el)));
      rafMovePayload.current = null;
    });
  };

  const onPointerDownBox = (e: React.PointerEvent, id: string, mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move") => {
    e.stopPropagation();
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    e.preventDefault();
    const rect = editorWrapRef.current?.getBoundingClientRect(); if (!rect) return;
    const contentW = rect.width - SKETCH_PAD * 2;
    const contentH = rect.height - SKETCH_PAD * 2;
    if (contentW <= 0 || contentH <= 0) return;

    const dxPct = ((e.clientX - d.startX) / contentW) * 100;
    const dyPct = ((e.clientY - d.startY) / contentH) * 100;

    const keepRatio = e.shiftKey;
    const snap = (v: number, step = SNAP_STEP_DEFAULT) => Math.round(v / step) * step;

    const base = d.start;
    let nx = base.x, ny = base.y, nw = base.w, nh = base.h;
    if (d.mode === "move") {
      nx = snap(base.x + dxPct); ny = snap(base.y + dyPct);
    } else {
      const ratio = (base.w || 1) / (base.h || 1);
      if (d.mode.includes("e")) nw = snap(base.w + dxPct);
      if (d.mode.includes("s")) nh = snap(base.h + dyPct);
      if (d.mode.includes("w")) { nx = snap(base.x + dxPct); nw = snap(base.w - dxPct); }
      if (d.mode.includes("n")) { ny = snap(base.y + dyPct); nh = snap(base.h - dyPct); }
      if (keepRatio) {
        if (["e","w"].some((s) => d.mode.includes(s))) nh = nw / ratio;
        if (["n","s"].some((s) => d.mode.includes(s))) nw = nh * ratio;
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
      saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements: latest, wishes, updatedAt: Date.now() } });
      queuePreviewGeneration();
    }
    dragRef.current = null;
  };

  /* ===== Превью в драфт ===== */
  const previewTimerRef = useRef<number | null>(null);
  const queuePreviewGeneration = () => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(async () => {
      const wrap = editorWrapRef.current; if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const pad = SKETCH_PAD;

      async function drawPreview(W: number, H: number): Promise<string | null> {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(W));
        canvas.height = Math.max(1, Math.floor(H));
        const ctx = canvas.getContext("2d"); if (!ctx) return null;

        // фон
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#6e6e6e"); grad.addColorStop(0.2, "#464545");
        grad.addColorStop(0.4, "#424242"); grad.addColorStop(0.7, "#888888"); grad.addColorStop(1.0, "#ffffff");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

        // изделие
        const base = await new Promise<HTMLImageElement | null>((resolve) => {
          const url = item?.url || ""; if (!url) return resolve(null);
          const i = new Image(); i.crossOrigin = "anonymous"; i.loading = "eager"; (i as any).fetchpriority = "high"; i.decoding = "sync";
          i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url;
        });

        const CX = pad, CY = pad, PW = W - pad * 2, PH = H - pad * 2;
        if (base) {
          const sr = base.width / base.height, dr = PW / PH;
          ctx.globalAlpha = 0.35;
          if (sr > dr) {
            const rw = PW, rh = Math.round(PW / sr), rx = CX, ry = CY + Math.round((PH - rh) / 2);
            ctx.drawImage(base, rx, ry, rw, rh);
          } else {
            const rh = PH, rw = Math.round(PH * sr), ry = CY, rx = CX + Math.round((PW - rw) / 2);
            ctx.drawImage(base, rx, ry, rw, rh);
          }
          ctx.globalAlpha = 1;
        }

        const fam = FONT_CENTURY;
        const safeIndex = (raw: string, max: number) => {
          const n = parseInt(raw, 10); if (!Number.isFinite(n) || n < 0) return 0;
          return Math.min(n, Math.max(0, max - 1));
        };

        for (const el of elements.slice().sort((a, b) => a.z - b.z)) {
          const rbox = { x: CX + (el.x / 100) * PW, y: CY + (el.y / 100) * PH, w: (el.w / 100) * PW, h: (el.h / 100) * PH };
          const key = el.id.split("-").slice(1).join("-");
          if (el.type === "portrait") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const url = p?.photo || ""; if (!url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => { const i = new Image(); i.crossOrigin = "anonymous"; i.loading = "eager"; (i as any).fetchpriority = "low"; i.decoding = "async"; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url; });
            if (!im) continue;
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            ctx.save(); ctx.beginPath(); ctx.rect(rbox.x, rbox.y, rbox.w, rbox.h); ctx.clip();
            if (el.bw) ctx.filter = "grayscale(100%)";
            if (sr2 > dr2) { const hh = rbox.h, ww = Math.round(hh * sr2), xx = Math.round(rbox.x + (rbox.w - ww) / 2), yy = rbox.y; ctx.drawImage(im, xx, yy, ww, hh); }
            else { const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2); ctx.drawImage(im, xx, yy, ww, hh); }
            ctx.restore(); ctx.filter = "none";
          } else if (el.type === "metric") {
            const p = peopleBlocks.find((pp) => pp.id === key);
            const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
            const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
            ctx.save(); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04)), padY2 = Math.max(2, Math.round(rbox.h * 0.10));
            const fitted = fitMetricFontsPx({ lines: lines.map(tf), boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.12, minPx: 10 });
            const totalH = fitted.reduce((a, b) => a + b * 1.12, 0);
            let y = rbox.y + (rbox.h - totalH) / 2 + (fitted[0] || 10) * 1.12 / 2;
            for (let i = 0; i < fitted.length; i++) { setFontOnCtx(ctx, !!el.italic, fitted[i], fam); ctx.fillText(tf(lines[i]), rbox.x + rbox.w / 2, y); y += fitted[i] * 1.12; }
            ctx.restore();
          } else if (el.type === "epitaph") {
            const idx = safeIndex(key, epitaphs.length);
            const tRaw = epitaphs[idx] || "";
            const isRLM = isRememberLoveMourn(tRaw);
            const padX2 = Math.max(4, Math.round(rbox.w * 0.04)), padY2 = Math.max(2, Math.round(rbox.h * 0.06));
            ctx.save(); ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
            if (isRLM && el.staircase) {
              const r = splitRememberPreserve(tRaw);
              const parts = [r.top, r.mid, r.bot];
              const fontPx = fitStairRLMFontPx({ lines: parts, boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.15, minPx: 10, maxPx: 96 });
              setFontOnCtx(ctx, !!el.italic, fontPx, fam);
              const slotH = (rbox.h - padY2 * 2) / 3;
              ctx.textAlign = "left";
              ctx.fillText(parts[0], rbox.x + padX2, rbox.y + padY2 + slotH * 0.5);
              ctx.textAlign = "center";
              ctx.fillText(parts[1], rbox.x + rbox.w / 2, rbox.y + padY2 + slotH * 1.5);
              ctx.textAlign = "right";
              ctx.fillText(parts[2], rbox.x + rbox.w - padX2, rbox.y + padY2 + slotH * 2.5);
            } else {
              const { fontPx } = fitMultilineFontPxGeneric({ text: tRaw, boxW: rbox.w, boxH: rbox.h, italic: !!el.italic, family: fam, padX: padX2, padY: padY2, lineHeight: 1.15 });
              setFontOnCtx(ctx, !!el.italic, fontPx, fam);
              ctx.textAlign = "center";
              ctx.fillText(el.uppercase ? tRaw.toUpperCase() : tRaw, rbox.x + rbox.w / 2, rbox.y + rbox.h / 2);
            }
            ctx.restore();
          } else if (el.type === "graphic" || el.type === "cross") {
            const idx = Number(key);
            const list = el.type === "cross" ? crosses : others;
            const g = Number.isFinite(idx) ? list[idx] : null; if (!g?.url) continue;
            const im = await new Promise<HTMLImageElement | null>((resolve) => {
              const i = new Image(); i.crossOrigin = "anonymous"; i.loading = "eager"; (i as any).fetchpriority = "low"; i.decoding = "async";
              i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = g.url;
            });
            if (!im) continue;
            ctx.save();
            if (el.type === "graphic" && el.flipH) {
              ctx.translate(rbox.x + rbox.w / 2, rbox.y + rbox.h / 2);
              ctx.scale(-1, 1);
              ctx.translate(-(rbox.x + rbox.w / 2), -(rbox.y + rbox.h / 2));
            }
            const sr2 = im.width / im.height, dr2 = rbox.w / rbox.h;
            if (sr2 > dr2) { const ww = rbox.w, hh = Math.round(ww / sr2), xx = rbox.x, yy = Math.round(rbox.y + (rbox.h - hh) / 2); ctx.drawImage(im, xx, yy, ww, hh); }
            else { const hh = rbox.h, ww = Math.round(hh * sr2), xx = rbox.x + Math.round((rbox.w - ww) / 2), yy = rbox.y; ctx.drawImage(im, xx, yy, ww, hh); }
            ctx.restore();
          }
        }
        return canvas.toDataURL("image/jpeg", 0.9);
      }

      const mini = await drawPreview(Math.max(320, Math.floor(r.width)), Math.max(320, Math.floor(r.height)));
      const maxSide = 1600, ratio = r.width / Math.max(1, r.height);
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

  // Автосохранение и превью при изменениях
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const cur = loadOrderDraft();
      saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
    }, 200) as unknown as number;
    queuePreviewGeneration();
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [elements, wishes]);

  // aspectRatio для изделия
  useEffect(() => {
    if (!item?.url) return;
    const im = new Image();
    im.onload = () => setImgWH({ w: im.naturalWidth || 4, h: im.naturalHeight || 3 });
    im.onerror = () => setImgWH({ w: 4, h: 3 });
    im.loading = "eager"; (im as any).fetchpriority = "high"; (im as any).decoding = "sync";
    im.src = item.url;
  }, [item?.url]);

  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 240ms ease", backgroundImage: `url(/data/bg.svg)`, backgroundSize: "cover", backgroundPosition: "center center", backgroundAttachment: "fixed" }}>
      <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
        <TopBarWithIntro title="Memorial" />

        <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
          Схематично разместите элементы по шаблону. Финальную раскладку выполнит специалист. Укажите порядок и выравнивание (верх/низ, лево/право).
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
            {item?.url && (
              <img
                src={item.url}
                alt=""
                decoding="sync"
                loading="eager"
                style={{
                  position: "absolute",
                  left: SKETCH_PAD,
                  top: SKETCH_PAD,
                  width: `calc(100% - ${SKETCH_PAD * 2}px)`,
                  height: `calc(100% - ${SKETCH_PAD * 2}px)`,
                  objectFit: "contain",
                  opacity: 0.35,
                  pointerEvents: "none",
                  backfaceVisibility: "hidden",
                  transform: "translateZ(0)"
                }}
                draggable={false}
              />
            )}

            <img
              src={item?.url || ""}
              alt=""
              style={{ position: "absolute", inset: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => { if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 }); }}
            />

            <ContentLayer />

            <div
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
              style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, zIndex: 1001, pointerEvents: "auto" }}
            >
              {elements.slice().sort((a, b) => a.z - b.z).map((el) => {
                const selected = el.id === selectedId;
                const frameStyle: React.CSSProperties = {
                  position: "absolute",
                  left: `${el.x}%`, top: `${el.y}%`,
                  width: `${el.w}%`, height: `${el.h}%`,
                  border: selected ? "2px solid #8ab4ff" : "1px dashed rgba(255,255,255,0.85)",
                  borderRadius: 4,
                  boxSizing: "border-box",
                  background: "transparent",
                  pointerEvents: "auto",
                  cursor: el.locked ? "not-allowed" : "move",
                  touchAction: "none"
                };
                return (
                  <div key={el.id} onPointerDown={(ev) => onPointerDownBox(ev, el.id, "move")} style={frameStyle} title={el.title || el.id}>
                    {selected && <MiniToolbar el={el} />}
                    {selected && !el.locked && (
                      <>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={knob(`-${28/2}px`, `-${28/2}px`, "nwse-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={knob(`calc(100% - ${28/2}px)`, `-${28/2}px`, "nesw-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={knob(`calc(100% - ${28/2}px)`, `calc(100% - ${28/2}px)`, "nwse-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={knob(`-${28/2}px`, `calc(100% - ${28/2}px)`, "nesw-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={knob(`calc(50% - ${28/2}px)`, `-${28/2}px`, "ns-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={knob(`calc(100% - ${28/2}px)`, `calc(50% - ${28/2}px)`, "ew-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={knob(`calc(50% - ${28/2}px)`, `calc(100% - ${28/2}px)`, "ns-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                        <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={knob(`-${28/2}px`, `calc(50% - ${28/2}px)`, "ew-resize")}><div style={{ width: 14, height: 14, background: "#fff", border: "1px solid #000", borderRadius: 3, boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} /></div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <label htmlFor="wishes" style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>Пожелания по эскизу</label>
          <textarea
            id="wishes"
            value={wishes}
            onChange={(e) => setWishes(e.target.value)}
            rows={4}
            placeholder="Например: портрет уменьшить, метрику сузить, эпитафию — лесенкой…"
            style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.35)", color: "#fff", padding: 10, resize: "vertical", outline: "none", boxSizing: "border-box" }}
          />
        </section>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={() => { const cur = loadOrderDraft(); saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } }); setOutro(true); setTimeout(() => onBack?.(), 150); }} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={() => { const cur = loadOrderDraft(); saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } }); const go = onRearSide || onSendOrder || onContinue; if (!go) return; setOutro(true); setTimeout(() => go({ elements, wishes }), 150); }} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
