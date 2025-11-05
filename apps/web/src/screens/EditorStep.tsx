// src/screens/EditorStep.tsx
// Live-редактор: синхронизация с TopBar (драфт) без перезатирания,
// предпросмотр (микро и большое), тулбары у элементов, безопасная начальная раскладка,
// подложка-градиент ПОД эскизом — как на шаге эпитафии.
//
// Правки по ТЗ:
// - Расстановка сохраняется: applyDraftDiff НЕ трогает x/y/w/h у уже существующих элементов (только добавляет/удаляет/обновляет текст/URL).
// - Начальная раскладка всегда в пределах холста: кламп координат + динамический расчет стартов по Y.
// - Если элементов много — уменьшаем их (масштабируем блоки эпитафий/графики/крестов).
// - Портрет изначально Ч/Б, расположен 10–15% от верха (y≈12%).
// - Добавлен флип по горизонтали для графики (toggle в тулбаре, отрисовка и на холсте, и в canvas).
// - ДОБАВЛЕНО: Горизонтальный шаблон для людей (вертикальный оставлен).
//   • Горизонтальный: делим холст на N равных колонок, в каждой — портрет (верх) и метрика (ниже).
//   • Кнопки: «Горизонтальный», «Вертикальный» + «Авторазместить» для перераскладки портретов/метрик.
//   • Авторасстановка применяется только к элементам типа portrait/metric, остальная геометрия не меняется.
//
// Примечание:
// - Введена LAYOUT_VERSION, чтобы один раз пересобрать безопасную раскладку (и не перезатирать далее локальные правки).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

const LAYOUT_VERSION = 2;
const FONT_CENTURY = `"Century Schoolbook", "Century Schoolbook L", "Century Schoolbook Bold", "Times New Roman", serif`;

/* ===== UI ===== */
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm") {
  const pad = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: pad[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    cursor: "pointer",
    transition: "transform 200ms ease"
  } as React.CSSProperties;
}
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function bottomUnderlayGradient() {
  return {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  } as React.CSSProperties;
}

/* ===== Utils ===== */
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
function personKey(p: any) {
  return p?.id || String([...(linesFromPerson(p) || [])].join("|") || "person").toLowerCase();
}
function epitaphId(text: string) {
  const t = (text || "").trim();
  const ascii = t
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "ep";
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 131 + t.charCodeAt(i)) >>> 0;
  return `ep-${ascii}-${hash.toString(16)}`;
}
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

/* ===== Types ===== */
type ElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; z: number;
  url?: string; name?: string;
  text?: string; baseFontPx?: number; currentFontPx?: number; fontWeight?: number; fontStyle?: "normal" | "italic";
  uppercase?: boolean; epLayout?: "inline" | "ladder"; imgBW?: boolean;
  flipH?: boolean;
};

type Props = {
  onBack?: () => void;
  onSaveDraft?: (payload: any) => void;
  onContinue?: (payload: any) => void;
};

/* ===== Geometry helpers ===== */
const centerX = (wPct: number) => Math.max(0, Math.min(100 - wPct, 50 - wPct / 2));
const clamp01 = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));
function clampEl<T extends { x: number; y: number; w: number; h: number }>(e: T): T {
  const x = clamp01(e.x, 0, 100 - e.w);
  const y = clamp01(e.y, 0, 100 - e.h);
  return { ...e, x, y };
}
function computeStartY(totalH: number, preferStart: number, bottomMargin = 2) {
  const maxStart = 100 - totalH - bottomMargin;
  return clamp01(Math.min(preferStart, maxStart));
}

/* ===== Layout defaults ===== */
const POS = {
  cross:   { x: 4,  yStart: 4,  w: 18, h: 12, vGap: 12, minW: 12, minH: 8 },
  portrait:{ y: 12, w: 48, h: 26 },
  metric:  { y: 42, w: 72, h: 16 },
  epitaph: { yStart: 64, w: 88, h: 7, gap: 2, minH: 5 },
  graphic: { y: 80, w: 70, h: 10, gap: 4, minH: 6, minW: 40 }
};

