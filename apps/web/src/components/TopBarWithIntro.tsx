// src/components/TopBarWithIntro.tsx
//
// ВАЖНО (фикс): внутри панели НЕ делаем compact-верстку.
// Панель всегда рисуется одной и той же разметкой, а на маленьких экранах
// уменьшается через transform: scale(...) (PanelAutoScale).
//
// compact используется только для шапки (кнопки сверху): отступы/шрифт.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { loadIntroState, saveIntro, type Intro, clearIntroAll } from "../lib/intro";
import { loadOrderDraft, saveOrderDraft, clearOrderDraft, type OrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

/* ===== Темизация ===== */
type ThemeMode = "dark" | "light";
const LS_THEME_KEY = "memorial.ui.theme.v1";

function loadTheme(): ThemeMode {
  const v = (typeof localStorage !== "undefined" ? localStorage.getItem(LS_THEME_KEY) : null) || "light";
  return v?.toLowerCase() === "dark" ? "dark" : "light";
}
function saveTheme(t: ThemeMode) {
  if (typeof localStorage !== "undefined") localStorage.setItem(LS_THEME_KEY, t);
}
function palette(t: ThemeMode) {
  if (t === "light") {
    return {
      text: "#222",
      subText: "rgba(0,0,0,0.65)",
      panelBg: "#fff",
      panelBorder: "1px solid #e6e2da",
      inputBg: "#ffffff",
      inputBorder: "1px solid #d7d3c7",
      link: "#1d4ed8",
      linkHover: "#0b3ab8",
      danger: "#b91c1c",
      dangerHover: "#991b1b",
      headerBg: "#ffffff",
      headerText: "#111",
      headerBorder: "1px solid #e6e2da",
      chevronCircleBg: "rgba(0,0,0,0.06)",
      chevronCircleBorder: "1px solid rgba(0,0,0,0.16)",
      chevronStroke: "#111",
      neutralBg: "#faf9f7",
      neutralBorder: "1px solid #ece8de",
      divider: "1px solid #ece8de",
      accentBg: "#fff8e6",
      accentBorder: "1px solid #f0d9a7",
      chipBg: "#eef2ff",
      chipText: "#1d4ed8"
    };
  }
  return {
    text: "#fff",
    subText: "rgba(255,255,255,0.85)",
    panelBg: "rgba(20,20,24,0.55)",
    panelBorder: "1px solid rgba(255,255,255,0.14)",
    inputBg: "rgba(255,255,255,0.06)",
    inputBorder: "1px solid rgba(255,255,255,0.18)",
    link: "#8ab4ff",
    linkHover: "#a5c5ff",
    danger: "#ff7b7b",
    dangerHover: "#ff9c9c",
    headerBg: "#000000",
    headerText: "#ffffff",
    headerBorder: "1px solid rgba(255,255,255,0.22)",
    chevronCircleBg: "rgba(255,255,255,0.06)",
    chevronCircleBorder: "1px solid rgba(255,255,255,0.16)",
    chevronStroke: "#ffffff",
    neutralBg: "rgba(255,255,255,0.04)",
    neutralBorder: "1px solid rgba(255,255,255,0.10)",
    divider: "1px solid rgba(255,255,255,0.12)",
    accentBg: "rgba(255,242,201,0.15)",
    accentBorder: "1px solid rgba(255,255,255,0.35)",
    chipBg: "rgba(138,180,255,0.18)",
    chipText: "#dbe7ff"
  };
}
function paperShadow(t: ThemeMode): React.CSSProperties {
  return t === "light"
    ? { boxShadow: "0 10px 24px rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.06)" }
    : { boxShadow: "0 8px 24px rgba(0,0,0,0.45)" };
}

/* ===== Адаптивность (только для шапки) ===== */
function useCompact(breakpoint = 420): boolean {
  const [compact, setCompact] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= breakpoint;
  });
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return compact;
}

/* ===== UI-хелперы/стили ===== */
function inputStyle(theme: ThemeMode): React.CSSProperties {
  const p = palette(theme);
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: p.inputBorder,
    background: p.inputBg,
    color: p.text,
    outline: "none",
    boxSizing: "border-box"
  };
}

function thumbBackdropStyle(theme: ThemeMode): React.CSSProperties {
  return {
    borderRadius: 10,
    background: "rgba(0,0,0,0.4)",
    border: theme === "light" ? "1px solid rgba(0,0,0,0.18)" : "1px solid rgba(255,255,255,0.14)",
    padding: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box"
  };
}

