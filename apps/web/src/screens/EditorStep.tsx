// src/screens/EditorStep.tsx
// Редактор: изначально на эскизе только резная работа.
// Сверху — единая палитра миниатюр, без подписей и разделов, в несколько столбцов.
// У миниатюр нет рамки/фона, изображение вписано и ограничено 120×120 по большей стороне.
// Клик/DnD добавляет элемент по центру и убирает из палитры. На рамке есть мини‑панель, включая корзину 🗑.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import {
  loadOrderDraft,
  saveOrderDraft,
  type OrderDraft,
  DRAFT_UPDATED_EVENT
} from "../lib/order";

/* ===== UI ===== */
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm"): React.CSSProperties {
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
  };
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

/* ===== Helpers ===== */
const DND_MIME = "application/x-memorial-editor-el";
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
const isCrossCategoryName = (s?: string) =>
  (s || "").toLowerCase().includes("крест") || (s || "").toLowerCase().includes("cross");

function linesFromPerson(p: any) {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
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
  const bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим…").trim();
  return { top, mid, bot };
}

/* ===== Measuring helpers ===== */
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

/* ===== Component ===== */
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
    () => ((draft as any)?.editor?.elements as EditorEl[]) || []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wishes, setWishes] = useState<string>(() => ((draft as any)?.editor?.wishes as string) || "");

  const editorWrapRef = useRef<HTMLDivElement | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);

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
  const crosses = useMemo(
    () => graphics.filter((g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)),
    [graphics]
  );
  const others = useMemo(
    () => graphics.filter((g) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)),
    [graphics]
  );

  // Что уже размещено на эскизе
  const placedPortraitIds = useMemo(
    () => new Set(elements.filter((e) => e.type === "portrait").map((e) => e.id.replace(/^portrait-/, ""))),
    [elements]
  );
  const placedMetricIds = useMemo(
    () => new Set(elements.filter((e) => e.type === "metric").map((e) => e.id.replace(/^metric-/, ""))),
    [elements]
  );
  const placedEpitaphIdx = useMemo(
    () => new Set(elements.filter((e) => e.type === "epitaph").map((e) => Number(e.id.replace(/^epitaph-/, "")))),
    [elements]
  );
  const placedCrossIdx = useMemo(
    () => new Set(elements.filter((e) => e.type === "cross").map((e) => Number(e.id.replace(/^cross-/, "")))),
    [elements]
  );
  const placedGraphicIdx = useMemo(
    () => new Set(elements.filter((e) => e.type === "graphic").map((e) => Number(e.id.replace(/^graphic-/, "")))),
    [elements]
  );

  // Единая палитра (без подписей/разделов)
  type TrayItem = { type: ElType; key: string | number; node: React.ReactNode };
  const trayItems: TrayItem[] = useMemo(() => {
    const items: TrayItem[] = [];

    // Портреты
    for (const p of peopleBlocks) {
      if (!placedPortraitIds.has(p.id)) {
        items.push({
          type: "portrait",
          key: p.id,
          node: p.photo ? (
            <img
              src={p.photo}
              alt=""
              style={{ maxWidth: 120, maxHeight: 120, width: "auto", height: "auto", objectFit: "contain", display: "block" }}
            />
          ) : (
            <div style={{ width: 120, height: 120, display: "grid", placeItems: "center", opacity: 0.7, fontSize: 12 }}>—</div>
          )
        });
      }
    }

    // Метрика (текст как миниатюра)
    for (const p of peopleBlocks) {
      if (!placedMetricIds.has(p.id)) {
        const ln = (p.lines || []) as string[];
        items.push({
          type: "metric",
          key: p.id,
          node: (
            <div
              style={{
                maxWidth: 120,
                maxHeight: 120,
                padding: 6,
                boxSizing: "border-box",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                lineHeight: 1.15,
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{ln[0] || "—"}</div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ln[1] || ""}</div>
              <div style={{ opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis" }}>{ln[2] || ""}</div>
            </div>
          )
        });
      }
    }

    // Эпитафии
    epitaphs.forEach((t, i) => {
      if (!placedEpitaphIdx.has(i)) {
        items.push({
          type: "epitaph",
          key: i,
          node: (
            <div
              style={{
                maxWidth: 120,
                maxHeight: 120,
                padding: 6,
                boxSizing: "border-box",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                lineHeight: 1.15,
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
              title={t}
            >
              {t}
            </div>
          )
        });
      }
    });

    // Кресты
    crosses.forEach((g, i) => {
      if (!placedCrossIdx.has(i)) {
        items.push({
          type: "cross",
          key: i,
          node: g.url ? (
            <img
              src={g.url}
              alt=""
              style={{ maxWidth: 120, maxHeight: 120, width: "auto", height: "auto", objectFit: "contain", display: "block" }}
            />
          ) : (
            <div style={{ width: 120, height: 120, display: "grid", placeItems: "center", opacity: 0.7, fontSize: 12 }}>—</div>
          )
        });
      }
    });

    // Графика
    others.forEach((g, i) => {
      if (!placedGraphicIdx.has(i)) {
        items.push({
          type: "graphic",
          key: i,
          node: g.url ? (
            <img
              src={g.url}
              alt=""
              style={{ maxWidth: 120, maxHeight: 120, width: "auto", height: "auto", objectFit: "contain", display: "block" }}
            />
          ) : (
            <div style={{ width: 120, height: 120, display: "grid", placeItems: "center", opacity: 0.7, fontSize: 12 }}>—</div>
          )
        });
      }
    });

    return items;
  }, [peopleBlocks, placedPortraitIds, placedMetricIds, epitaphs, placedEpitaphIdx, crosses, placedCrossIdx, others, placedGraphicIdx]);

  // Добавление по центру
  const nextZ = () => (elements.length ? Math.max(...elements.map((e) => e.z || 0)) + 10 : 10);
  const addCentered = (type: ElType, key: string | number) => {
    let newEl: EditorEl | null = null;
    const baseCenter = (w: number, h: number) => clampBox((100 - w) / 2, (100 - h) / 2, w, h);
    if (type === "portrait" && typeof key === "string") {
      if (elements.some((e) => e.type === "portrait" && e.id === `portrait-${key}`)) return;
      const r = baseCenter(28, 34);
      newEl = { id: `portrait-${key}`, type, ...r, z: nextZ(), bw: true, title: "Портрет" };
    } else if (type === "metric" && typeof key === "string") {
      if (elements.some((e) => e.type === "metric" && e.id === `metric-${key}`)) return;
      const r = baseCenter(44, 20);
      newEl = { id: `metric-${key}`, type, ...r, z: nextZ(), uppercase: true, italic: false, title: "Метрика" };
    } else if (type === "epitaph" && typeof key === "number") {
      if (elements.some((e) => e.type === "epitaph" && e.id === `epitaph-${key}`)) return;
      const r = baseCenter(72, 16);
      const txt = epitaphs[key] || "";
      newEl = { id: `epitaph-${key}`, type, ...r, z: nextZ(), uppercase: false, italic: false, staircase: isRememberLoveMourn(txt), title: "Эпитафия" };
    } else if (type === "cross" && typeof key === "number") {
      if (elements.some((e) => e.type === "cross" && e.id === `cross-${key}`)) return;
      const r = baseCenter(16, 16);
      newEl = { id: `cross-${key}`, type, ...r, z: nextZ(), title: "Крест" };
    } else if (type === "graphic" && typeof key === "number") {
      if (elements.some((e) => e.type === "graphic" && e.id === `graphic-${key}`)) return;
      const r = baseCenter(24, 16);
      newEl = { id: `graphic-${key}`, type, ...r, z: nextZ(), flipH: false, title: "Графика" };
    }
    if (newEl) {
      setElements((prev) => prev.concat([newEl!]));
      setSelectedId(newEl.id);
    }
  };

  // DnD из палитры в эскиз
  const onTrayDragStart = (e: React.DragEvent, payload: { type: ElType; key: string | number }) => {
    try {
      e.dataTransfer?.setData(DND_MIME, JSON.stringify(payload));
      (e.dataTransfer as DataTransfer).effectAllowed = "copyMove";
    } catch {}
  };
  const onEditorDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes(DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onEditorDrop = (e: React.DragEvent) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.types.includes(DND_MIME)) return;
    e.preventDefault();
    try {
      const raw = dt.getData(DND_MIME);
      const obj = JSON.parse(raw) as { type: ElType; key: string | number };
      addCentered(obj.type, obj.key);
    } catch {}
  };

  // Синхронизация со стором (чтение)
  const refreshRef = useRef<(opts?: { force?: boolean }) => void>(() => {});
  const isRefreshingRef = useRef(false);
  const lastStoreSigRef = useRef<string>("");

  const refreshFromDraft = React.useCallback(
    (opts?: { force?: boolean }) => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      try {
        const fresh = loadOrderDraft();
        const pick = { item: fresh?.item || null, engraving: fresh?.engraving || null, graphics: fresh?.graphics || null };
        const sig = JSON.stringify(pick);
        if (sig !== lastStoreSigRef.current) {
          setDraft(fresh);
          lastStoreSigRef.current = sig;
        }
        const incomingEls: EditorEl[] = (((fresh as any)?.editor?.elements || []) as EditorEl[]) || [];
        const incomingWishes: string = (((fresh as any)?.editor?.wishes || "") as string) || "";
        const shouldSetEls = opts?.force || JSON.stringify(incomingEls) !== JSON.stringify(elements);
        const shouldSetWishes = opts?.force || incomingWishes !== wishes;
        if (shouldSetEls) setElements(incomingEls);
        if (shouldSetWishes) setWishes(incomingWishes);
      } finally {
        isRefreshingRef.current = false;
      }
    },
    [elements, wishes]
  );

  useEffect(() => {
    refreshRef.current = refreshFromDraft;
  }, [refreshFromDraft]);

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

  /* ===== Мини‑панель инструментов (на рамке) ===== */
  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

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
            title={el.uppercase ? "Показать строчные" : "Показать ПРОПИСНЫЕ"}
            onClick={(e) => {
              e.stopPropagation();
              setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, uppercase: !x.uppercase } : x)));
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
              title={el.italic ? "Обычный" : "Курсив"}
              onClick={(e) => {
                e.stopPropagation();
                setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, italic: !x.italic } : x)));
              }}
            >
              {el.italic ? "Обычный" : "Курсив"}
            </button>
            {canStair && (
              <button
                type="button"
                style={btn}
                title={el.staircase ? "В строку" : "Лесенкой"}
                onClick={(e) => {
                  e.stopPropagation();
                  setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, staircase: !x.staircase } : x)));
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
            title="Отразить по горизонтали"
            onClick={(e) => {
              e.stopPropagation();
              setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, flipH: !x.flipH } : x)));
            }}
          >
            ⇄
          </button>
        )}
        {isPortrait && (
          <button
            type="button"
            style={btn}
            title={el.bw ? "Сделать цветным" : "Сделать ч/б"}
            onClick={(e) => {
              e.stopPropagation();
              setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, bw: !x.bw } : x)));
            }}
          >
            {el.bw ? "Цвет" : "Ч/Б"}
          </button>
        )}
        {/* Корзина — вернуть в палитру */}
        <button
          type="button"
          style={{ ...btn, padding: "2px 8px" }}
          title="Удалить с эскиза (вернётся в палитру)"
          onClick={(e) => {
            e.stopPropagation();
            setElements((prev) => prev.filter((x) => x.id !== el.id));
            setSelectedId(null);
          }}
        >
          🗑
        </button>
      </div>
    );
  };

  /* ===== Слой отрисовки содержимого (ВАЖНО: определён до использования) ===== */
  const ContentLayer: React.FC = () => {
    const wrap = editorWrapRef.current?.getBoundingClientRect();
    const contentW = Math.max(1, (wrap?.width || 1) - SKETCH_PAD * 2);
    const contentH = Math.max(1, (wrap?.height || 1) - SKETCH_PAD * 2);

    return (
      <div
        style={{
          position: "absolute",
          left: SKETCH_PAD,
          top: SKETCH_PAD,
          right: SKETCH_PAD,
          bottom: SKETCH_PAD,
          pointerEvents: "none",
          zIndex: 1000,
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
          contain: "paint"
        }}
      >
        {elements
          .slice()
          .sort((a, b) => a.z - b.z)
          .map((el) => {
            const key = el.id.split("-").slice(1).join("-");
            const boxPx = {
              x: (el.x / 100) * contentW,
              y: (el.y / 100) * contentH,
              w: (el.w / 100) * contentW,
              h: (el.h / 100) * contentH
            };
            const wrapperStyle: React.CSSProperties = {
              position: "absolute",
              left: Math.round(boxPx.x),
              top: Math.round(boxPx.y),
              width: Math.round(boxPx.w),
              height: Math.round(boxPx.h),
              zIndex: el.z,
              pointerEvents: "none",
              willChange: "transform",
              transform: "translateZ(0)",
              backfaceVisibility: "hidden",
              contain: "paint",
              boxSizing: "border-box"
            };

            if (el.type === "portrait") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const url = p?.photo || "";
              return (
                <div key={`content-${el.id}`} style={wrapperStyle}>
                  {url ? (
                    <img
                      src={url}
                      alt=""
                      draggable={false}
                      loading="eager"
                      decoding="async"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: el.bw ? "grayscale(100%)" : "none",
                        display: "block",
                        willChange: "transform",
                        transform: "translateZ(0)",
                        backfaceVisibility: "hidden"
                      }}
                    />
                  ) : null}
                </div>
              );
            }

            if (el.type === "metric") {
              const p = peopleBlocks.find((pp) => pp.id === key);
              const lines = (p?.lines || []).filter(Boolean).slice(0, 3);
              const tf = el.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
              const padX = Math.max(4, Math.round(boxPx.w * 0.04));
              const padY = Math.max(2, Math.round(boxPx.h * 0.1));
              const fitted = fitMetricFontsPx({
                lines: lines.map(tf),
                boxW: boxPx.w,
                boxH: boxPx.h,
                italic: !!el.italic,
                family: FONT_CENTURY,
                padX,
                padY,
                lineHeight: 1.12,
                minPx: 10
              });
              return (
                <div
                  key={`content-${el.id}`}
                  style={{
                    ...wrapperStyle,
                    color: "#fff",
                    fontFamily: FONT_CENTURY,
                    textAlign: "center"
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      padding: `${padY}px ${padX}px`,
                      boxSizing: "border-box",
                      lineHeight: 1.12,
                      fontStyle: el.italic ? "italic" : "normal",
                      textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                    }}
                  >
                    <div style={{ display: "grid", gap: 2, width: "100%" }}>
                      {lines[0] && <div style={{ fontWeight: 700, fontSize: fitted[0] || 12 }}>{tf(lines[0])}</div>}
                      {lines[1] && <div style={{ fontWeight: 600, fontSize: fitted[1] || 11 }}>{tf(lines[1])}</div>}
                      {lines[2] && (
                        <div style={{ fontWeight: 400, fontSize: fitted[2] || 10, opacity: 0.95 }}>{tf(lines[2])}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (el.type === "epitaph") {
              const idx = Number(key);
              const tRaw = Number.isFinite(idx) ? epitaphs[idx] || "" : "";
              const isRLM = isRememberLoveMourn(tRaw);
              const padX = Math.max(4, Math.round(boxPx.w * 0.04));
              const padY = Math.max(2, Math.round(boxPx.h * 0.06));

              if (isRLM && el.staircase) {
                const r = splitRememberPreserve(tRaw);
                const parts = [r.top, r.mid, r.bot];
                const ctxm = getMeasureCtx();
                const w1 = measureTextAt(ctxm, parts[0], !!el.italic, FONT_CENTURY, 100);
                const w2 = measureTextAt(ctxm, parts[1], !!el.italic, FONT_CENTURY, 100);
                const w3 = measureTextAt(ctxm, parts[2], !!el.italic, FONT_CENTURY, 100);
                const maxW = Math.max(w1, w2, w3);
                const fByW = ((boxPx.w - padX * 2) * 100) / Math.max(1, maxW);
                const fByH = (boxPx.h - padY * 2) / (3 * 1.15);
                const fontPx = Math.max(10, Math.floor(Math.min(fByW, fByH)));
                return (
                  <div key={`content-${el.id}`} style={{ ...wrapperStyle, color: "#fff", fontFamily: FONT_CENTURY }}>
                    <div
                      style={{
                        position: "absolute",
                        left: padX,
                        top: padY,
                        right: padX,
                        bottom: padY,
                        display: "grid",
                        gridTemplateRows: "1fr 1fr 1fr"
                      }}
                    >
                      <div
                        style={{
                          alignSelf: "center",
                          justifySelf: "start",
                          fontWeight: 600,
                          fontStyle: el.italic ? "italic" : "normal",
                          fontSize: fontPx,
                          textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                        }}
                      >
                        {parts[0]}
                      </div>
                      <div
                        style={{
                          alignSelf: "center",
                          justifySelf: "center",
                          fontWeight: 600,
                          fontStyle: el.italic ? "italic" : "normal",
                          fontSize: fontPx,
                          textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                        }}
                      >
                        {parts[1]}
                      </div>
                      <div
                        style={{
                          alignSelf: "center",
                          justifySelf: "end",
                          fontWeight: 600,
                          fontStyle: el.italic ? "italic" : "normal",
                          fontSize: fontPx,
                          textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                        }}
                      >
                        {parts[2]}
                      </div>
                    </div>
                  </div>
                );
              } else {
                const textDisplay = el.uppercase ? tRaw.toUpperCase() : tRaw;
                const { fontPx, lines } = fitMultilineFontPxGeneric({
                  text: textDisplay,
                  boxW: boxPx.w,
                  boxH: boxPx.h,
                  italic: !!el.italic,
                  family: FONT_CENTURY,
                  padX,
                  padY,
                  lineHeight: 1.15
                });
                return (
                  <div key={`content-${el.id}`} style={{ ...wrapperStyle, color: "#fff", fontFamily: FONT_CENTURY, textAlign: "center" }}>
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        padding: `${padY}px ${padX}px`,
                        boxSizing: "border-box",
                        lineHeight: 1.15,
                        fontStyle: el.italic ? "italic" : "normal",
                        textShadow: "0 1px 2px rgba(0,0,0,0.6)"
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: fontPx, whiteSpace: "pre-wrap" }}>{lines.join("\n")}</div>
                    </div>
                  </div>
                );
              }
            }

            if (el.type === "cross" || el.type === "graphic") {
              const idx = Number(key);
              const list = el.type === "cross" ? crosses : others;
              const g = Number.isFinite(idx) ? list[idx] : null;
              const tr = el.type === "graphic" && el.flipH ? "scaleX(-1) translateZ(0)" : "translateZ(0)";
              return (
                <div key={`content-${el.id}`} style={wrapperStyle}>
                  {g?.url ? (
                    <img
                      src={g.url}
                      alt=""
                      draggable={false}
                      loading="eager"
                      decoding="async"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        transform: tr,
                        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                        willChange: "transform",
                        backfaceVisibility: "hidden"
                      }}
                    />
                  ) : null}
                </div>
              );
            }

            return null;
          })}
      </div>
    );
  };

  /* ===== Навигация кнопками ===== */
  const handleBack = () => {
    const cur = loadOrderDraft();
    saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };
  const handleContinue = () => {
    const cur = loadOrderDraft();
    saveOrderDraft({ ...cur, editor: { ...(cur as any).editor, elements, wishes, updatedAt: Date.now() } });
    const go = onRearSide || onSendOrder || onContinue;
    if (!go) return;
    setOutro(true);
    setTimeout(() => go({ elements, wishes }), 150);
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

  // Карточка миниатюры (прозрачная, без рамки; содержимое вписано до 120×120)
  const TrayCard: React.FC<{
    onClick: () => void;
    onDragStart: (e: React.DragEvent) => void;
    children: React.ReactNode;
  }> = ({ onClick, onDragStart, children }) => (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={{
        width: "100%",
        minHeight: 120,
        display: "grid",
        placeItems: "center",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "grab",
        userSelect: "none"
      }}
    >
      {children}
    </button>
  );

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

        {/* Подсказка */}
        <section
          style={{
            ...glassPanelStyle(),
            padding: "10px 12px",
            margin: "8px 0",
            fontSize: 13,
            lineHeight: 1.4
          }}
        >
          Перетащите миниатюру на эскиз или нажмите на неё — элемент добавится по центру. Затем перемещайте и изменяйте размер. Чтобы убрать элемент, нажмите 🗑 на его рамке.
        </section>

        {/* Единая палитра миниатюр (без подписей) */}
        <section style={{ ...glassPanelStyle(), padding: 10, margin: "12px 0" }}>
          {trayItems.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 10,
                alignItems: "stretch"
              }}
            >
              {trayItems.map((it, idx) => (
                <TrayCard
                  key={`ti-${it.type}-${it.key}-${idx}`}
                  onClick={() => addCentered(it.type, it.key)}
                  onDragStart={(e) => onTrayDragStart(e, { type: it.type, key: it.key })}
                >
                  {it.node}
                </TrayCard>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.9 }}>Все выбранные элементы уже размещены на эскизе.</div>
          )}
        </section>

        {/* Область редактора */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={editorWrapRef}
            onDragOver={onEditorDragOver}
            onDrop={onEditorDrop}
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
            {/* Подложка с изделием */}
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

            {/* невидимая картинка для измерения пропорций */}
            <img
              src={item?.url || ""}
              alt=""
              style={{ position: "absolute", inset: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              onLoad={(e) => {
                const im = e.currentTarget as HTMLImageElement;
                if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
              }}
              onError={() => {
                if (!(imgWH.w && imgWH.h)) setImgWH({ w: 4, h: 3 });
              }}
            />

            {/* Слой эскиза */}
            <ContentLayer />

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
                    border: selected ? "2px solid #8ab4ff" : "1px dashed rgba(255,255,255,0.85)",
                    borderRadius: 4,
                    boxSizing: "border-box",
                    background: "transparent",
                    pointerEvents: "auto",
                    cursor: el.locked ? "not-allowed" : "move",
                    touchAction: "none"
                  };
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
                    <div key={el.id} onPointerDown={(ev) => onPointerDownBox(ev, el.id, "move")} style={frameStyle} title={el.title || el.id}>
                      {selected && <MiniToolbar el={el} />}
                      {selected && !el.locked && (
                        <>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={knob(`-${KNOB_HIT / 2}px`, `-${KNOB_HIT / 2}px`, "nwse-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={knob(`calc(100% - ${KNOB_HIT / 2}px)`, `-${KNOB_HIT / 2}px`, "nesw-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={knob(`calc(100% - ${KNOB_HIT / 2}px)`, `calc(100% - ${KNOB_HIT / 2}px)`, "nwse-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={knob(`-${KNOB_HIT / 2}px`, `calc(100% - ${KNOB_HIT / 2}px)`, "nesw-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={knob(`calc(50% - ${KNOB_HIT / 2}px)`, `-${KNOB_HIT / 2}px`, "ns-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={knob(`calc(100% - ${KNOB_HIT / 2}px)`, `calc(50% - ${KNOB_HIT / 2}px)`, "ew-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={knob(`calc(50% - ${KNOB_HIT / 2}px)`, `calc(100% - ${KNOB_HIT / 2}px)`, "ns-resize")}><div style={knobDot} /></div>
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={knob(`-${KNOB_HIT / 2}px`, `calc(50% - ${KNOB_HIT / 2}px)`, "ew-resize")}><div style={knobDot} /></div>
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
          <label htmlFor="wishes" style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>
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

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>
            Назад
          </button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