export default function EditorStep({ onBack, onSaveDraft, onContinue }: Props) {
  const [outro, setOutro] = useState(false);

  // Template orientation (horizontal/vertical) for people layout
  const [peopleTemplate, setPeopleTemplate] = useState<"horizontal" | "vertical">("vertical");

  // Canvas/DOM
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 1, h: 1 });
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(() => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined), [imgWH]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const measure = () => {
      const r = containerRef.current?.getBoundingClientRect();
      setContainerSize({ w: Math.max(1, r?.width || 1), h: Math.max(1, r?.height || 1) });
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(containerRef.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // State
  const [elements, setElements] = useState<EditorEl[]>(() => (loadOrderDraft() as any)?.editor?.elements || []);
  const [bgItemUrl, setBgItemUrl] = useState<string>(() => loadOrderDraft()?.item?.url || "");
  const sourceSnapRef = useRef<{
    itemUrl: string;
    epIds: string[]; epTexts: string[];
    crossIds: string[]; otherIds: string[];
    people: { id: string; text: string; photo: string }[];
  } | null>(null);
  const suspendSaveRef = useRef(false);

  // Build safe initial layout (default vertical for multi-person)
  const buildFromDraft = useCallback((draft: any) => {
    const itemUrl = draft?.item?.url || "";
    const engraving = draft?.engraving || {};
    const graphics = Array.isArray(draft?.graphics) ? draft.graphics : [];

    const epitaphs: string[] =
      Array.isArray(engraving?.epitaphs) && engraving.epitaphs.length
        ? engraving.epitaphs.filter(Boolean)
        : (engraving?.epitaphText
            ? String(engraving.epitaphText).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
            : []);

    const peopleBlocks =
      Array.isArray(engraving?.persons) && engraving.persons.length
        ? engraving.persons.map((p: any, idx: number) => ({
            id: personKey(p) || `person-${idx}`,
            lines: linesFromPerson(p),
            photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
          }))
        : (() => {
            const out: string[] = [];
            if (engraving?.fullName) out.push(String(engraving.fullName));
            const dates: string[] = [];
            if (engraving?.birthDate) dates.push(String(engraving.birthDate));
            if (engraving?.deathDate) dates.push(String(engraving.deathDate));
            if (dates.length) out.push(dates.join(" — "));
            if (Array.isArray(engraving?.lines) && engraving.lines.length) out.push(...engraving.lines.filter(Boolean));
            const photo = engraving?.photoPreview || engraving?.photoDataUrl || engraving?.photoUrl || engraving?.photo || null;
            return out.length || photo ? [{ id: "legacy-0", lines: out, photo }] : [];
          })();

    const crosses = graphics.filter((g: any) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug));
    const others  = graphics.filter((g: any) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug));

    const els: EditorEl[] = [];
    let z = 1;

    // Crosses
    if (crosses.length) {
      const count = Math.min(crosses.length, 6);
      let w = POS.cross.w, h = POS.cross.h, gap = POS.cross.vGap;
      const targetSpan = 36;
      const totalH = count * h + (count - 1) * gap;
      const s = Math.min(1, targetSpan / Math.max(totalH, 1));
      h = Math.max(POS.cross.minH, Math.round(h * s));
      w = Math.max(POS.cross.minW, Math.round(w * s));
      gap = Math.max(6, Math.round(gap * s));
      let y = POS.cross.yStart;
      crosses.slice(0, count).forEach((g: any) => {
        els.push(clampEl({ id: `cross-${g.id}`, type: "cross", x: POS.cross.x, y, w, h, z: z++, url: g.url, name: g.name, imgBW: false }));
        y += h + gap;
      });
    }

    // People default (vertical multi-row; single-person center)
    if (peopleBlocks.length === 1) {
      const p = peopleBlocks[0];
      if (p.photo) {
        els.push(clampEl({
          id: `portrait-${p.id}`, type: "portrait",
          x: centerX(POS.portrait.w), y: POS.portrait.y, w: POS.portrait.w, h: POS.portrait.h,
          z: z++, url: p.photo || undefined, name: "Портрет", imgBW: true
        }));
      }
      const text = (p.lines || []).join("\n");
      if (text) {
        els.push(clampEl({
          id: `metric-${p.id}`, type: "metric",
          x: centerX(POS.metric.w), y: POS.metric.y, w: POS.metric.w, h: POS.metric.h,
          z: z++, text, baseFontPx: 26, currentFontPx: 26, fontWeight: 700, fontStyle: "normal", uppercase: true
        }));
      }
    } else if (peopleBlocks.length > 1) {
      const startY = crosses.length ? 18 : 12;
      const rowH = 16;
      peopleBlocks.slice(0, 3).forEach((p, idx) => {
        const rowY = startY + idx * (rowH + 2);
        if (p.photo) els.push(clampEl({ id: `portrait-${p.id}`, type: "portrait", x: 12, y: rowY, w: 22, h: 14, z: z++, url: p.photo || undefined, name: "Портрет", imgBW: true }));
        const text = (p.lines || []).join("\n");
        if (text) els.push(clampEl({ id: `metric-${p.id}`, type: "metric", x: 38, y: rowY, w: 50, h: 14, z: z++, text, baseFontPx: 22, currentFontPx: 22, fontWeight: 700, fontStyle: "normal", uppercase: true }));
      });
    }

    // Epitaphs
    if (epitaphs.length) {
      const count = Math.min(epitaphs.length, 10);
      let h = POS.epitaph.h, gap = POS.epitaph.gap;
      let total = count * h + (count - 1) * gap;
      let y = computeStartY(total, POS.epitaph.yStart, 4);
      if (y + total > 98) {
        const s = Math.min(1, (98 - y) / Math.max(total, 1));
        h = Math.max(POS.epitaph.minH, Math.round(h * s));
        gap = Math.max(1, Math.round(gap * s));
        total = count * h + (count - 1) * gap;
        y = computeStartY(total, POS.epitaph.yStart, 2);
      }
      const epIds = epitaphs.map(epitaphId);
      epIds.slice(0, count).forEach((id, i) => {
        els.push(clampEl({
          id, type: "epitaph",
          x: centerX(POS.epitaph.w), y, w: POS.epitaph.w, h, z: z++,
          text: epitaphs[i], baseFontPx: 20, currentFontPx: 20, fontWeight: 700, fontStyle: "italic", epLayout: "ladder"
        }));
        y += h + gap;
      });
    }

    // Graphics
    if (others.length) {
      const count = Math.min(others.length, 8);
      let h = POS.graphic.h, gap = POS.graphic.gap, w = POS.graphic.w;
      let total = count * h + (count - 1) * gap;
      let y = computeStartY(total, POS.graphic.y, 2);
      if (y + total > 98) {
        const s = Math.min(1, (98 - y) / Math.max(total, 1));
        h = Math.max(POS.graphic.minH, Math.round(h * s));
        gap = Math.max(2, Math.round(gap * s));
        total = count * h + (count - 1) * gap;
        y = computeStartY(total, POS.graphic.y, 2);
      }
      others.slice(0, count).forEach((g: any) => {
        els.push(clampEl({
          id: `graphic-${g.id}`, type: "graphic",
          x: centerX(w), y, w, h, z: z++, url: g.url, name: g.name, flipH: false
        }));
        y += h + gap;
      });
    }

    const snap = {
      itemUrl,
      epIds: epitaphs.map(epitaphId),
      epTexts: epitaphs.slice(),
      crossIds: crosses.map((g: any) => String(g.id)),
      otherIds: others.map((g: any) => String(g.id)),
      people: (peopleBlocks || []).map((p: any) => ({ id: p.id, text: (p.lines || []).join("\n"), photo: p.photo || "" }))
    };

    return { itemUrl, els, snap };
  }, []);

  // applyDraftDiff: не трогаем x/y/w/h у существующих элементов
  const applyDraftDiff = useCallback((dr: any) => {
    const built = buildFromDraft(dr);
    const nextSnap = built.snap;
    const prevSnap = sourceSnapRef.current;

    setBgItemUrl(built.itemUrl || "");

    if (!prevSnap || elements.length === 0) {
      suspendSaveRef.current = true;
      sourceSnapRef.current = nextSnap;
      setElements(built.els);
      setTimeout(() => (suspendSaveRef.current = false), 0);
      return true;
    }

    let changed = false;

    // Epitaphs
    if (JSON.stringify(prevSnap.epIds) !== JSON.stringify(nextSnap.epIds) ||
        JSON.stringify(prevSnap.epTexts) !== JSON.stringify(nextSnap.epTexts)) {
      suspendSaveRef.current = true;
      setElements((prevEls) => {
        const els = prevEls.slice();
        const idxById = new Map<string, number>();
        els.forEach((e, i) => { if (e.type === "epitaph") idxById.set(e.id, i); });
        prevSnap.epIds.forEach((id) => {
          if (!nextSnap.epIds.includes(id)) {
            const i = idxById.get(id);
            if (typeof i === "number") { els.splice(i, 1); idxById.delete(id); changed = true; }
          }
        });
        let maxZ = els.reduce((m, e) => Math.max(m, e.z), 0);
        nextSnap.epIds.forEach((id, i) => {
          const j = idxById.get(id);
          const text = nextSnap.epTexts[i];
          if (typeof j === "number") {
            if (els[j].text !== text) { els[j] = { ...els[j], text }; changed = true; }
          } else {
            const proto = built.els.find((e) => e.id === id);
            const safe = proto ? clampEl(proto) : clampEl({ id, type: "epitaph", x: centerX(70), y: 70, w: 70, h: 7, z: ++maxZ } as any);
            els.push({ ...safe, text, baseFontPx: 20, currentFontPx: 20, fontWeight: 700, fontStyle: "italic", epLayout: "ladder" });
            changed = true;
          }
        });
        return els;
      });
      setTimeout(() => (suspendSaveRef.current = false), 0);
    }

    // People (add/remove/update content only)
    if (JSON.stringify(prevSnap.people) !== JSON.stringify(nextSnap.people)) {
      suspendSaveRef.current = true;
      setElements((prevEls) => {
        let els = prevEls.slice();
        const nextMap = new Map(nextSnap.people.map((p) => [p.id, p]));
        prevSnap.people.forEach((pp) => {
          if (!nextMap.has(pp.id)) {
            els = els.filter((e) => !(e.type === "metric" && e.id === `metric-${pp.id}`) && !(e.type === "portrait" && e.id === `portrait-${pp.id}`));
            changed = true;
          }
        });
        let zCounter = els.reduce((m, e) => Math.max(m, e.z), 0);
        nextSnap.people.forEach((np) => {
          const mid = `metric-${np.id}`;
          const mi = els.findIndex((e) => e.id === mid);
          if (np.text) {
            if (mi >= 0) {
              if (els[mi].text !== np.text) { els[mi] = { ...els[mi], text: np.text }; changed = true; }
            } else {
              const proto = built.els.find((e) => e.id === mid);
              const safe = proto ? clampEl(proto) : clampEl({ id: mid, type: "metric", x: centerX(72), y: 42, w: 72, h: 16, z: ++zCounter } as any);
              els.push({ ...safe, text: np.text, baseFontPx: 26, currentFontPx: 26, fontWeight: 700, fontStyle: "normal", uppercase: true });
              changed = true;
            }
          } else if (mi >= 0) { els.splice(mi, 1); changed = true; }

          const pid = `portrait-${np.id}`;
          const pi = els.findIndex((e) => e.id === pid);
          if (np.photo) {
            if (pi >= 0) {
              if (els[pi].url !== np.photo) { els[pi] = { ...els[pi], url: np.photo }; changed = true; }
            } else {
              const proto = built.els.find((e) => e.id === pid);
              const safe = proto ? clampEl(proto) : clampEl({ id: pid, type: "portrait", x: centerX(48), y: 12, w: 48, h: 26, z: ++zCounter } as any);
              els.push({ ...safe, url: np.photo, name: "Портрет", imgBW: true });
              changed = true;
            }
          } else if (pi >= 0) { els.splice(pi, 1); changed = true; }
        });

        return els;
      });
      setTimeout(() => (suspendSaveRef.current = false), 0);
    }

    // Crosses
    if (JSON.stringify(prevSnap.crossIds) !== JSON.stringify(nextSnap.crossIds)) {
      suspendSaveRef.current = true;
      setElements((prevEls) => {
        const els = prevEls.slice();
        const existing = new Map<string, number>();
        els.forEach((e, i) => { if (e.type === "cross") existing.set(e.id.replace(/^cross-/, ""), i); });
        prevSnap.crossIds.forEach((id) => {
          if (!nextSnap.crossIds.includes(id)) {
            const i = existing.get(id);
            if (typeof i === "number") { els.splice(i, 1); existing.delete(id); changed = true; }
          }
        });
        let maxZ = els.reduce((m, e) => Math.max(m, e.z), 0);
        const nextObjs = (dr?.graphics || []).filter((g: any) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug));
        nextSnap.crossIds.forEach((id) => {
          const gi = existing.get(id);
          const g = nextObjs.find((gg: any) => String(gg.id) === id);
          if (!g) return;
          if (typeof gi === "number") {
            const old = els[gi];
            if (old.url !== g.url || old.name !== g.name) { els[gi] = { ...old, url: g.url, name: g.name }; changed = true; }
          } else {
            const proto = built.els.find((e) => e.id === `cross-${id}`);
            const safe = proto ? clampEl(proto as any) : clampEl({ id: `cross-${id}`, type: "cross", x: POS.cross.x, y: POS.cross.yStart, w: POS.cross.w, h: POS.cross.h, z: ++maxZ } as any);
            els.push({ ...safe, url: g.url, name: g.name });
            changed = true;
          }
        });
        return els;
      });
      setTimeout(() => (suspendSaveRef.current = false), 0);
    }

    // Graphics
    if (JSON.stringify(prevSnap.otherIds) !== JSON.stringify(nextSnap.otherIds)) {
      suspendSaveRef.current = true;
      setElements((prevEls) => {
        let els = prevEls.slice();
        const existing = new Map<string, number>();
        els.forEach((e, i) => { if (e.type === "graphic") existing.set(e.id.replace(/^graphic-/, ""), i); });
        prevSnap.otherIds.forEach((id) => {
          if (!nextSnap.otherIds.includes(id)) {
            const i = existing.get(id);
            if (typeof i === "number") { els.splice(i, 1); existing.delete(id); changed = true; }
          }
        });
        let maxZ = els.reduce((m, e) => Math.max(m, e.z), 0);
        const nextObjs = (dr?.graphics || []).filter((g: any) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug));
        nextSnap.otherIds.forEach((id) => {
          const gi = existing.get(id);
          const g = nextObjs.find((gg: any) => String(gg.id) === id);
          if (!g) return;
          if (typeof gi === "number") {
            const old = els[gi];
            if (old.url !== g.url || old.name !== g.name) { els[gi] = { ...old, url: g.url, name: g.name }; changed = true; }
          } else {
            const proto = built.els.find((e) => e.id === `graphic-${id}`);
            const safe = proto ? clampEl(proto as any) : clampEl({ id: `graphic-${id}`, type: "graphic", x: centerX(POS.graphic.w), y: POS.graphic.y, w: POS.graphic.w, h: POS.graphic.h, z: ++maxZ } as any);
            els.push({ ...safe, url: g.url, name: g.name, flipH: false });
            changed = true;
          }
        });
        return els;
      });
      setTimeout(() => (suspendSaveRef.current = false), 0);
    }

    sourceSnapRef.current = nextSnap;
    return changed;
  }, [buildFromDraft, elements.length]);

  // Auto layout (people only): horizontal/vertical templates
  const autoLayoutPeople = useCallback((template: "horizontal" | "vertical") => {
    const snap = sourceSnapRef.current;
    if (!snap || snap.people.length === 0) return;
    setElements((prev) => {
      let els = prev.slice();
      const people = snap.people.slice(0); // order from draft
      if (template === "horizontal") {
        // Equal columns across width
        const n = people.length;
        const margin = 2; const gap = Math.min(3, Math.max(1, Math.round(100 / (n * 12)))); // adaptive small gap
        const colW = Math.max(14, (100 - margin * 2 - gap * (n - 1)) / Math.max(1, n));
        // portrait/metric sizes (in % of canvas)
        const pH = 26; // similar to POS.portrait.h
        const mH = 14; // similar to POS.metric.h
        const pY = 10; // top
        const mY = pY + pH + 4;
        people.forEach((p, i) => {
          const x = clamp01(margin + i * (colW + gap));
          const pid = `portrait-${p.id}`;
          const mid = `metric-${p.id}`;
          els = els.map((e) =>
            e.id === pid ? clampEl({ ...e, x, y: pY, w: colW, h: pH }) :
            e.id === mid ? clampEl({ ...e, x, y: mY, w: colW, h: mH }) : e
          );
        });
      } else {
        // Vertical rows: image on left, metric on right per row
        const startY = 12;
        const rowH = 14;
        const gapY = 2;
        people.forEach((p, idx) => {
          const rowY = startY + idx * (rowH + gapY);
          const pid = `portrait-${p.id}`;
          const mid = `metric-${p.id}`;
          els = els.map((e) =>
            e.id === pid ? clampEl({ ...e, x: 12, y: rowY, w: 22, h: rowH }) :
            e.id === mid ? clampEl({ ...e, x: 38, y: rowY, w: 50, h: rowH }) : e
          );
        });
      }
      return els;
    });
  }, []);

  // Refresh from draft + versioned rebuild
  const refreshFromDraft = useCallback(() => {
    const dr = loadOrderDraft();
    const needRebuild = (dr?.editor?.layoutVersion || 0) !== LAYOUT_VERSION;
    const built = buildFromDraft(dr);

    if (elements.length === 0 || needRebuild) {
      suspendSaveRef.current = true;
      sourceSnapRef.current = built.snap;
      setElements(built.els);
      setBgItemUrl(built.itemUrl || "");
      const prev = loadOrderDraft();
      saveOrderDraft({ ...prev, editor: { ...(prev.editor || {}), layoutVersion: LAYOUT_VERSION } });
      setTimeout(() => {
        suspendSaveRef.current = false;
        // Первичная авторасстановка по горизонтальному шаблону, если изображение горизонтальное
        // (иначе оставляем вертикальный по умолчанию)
        // Вычислим из текущих размеров (imgWH пока не известны, используем itemUrl позже в onLoad)
      }, 0);
      return;
    }

    applyDraftDiff(dr);
  }, [applyDraftDiff, buildFromDraft, elements.length]);

  // First mount + subscriptions
  useEffect(() => { refreshFromDraft(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => refreshFromDraft();
    const onVisible = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") refreshFromDraft(); };
    window.addEventListener(DRAFT_UPDATED_EVENT, handler as any);
    window.addEventListener("storage", handler);
    window.addEventListener("focus", handler);
    window.addEventListener("hashchange", handler);
    window.addEventListener("popstate", handler);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, handler as any);
      window.removeEventListener("storage", handler);
      window.removeEventListener("focus", handler);
      window.removeEventListener("hashchange", handler);
      window.removeEventListener("popstate", handler);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshFromDraft]);

  // Save only on local edits
  useEffect(() => {
    if (suspendSaveRef.current) return;
    const prev = loadOrderDraft();
    saveOrderDraft({ ...prev, editor: { ...(prev.editor || {}), elements, layoutVersion: LAYOUT_VERSION, updatedAt: Date.now() } });
    onSaveDraft?.({ editorElements: elements });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  /* ===== Preview (mini and hi) ===== */
  const previewTimerRef = useRef<number | null>(null);

  const renderPreview = useCallback(async (W: number, H: number): Promise<string | null> => {
    if (W <= 0 || H <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Base item
    const base = await loadImageSafe(bgItemUrl);
    if (base) {
      const sr = base.width / base.height, dr = W / H;
      if (sr > dr) {
        const rw = W, rh = Math.round(W / sr), rx = 0, ry = Math.round((H - rh) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      } else {
        const rh = H, rw = Math.round(H * sr), ry = 0, rx = Math.round((W - rw) / 2);
        ctx.drawImage(base, rx, ry, rw, rh);
      }
    }

    // Elements
    const els = elements.slice().sort((a, b) => a.z - b.z);
    for (const el of els) {
      const rect = { x: (el.x / 100) * W, y: (el.y / 100) * H, w: (el.w / 100) * W, h: (el.h / 100) * H };

      if (el.type === "portrait" || el.type === "graphic" || el.type === "cross") {
        if (!el.url) continue;
        const im = await loadImageSafe(el.url);
        if (!im) continue;

        if (el.type === "portrait") {
          const rr = (() => {
            const sr = im.width / im.height, dr = rect.w / rect.h;
            if (sr > dr) return { h: rect.h, w: Math.round(rect.h * sr), x: Math.round(rect.x + (rect.w - Math.round(rect.h * sr)) / 2), y: rect.y };
            return { w: rect.w, h: Math.round(rect.w / sr), x: rect.x, y: Math.round(rect.y + (rect.h - Math.round(rect.w / sr)) / 2) };
          })();
          ctx.save();
          ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
          ctx.filter = el.imgBW ? "grayscale(100%)" : "none";
          ctx.drawImage(im, rr.x, rr.y, rr.w, rr.h);
          ctx.restore();
        } else {
          ctx.save();
          if (el.type === "graphic" && el.flipH) {
            ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
            ctx.scale(-1, 1);
            ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
          }
          const rr = (() => {
            const sr = im.width / im.height, dr = rect.w / rect.h;
            if (sr > dr) return { w: rect.w, h: Math.round(rect.w / sr), x: rect.x, y: Math.round(rect.y + (rect.h - Math.round(rect.w / sr)) / 2) };
            return { h: rect.h, w: Math.round(rect.h * sr), y: rect.y, x: Math.round(rect.x + (rect.w - Math.round(rect.h * sr)) / 2) };
          })();
          ctx.drawImage(im, rr.x, rr.y, rr.w, rr.h);
          ctx.restore();
        }
      } else if (el.type === "metric" || el.type === "epitaph") {
        const lines = (el.text || "").split("\n").map((s) => s.trim()).filter(Boolean);
        const fontPx = el.currentFontPx || el.baseFontPx || 20;
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${fontPx}px ${FONT_CENTURY}`;
        const cy = rect.y + rect.h / 2;
        const lh = fontPx * 1.2;
        const startY = cy - ((lines.length - 1) * lh) / 2;
        lines.forEach((ln, i) => ctx.fillText(ln, rect.x + rect.w / 2, startY + i * lh));
        ctx.restore();
      }
    }

    return canvas.toDataURL("image/jpeg", 0.9);
  }, [bgItemUrl, elements]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(async () => {
      const miniW = Math.max(320, Math.floor(containerSize.w));
      const miniH = Math.max(320, Math.floor(containerSize.h));
      const mini = await renderPreview(miniW, miniH);
      const maxSide = 1600;
      const ratio = containerSize.w > 0 && containerSize.h > 0 ? containerSize.w / containerSize.h : 1;
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await renderPreview(bigW, bigH);

      const prevEditor = (loadOrderDraft().editor || {});
      saveOrderDraft({ editor: { ...prevEditor, previewUrl: mini || prevEditor.previewUrl, previewHiUrl: big || prevEditor.previewHiUrl, previewUpdatedAt: Date.now(), layoutVersion: LAYOUT_VERSION } });
    }, 150) as unknown as number;

    return () => {
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    };
  }, [renderPreview, containerSize]);

  /* ===== DnD / Resize ===== */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const pxToPctX = (dx: number) => (dx / containerSize.w) * 100;
  const pxToPctY = (dy: number) => (dy / containerSize.h) * 100;
  const bringToFront = (id: string) =>
    setElements((prev) => {
      const maxZ = prev.reduce((m, e) => Math.max(m, e.z), 0);
      return prev.map((e) => (e.id === id ? { ...e, z: maxZ + 1 } : e));
    });

  const dragRef = useRef<{
    id: string; mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number; startY: number; start: EditorEl; capture: HTMLElement | null;
  } | null>(null);

  const onPointerDownEl = (e: React.PointerEvent, id: string, mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move") => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch {}
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    bringToFront(id);
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el }, capture: target };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    e.preventDefault();
    const dxPct = pxToPctX(e.clientX - d.startX);
    const dyPct = pxToPctY(e.clientY - d.startY);
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        let { x, y, w, h } = d.start;
        const minW = 4, minH = 3;
        if (d.mode === "move") {
          x = clamp(x + dxPct, 0, 100 - w);
          y = clamp(y + dyPct, 0, 100 - h);
          return clampEl({ ...el, x, y, w, h });
        }
        let nx = x, ny = y, nw = w, nh = h;
        const hSide = (side: "w" | "e") => {
          if (side === "e") nw = clamp(w + dxPct, minW, 100 - x);
          else { nx = clamp(x + dxPct, 0, x + w - minW); nw = clamp(w - dxPct, minW, 100 - nx); }
        };
        const vSide = (side: "n" | "s") => {
          if (side === "s") nh = clamp(h + dyPct, minH, 100 - y);
          else { ny = clamp(y + dyPct, 0, y + h - minH); nh = clamp(h - dyPct, minH, 100 - ny); }
        };
        if (d.mode.includes("e")) hSide("e");
        if (d.mode.includes("w")) hSide("w");
        if (d.mode.includes("s")) vSide("s");
        if (d.mode.includes("n")) vSide("n");
        let currentFontPx = el.currentFontPx;
        if ((el.type === "metric" || el.type === "epitaph") && el.baseFontPx) {
          currentFontPx = Math.max(10, Math.round((d.start.baseFontPx || 20) * (nh / d.start.h)));
        }
        return clampEl({ ...el, x: nx, y: ny, w: nw, h: nh, currentFontPx });
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d?.capture) { try { d.capture.releasePointerCapture((e as any).pointerId); } catch {} }
    dragRef.current = null;
  };

  /* ===== Тулбар у выбранного элемента ===== */
  const renderAttachedToolbar = (el: EditorEl) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 };
    return (
      <div
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{
          position: "absolute",
          left: 0,
          top: -28,
          display: "flex",
          gap: 6,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 6,
          padding: "2px 6px",
          alignItems: "center"
        }}
      >
        {el.type === "metric" && (
          <button
            type="button"
            style={btn}
            onClick={() =>
              setElements((prev) =>
                prev.map((x) => (x.id === el.id ? { ...x, uppercase: !(x.uppercase !== false) } : x))
              )
            }
            title="Строчные/ПРОПИСНЫЕ"
          >
            {el.uppercase !== false ? "Строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}

        {el.type === "epitaph" && (
          <button
            type="button"
            style={btn}
            onClick={() =>
              setElements((prev) =>
                prev.map((x) => (x.id === el.id ? { ...x, epLayout: x.epLayout === "ladder" ? "inline" : "ladder" } : x))
              )
            }
            title="Лесенкой/В строку"
          >
            {el.epLayout === "ladder" ? "В строку" : "Лесенкой"}
          </button>
        )}

        {el.type === "portrait" && (
          <button
            type="button"
            style={btn}
            onClick={() =>
              setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, imgBW: !x.imgBW } : x)))
            }
            title="Цветное/Ч/Б"
          >
            {el.imgBW ? "Цветное" : "Ч/Б"}
          </button>
        )}

        {el.type === "graphic" && (
          <button
            type="button"
            style={btn}
            onClick={() =>
              setElements((prev) =>
                prev.map((x) => (x.id === el.id ? { ...x, flipH: !x.flipH } : x))
              )
            }
            title="Отразить по горизонтали"
          >
            {el.flipH ? "Справа" : "Слева"}
          </button>
        )}
      </div>
    );
  };

  /* ===== Render content ===== */
  const renderMetricText = (text?: string, uppercase = true, fontPx = 20) => {
    const lines = (text || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const [l1, l2, l3, ...rest] = lines;
    const toCase = (s?: string) => (uppercase ? (s || "").toUpperCase() : s || "");
    return (
      <div style={{ width: "100%", height: "100%", color: "#fff", fontFamily: FONT_CENTURY, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div style={{ display: "grid", gap: 4, width: "100%" }}>
          {l1 && <div style={{ fontWeight: 700, fontSize: Math.round(fontPx * 1.1), lineHeight: 1.1 }}>{toCase(l1)}</div>}
          {l2 && <div style={{ fontWeight: 600, fontSize: Math.round(fontPx * 0.95), lineHeight: 1.1 }}>{toCase(l2)}</div>}
          {l3 && <div style={{ fontWeight: 500, fontSize: Math.round(fontPx * 0.85), lineHeight: 1.1 }}>{toCase(l3)}</div>}
          {rest.map((l, i) => <div key={i} style={{ fontWeight: 500, fontSize: Math.round(fontPx * 0.85), lineHeight: 1.1 }}>{toCase(l)}</div>)}
        </div>
      </div>
    );
  };
  const renderEpitaphText = (el: EditorEl) => {
    const fontPx = el.currentFontPx || el.baseFontPx || 20;
    const content = (el.text || "").split(/\n/).map((s) => s.trim()).filter(Boolean).join(" ");
    const lower = content.toLowerCase().replace(/[.,…\s]+/g, "");
    const isPLS = lower.includes("помним") && lower.includes("любим") && lower.includes("скорбим");
    if (isPLS && el.epLayout === "ladder") {
      return (
        <div style={{ width: "100%", height: "100%", color: "#fff", fontFamily: FONT_CENTURY, fontWeight: 700, fontStyle: "italic", display: "grid", alignContent: "center", gap: 4 }}>
          <div style={{ textAlign: "left", fontSize: Math.round(fontPx) }}>Помним</div>
          <div style={{ textAlign: "center", fontSize: Math.round(fontPx) }}>Любим</div>
          <div style={{ textAlign: "right", fontSize: Math.round(fontPx) }}>Скорбим</div>
        </div>
      );
    }
    return (
      <div style={{ width: "100%", height: "100%", color: "#fff", fontFamily: FONT_CENTURY, fontWeight: 700, fontStyle: "italic", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.15, whiteSpace: "pre-wrap", textAlign: "center" }}>
        <span style={{ fontSize: Math.round(fontPx) }}>{content}</span>
      </div>
    );
  };
  const renderContent = (el: EditorEl) => {
    if (el.type === "portrait") {
      const bw = el.imgBW ? 1 : 0;
      return <img src={el.url || ""} alt={el.name || el.id} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", userSelect: "none", pointerEvents: "none", filter: `grayscale(${bw})` }} draggable={false} />;
    }
    if (el.type === "cross" || el.type === "graphic") {
      const flip = el.type === "graphic" && el.flipH ? "scaleX(-1)" : "none";
      return <img src={el.url} alt={el.name || el.id} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", transform: flip, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} />;
    }
    if (el.type === "metric") return renderMetricText(el.text, el.uppercase !== false, el.currentFontPx || el.baseFontPx || 20);
    if (el.type === "epitaph") return renderEpitaphText(el);
    return null;
  };

  // Actions
  const handleBack = () => {
    const prev = loadOrderDraft();
    saveOrderDraft({ ...prev, editor: { ...(prev.editor || {}), elements, layoutVersion: LAYOUT_VERSION } });
    setOutro(true);
    setTimeout(() => onBack?.(), 150);
  };
  const handleContinue = () => {
    const prev = loadOrderDraft();
    saveOrderDraft({ ...prev, editor: { ...(prev.editor || {}), elements, layoutVersion: LAYOUT_VERSION } });
    onContinue?.({ elements });
  };

  // Auto set template by bg orientation once image is loaded (only when first time)
  const initialTemplateSetRef = useRef(false);

  return (
    <div
      style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 200ms ease", maxWidth: 600, margin: "0 auto" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <TopBarWithIntro title="Memorial" />

      {/* Подсказка */}
      <h4 style={{ margin: "0 0 8px 0", textAlign: "center", fontWeight: "normal", fontStyle: "italic" }}>
        Разместите элементы условно. <br />
        Итоговую компоновку выполнит специалист по этой схеме. <br />
        Укажите порядок и выравнивание.
      </h4>

      {/* Переключатель шаблонов для людей + авторазмещение */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setPeopleTemplate("horizontal")}
          style={{ ...glassButtonStyle("nano"), opacity: peopleTemplate === "horizontal" ? 1 : 0.7 }}
          title="Горизонтальная раскладка: N равных колонок"
        >
          Горизонтальный шаблон
        </button>
        <button
          type="button"
          onClick={() => setPeopleTemplate("vertical")}
          style={{ ...glassButtonStyle("nano"), opacity: peopleTemplate === "vertical" ? 1 : 0.7 }}
          title="Вертикальная раскладка: строки"
        >
          Вертикальный шаблон
        </button>
        <button
          type="button"
          onClick={() => autoLayoutPeople(peopleTemplate)}
          style={glassButtonStyle("nano")}
          title="Переразместить портреты и метрики по выбранному шаблону"
        >
          Авторазместить
        </button>
      </div>

      {/* Холст редактора */}
      <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
        <div
          ref={containerRef}
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
          {/* Фон изделия */}
          <img
            src={bgItemUrl}
            alt="Изделие"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 1
            }}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setImgWH({ w: img.naturalWidth, h: img.naturalHeight });
                // Первичная автоподстановка шаблона: если фон горизонтальный — выберем горизонтальный, и выполним авторазметку
                if (!initialTemplateSetRef.current) {
                  initialTemplateSetRef.current = true;
                  const horiz = img.naturalWidth > img.naturalHeight;
                  setPeopleTemplate(horiz ? "horizontal" : "vertical");
                  // Выполним авторазмещение только если есть люди и это первый раз
                  setTimeout(() => autoLayoutPeople(horiz ? "horizontal" : "vertical"), 0);
                }
              }
            }}
          />

          {/* Элементы */}
          {elements.slice().sort((a, b) => a.z - b.z).map((el) => {
            const selected = el.id === selectedId;
            return (
              <div
                key={el.id}
                onPointerDown={(ev) => onPointerDownEl(ev, el.id, "move")}
                style={{
                  position: "absolute",
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  width: `${el.w}%`,
                  height: `${el.h}%`,
                  zIndex: 10 + el.z,
                  outline: selected ? "2px solid #8ab4ff" : "none",
                  borderRadius: 4,
                  boxShadow: selected ? "0 0 0 1px rgba(138,180,255,0.6)" : undefined,
                  touchAction: "none",
                  cursor: "move"
                }}
              >
                {renderContent(el)}

                {/* Ресайз-хэндлы + тулбар */}
                {selected && (
                  <>
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "nw")} style={handleDot(0, 0, "nwse-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "n")}  style={handleDot("50%", 0, "ns-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "ne")} style={handleDot("100%", 0, "nesw-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "e")}  style={handleDot("100%", "50%", "ew-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "se")} style={handleDot("100%", "100%", "nwse-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "s")}  style={handleDot("50%", "100%", "ns-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "sw")} style={handleDot(0, "100%", "nesw-resize")} />
                    <div onPointerDown={(ev) => onPointerDownEl(ev as any, el.id, "w")}  style={handleDot(0, "50%", "ew-resize")} />

                    {renderAttachedToolbar(el)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
      </div>
    </div>
  );
}

/* ===== Вспомогательное ===== */
function handleDot(left: number | string, top: number | string, cursor: string): React.CSSProperties {
  return {
    position: "absolute",
    left: typeof left === "number" ? left : left,
    top: typeof top === "number" ? top : top,
    width: 10,
    height: 10,
    background: "#fff",
    border: "1px solid #000",
    borderRadius: 2,
    transform: "translate(-50%, -50%)",
    cursor
  };
}