function epitaphItemStyle(theme: ThemeMode): React.CSSProperties {
  const p = palette(theme);
  return {
    background: theme === "light" ? "rgba(255, 232, 170, 0.85)" : "rgba(255, 232, 170, 0.22)",
    border: theme === "light" ? "1px solid rgba(160, 110, 0, 0.35)" : "1px solid rgba(255,255,255,0.22)",
    borderRadius: 10,
    padding: 8,
    color: p.text
  };
}
function epitaphListStyle(): React.CSSProperties {
  return { display: "grid", gap: 6 };
}

function galleryThumbBoxStyle(): React.CSSProperties {
  const grad: React.CSSProperties = {
    backgroundColor: "#000000",
    backgroundImage: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  };
  return {
    ...grad,
    overflow: "hidden",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    position: "relative"
  };
}

function linkButtonStyle(theme: ThemeMode, kind: "default" | "danger" = "default", disabled = false): React.CSSProperties {
  const p = palette(theme);
  const color = kind === "danger" ? p.danger : p.link;
  return {
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    color: disabled ? p.subText : color,
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    font: "inherit",
    lineHeight: 1.2
  };
}

function Row({
  label,
  theme,
  children
}: {
  label: string;
  theme: ThemeMode;
  children: React.ReactNode;
}) {
  // Всегда одна и та же сетка (никаких compact вариантов)
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
      <div style={{ color: palette(theme).text }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function fileNameFromUrl(url?: string): string {
  if (!url) return "";
  try {
    const noQuery = String(url).split(/[?#]/)[0];
    const last = (noQuery.split("/").pop() || noQuery).split("\\").pop() || noQuery;
    return decodeURIComponent(last.replace(/\+/g, " "));
  } catch {
    return url;
  }
}

function glassPanelStyle(themeParam?: ThemeMode): React.CSSProperties {
  const t = themeParam ?? loadTheme();
  const p = palette(t);
  return { background: p.neutralBg, border: p.neutralBorder, borderRadius: 10, color: p.text };
}

function chip(theme: ThemeMode): React.CSSProperties {
  const p = palette(theme);
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    background: p.chipBg,
    color: p.chipText,
    whiteSpace: "nowrap"
  };
}

/* ===== Коллапс ===== */
function useCollapse(open: boolean, duration = 280) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    overflow: "hidden",
    maxHeight: 0,
    opacity: 0,
    transform: "translateY(-6px)"
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.scrollHeight;

    if (open) {
      setStyle({
        overflow: "hidden",
        maxHeight: h,
        opacity: 1,
        transform: "translateY(0)",
        transition: `max-height ${duration}ms ease, opacity ${duration}ms ease, transform ${duration}ms ease`
      });
      const t = setTimeout(() => {
        if (ref.current) setStyle((s) => ({ ...s, maxHeight: ref.current!.scrollHeight }));
      }, duration + 20);
      return () => clearTimeout(t);
    }

    setStyle({
      overflow: "hidden",
      maxHeight: 0,
      opacity: 0,
      transform: "translateY(-6px)",
      transition: `max-height ${duration}ms ease, opacity ${duration}ms ease, transform ${duration}ms ease`
    });
  }, [open, duration]);

  return { ref, style };
}

/* ===== Форматтеры ===== */
function mmToCm(mm?: number): number | undefined {
  if (typeof mm !== "number" || !isFinite(mm)) return undefined;
  return mm / 10;
}
function cmValue(n?: number): string {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

function normalizeEpitaphItems(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((s) => String(s || "").replace(/\r\n?/g, "\n").trim())
      .filter(Boolean);
  }
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  return t ? [t] : [];
}

function uniqByNorm(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    const key = String(x || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(String(x || "").replace(/\r\n?/g, "\n").trim());
  }
  return out;
}

