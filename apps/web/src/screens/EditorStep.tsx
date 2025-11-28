// src/screens/EditorStep.tsx
// Редактор элементов: надёжная инициализация позиций из шаблона БЕЗ чтения DOM.
// Вместо попыток считывать размеры из скрытого SketchTemplate, мы вычисляем раскладку теми же
// правилами (computeSketchLayout). Это устраняет:
// - схлопывание элементов (крест «есть, но не видно»);
// - кривую/неактивную эпитафию;
// - ошибки чтения из undefined (align и т.п.).
//
// Что внутри:
// - computeSketchLayout(stageW, stageH, orientation, people, crosses, graphics, epitaphs)
//   возвращает коробки (x,y,w,h) в процентах контентной области.
// - Одноразовая инициализация позиций по хэшу состояния (ориентация, состав, размеры); ручные правки не затираем.
// - Гарантируем минимальные размеры коробок, чтобы ничего не схлопывалось.
// - Рендер контента использует безопасные дефолты (align = "center"), не читает потенциально undefined.
//
// Остальное: DnD/resize, мини-кнопки (ПРОПИСНЫЕ/строчные, Лесенкой/В строку, Отразить ⇄),
// превью (canvas), авто-сейв — без изменений.

import React, { useEffect, useMemo, useRef, useState } from "react";
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
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты от контентной области
  z: number;
  title?: string;
  locked?: boolean;
  // контентные флаги
  uppercase?: boolean;
  italic?: boolean;
  flipH?: boolean;
  bw?: boolean;
  staircase?: boolean;
};

/* ===== Helpers ===== */
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
const normRemember = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim();
const isRememberLoveMourn = (t?: string) => normRemember(t) === "помним любим скорбим";

