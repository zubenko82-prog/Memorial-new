// src/screens/EditorStep.tsx
// Редактор: берём готовую раскладку из SketchTemplate и навешиваем только рамки/контролы.
// Что важно:
// - Портреты, метрики, кресты, графика, эпитафии (в т.ч. многострочная ОДНА эпитафия) — рисует SketchTemplate.
// - EditorStep получает от SketchTemplate боксы (onLayout) и поверх показывает рамки с DnD/resize.
// - Эпитафии: одна эпитафия может содержать несколько строк (с \n) и остаётся одним элементом.
// - Предпросмотр (canvas) поддерживает многострочные эпитафии.
// - Защита от петель сохранения; автосохранение; Alt+клик — цикл выбора под курсором.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
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

/* ===== Types ===== */
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты 0..100 относительно области SketchTemplate
  z: number;
  title?: string;
  locked?: boolean;
  uppercase?: boolean; // metric/epitaph
  italic?: boolean;    // metric/epitaph
  flipH?: boolean;     // graphic
  bw?: boolean;        // portrait
  staircase?: boolean; // «Помним, любим, скорбим…»
};

type SketchLayoutBox = { x: number; y: number; w: number; h: number; type: ElType };

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
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clampBox = (x: number, y: number, w: number, h: number) => ({
  x: clamp(x, 0, 100 - w),
  y: clamp(y, 0, 100 - h),
  w: clamp(w, 2, 100),
  h: clamp(h, 2, 100)
});
const snap = (v: number, step = 1) => Math.round(v / step) * step;
const isRememberLoveMourn = (t?: string) =>
  (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim() === "помним любим скорбим";
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

/* ===== Компонент ===== */
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
  const wishesTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(
    () => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined),
    [imgWH]
  );

  // Защита от зацикливаний при сохранении
  const isSavingRef = useRef(false);
  const touchSaving = (ms = 350) => {
    isSavingRef.current = true;
    window.setTimeout(() => (isSavingRef.current = false), ms);
  };
  const saveEditor = (updater: (prev: OrderDraft) => OrderDraft) => {
    const prev = loadOrderDraft();
    const next = updater(prev);
    const prevJson = JSON.stringify(prev.editor || {});
    const nextJson = JSON.stringify(next.editor || {});
    if (prevJson === nextJson) return;
    touchSaving();
    saveOrderDraft(next);
  };

  // Live-reload драфта (без петель)
  useEffect(() => {
    const reload = () => {
      if (isSavingRef.current) return;
      setDraft(loadOrderDraft());
    };
    window.addEventListener("focus", reload);
    window.addEventListener("storage", reload);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reload();
    });
    window.addEventListener("draft:updated" as any, reload);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("storage", reload);
      document.removeEventListener("visibilitychange", reload as any);
      window.removeEventListener("draft:updated" as any, reload);
    };
  }, []);

  // Источники
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

  // ОДНА эпитафия может быть многострочной — это один элемент (не делим по строкам)
  const epitaphs = useMemo(() => {
    if (Array.isArray(engr?.epitaphs) && engr.epitaphs.length) return (engr.epitaphs as string[]).filter(Boolean);
    if (typeof engr?.epitaphText === "string" && engr.epitaphText.trim()) return [engr.epitaphText.trim()];
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

  /* ===== DnD/Resize рамок ===== */
  const dragRef = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number;
    start: EditorEl;
  } | null>(null);

  function contentRect() {
    const host = wrapperRef.current?.getBoundingClientRect();
    if (!host) return null;
    return { x: host.left, y: host.top, w: Math.max(1, host.width), h: Math.max(1, host.height) };
  }

  const onPointerDownBox = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move"
  ) => {
    e.stopPropagation();
    // Alt+клик — выбрать следующий элемент под курсором
    if (e.altKey && wrapperRef.current) {
      const hitId = pickElementUnderPointer(e.clientX, e.clientY, id);
      if (hitId) setSelectedId(hitId);
      return;
    }
    const el = elements.find((x) => x.id === id);
    if (!el || el.locked) return;
    setSelectedId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const rect = contentRect();
    if (!rect) return;

    const dxPct = ((e.clientX - d.startX) / rect.w) * 100;
    const dyPct = ((e.clientY - d.startY) / rect.h) * 100;
    const withSnap = !e.altKey;
    const snapStep = e.shiftKey ? 1.5 : 1;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        let { x, y, w, h } = d.start;

        if (d.mode === "move") {
          let nx = x + dxPct;
          let ny = y + dyPct;
          if (withSnap) { nx = snap(nx, snapStep); ny = snap(ny, snapStep); }
          return { ...el, ...clampBox(nx, ny, w, h) };
        }

        // resize
        const keepRatio = e.shiftKey;
        let nx = x, ny = y, nw = w, nh = h;
        const r0 = (w || 1) / (h || 1);

        if (d.mode.includes("e")) nw = w + dxPct;
        if (d.mode.includes("s")) nh = h + dyPct;
        if (d.mode.includes("w")) { nx = x + dxPct; nw = w - dxPct; }
        if (d.mode.includes("n")) { ny = y + dyPct; nh = h - dyPct; }

        if (keepRatio) {
          if (d.mode.includes("e") || d.mode.includes("w")) nh = nw / r0;
          if (d.mode.includes("n") || d.mode.includes("s")) nw = nh * r0;
        }

        if (withSnap) { nx = snap(nx, snapStep); ny = snap(ny, snapStep); nw = snap(nw, snapStep); nh = snap(nh, snapStep); }
        return { ...el, ...clampBox(nx, ny, nw, nh) };
      })
    );
  };

  const onPointerUp = () => { dragRef.current = null; };

  function pickElementUnderPointer(clientX: number, clientY: number, currentTopId?: string | null): string | null {
    const rect = contentRect();
    if (!rect) return null;
    const px = clientX - rect.x;
    const py = clientY - rect.y;
    const list = elements
      .slice()
      .sort((a, b) => b.z - a.z)
      .filter((el) => {
        const ex = (el.x / 100) * rect.w;
        const ey = (el.y / 100) * rect.h;
        const ew = (el.w / 100) * rect.w;
        const eh = (el.h / 100) * rect.h;
        return px >= ex && px <= ex + ew && py >= ey && py <= ey + eh;
      })
      .map((el) => el.id);

    if (list.length === 0) return null;
    if (!currentTopId || !list.includes(currentTopId)) return list[0];
    const idx = list.indexOf(currentTopId);
    return list[(idx + 1) % list.length];
  }

  /* ===== Приём раскладки от SketchTemplate ===== */
  const layoutHashRef = useRef<string>("");
  const applyLayoutFromSketch = (boxes: Record<string, SketchLayoutBox>) => {
    const ids = Object.keys(boxes).sort();
    const sig = ids.map((id) => {
      const b = boxes[id];
      return `${id}:${b.type}:${b.x.toFixed(2)}:${b.y.toFixed(2)}:${b.w.toFixed(2)}:${b.h.toFixed(2)}`;
    }).join("|");
    if (layoutHashRef.current === sig) return;
    layoutHashRef.current = sig;

    setElements((prev) => {
      const prevMap = new Map(prev.map((e) => [e.id, e]));
      const next: EditorEl[] = [];
      ids.forEach((id, i) => {
        const b = boxes[id];
        const old = prevMap.get(id);
        const base: EditorEl = old
          ? { ...old, x: b.x, y: b.y, w: b.w, h: b.h, type: b.type }
          : {
              id,
              type: b.type,
              x: b.x, y: b.y, w: b.w, h: b.h,
              z: 10 + i,
              title: id,
              uppercase: b.type === "metric" ? true : undefined,
              bw: b.type === "portrait" ? true : undefined
            };
        next.push(base);
        prevMap.delete(id);
      });
      // переносим элементы, которых нет в новой раскладке (кастом‑слои пользователя)
      prevMap.forEach((el) => next.push(el));
      return next;
    });

    // Сохраняем хэш раскладки в драфт (для быстрых сравнений)
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), sketchInitHash: sig, updatedAt: Date.now() }
    } as OrderDraft));
  };

  /* ===== Автосохранение ===== */
  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveEditor((prev) => ({
        ...prev,
        editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
      } as OrderDraft));
    }, 240) as unknown as number;
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); };
  }, [elements, wishes]);

  useEffect(() => {
    if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current);
    wishesTimerRef.current = window.setTimeout(() => {
      saveEditor((prev) => {
        if (prev.editor?.wishes === wishes) return prev;
        return { ...prev, editor: { ...(prev.editor || {}), wishes, updatedAt: Date.now() } } as OrderDraft;
      });
    }, 320) as unknown as number;
    return () => { if (wishesTimerRef.current) window.clearTimeout(wishesTimerRef.current); };
  }, [wishes]);

  /* ===== Превью (canvas) — с поддержкой многострочных эпитафий ===== */
  const renderPreview = async (W: number, H: number): Promise<string | null> => {
    if (W <= 0 || H <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // фон-подложка
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // base (фото изделия)
    const base = await (async () => {
      if (!item?.url) return null;
      return new Promise<HTMLImageElement | null>((resolve) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = item.url;
      });
    })();
    if (base) {
      const sr = base.width / base.height, dr = W / H;
      ctx.globalAlpha = 0.35;
      if (sr > dr) {
        const rw = W, rh = Math.round(W / sr), rx = 0, ry = Math.round((H - rh) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      } else {
        const rh = H, rw = Math.round(H * sr), ry = 0, rx = Math.round((W - rw) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      }
      ctx.globalAlpha = 1;
    }

    const fontFamily = `"Century Schoolbook","Times New Roman",serif`;

    // Сортированный список для рисования (по z)
    const els = elements.slice().sort((a, b) => a.z - b.z);
    for (const el of els) {
      const r = { x: (el.x / 100) * W, y: (el.y / 100) * H, w: (el.w / 100) * W, h: (el.h / 100) * H };
      const key = el.id.split("-").slice(1).join("-");

      if (el.type === "portrait") {
        const p = peopleBlocks.find((pp) => pp.id === key);
        const url = p?.photo || "";
        if (!url) continue;
        const im = await (async () => {
          return new Promise<HTMLImageElement | null>((resolve) => {
            const i = new Image();
            i.crossOrigin = "anonymous";
            i.onload = () => resolve(i);
            i.onerror = () => resolve(null);
            i.src = url;
          });
        })();
        if (!im) continue;
        const sr2 = im.width / im.height, dr2 = r.w / r.h;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.filter = el.bw ? "grayscale(100%)" : "none";
        if (sr2 > dr2) {
          const hh = r.h, ww = Math.round(hh * sr2), xx = Math.round(r.x + (r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const ww = r.w, hh = Math.round(ww / sr2), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
        ctx.filter = "none";
      } else if (el.type === "graphic") {
        const idx = Number(key);
        const g = Number.isFinite(idx) ? others[idx] : undefined;
        const url = g?.url || "";
        if (!url) continue;
        const im = await (async () => {
          return new Promise<HTMLImageElement | null>((resolve) => {
            const i = new Image();
            i.crossOrigin = "anonymous";
            i.onload = () => resolve(i);
            i.onerror = () => resolve(null);
            i.src = url;
          });
        })();
        if (!im) continue;
        ctx.save();
        if (el.flipH) {
          ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
          ctx.scale(-1, 1);
          ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
        const sr2 = im.width / im.height, dr2 = r.w / r.h;
        if (sr2 > dr2) {
          const ww = r.w, hh = Math.round(ww / sr2), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const hh = r.h, ww = Math.round(hh * sr2), xx = r.x + Math.round((r.w - ww) / 2), yy = r.y;
          ctx.drawImage(im, xx, yy, ww, hh);
        }
        ctx.restore();
      } else if (el.type === "cross") {
        const idx = Number(key);
        const c = Number.isFinite(idx) ? crosses[idx] : undefined;
        const url = c?.url || "";
        if (!url) continue;
        const im = await (async () => {
          return new Promise<HTMLImageElement | null>((resolve) => {
            const i = new Image();
            i.crossOrigin = "anonymous";
            i.onload = () => resolve(i);
            i.onerror = () => resolve(null);
            i.src = url;
          });
        })();
        if (!im) continue;
        const sr2 = im.width / im.height, dr2 = r.w / r.h;
        if (sr2 > dr2) {
          const ww = r.w, hh = Math.round(ww / sr2), xx = r.x, yy = Math.round(r.y + (r.h - hh) / 2);
          ctx.drawImage(im, xx, yy, ww, hh);
        } else {
          const hh = r.h, ww = Math.round(hh * sr2), xx = r.x + Math.round((r.w - ww) / 2), yy = r.y;
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
        const f1 = Math.max(10, Math.round(r.h * 0.28));
        const f2 = Math.max(10, Math.round(r.h * 0.24));
        const f3 = Math.max(10, Math.round(r.h * 0.20));
        const sizes = [f1, f2, f3];
        const lh = Math.max(10, Math.round(r.h / Math.max(1, lines.length)));
        const startY = r.y + r.h / 2 - ((lines.length - 1) * lh) / 2;
        const X = r.x + r.w / 2;
        lines.forEach((ln, i) => {
          ctx.font = `${el.italic ? "italic " : ""}${(sizes[i] || sizes[sizes.length - 1])}px ${fontFamily}`;
          ctx.fillText(tf(ln), X, startY + i * lh);
        });
        ctx.restore();
      } else if (el.type === "epitaph") {
        const idx = Number(key);
        const raw = Number.isFinite(idx) ? (epitaphs[idx] || "") : "";
        const text = el.uppercase ? raw.toUpperCase() : raw;

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        // Многострочная: делим по \n и центрируем блок
        const lines = String(text).split(/\r?\n/);
        const f = Math.max(10, Math.round(r.h / Math.max(1, lines.length) * 0.9));
        ctx.font = `${el.italic ? "italic " : ""}${f}px ${fontFamily}`;
        const totalH = f * lines.length;
        let y0 = r.y + (r.h - totalH) / 2 + f / 2;
        const X = r.x + r.w / 2;

        if (el.staircase && isRememberLoveMourn(text)) {
          const { top, mid, bot } = splitRememberPreserve(text);
          ctx.textAlign = "left"; ctx.fillText(top, r.x + 4, r.y + f * 0.8);
          ctx.textAlign = "center"; ctx.fillText(mid, X, r.y + r.h / 2);
          ctx.textAlign = "right"; ctx.fillText(bot, r.x + r.w - 4, r.y + r.h - f * 0.2);
        } else {
          ctx.textBaseline = "middle";
          lines.forEach((ln) => { ctx.fillText(ln, X, y0); y0 += f; });
        }
        ctx.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", 0.9);
  };

  // Дебаунс-генерация превью (с фильтрацией входов)
  const prevPreviewInputsRef = useRef<string>("");
  const prevSavedPreviewRef = useRef<{ mini?: string | null; big?: string | null }>({});
  const layoutAppliedHash = useRef<string>("");

  useEffect(() => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);

    const inputsSig = JSON.stringify({
      item: item?.url || "",
      elements: elements.map(({ id, x, y, w, h, z, type, uppercase, italic, flipH, bw, staircase }) => ({
        id, x, y, w, h, z, type, uppercase, italic, flipH, bw, staircase
      })),
      people: peopleBlocks.map((p) => ({ id: p.id, l: p.lines, has: !!p.photo })),
      crosses: crosses.map((c) => c.url),
      others: others.map((o) => o.url),
      epitaphs
    });

    if (prevPreviewInputsRef.current === inputsSig) return;
    prevPreviewInputsRef.current = inputsSig;

    previewTimerRef.current = window.setTimeout(async () => {
      const host = wrapperRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      const miniW = Math.max(320, Math.floor(r.width));
      const miniH = Math.max(320, Math.floor(r.height));
      const mini = await renderPreview(miniW, miniH);

      const maxSide = 1600;
      const ratio = r.width / (r.height || 1);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await renderPreview(bigW, bigH);

      const prevSaved = prevSavedPreviewRef.current;
      if ((mini || null) === (prevSaved.mini || null) && (big || null) === (prevSaved.big || null)) return;
      prevSavedPreviewRef.current = { mini, big };

      saveEditor((prev) => {
        const oldMini = (prev as any).editor?.previewUrl || null;
        const oldBig = (prev as any).editor?.previewHiUrl || null;
        if ((mini || null) === oldMini && (big || null) === oldBig) return prev;
        return {
          ...prev,
          editor: {
            ...(prev.editor || {}),
            previewUrl: mini || oldMini,
            previewHiUrl: big || oldBig,
            previewUpdatedAt: Date.now(),
            elements,
            wishes
          }
        } as OrderDraft;
      });
    }, 260) as unknown as number;

    return () => { if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current); };
  }, [item?.url, elements, peopleBlocks, crosses, others, epitaphs]);

  /* ===== Навигация ===== */
  const handleBack = () => {
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    } as OrderDraft));
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };
  const handleContinue = () => {
    saveEditor((prev) => ({
      ...prev,
      editor: { ...(prev.editor || {}), elements, wishes, updatedAt: Date.now() }
    } as OrderDraft));
    const go = onRearSide || onSendOrder || onContinue;
    if (!go) return;
    setOutro(true);
    setTimeout(() => go({ elements, wishes }), 150);
  };

  /* ===== Рамки и мини‑панель ===== */
  const handleDot = (left: number | string, top: number | string, cursor: string): React.CSSProperties => ({
    position: "absolute",
    left, top,
    width: 10, height: 10,
    background: "#fff", border: "1px solid #000",
    borderRadius: 2, transform: "translate(-50%, -50%)",
    cursor
  });

  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    const isMetric = el.type === "metric";
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
    return (
      <div
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{
          position: "absolute", left: 0, top: -30,
          display: "flex", gap: 6,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 6, padding: "2px 6px",
          alignItems: "center", pointerEvents: "auto", zIndex: 3000
        }}
      >
        {isMetric && (
          <button
            type="button"
            style={btn}
            title={el.uppercase ? "Сделать строчные" : "Сделать ПРОПИСНЫЕ"}
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, uppercase: !e.uppercase } : e)))}
          >
            {el.uppercase ? "строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}
        {isEpitaph && (
          <button
            type="button"
            style={btn}
            title={el.italic ? "Обычный стиль" : "Курсив"}
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, italic: !e.italic } : e)))}
          >
            {el.italic ? "Обычный" : "Курсив"}
          </button>
        )}
        {isGraphic && (
          <button
            type="button"
            style={btn}
            title="Отразить по горизонтали"
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))}
          >
            Отразить ⇄
          </button>
        )}
      </div>
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
          Разместите элементы условно. Укажите порядок и выравнивание (верх/низ, слева/справа). Финальный вариант сделает специалист исходя из технических требований и согласно этой схеме.
        </section>

        {/* Эскиз (контент рендерит SketchTemplate), рамки — поверх */}
        <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
          <div
            ref={wrapperRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerDown={(e) => {
              if (e.altKey) {
                const hit = pickElementUnderPointer(e.clientX, e.clientY, null);
                if (hit) setSelectedId(hit);
              } else {
                setSelectedId(null);
              }
            }}
            style={{
              position: "relative",
              width: "100%",
              borderRadius: 10,
              overflow: "hidden",
              userSelect: "none",
              background: "rgba(0,0,0,0.85)",
              aspectRatio: aspect,
              minHeight: aspect ? undefined : 540
            }}
          >
            {/* Полный эскиз */}
            <SketchTemplate
              item={item}
              peopleBlocks={peopleBlocks}
              crosses={crosses}
              others={others}
              epitaphs={epitaphs}
              carvingOpacity={0.4}
              // Получаем проценты 0..100 для каждого бокса
              onLayout={(boxes: Record<string, SketchLayoutBox>) => applyLayoutFromSketch(boxes)}
            />

            {/* Рамки поверх */}
            <div style={{ position: "absolute", inset: 0, zIndex: 1000, pointerEvents: "none" }}>
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
                        left: `${el.x}%`, top: `${el.y}%`,
                        width: `${el.w}%`, height: `${el.h}%`,
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
                          {/* Углы */}
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={{ position: "absolute", left: 0, top: 0, ...handleDot(0, 0, "nwse-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={{ position: "absolute", left: "100%", top: 0, ...handleDot("100%", 0, "nesw-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={{ position: "absolute", left: "100%", top: "100%", ...handleDot("100%", "100%", "nwse-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={{ position: "absolute", left: 0, top: "100%", ...handleDot(0, "100%", "nesw-resize") }} />
                          {/* Стороны */}
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")} style={{ position: "absolute", left: "50%", top: 0, ...handleDot("50%", 0, "ns-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")} style={{ position: "absolute", left: "100%", top: "50%", ...handleDot("100%", "50%", "ew-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")} style={{ position: "absolute", left: "50%", top: "100%", ...handleDot("50%", "100%", "ns-resize") }} />
                          <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")} style={{ position: "absolute", left: 0, top: "50%", ...handleDot(0, "50%", "ew-resize") }} />
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
            placeholder="Например: ещё уменьшить портрет, метрику сузить, эпитафию сделать лесенкой…"
            style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.35)", color: "#fff", padding: 10, resize: "vertical", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>Пожелания будут учтены при подготовке финального макета.</div>
        </section>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "10px 0", flexWrap: "wrap" }}>
          <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
        </div>
      </div>
    </div>
  );
}