/* ===== AutoScale wrapper (SCALE DOWN only, panel-only) ===== */
function useScaleToFit(params: {
  enabled: boolean;
  minScale?: number;
  maxScale?: number;
  paddingPx?: number;
}) {
  // опустим minScale, чтобы не "ломать" верстку даже на очень узких экранах
  const { enabled, minScale = 0.55, maxScale = 1, paddingPx = 0 } = params;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [scale, setScale] = useState(1);
  const [scaledH, setScaledH] = useState<number | null>(null);

  const measure = useCallback(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    const hostW = host.clientWidth || 0;
    if (hostW <= 0) return;

    const cw = content.scrollWidth || content.getBoundingClientRect().width || 1;
    const ch = content.scrollHeight || content.getBoundingClientRect().height || 1;

    const availableW = Math.max(1, hostW - paddingPx * 2);
    const k = Math.min(maxScale, Math.max(minScale, Math.min(1, availableW / Math.max(1, cw))));

    setScale(k);
    setScaledH(Math.ceil(ch * k));
  }, [maxScale, minScale, paddingPx]);

  useEffect(() => {
    if (!enabled) {
      setScale(1);
      setScaledH(null);
      return;
    }

    measure();

    const host = hostRef.current;
    const content = contentRef.current;

    const RO = (window as any).ResizeObserver as any;
    const ro = RO ? new RO(() => measure()) : null;
    if (ro && host) ro.observe(host);
    if (ro && content) ro.observe(content);

    const onResize = () => measure();
    window.addEventListener("resize", onResize);

    const t1 = window.setTimeout(measure, 60);
    const t2 = window.setTimeout(measure, 180);
    const t3 = window.setTimeout(measure, 420);

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect?.();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [enabled, measure]);

  return { hostRef, contentRef, scale, scaledH };
}