/* =========================================================================================
   computeSketchLayout: единая программная раскладка (без чтения DOM из SketchTemplate)
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
  const addPct = (map: Map<string, any>, id: string, x: number, y: number, w: number, h: number) =>
    map.set(id, clampBox(toPct(x, stageW), toPct(y, stageH), toPct(w, stageW), toPct(h, stageH)));

  const m = new Map<string, { x: number; y: number; w: number; h: number }>();
  const n = people.length;
  const tplKey: "one" | "two" | "many" = n <= 1 ? "one" : n === 2 ? "two" : "many";

  const gap = Math.round(0.015 * stageH);
  const top6 = Math.round(0.06 * stageH);
  const top8 = Math.round(0.08 * stageH);
  const bottomPad = Math.max(8, Math.round(0.02 * stageH));
  const epW = Math.round(stageW * 0.88);
  const epX = Math.round((stageW - epW) / 2);

  const crossWpct = orientation === "vertical" ? 0.14 : 0.08;
  const crossWpx = Math.round(stageW * crossWpct);
  const crossHpx = crossWpx;

  if (orientation === "horizontal" && tplKey === "one") {
    // Портрет (40% H, по центру)
    const ph = Math.round(0.40 * stageH);
    let pw = Math.round(ph * (3 / 4));
    if (pw > stageW * 0.9) {
      const k = (stageW * 0.9) / pw;
      pw = Math.max(40, Math.round(pw * k));
    }
    const px = Math.round((stageW - pw) / 2);
    const py = top6;
    const person = people[0];
    if (person) addPct(m, `portrait-${person.id}`, px, py, pw, ph);

    // Метрика (20% H, по центру)
    const mh = Math.max(24, Math.round(0.20 * stageH));
    const mw = Math.round(stageW * 0.8);
    const mx = Math.round((stageW - mw) / 2);
    const my = py + ph + gap;
    if (person) addPct(m, `metric-${person.id}`, mx, my, mw, mh);

    // Эпитафия под метрикой
    const epTop = my + mh + gap;

    // Графика — у самого низа, но так, чтобы не пересекала эпитафию
    const gMaxH = Math.round(0.18 * stageH);
    const gH = Math.max(0, Math.min(gMaxH, stageH - bottomPad - epTop - gap));
    const gTop = stageH - bottomPad - gH;

    // Эпитафии (даем полосу до графики)
    const epH = Math.max(20, Math.round((gTop - gap) - epTop));
    epitaphs.forEach((_, i) => addPct(m, `epitaph-${i}`, epX, epTop, epW, epH));

    // Графика
    if (graphics.length > 0 && gH > 0) {
      const gw = Math.round(stageW * 0.9);
      const gx = Math.round((stageW - gw) / 2);
      for (let i = 0; i < graphics.length; i++) addPct(m, `graphic-${i}`, gx, gTop, gw, gH);
    }

    // Кресты: один слева; два — слева и справа
    if (crosses[0]) addPct(m, `cross-0`, Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx);
    if (crosses[1]) addPct(m, `cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx);

  } else if (orientation === "horizontal" && tplKey === "two") {
    // Две колонки
    const colGap = Math.round(0.012 * stageW);
    const colW = Math.min(320, Math.max(140, Math.floor((stageW - colGap) / 2)));
    const totalW = colW * 2 + colGap;
    const leftStart = Math.round((stageW - totalW) / 2);
    const pw = colW;
    const ph = Math.round(pw * (4 / 3));
    const top = top8;

    people.slice(0, 2).forEach((p, idx) => {
      const cx = leftStart + idx * (colW + colGap);
      addPct(m, `portrait-${p.id}`, cx, top, pw, ph);
      const mw = Math.round(colW * 0.8);
      const mh = Math.max(30, Math.round(0.16 * stageH));
      addPct(m, `metric-${p.id}`, cx + Math.round((colW - mw) / 2), top + ph + Math.round(0.01 * stageH), mw, mh);
    });

    const metricsBottom = people.slice(0, 2).reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`); if (!b) return acc;
      return Math.max(acc, (b.y / 100) * stageH + (b.h / 100) * stageH);
    }, 0);

    const epTop = Math.round(metricsBottom + gap);
    const gMaxH = Math.round(0.14 * stageH);
    const gH = Math.max(0, Math.min(gMaxH, stageH - bottomPad - epTop - gap));
    const gTop = stageH - bottomPad - gH;

    const epH = Math.max(20, Math.round((gTop - gap) - epTop));
    epitaphs.forEach((_, i) => addPct(m, `epitaph-${i}`, epX, epTop, epW, epH));

    if (graphics.length > 0 && gH > 0) {
      const gw = Math.round(stageW * 0.9);
      const gx = Math.round((stageW - gw) / 2);
      for (let i = 0; i < graphics.length; i++) addPct(m, `graphic-${i}`, gx, gTop, gw, gH);
    }

    // Кресты: 1 — центр; 2 — края
    if (crosses.length === 1) {
      addPct(m, `cross-0`, Math.round((stageW - crossWpx) / 2), Math.round(0.06 * stageH), crossWpx, crossHpx);
    } else if (crosses.length >= 2) {
      addPct(m, `cross-0`, Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx);
      addPct(m, `cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx);
    }

  } else if (orientation === "horizontal" && tplKey === "many") {
    const cols = Math.min(4, Math.max(3, people.length));
    const colGap = Math.round(0.012 * stageW);
    const colW = Math.min(260, Math.max(140, Math.floor((stageW - (cols - 1) * colGap) / cols)));
    const totalW = colW * cols + (cols - 1) * colGap;
    const leftStart = Math.round((stageW - totalW) / 2);
    const top = top8;
    const pw = colW;
    const ph = Math.round(pw * (4 / 3));

    people.forEach((p, i) => {
      const cx = leftStart + i * (colW + colGap);
      addPct(m, `portrait-${p.id}`, cx, top, pw, ph);
      const mw = Math.round(colW * 0.8);
      const mh = Math.max(28, Math.round(0.14 * stageH));
      addPct(m, `metric-${p.id}`, cx + Math.round((colW - mw) / 2), top + ph + Math.round(0.008 * stageH), mw, mh);
    });

    const metricsBottom = people.reduce((acc, p) => {
      const b = m.get(`metric-${p.id}`); if (!b) return acc;
      return Math.max(acc, (b.y / 100) * stageH + (b.h / 100) * stageH);
    }, 0);

    const epTop = Math.round(metricsBottom + gap);
    const gMaxH = Math.round(0.14 * stageH);
    const gH = Math.max(0, Math.min(gMaxH, stageH - bottomPad - epTop - gap));
    const gTop = stageH - bottomPad - gH;

    const epH = Math.max(20, Math.round((gTop - gap) - epTop));
    epitaphs.forEach((_, i) => addPct(m, `epitaph-${i}`, epX, epTop, epW, epH));
    if (graphics.length > 0 && gH > 0) {
      const gw = Math.round(stageW * 0.9);
      const gx = Math.round((stageW - gw) / 2);
      for (let i = 0; i < graphics.length; i++) addPct(m, `graphic-${i}`, gx, gTop, gw, gH);
    }

    if (crosses[0]) addPct(m, `cross-0`, Math.round(0.04 * stageW), Math.round(0.06 * stageH), crossWpx, crossHpx);
    if (crosses[1]) addPct(m, `cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.06 * stageH), crossWpx, crossHpx);

  } else {
    // Вертикальные
    const topPortrait = Math.round(0.12 * stageH);
    if (tplKey === "one" && people[0]) {
      const p = people[0];
      const pw = Math.round(stageW * 0.6);
      const ph = Math.round(pw * (4 / 3));
      const px = Math.round((stageW - pw) / 2);
      addPct(m, `portrait-${p.id}`, px, topPortrait, pw, ph);

      const mw = Math.round(stageW * 0.8);
      const mh = Math.max(32, Math.round(0.18 * stageH));
      const mx = Math.round((stageW - mw) / 2);
      const my = topPortrait + ph + Math.round(0.01 * stageH);
      addPct(m, `metric-${p.id}`, mx, my, mw, mh);

      const epTop = my + mh + gap;
      const gMaxH = Math.round(0.18 * stageH);
      const gH = Math.max(0, Math.min(gMaxH, stageH - bottomPad - epTop - gap));
      const gTop = stageH - bottomPad - gH;

      const epH = Math.max(20, Math.round((gTop - gap) - epTop));
      epitaphs.forEach((_, i) => addPct(m, `epitaph-${i}`, epX, epTop, epW, epH));

      if (graphics.length > 0 && gH > 0) {
        const gw = Math.round(stageW * 0.9);
        const gx = Math.round((stageW - gw) / 2);
        for (let i = 0; i < graphics.length; i++) addPct(m, `graphic-${i}`, gx, gTop, gw, gH);
      }

      if (crosses[0]) addPct(m, `cross-0`, Math.round(0.04 * stageW), Math.round(0.04 * stageH), crossWpx, crossHpx);
      if (crosses[1]) addPct(m, `cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.04 * stageH), crossWpx, crossHpx);

    } else {
      // two/many — строками
      const rows = tplKey === "two" ? 2 : people.length;
      const rowGap = Math.round(0.01 * stageH);
      const gridTop = topPortrait;
      const rowH = Math.floor((stageH - gridTop - bottomPad - (rows - 1) * rowGap) / rows);
      people.forEach((p, i) => {
        const ry = gridTop + i * (rowH + rowGap);
        const pw = Math.round(stageW * 0.45);
        const ph = Math.round(pw * (4 / 3));
        const px = Math.round(stageW * 0.03 + (stageW * 0.42 - pw) / 2);
        addPct(m, `portrait-${p.id}`, px, ry + Math.round((rowH - ph) / 2), pw, ph);

        const mw = Math.round(stageW * 0.5);
        const mh = Math.max(24, Math.round(0.16 * stageH));
        const mx = Math.round(stageW * 0.48);
        const my = ry + Math.round((rowH - mh) / 2);
        addPct(m, `metric-${p.id}`, mx, my, mw, mh);
      });

      const metricsBottom = people.reduce((acc, p) => {
        const b = m.get(`metric-${p.id}`); if (!b) return acc;
        return Math.max(acc, (b.y / 100) * stageH + (b.h / 100) * stageH);
      }, 0);
      const epTop = Math.round(metricsBottom + gap);
      const gMaxH = Math.round(0.16 * stageH);
      const gH = Math.max(0, Math.min(gMaxH, stageH - bottomPad - epTop - gap));
      const gTop = stageH - bottomPad - gH;

      const epH = Math.max(20, Math.round((gTop - gap) - epTop));
      epitaphs.forEach((_, i) => addPct(m, `epitaph-${i}`, epX, epTop, epW, epH));

      if (graphics.length > 0 && gH > 0) {
        const gw = Math.round(stageW * 0.9);
        const gx = Math.round((stageW - gw) / 2);
        for (let i = 0; i < graphics.length; i++) addPct(m, `graphic-${i}`, gx, gTop, gw, gH);
      }

      if (crosses[0]) addPct(m, `cross-0`, Math.round(0.04 * stageW), Math.round(0.04 * stageH), crossWpx, crossHpx);
      if (crosses[1]) addPct(m, `cross-1`, Math.round(stageW - 0.04 * stageW - crossWpx), Math.round(0.04 * stageH), crossWpx, crossHpx);
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

  /* ===== Инициализация позиций по шаблону (без DOM), одноразово по хэшу ===== */
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

    const ensureMin = (b: { x: number; y: number; w: number; h: number }, minW = 4, minH = 4) => ({
      ...b,
      w: Math.max(b.w, minW),
      h: Math.max(b.h, minH)
    });

    setElements((prev) => {
      const prevMap = new Map(prev.map((e) => [e.id, e]));
      const used = new Set<string>();
      const next: EditorEl[] = [];

      // Люди (портрет/метрика)
      peopleBlocks.forEach((p, i) => {
        const pid = `portrait-${p.id}`;
        const mid = `metric-${p.id}`;
        const pb = layout.get(pid);
        const mb = layout.get(mid);
        if (pb) {
          const safe = ensureMin(pb, 6, 8);
          const old = prevMap.get(pid);
          next.push(old ? { ...old, ...safe } : { id: pid, type: "portrait", ...safe, z: i * 10 + 1, title: pid, bw: true });
          used.add(pid);
        }
        if (mb) {
          const safe = ensureMin(mb, 10, 10);
          const old = prevMap.get(mid);
          next.push(old ? { ...old, ...safe } : { id: mid, type: "metric", ...safe, z: i * 10 + 2, title: mid, uppercase: true });
          used.add(mid);
        }
      });

      // Эпитафии
      epitaphs.forEach((_, idx) => {
        const id = `epitaph-${idx}`;
        const b = layout.get(id);
        if (!b) return;
        const safe = ensureMin(b, 12, 12);
        const old = prevMap.get(id);
        next.push(
          old
            ? { ...old, ...safe }
            : {
                id,
                type: "epitaph",
                ...safe,
                z: 100 + idx,
                title: id,
                staircase: isRememberLoveMourn(epitaphs[idx]) ? true : undefined
              }
        );
        used.add(id);
      });

      // Кресты
      crosses.forEach((_, idx) => {
        const id = `cross-${idx}`;
        const b = layout.get(id);
        if (!b) return;
        const safe = ensureMin(b, 6, 6);
        const old = prevMap.get(id);
        next.push(old ? { ...old, ...safe } : { id, type: "cross", ...safe, z: 200 + idx, title: id });
        used.add(id);
      });

      // Графика
      others.forEach((_, idx) => {
        const id = `graphic-${idx}`;
        const b = layout.get(id) || layout.get("graphic-0");
        if (!b) return;
        const safe = ensureMin(b, 14, 12);
        const old = prevMap.get(id);
        next.push(old ? { ...old, ...safe } : { id, type: "graphic", ...safe, z: 300 + idx, title: id, flipH: false });
        used.add(id);
      });

      // Переносим старые неиспользованные (кастом)
      prev.forEach((el) => {
        if (!used.has(el.id)) next.push(el);
      });

      return next;
    });

    setLayoutAppliedHash(hash);
    const prevDraft = loadOrderDraft();
    saveOrderDraft({
      ...prevDraft,
      editor: {
        ...(prevDraft.editor || {}),
        sketchInitHash: hash,
        updatedAt: Date.now()
      }
    });
  }, [wrapperRef.current, item?.url, peopleBlocks, crosses, others, epitaphs, imgWH, draft?.size?.orientation, layoutAppliedHash]);

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
        if (d.mode.includes("n")) { ny = y + dyPct; nh = h - dyPct; }

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
        // В превью портрет рисуем только если есть фото
        const person = peopleBlocks.find((pp) => pp.id === key);
        if (!person?.photo) continue;
        const im = await loadImageSafe(person.photo);
        if (!im) continue;
        const sr = im.width / im.height, dr = r.w / r.h;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        if (sr > dr) {
          const hh = r.h, ww = Math.round(hh * sr), xx = Math.round(r.x + (r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const ww = r.w, hh = Math.round(ww / sr), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
      } else if (el.type === "graphic") {
        const idx = Number(key);
        const g = Number.isFinite(idx) ? others[idx] : undefined;
        if (!g?.url) continue;
        const im = await loadImageSafe(g.url);
        if (!im) continue;
        const sr = im.width / im.height, dr = r.w / r.h;
        ctx.save();
        if (el.flipH) {
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
          ctx.scale(-1, 1);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
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
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const f = Math.max(10, Math.round(r.h * 0.32));
        ctx.font = `${el.italic ? "italic " : ""}${f}px "Century Schoolbook","Times New Roman",serif`;
        ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2, r.w - 8);
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
    }, 280) as unknown as number;

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

    const showStair = isEpitaph && isRememberLoveMourn(epitaphs[Number(key)] || "");

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

        {showStair && (
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
    const safeAlign: "left" | "center" | "right" = "center";

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
                    textAlign: safeAlign,
                    fontFamily, fontStyle: el.italic ? "italic" : "normal",
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
                      textAlign: safeAlign,
                      fontFamily, fontStyle: el.italic ? "italic" : "normal",
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
            {/* Бэкграунд */}
            <img
              src={item?.url || ""}
              alt={item?.name || "Изделие"}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0.35, userSelect: "none", pointerEvents: "none" }}
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => {
                if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 });
              }}
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
                      {selected && <MiniToolbar el={el} />}
                      {selected && !el.locked && (
                        <>
                          {/* Ручки ресайза */}
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
