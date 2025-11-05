// src/components/SketchBoard.tsx
// FIX: метрика не отображалась, потому что SketchBoard брал данные engraving из драфта,
// игнорируя свежие пропсы с формы шага (engravingProp). Теперь приоритет — у пропсов.
// Дополнительно: при сверке всегда добавляем/обновляем метрику без изменения её позиции/размера.
// Графика — по центру (w=35%). Под изделием — видимый градиент на всю область редактора.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  loadOrderDraft,
  saveOrderDraft,
  DRAFT_UPDATED_EVENT,
  type OrderDraft
} from "../lib/order";

/* ===== UI ===== */
const FONT_CENTURY = `"Century Schoolbook", "Century Schoolbook L", "Century Schoolbook Bold", "Times New Roman", serif`;

function glassButtonStyle(size: "nano" | "sm" | "md" = "nano") {
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
    backgroundColor: "#000",
    backgroundImage:
      "linear-gradient(to bottom, #0f0f12 0%, #1b1b20 30%, #222227 55%, #2c2c31 80%, #333339 100%)"
  } as React.CSSProperties;
}

/* ===== Helpers ===== */
function isCrossCategoryName(s?: string) {
  const v = (s || "").toLowerCase();
  return v.includes("крест") || v.includes("cross") || v.includes("crosses");
}
function linesFromPerson(p: any) {
  const l1 = (p.lastName || "").trim();
  const l2 = [p.firstName, p.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p.birthDate, p.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
function personKey(p: any) {
  return p?.id || String([...(linesFromPerson(p) || [])].join("|") || "person").toLowerCase();
}
function metricTextFromEngraving(engraving: any): string {
  if (Array.isArray(engraving?.persons) && engraving.persons.length > 0) {
    const lp = linesFromPerson(engraving.persons[0] || {});
    const metric = lp.join("\n").trim();
    if (metric) return metric;
  }
  const metrics = Array.isArray(engraving?.metrics) ? engraving.metrics.filter(Boolean) : [];
  if (metrics.length) return metrics.join("\n");
  const out: string[] = [];
  if (engraving?.fullName) out.push(String(engraving.fullName));
  const dates: string[] = [];
  if (engraving?.birthDate) dates.push(String(engraving.birthDate));
  if (engraving?.deathDate) dates.push(String(engraving.deathDate));
  if (dates.length) out.push(dates.join(" — "));
  if (Array.isArray(engraving?.lines) && engraving.lines.length) out.push(...engraving.lines.filter(Boolean));
  return out.join("\n").trim();
}

/* ===== Types ===== */
export type EditorElType = "portrait" | "metric" | "epitaph" | "cross" | "graphic";
export type EditorEl = {
  id: string;
  type: EditorElType;
  x: number; y: number; w: number; h: number; z: number;
  url?: string;
  name?: string;
  text?: string;
  baseFontPx?: number;
  currentFontPx?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  uppercase?: boolean;
  epLayout?: "inline" | "ladder";
  imgBW?: boolean;
};

export type SketchBoardProps = {
  item?: any;        // { url, name }
  engraving?: any;   // persons[] или legacy-поля
  decor?: any;       // { graphics:[], epitaphs:[] }
  draftNamespace?: string; // по умолчанию "editor"
  onSaveDraft?: (payload: any) => void;
};

/* ===== Component ===== */
export default function SketchBoard({
  item: itemProp,
  engraving: engravingProp,
  decor: decorProp,
  draftNamespace = "editor",
  onSaveDraft
}: SketchBoardProps) {
  // 1) Берём актуальные данные из драфта, но приоритет — у пропсов шага!
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  useEffect(() => {
    const onUpd = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
      window.removeEventListener("storage", onUpd);
    };
  }, []);

  // ВАЖНО: приоритет ПЕРЕД драфтом — у пропсов (чтобы метрика/фото из текущего шага появлялись сразу)
  const item = itemProp || draft.item || {};
  const engraving = engravingProp || draft.engraving || {};
  const decor = decorProp || draft.decor || {};

  // 2) Данные (people/graphics/epitaphs)
  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engraving?.persons) && engraving.persons.length > 0) {
      return engraving.persons.map((p: any, idx: number) => ({
        id: personKey(p) || `person-${idx}`,
        lines: linesFromPerson(p),
        photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
      }));
    }
    const text = metricTextFromEngraving(engraving);
    const photo = engraving?.photoPreview || engraving?.photoDataUrl || engraving?.photoUrl || engraving?.photo || null;
    return text || photo ? [{ id: "legacy-0", lines: text ? text.split("\n") : [], photo }] : [];
  }, [engraving]);

  const graphics: any[] = useMemo(() => (Array.isArray(decor?.graphics) ? decor.graphics : []), [decor]);
  const epitaphs: string[] = useMemo(
    () => (Array.isArray(decor?.epitaphs) ? decor.epitaphs.filter(Boolean) : []),
    [decor]
  );
  const crosses = useMemo(
    () => graphics.filter((g) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)),
    [graphics]
  );
  const otherGraphics = useMemo(
    () => graphics.filter((g) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)),
    [graphics]
  );

  // 3) Начальная раскладка
  const initialElements = useMemo<EditorEl[]>(() => {
    const els: EditorEl[] = [];
    let z = 1;

    // Кресты — как прежде
    crosses.slice(0, 3).forEach((g, i) => {
      els.push({
        id: `cross-${g.id}`,
        type: "cross",
        x: 4,
        y: 4 + i * 14,
        w: 18,
        h: 12,
        z: z++,
        url: g.url,
        name: g.name
      });
    });

    // Портрет/метрика
    if (peopleBlocks.length === 1) {
      const p = peopleBlocks[0];
      if (p.photo) {
        els.push({
          id: `portrait-${p.id}`,
          type: "portrait",
          x: 24,
          y: 18,
          w: 52,
          h: 28,
          z: z++,
          url: p.photo,
          name: "Портрет",
          imgBW: true
        });
      }
      const text = (p.lines || []).join("\n") || metricTextFromEngraving(engraving);
      if (text) {
        els.push({
          id: `metric-${p.id}`,
          type: "metric",
          x: 15,
          y: 50,
          w: 70,
          h: 16,
          z: z++,
          text,
          baseFontPx: 26,
          currentFontPx: 26,
          fontWeight: 700,
          fontStyle: "normal",
          uppercase: true
        });
      }
    } else if (peopleBlocks.length > 1) {
      const startY = crosses.length ? 18 : 12;
      peopleBlocks.forEach((p, i) => {
        const rowY = startY + i * 18;
        if (p.photo) {
          els.push({
            id: `portrait-${p.id}`,
            type: "portrait",
            x: 14,
            y: rowY,
            w: 26,
            h: 16,
            z: z++,
            url: p.photo,
            name: "Портрет",
            imgBW: true
          });
        }
        const text = (p.lines || []).join("\n");
        if (text) {
          els.push({
            id: `metric-${p.id}`,
            type: "metric",
            x: 44,
            y: rowY,
            w: 42,
            h: 14,
            z: z++,
            text,
            baseFontPx: 22,
            currentFontPx: 22,
            fontWeight: 700,
            fontStyle: "normal",
            uppercase: true
          });
        }
      });
    } else {
      // Legacy-метрика
      const text = metricTextFromEngraving(engraving);
      if (text) {
        els.push({
          id: "metric-legacy",
          type: "metric",
          x: 15,
          y: 50,
          w: 70,
          h: 16,
          z: z++,
          text,
          baseFontPx: 26,
          currentFontPx: 26,
          fontWeight: 700,
          fontStyle: "normal",
          uppercase: true
        });
      }
    }

    // Эпитафии
    if (epitaphs.length) {
      const epH = 10;
      const epGap = 2;
      const bottomOffset = 22;
      let baseYTop = 100 - bottomOffset - epH;
      epitaphs.slice(0, 8).forEach((text, idx) => {
        const y = Math.max(0, baseYTop - idx * (epH + epGap));
        els.push({
          id: `epitaph-${idx}`,
          type: "epitaph",
          x: 6,
          y,
          w: 88,
          h: epH,
          z: z++,
          text,
          baseFontPx: 20,
          currentFontPx: 20,
          fontWeight: 700,
          fontStyle: "italic",
          epLayout: "ladder"
        });
      });
    }

    // Прочая графика — центр, width=35%
    const wG = 35;
    const xCenter = (100 - wG) / 2;
    otherGraphics.slice(0, 6).forEach((g, i) => {
      const y = 90 + i * 10;
      els.push({
        id: `graphic-${g.id}`,
        type: "graphic",
        x: xCenter,
        y,
        w: wG,
        h: 10,
        z: z++,
        url: g.url,
        name: g.name
      });
    });

    return els.map((e) => ({ ...e, x: Math.min(92, Math.max(0, e.x)), y: Math.min(92, Math.max(0, e.y)) }));
  }, [crosses, otherGraphics, epitaphs, peopleBlocks, engraving]);

  // 4) Контейнер и размеры
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 1, h: 1 });
  const [imgWH, setImgWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const aspect = useMemo(() => (imgWH.w > 0 && imgWH.h > 0 ? `${imgWH.w} / ${imgWH.h}` : undefined), [imgWH]);

  useEffect(() => {
    const measure = () => {
      const r = containerRef.current?.getBoundingClientRect();
      setContainerSize({ w: Math.max(1, r?.width || 1), h: Math.max(1, r?.height || 1) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // 5) Элементы (драфт или старт)
  const [elements, setElements] = useState<EditorEl[]>(() => {
    const ns = (loadOrderDraft() as any)[draftNamespace] || {};
    const draftEls = ns.elements as EditorEl[] | undefined;
    return Array.isArray(draftEls) && draftEls.length ? draftEls : initialElements;
  });

  useEffect(() => {
    const ns = (loadOrderDraft() as any)[draftNamespace] || {};
    const draftEls = ns.elements as EditorEl[] | undefined;
    if (!draftEls || draftEls.length === 0) setElements(initialElements);
  }, [initialElements, draftNamespace]);

  // 6) Сверка: добавляем/обновляем метрику и прочее, не трогая позиции
  useEffect(() => {
    setElements((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      const next = [...prev];

      const pushMissing = (el?: EditorEl) => {
        if (!el) return;
        if (!byId.has(el.id)) {
          next.push(el);
          byId.set(el.id, el);
        }
      };

      if (peopleBlocks.length === 1) {
        const p = peopleBlocks[0];
        if (p.photo) {
          const id = `portrait-${p.id}`;
          const cur = byId.get(id);
          if (cur) {
            if (cur.url !== p.photo) cur.url = p.photo || undefined;
          } else pushMissing(initialElements.find((e) => e.id === id));
        }
        const text = (p.lines || []).join("\n") || metricTextFromEngraving(engraving);
        const idM = `metric-${p.id}`;
        const curM = byId.get(idM);
        if (text) {
          if (curM) {
            if (curM.text !== text) curM.text = text;
          } else {
            pushMissing(initialElements.find((e) => e.id === idM) || {
              id: idM,
              type: "metric",
              x: 15, y: 50, w: 70, h: 16, z: 100,
              text, baseFontPx: 26, currentFontPx: 26, fontWeight: 700, fontStyle: "normal", uppercase: true
            } as EditorEl);
          }
        }
      } else if (peopleBlocks.length > 1) {
        peopleBlocks.forEach((p) => {
          if (p.photo) {
            const id = `portrait-${p.id}`;
            const cur = byId.get(id);
            if (cur) {
              if (cur.url !== p.photo) cur.url = p.photo || undefined;
            } else pushMissing(initialElements.find((e) => e.id === id));
          }
          const text = (p.lines || []).join("\n");
          const idM = `metric-${p.id}`;
          if (text) {
            const curM = byId.get(idM);
            if (curM) {
              if (curM.text !== text) curM.text = text;
            } else pushMissing(initialElements.find((e) => e.id === idM));
          }
        });
      } else {
        const text = metricTextFromEngraving(engraving);
        const id = "metric-legacy";
        if (text) {
          const cur = byId.get(id);
          if (cur) {
            if (cur.text !== text) cur.text = text;
          } else {
            pushMissing(initialElements.find((e) => e.id === id) || {
              id, type: "metric",
              x: 15, y: 50, w: 70, h: 16, z: 100,
              text, baseFontPx: 26, currentFontPx: 26, fontWeight: 700, fontStyle: "normal", uppercase: true
            } as EditorEl);
          }
        }
      }

      // Кресты
      crosses.slice(0, 3).forEach((g) => {
        const id = `cross-${g.id}`;
        const cur = byId.get(id);
        if (cur) {
          if (cur.url !== g.url) cur.url = g.url;
        } else pushMissing(initialElements.find((e) => e.id === id));
      });

      // Эпитафии
      epitaphs.slice(0, 8).forEach((t, idx) => {
        const id = `epitaph-${idx}`;
        const cur = byId.get(id);
        if (cur) {
          if (cur.text !== t) cur.text = t;
        } else pushMissing(initialElements.find((e) => e.id === id));
      });

      // Прочая графика
      otherGraphics.slice(0, 6).forEach((g) => {
        const id = `graphic-${g.id}`;
        const cur = byId.get(id);
        if (cur) {
          if (cur.url !== g.url) cur.url = g.url;
        } else pushMissing(initialElements.find((e) => e.id === id));
      });

      return next;
    });
  }, [peopleBlocks, crosses, epitaphs, otherGraphics, initialElements, engraving]);

  // 7) Сохранение в драфт
  useEffect(() => {
    const prevNs = (loadOrderDraft() as any)[draftNamespace] || {};
    saveOrderDraft({ [draftNamespace]: { ...prevNs, elements, updatedAt: Date.now() } });
    onSaveDraft?.({ elements, ns: draftNamespace });
  }, [elements, draftNamespace, onSaveDraft]);

  // 8) DnD / Resize
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bringToFront = (id: string) =>
    setElements((prev) => {
      const maxZ = prev.reduce((m, e) => Math.max(m, e.z), 0);
      return prev.map((e) => (e.id === id ? { ...e, z: maxZ + 1 } : e));
    });

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const activeDrag = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number;
    startY: number;
    start: EditorEl;
    captureEl: HTMLElement | null;
    wPx: number; hPx: number;
  } | null>(null);

  const onPointerDownEl = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move"
  ) => {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch {}
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    bringToFront(id);
    const rect = (containerRef.current?.getBoundingClientRect()) || { width: 1, height: 1 };
    activeDrag.current = {
      id, mode, startX: e.clientX, startY: e.clientY, start: { ...el }, captureEl: target,
      wPx: Math.max(1, rect.width), hPx: Math.max(1, rect.height)
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const act = activeDrag.current;
    if (!act) return;
    e.preventDefault();

    const dxPct = ((e.clientX - act.startX) / act.wPx) * 100;
    const dyPct = ((e.clientY - act.startY) / act.hPx) * 100;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== act.id) return el;

        let { x, y, w, h } = act.start;
        const minW = 4;
        const minH = 3;

        if (act.mode === "move") {
          x = clamp(x + dxPct, 0, 100 - w);
          y = clamp(y + dyPct, 0, 100 - h);
          return { ...el, x, y, w, h };
        }

        let nx = x, ny = y, nw = w, nh = h;
        const applyHoriz = (side: "w" | "e") => {
          if (side === "e") {
            nw = clamp(w + dxPct, minW, 100 - x);
          } else {
            nx = clamp(x + dxPct, 0, x + w - minW);
            nw = clamp(w - dxPct, minW, 100 - nx);
          }
        };
        const applyVert = (side: "n" | "s") => {
          if (side === "s") {
            nh = clamp(h + dyPct, minH, 100 - y);
          } else {
            ny = clamp(y + dyPct, 0, y + h - minH);
            nh = clamp(h - dyPct, minH, 100 - ny);
          }
        };

        if (act.mode.includes("e")) applyHoriz("e");
        if (act.mode.includes("w")) applyHoriz("w");
        if (act.mode.includes("s")) applyVert("s");
        if (act.mode.includes("n")) applyVert("n");

        // Масштаб шрифта (по высоте блока)
        let currentFontPx = el.currentFontPx;
        if ((el.type === "metric" || el.type === "epitaph") && el.baseFontPx) {
          const ratioH = nh / act.start.h;
          currentFontPx = Math.max(10, Math.round((el.baseFontPx || 20) * ratioH));
        }

        return { ...el, x: nx, y: ny, w: nw, h: nh, currentFontPx };
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const act = activeDrag.current;
    if (act?.captureEl) {
      try { act.captureEl.releasePointerCapture((e as any).pointerId); } catch {}
    }
    activeDrag.current = null;
  };

  const onDeselect = () => setSelectedId(null);

  // Рендер текста метрики
  const renderMetricText = (text?: string, uppercase = true, fontPx = 20) => {
    const lines = (text || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const [l1, l2, l3, ...rest] = lines;
    const toCase = (s?: string) => (uppercase ? (s || "").toUpperCase() : s || "");
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          color: "#fff",
          textAlign: "center",
          fontFamily: FONT_CENTURY,
          display: "grid",
          placeItems: "center"
        }}
      >
        <div style={{ display: "grid", gap: 4, width: "100%" }}>
          {l1 && <div style={{ fontWeight: 700, fontSize: Math.round(fontPx * 1.1), lineHeight: 1.1 }}>{toCase(l1)}</div>}
          {l2 && <div style={{ fontWeight: 600, fontSize: Math.round(fontPx * 0.95), lineHeight: 1.1 }}>{toCase(l2)}</div>}
          {l3 && <div style={{ fontWeight: 500, fontSize: Math.round(fontPx * 0.85), lineHeight: 1.1 }}>{toCase(l3)}</div>}
          {rest.length > 0 && rest.map((l, i) => (<div key={i} style={{ fontWeight: 500, fontSize: Math.round(fontPx * 0.85), lineHeight: 1.1 }}>{toCase(l)}</div>))}
        </div>
      </div>
    );
  };

  const renderEpitaphText = (el: EditorEl) => {
    const fontPx = el.currentFontPx || el.baseFontPx || 20;
    const content = (el.text || "").split(/\n/).map((s) => s.trim()).filter(Boolean).join(" ");
    const lower = content.toLowerCase().replace(/\s+/g, "");
    const isPLS = lower.includes("помним") && lower.includes("любим") && lower.includes("скорбим");
    if (isPLS && el.epLayout === "ladder") {
      return (
        <div style={{ width: "100%", height: "100%", color: "#fff", textAlign: "center", fontFamily: FONT_CENTURY, fontWeight: 700, fontStyle: "italic", display: "grid", alignContent: "center", gap: 4 }}>
          <div style={{ textAlign: "left", fontSize: Math.round(fontPx) }}>Помним</div>
          <div style={{ textAlign: "center", fontSize: Math.round(fontPx) }}>Любим</div>
          <div style={{ textAlign: "right", fontSize: Math.round(fontPx) }}>Скорбим</div>
        </div>
      );
    }
    return (
      <div style={{ width: "100%", height: "100%", color: "#fff", textAlign: "center", fontFamily: FONT_CENTURY, fontWeight: 700, fontStyle: "italic", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.15, whiteSpace: "pre-wrap" }}>
        {content}
      </div>
    );
  };

  const renderContent = (el: EditorEl) => {
    if (el.type === "portrait") {
      const src = el.url || "";
      const bw = el.imgBW ? 1 : 0;
      return <img src={src} alt={el.name || el.type} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", userSelect: "none", pointerEvents: "none", filter: `grayscale(${bw})` }} draggable={false} />;
    }
    if (el.type === "cross" || el.type === "graphic") {
      return <img src={el.url} alt={el.name || el.type} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }} draggable={false} />;
    }
    if (el.type === "metric") return renderMetricText(el.text, el.uppercase !== false, el.currentFontPx || el.baseFontPx || 20);
    if (el.type === "epitaph") return renderEpitaphText(el);
    return null;
  };

  // 9) Превью в canvas (unchanged)
  useEffect(() => {
    let cancelled = false;
    async function makePreview() {
      try {
        const W = Math.max(320, Math.floor(containerSize.w));
        const H = Math.max(480, Math.floor(containerSize.h || 1));
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#0f0f12");
        grad.addColorStop(1, "#333339");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        if (item?.url) {
          const baseImg = await loadImageSafe(item.url);
          if (baseImg) {
            const r = fitContain(baseImg.width, baseImg.height, W, H);
            ctx.drawImage(baseImg, r.x, r.y, r.w, r.h);
          }
        }

        for (const el of elements.slice().sort((a, b) => a.z - b.z)) {
          const rect = { x: (el.x / 100) * W, y: (el.y / 100) * H, w: (el.w / 100) * W, h: (el.h / 100) * H };
          if (el.type === "portrait" || el.type === "graphic" || el.type === "cross") {
            if (!el.url) continue;
            const im = await loadImageSafe(el.url);
            if (im) {
              if (el.type === "portrait") {
                const rr = fitCover(im.width, im.height, rect.w, rect.h);
                ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
                ctx.filter = el.imgBW ? "grayscale(100%)" : "none";
                ctx.drawImage(im, rect.x + rr.x, rect.y + rr.y, rr.w, rr.h);
                ctx.restore();
              } else {
                const rr = fitContain(im.width, im.height, rect.w, rect.h);
                ctx.drawImage(im, rect.x + rr.x, rect.y + rr.y, rr.w, rr.h);
              }
            }
          } else if (el.type === "metric" || el.type === "epitaph") {
            const lines = (el.text || "").split("\n").map((s) => s.trim()).filter(Boolean);
            ctx.save();
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = `${el.currentFontPx || el.baseFontPx || 20}px ${FONT_CENTURY}`;
            const cy = rect.y + rect.h / 2;
            const lh = (el.currentFontPx || el.baseFontPx || 20) * 1.2;
            const startY = cy - ((lines.length - 1) * lh) / 2;
            lines.forEach((ln, i) => ctx.fillText(ln, rect.x + rect.w / 2, startY + i * lh));
            ctx.restore();
          }
        }

        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        if (!cancelled) {
          const prevNs = (loadOrderDraft() as any)[draftNamespace] || {};
          saveOrderDraft({ [draftNamespace]: { ...prevNs, previewUrl: dataUrl, updatedAt: Date.now() } });
        }
      } catch {}
    }
    makePreview();
    return () => { cancelled = true; };
  }, [item, elements, containerSize, draftNamespace]);

  // 10) Рендер (градиент-подложка под изделием)
  return (
    <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
      <div
        ref={containerRef}
        onPointerDown={() => setSelectedId(null)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          ...bottomUnderlayGradient(),
          position: "relative",
          width: "100%",
          borderRadius: 10,
          overflow: "hidden",
          userSelect: "none",
          aspectRatio: aspect,
          minHeight: aspect ? undefined : 540
        }}
      >
        {/* Стеклянный градиент под изделием */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
            zIndex: 0,
            pointerEvents: "none"
          }}
        />

        {/* Изделие */}
        <img
          src={item?.url || ""}
          alt={item?.name || "Изделие"}
          style={{ position: "relative", zIndex: 2, display: "block", width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", userSelect: "none" }}
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setImgWH({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />

        {/* Слои */}
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

              {selected && (
                <div
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
                  onPointerDown={(ev) => ev.stopPropagation()}
                >
                  {el.type === "metric" && (
                    <button
                      type="button"
                      style={{ ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 }}
                      title="Переключить регистр (Прописные/строчные)"
                      onClick={(e) => {
                        e.stopPropagation();
                        setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, uppercase: !(x.uppercase !== false) } : x)));
                      }}
                    >
                      {el.uppercase !== false ? "Строчные" : "ПРОПИСНЫЕ"}
                    </button>
                  )}
                  {el.type === "epitaph" && (
                    <button
                      type="button"
                      style={{ ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 }}
                      title="Эпитафия: лесенкой/в строку"
                      onClick={(e) => {
                        e.stopPropagation();
                        setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, epLayout: x.epLayout === "ladder" ? "inline" : "ladder" } : x)));
                      }}
                    >
                      {el.epLayout === "ladder" ? "В строку" : "Лесенкой"}
                    </button>
                  )}
                  {el.type === "portrait" && (
                    <button
                      type="button"
                      style={{ ...glassButtonStyle("nano"), padding: "2px 6px", fontSize: 11 }}
                      title={el.imgBW ? "Сделать цветным" : "Сделать ч/б"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setElements((prev) => prev.map((x) => (x.id === el.id ? { ...x, imgBW: !x.imgBW } : x)));
                      }}
                    >
                      {el.imgBW ? "Цветное" : "Ч/Б"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ===== Utils ===== */
function loadImageSafe(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
function fitContain(sw: number, sh: number, dw: number, dh: number) {
  const sr = sw / sh, dr = dw / dh;
  let w = 0, h = 0, x = 0, y = 0;
  if (sr > dr) { w = dw; h = Math.round(dw / sr); x = 0; y = Math.round((dh - h) / 2); }
  else { h = dh; w = Math.round(dh * sr); x = Math.round((dw - w) / 2); y = 0; }
  return { x, y, w, h };
}
function fitCover(sw: number, sh: number, dw: number, dh: number) {
  const sr = sw / sh, dr = dw / dh;
  let w = 0, h = 0, x = 0, y = 0;
  if (sr > dr) { h = dh; w = Math.round(dh * sr); x = Math.round((dw - w) / 2); y = 0; }
  else { w = dw; h = Math.round(dw / sr); x = 0; y = Math.round((dh - h) / 2); }
  return { x, y, w, h };
}