function PanelAutoScale({
  enabled,
  children,
  paddingPx = 0
}: {
  enabled: boolean;
  children: React.ReactNode;
  paddingPx?: number;
}) {
  const { hostRef, contentRef, scale, scaledH } = useScaleToFit({
    enabled,
    minScale: 0.55,
    maxScale: 1,
    paddingPx
  });

  return (
    <div ref={hostRef} style={{ width: "100%", paddingLeft: paddingPx, paddingRight: paddingPx, boxSizing: "border-box" }}>
      <div style={{ height: enabled && scaledH != null ? scaledH : "auto", transition: "height 140ms ease" }}>
        <div
          ref={contentRef}
          style={{
            transform: enabled ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
            width: enabled && scale < 1 ? `${100 / scale}%` : "100%",
            willChange: "transform"
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ===== Компонент ===== */
export default function TopBarWithIntro({ title = "Memorial" }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const compactHeader = useCompact(420);

  const [introData, setIntroData] = useState(() => loadIntroState());
  const intro = introData.intro;
  const orderNumber = introData.orderNumber || "—";

  const [order, setOrder] = useState<OrderDraft>(() => loadOrderDraft());

  const [name, setName] = useState(intro?.customerName || "");
  const [phone, setPhone] = useState(intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState(intro?.customerNotes || "");
  const [sizeNotes, setSizeNotes] = useState(order.size?.notes || "");
  const [epitaphsText, setEpitaphsText] = useState(
    (order.engraving?.epitaphs && order.engraving!.epitaphs!.join("\n")) || order.engraving?.epitaphText || ""
  );
  const [orderNotes, setOrderNotes] = useState((order as any).notes || "");
  const [frontWishes, setFrontWishes] = useState<string>((order as any)?.editor?.wishes || "");
  const [backWishes, setBackWishes] = useState<string>((order as any)?.editorBack?.wishes || "");

  const refreshAll = useCallback(
    (opts?: { force?: boolean }) => {
      const freshOrder = loadOrderDraft();
      const freshIntroState = loadIntroState();

      setOrder(freshOrder);
      setIntroData(freshIntroState);

      if (!editing || opts?.force) {
        const i = freshIntroState.intro || {};
        setName(i.customerName || "");
        setPhone(i.customerPhone || "");
        setContactNotes(i.customerNotes || "");

        setSizeNotes(freshOrder.size?.notes || "");
        setEpitaphsText(
          (freshOrder.engraving?.epitaphs && freshOrder.engraving!.epitaphs!.join("\n")) ||
            freshOrder.engraving?.epitaphText ||
            ""
        );
        setOrderNotes((freshOrder as any).notes || "");
        setFrontWishes((freshOrder as any)?.editor?.wishes || "");
        setBackWishes((freshOrder as any)?.editorBack?.wishes || "");
      }
    },
    [editing]
  );

  useEffect(() => {
    const onAny = () => refreshAll({ force: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAll({ force: true });
    };

    window.addEventListener("storage", onAny);
    window.addEventListener("memorial:orderDraftUpdated", onAny as any);
    window.addEventListener(DRAFT_UPDATED_EVENT, onAny as any);
    window.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onAny);
    window.addEventListener("pageshow", onAny as any);

    refreshAll({ force: true });
    return () => {
      window.removeEventListener("storage", onAny);
      window.removeEventListener("memorial:orderDraftUpdated", onAny as any);
      window.removeEventListener(DRAFT_UPDATED_EVENT, onAny as any);
      window.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onAny);
      window.removeEventListener("pageshow", onAny as any);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (open) refreshAll({ force: true });
  }, [open, refreshAll]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("memorial:openTopBarPanel", onOpen as any);
    return () => window.removeEventListener("memorial:openTopBarPanel", onOpen as any);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setOrder(loadOrderDraft());
    };
    tick();
    const t = window.setInterval(tick, 300);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  const phoneLine = useMemo(() => ((editing ? phone : intro?.customerPhone) || "").trim(), [editing, phone, intro?.customerPhone]);

  const frontGraphics = (order.graphics || []) as any[];
  const frontCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphics.forEach((g: any) => {
      if (g?.id) m[g.id] = (m[g.id] || 0) + 1;
    });
    return m;
  }, [frontGraphics]);
  const frontUnique = useMemo(() => {
    const first: Record<string, any> = {};
    frontGraphics.forEach((g: any) => {
      const id = g?.id;
      if (id && !first[id]) first[id] = g;
    });
    return Object.values(first);
  }, [frontGraphics]);

  const rearSelectedIds: string[] = (((order as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((order as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    (rearSelectedIds || []).forEach((id) => { m[id] = (m[id] || 0) + 1; });
    return m;
  }, [rearSelectedIds]);
  const rearUnique = useMemo(() => {
    const ids = Array.from(new Set(rearSelectedIds || []));
    return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "", preview: "" });
  }, [rearSelectedIds, rearMeta]);

  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(order.engraving?.epitaphs) ? order.engraving!.epitaphs!.filter(Boolean) : [];
    if (arr.length) return arr;
    if (order.engraving?.epitaphText?.trim()) return [order.engraving!.epitaphText!.trim()];
    return [];
  }, [order.engraving]);

  const rearEpitaphs: string[] = useMemo(() => (((order as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean), [order]);

  const frontHasSketch = (frontUnique?.length || 0) > 0 || (frontEpitaphs?.length || 0) > 0 || !!frontWishes.trim();
  const rearHasSketch = (rearUnique?.length || 0) > 0 || (rearEpitaphs?.length || 0) > 0 || !!backWishes.trim();

  const extras: any = (order as any)?.extras || {};
  const plateEnabled: boolean = !!extras.headstonePlate;
  const plateIds: string[] = (extras.plateGraphicsIds as string[]) || [];
  const plateMeta: Record<string, any> = (extras.plateGraphicsMeta as Record<string, any>) || {};
  const plateSize = extras.plateSize as string | undefined;
  const plateThickness = extras.plateThickness as string | undefined;
  const plateOrientation = extras.plateOrientation as string | undefined;

  const plateChosen = useMemo(() => {
    const uniq = Array.from(new Set(plateIds || []));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta]);

  const plateEpitaphItems = useMemo(() => {
    const a = normalizeEpitaphItems(extras.plateEpitaph);
    const b = normalizeEpitaphItems(extras.plateEpitaphs);
    return uniqByNorm([...a, ...b]);
  }, [extras.plateEpitaph, extras.plateEpitaphs]);

  const extrasParts = useMemo(() => {
    const tumba = (extras.tumba ?? true) ? true : false;
    const flowerbed = !!extras.flowerbed;
    const vase = !!extras.vase;
    return { tumba, flowerbed, vase };
  }, [extras.tumba, extras.flowerbed, extras.vase]);

  const saveAll = () => {
    const epLines = (epitaphsText || "").split("\n").map((s) => s.trim()).filter(Boolean);

    const introNext: Intro = {
      customerName: (name || "").trim(),
      customerPhone: (phone || "").trim(),
      customerNotes: (contactNotes || "").trim() || undefined
    };
    const lock = !introData.orderNumber;
    saveIntro(introNext, { lock });

    const patch: Partial<OrderDraft> = {
      size: { notes: sizeNotes?.trim() || undefined },
      engraving: {
        epitaphs: epLines.length ? epLines : undefined,
        epitaphText: epLines.length === 1 ? epLines[0] : undefined
      } as any,
      editor: { wishes: (frontWishes || "").trim() || undefined } as any,
      editorBack: { wishes: (backWishes || "").trim() || undefined } as any,
      ...(orderNotes?.trim() ? { notes: orderNotes.trim() } : {})
    };

    const stored = saveOrderDraft(patch);
    setOrder(stored);
    refreshAll({ force: true });

    try {
      window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
      window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
    } catch {}
  };

  const [isClearing, setIsClearing] = useState(false);

  function makeEmptyDraft(): OrderDraft {
    return {
      item: null as any,
      size: {},
      engraving: { persons: [], epitaphs: undefined, epitaphText: undefined } as any,
      editor: {} as any,
      editorBack: {} as any,
      graphics: [],
      notes: undefined,
      extras: {},
      updatedAt: Date.now()
    } as OrderDraft;
  }

  async function handleClearAll() {
    if (isClearing) return;
    const ok = window.confirm("Очистить ВСЕ данные заказа, включая номер заявки и усопших? Действие необратимо.");
    if (!ok) return;

    setIsClearing(true);
    try {
      await clearOrderDraft();
      clearIntroAll();
      try {
        localStorage.removeItem("memorial.navEnabled");
        localStorage.removeItem("memorial.navEnabled.reviewOnly");
      } catch {}

      setEditing(false);
      setOpen(false);

      const blank = makeEmptyDraft();
      setOrder(blank);
      setIntroData({ intro: {}, orderNumber: undefined } as any);

      setName("");
      setPhone("");
      setContactNotes("");
      setSizeNotes("");
      setEpitaphsText("");
      setOrderNotes("");
      setFrontWishes("");
      setBackWishes("");

      try {
        window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
        window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
      } catch {}

      setTimeout(() => refreshAll({ force: true }), 0);
    } finally {
      setIsClearing(false);
    }
  }

  const coll = useCollapse(open, 280);
  const panelId = "order-panel";
  const p = palette(theme);

  return (
    <div style={{ marginTop: compactHeader ? 1 : 10, marginLeft: compactHeader ? 1 : 0, marginRight: compactHeader ? 1 : 0, marginBottom: compactHeader ? 8 : 10 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={open ? "Скрыть данные заказа" : "Показать данные заказа"}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: compactHeader ? "8px 8px" : "12px 14px",
          borderRadius: compactHeader ? 10 : 12,
          border: p.headerBorder,
          background: p.headerBg,
          color: p.headerText,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: compactHeader ? 8 : 12,
          cursor: "pointer",
          ...paperShadow(theme)
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: compactHeader ? 8 : 10, minWidth: 0 }}>
          <span style={{ fontSize: compactHeader ? 18 : 22, fontWeight: 600, letterSpacing: 0.2 }}>{title}</span>
        </div>

        <div style={{ display: "grid", gap: 3, minWidth: 0, textAlign: "right", justifyItems: "end" }}>
          <div style={{ fontSize: compactHeader ? 14 : 16, fontWeight: 700, whiteSpace: "nowrap", maxWidth: "56vw", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(editing ? name : intro?.customerName) || "—"}
          </div>
          {phoneLine && (
            <div
              style={{
                fontSize: compactHeader ? 12 : 13,
                opacity: 0.92,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: compactHeader ? "56vw" : "50vw"
              }}
              title={phoneLine}
            >
              {phoneLine}
            </div>
          )}
        </div>
      </button>

      <div
        id={panelId}
        data-topbar-panel="1"
        data-topbar-open={open ? "1" : "0"}
        ref={coll.ref}
        style={{ ...coll.style, willChange: "max-height, opacity, transform", marginTop: open ? (compactHeader ? 6 : 8) : 0 }}
      >
        <PanelAutoScale enabled={open} paddingPx={0}>
          <section
            style={{
              background: p.panelBg,
              border: p.panelBorder,
              borderRadius: compactHeader ? 10 : 12,
              color: p.text,
              ...paperShadow(theme),
              padding: compactHeader ? 8 : 12,
              display: "grid",
              gap: 10
            }}
          >
            {/* actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const next: ThemeMode = theme === "dark" ? "light" : "dark";
                  setTheme(next);
                  saveTheme(next);
                }}
                style={linkButtonStyle(theme)}
              >
                {theme === "dark" ? "Светлый стиль" : "Тёмный стиль"}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (editing) saveAll();
                  setEditing((v) => !v);
                }}
                style={linkButtonStyle(theme)}
              >
                {editing ? "Сохранить" : "Редактировать"}
              </button>
            </div>

            <div style={{ fontSize: 13, opacity: 0.9 }}>№ {orderNumber}</div>

            {/* Контакты (всегда "полная" разметка, без compact веток) */}
            <section style={{ ...glassPanelStyle(theme), padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Контакты</div>
              {editing ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <Row label="Имя" theme={theme}>
                    <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle(theme)} placeholder="Иванов Иван Иванович" />
                  </Row>
                  <Row label="Телефон" theme={theme}>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle(theme)} placeholder="+7 (___) ___-__-__" inputMode="tel" />
                  </Row>
                  <Row label="Примечание" theme={theme}>
                    <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} style={inputStyle(theme)} placeholder="Удобное время, мессенджер…" />
                  </Row>
                </div>
              ) : (
                contactNotes.trim() && <div>{contactNotes.trim()}</div>
              )}
            </section>

            {/* Резная работа (всегда 2 колонки) */}
            <section style={{ ...glassPanelStyle(theme), padding: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Резная работа</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "stretch" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ ...galleryThumbBoxStyle(), width: "100%", aspectRatio: "1 / 1" }}>
                    {order.item?.url ? (
                      <img src={order.item.url} alt={order.item.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                    ) : (
                      <div style={{ color: palette(theme).subText, fontSize: 12 }}>нет</div>
                    )}
                  </div>
                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {order.item?.name || fileNameFromUrl(order.item?.url) || "—"}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                  <div style={{ fontWeight: 600 }}>Характеристики</div>
                  <div style={{ opacity: 0.95 }}>
                    {cmValue(mmToCm(order.size?.width))}×{cmValue(mmToCm(order.size?.height))}×{cmValue(mmToCm(order.size?.thickness))} см
                  </div>
                  {(editing || sizeNotes.trim()) && (
                    <div>
                      {editing ? (
                        <textarea value={sizeNotes} onChange={(e) => setSizeNotes(e.target.value)} rows={3} placeholder="Примечание по размерам…" style={{ ...inputStyle(theme), resize: "vertical" }} />
                      ) : (
                        sizeNotes.trim() && <div style={{ whiteSpace: "pre-wrap" }}>{sizeNotes.trim()}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Люди + элементы эскиза + плита — оставляем как у вас, но БЕЗ compact-веток */}
            {(order.engraving?.persons?.length || 0) > 0 && (
              <section style={{ ...glassPanelStyle(theme), padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                  <span style={chip(theme)}>Люди на памятнике</span>
                  {(order as any)?.editorBack?.people?.length > 0 && <span style={{ ...chip(theme), opacity: 0.85 }}>Тыльная сторона</span>}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: (order as any)?.editorBack?.people?.length > 0 ? "1fr 1fr" : "1fr",
                    gap: 16
                  }}
                >
                  <div style={{ border: palette(theme).divider, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Лицевая</div>
                    <div style={{ display: "grid", gap: 0 }}>
                      {(order.engraving?.persons as any[]).map((ppl: any, idx: number) => {
                        const last = idx === (order.engraving?.persons?.length || 0) - 1;
                        const fio1 = (ppl.lastName || "").trim();
                        const fio2 = [ppl.firstName, ppl.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                        const metric = [ppl.birthDate?.trim(), ppl.deathDate?.trim()].filter(Boolean).join(" — ");
                        return (
                          <div
                            key={ppl.id || `person-front-${idx}`}
                            style={{
                              padding: "8px 0",
                              borderBottom: last ? "none" : palette(theme).divider,
                              display: "flex",
                              alignItems: "center",
                              gap: 10
                            }}
                          >
                            <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                              <div style={{ ...thumbBackdropStyle(theme), width: "100%", height: "100%" }}>
                                {ppl.photoPreview ? (
                                  <img src={ppl.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 8 }} />
                                ) : (
                                  <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                              {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                              {fio2 && <div style={{ opacity: 0.95 }}>{fio2}</div>}
                              <div style={{ opacity: 0.9 }}>{metric || "—"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(order as any)?.editorBack?.people?.length > 0 && (
                    <div style={{ border: palette(theme).divider, borderRadius: 8, padding: 8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Тыльная</div>
                      <div style={{ display: "grid", gap: 0 }}>
                        {((order as any)?.editorBack?.people as any[]).map((ppl: any, idx: number) => {
                          const last = idx === ((order as any)?.editorBack?.people?.length || 0) - 1;
                          const fio1 = (ppl.lastName || "").trim();
                          const fio2 = [ppl.firstName, ppl.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
                          const metric = [ppl.birthDate?.trim(), ppl.deathDate?.trim()].filter(Boolean).join(" — ");
                          return (
                            <div
                              key={ppl.id || `person-back-${idx}`}
                              style={{
                                padding: "8px 0",
                                borderBottom: last ? "none" : palette(theme).divider,
                                display: "flex",
                                alignItems: "center",
                                gap: 10
                              }}
                            >
                              <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                                <div style={{ ...thumbBackdropStyle(theme), width: "100%", height: "100%" }}>
                                  {ppl.photoPreview ? (
                                    <img src={ppl.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 8 }} />
                                  ) : (
                                    <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>
                                  )}
                                </div>
                              </div>
                              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                                {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                                {fio2 && <div style={{ opacity: 0.95 }}>{fio2}</div>}
                                <div style={{ opacity: 0.9 }}>{metric || "—"}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {(frontHasSketch || rearHasSketch) && (
              <section style={{ ...glassPanelStyle(theme), padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                  <span style={chip(theme)}>Элементы эскиза</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: frontHasSketch && rearHasSketch ? "1fr 1fr" : "1fr", gap: 16 }}>
                  {/* (контент как в вашем файле; без compact веток) */}
                  {/* Лицевая */}
                  {frontHasSketch && (
                    <div style={{ border: palette(theme).divider, borderRadius: 8, padding: 8 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>

                      {frontGraphics.length > 0 && (
                        <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>Графика</div>
                          {frontUnique.map((g: any) => {
                            const qty = g?.id ? (frontCountsById[g.id] || 0) : 0;
                            return (
                              <div key={`fg-${g.id || fileNameFromUrl(g.url)}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                                <div style={{ ...thumbBackdropStyle(theme), width: 64, height: 64 }}>
                                  {g.url ? (
                                    <img src={g.url} alt={g.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", borderRadius: 8 }} />
                                  ) : (
                                    <div style={{ width: 28, height: 28, background: "rgba(255,255,255,0.06)" }} />
                                  )}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                  <div style={{ color: palette(theme).text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                    {g.name || fileNameFromUrl(g.url) || g.id || "—"}
                                  </div>
                                  {qty > 1 && <div style={{ fontSize: 12, opacity: 0.8, color: palette(theme).subText }}>×{qty}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {frontEpitaphs.length > 0 && (
                        <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>Эпитафии</div>
                          <div style={epitaphListStyle()}>
                            {frontEpitaphs.map((t, idx) => (
                              <div key={`front-ep-${idx}`} style={epitaphItemStyle(theme)}>
                                <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {frontWishes.trim() && (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Пожелания</div>
                          <div style={{ whiteSpace: "pre-wrap" }}>{frontWishes.trim()}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Тыльная */}
                  {rearHasSketch && (
                    <div style={{ border: palette(theme).divider, borderRadius: 8, padding: 8 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>

                      {rearUnique.length > 0 && (
                        <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>Графика</div>
                          {rearUnique.map((g: any, i: number) => {
                            const gid = g?.id || g?.relPath || g?.url || g?.name || `rear-${i}`;
                            const qty = rearCountsById[gid] || 0;

                            return (
                              <div key={`rg-${gid}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                                <div style={{ ...thumbBackdropStyle(theme), width: 64, height: 64 }}>
                                  {g.url ? (
                                    <img src={g.url} alt={g.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", borderRadius: 8 }} />
                                  ) : (
                                    <div style={{ width: 28, height: 28, background: "rgba(255,255,255,0.06)" }} />
                                  )}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                  <div style={{ color: palette(theme).text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                    {g.name || fileNameFromUrl(g.url) || gid}
                                  </div>
                                  {qty > 1 && <div style={{ fontSize: 12, opacity: 0.8, color: palette(theme).subText }}>×{qty}</div>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {rearEpitaphs.length > 0 && (
                        <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>Эпитафии</div>
                          <div style={epitaphListStyle()}>
                            {rearEpitaphs.map((t, idx) => (
                              <div key={`rear-ep-${idx}`} style={epitaphItemStyle(theme)}>
                                <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {backWishes.trim() && (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Пожелания</div>
                          <div style={{ whiteSpace: "pre-wrap" }}>{backWishes.trim()}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Плита */}
            {plateEnabled && (
              <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Надгробная плита — выбрано</div>

                {(plateSize || plateThickness || plateOrientation) && (
                  <div style={{ marginBottom: 8, opacity: 0.95 }}>
                    {plateSize && <div>Размер: {plateSize}</div>}
                    {plateThickness && <div>Толщина: {plateThickness}</div>}
                    {plateOrientation && <div>Ориентация: {plateOrientation === "horizontal" ? "горизонтально" : "вертикально"}</div>}
                  </div>
                )}

                <div style={{ display: "grid", gap: 8 }}>
                  {plateChosen.length > 0 ? (
                    plateChosen.map((g: any, i: number) => (
                      <div key={`plate-${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, alignItems: "center" }}>
                        <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                          <div style={{ ...thumbBackdropStyle(theme), width: "100%", height: "100%" }}>
                            {g.url ? (
                              <img src={g.url} alt={g.name || g.id || ""} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", borderRadius: 8 }} />
                            ) : (
                              <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>
                            )}
                          </div>
                        </div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: palette(theme).subText }}>Графика не выбрана</div>
                  )}
                </div>

                {plateEpitaphItems.length > 0 && (
                  <div style={{ ...glassPanelStyle(theme), padding: 8, marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии (плита)</div>
                    <div style={epitaphListStyle()}>
                      {plateEpitaphItems.map((t, idx) => (
                        <div key={`plate-ep-${idx}`} style={epitaphItemStyle(theme)}>
                          <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Дополнительно */}
            <div style={{ marginTop: 8, opacity: 0.92, fontSize: 13 }}>
              <span style={{ opacity: 0.9 }}>Дополнительно: </span>
              <span style={{ fontWeight: extrasParts.tumba ? 700 : 400 }}>Тумба: {extrasParts.tumba ? "да" : "нет"}</span>
              <span style={{ opacity: 0.7 }}> · </span>
              <span style={{ fontWeight: extrasParts.flowerbed ? 700 : 400 }}>Цветник: {extrasParts.flowerbed ? "да" : "нет"}</span>
              <span style={{ opacity: 0.7 }}> · </span>
              <span style={{ fontWeight: extrasParts.vase ? 700 : 400 }}>Ваза: {extrasParts.vase ? "да" : "нет"}</span>
            </div>

                </div>
              </section>
            )}

            {plateEnabled && (
              <section style={{ ...glassPanelStyle(theme), padding: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Надгробная плита — выбрано</div>

                {(plateSize || plateThickness || plateOrientation) && (
                  <div style={{ marginBottom: 8, opacity: 0.95 }}>
                    {plateSize && <div>Размер: {plateSize}</div>}
                    {plateThickness && <div>Толщина: {plateThickness}</div>}
                    {plateOrientation && <div>Ориентация: {plateOrientation === "horizontal" ? "горизонтально" : "вертикально"}</div>}
                  </div>
                )}

                <div style={{ display: "grid", gap: 8 }}>
                  {plateChosen.length > 0 ? (
                    plateChosen.map((g: any, i: number) => (
                      <div key={`plate-${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, alignItems: "center" }}>
                        <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                          <div style={{ ...thumbBackdropStyle(theme), width: "100%", height: "100%" }}>
                            {g.url ? (
                              <img src={g.url} alt={g.name || g.id || ""} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", borderRadius: 8 }} />
                            ) : (
                              <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>
                            )}
                          </div>
                        </div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: palette(theme).subText }}>Графика не выбрана</div>
                  )}
                </div>

                {plateEpitaphItems.length > 0 && (
                  <div style={{ ...glassPanelStyle(theme), padding: 8, marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии (плита)</div>
                    <div style={epitaphListStyle()}>
                      {plateEpitaphItems.map((t, idx) => (
                        <div key={`plate-ep-${idx}`} style={epitaphItemStyle(theme)}>
                          <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            <div style={{ marginTop: 8, opacity: 0.92, fontSize: 13 }}>
              <span style={{ opacity: 0.9 }}>Дополнительно: </span>
              <span style={{ fontWeight: extrasParts.tumba ? 700 : 400 }}>Тумба: {extrasParts.tumba ? "да" : "нет"}</span>
              <span style={{ opacity: 0.7 }}> · </span>
              <span style={{ fontWeight: extrasParts.flowerbed ? 700 : 400 }}>Цветник: {extrasParts.flowerbed ? "да" : "нет"}</span>
              <span style={{ opacity: 0.7 }}> · </span>
              <span style={{ fontWeight: extrasParts.vase ? 700 : 400 }}>Ваза: {extrasParts.vase ? "да" : "нет"}</span>
            </div>

            <div style={{ marginTop: 2, paddingTop: 10, borderTop: palette(theme).divider, display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleClearAll(); }}
                style={linkButtonStyle(theme, "danger", isClearing)}
                title="Очистить все данные (с подтверждением)"
                disabled={isClearing}
              >
                {isClearing ? "Очищаем…" : "Очистить всё"}
              </button>
            </div>
          </section>
        </PanelAutoScale>
      </div>
    </div>
  );
}
