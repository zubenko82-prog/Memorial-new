// src/components/TopBarWithIntro.tsx
// Шапка-кнопка с раскрывающейся панелью заказа.
// Эпитафии теперь отображаются в разделе «Элементы эскиза» (для лицевой и тыльной сторон).

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  loadIntroState,
  saveIntro,
  type Intro,
  clearIntroAll
} from "../lib/intro";
import {
  loadOrderDraft,
  saveOrderDraft,
  clearOrderDraft,
  type OrderDraft,
  DRAFT_UPDATED_EVENT
} from "../lib/order";

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

/* ===== Адаптивность ===== */
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
function galleryThumbBoxStyle(): React.CSSProperties {
  const grad: React.CSSProperties = {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
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
function Row({ label, theme, children, compact = false }: { label: string; theme: ThemeMode; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `${compact ? 120 : 160}px 1fr`, gap: compact ? 8 : 10, alignItems: "center" }}>
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
function accentPanelStyle(theme: ThemeMode): React.CSSProperties {
  const p = palette(theme);
  return { background: p.accentBg, border: p.accentBorder, borderRadius: 10, padding: 8 };
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

/* ===== Компонент ===== */
export default function TopBarWithIntro({ title = "Memorial" }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const compact = useCompact(420);

  // Интро и номер
  const [introData, setIntroData] = useState(() => loadIntroState());
  const intro = introData.intro;
  const orderNumber = introData.orderNumber || "—";

  // Драфт заказа
  const [order, setOrder] = useState<OrderDraft>(() => loadOrderDraft());

  // Поля редактирования
  const [name, setName] = useState(intro?.customerName || "");
  const [phone, setPhone] = useState(intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState(intro?.customerNotes || "");
  const [sizeNotes, setSizeNotes] = useState(order.size?.notes || "");
  const [epitaphsText, setEpitaphsText] = useState(
    (order.engraving?.epitaphs && order.engraving!.epitaphs!.join("\n")) ||
      order.engraving?.epitaphText ||
      ""
  );
  const [orderNotes, setOrderNotes] = useState((order as any).notes || "");
  const [frontWishes, setFrontWishes] = useState<string>((order as any)?.editor?.wishes || "");
  const [backWishes, setBackWishes] = useState<string>((order as any)?.editorBack?.wishes || "");

  // Единая синхронизация (всегда подтягиваем актуальные значения)
  const refreshAll = React.useCallback((opts?: { force?: boolean }) => {
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
  }, [editing]);

  useEffect(() => {
    const onAny = () => refreshAll();
    const onVisible = () => { if (document.visibilityState === "visible") refreshAll({ force: true }); };

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

  // Линия контактная (только телефон)
  const phoneLine = useMemo(() => {
    const b = (editing ? phone : intro?.customerPhone) || "";
    return b;
  }, [editing, phone, intro?.customerPhone]);

  // Графика (лицевая/тыльная)
  const frontGraphics = (order.graphics || []) as any[];
  const frontCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphics.forEach((g: any) => { if (g?.id) m[g.id] = (m[g.id] || 0) + 1; });
    return m;
  }, [frontGraphics]);
  const frontUnique = useMemo(() => {
    const first: Record<string, any> = {};
    frontGraphics.forEach((g: any) => { const id = g?.id; if (id && !first[id]) first[id] = g; });
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

  // Эпитафии (фронт/тыл)
  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(order.engraving?.epitaphs) ? order.engraving!.epitaphs!.filter(Boolean) : [];
    if (arr.length) return arr;
    if (order.engraving?.epitaphText?.trim()) return [order.engraving!.epitaphText!.trim()];
    return [];
  }, [order.engraving]);
  const rearEpitaphs: string[] = useMemo(
    () => (((order as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean),
    [order]
  );

  const frontHasSketch =
    (frontUnique && frontUnique.length > 0) ||
    (frontEpitaphs && frontEpitaphs.length > 0) ||
    (frontWishes && frontWishes.trim().length > 0);
  const rearHasSketch =
    (rearUnique && rearUnique.length > 0) ||
    (rearEpitaphs && rearEpitaphs.length > 0) ||
    (backWishes && backWishes.trim().length > 0);

  // Extras (плита)
  const extras: any = (order as any)?.extras || {};
  const plateEnabled: boolean = !!extras.headstonePlate;
  const plateIds: string[] = (extras.plateGraphicsIds as string[]) || [];
  const plateMeta: Record<string, any> = (extras.plateGraphicsMeta as Record<string, any>) || {};
  const plateEpitaph: string = (extras.plateEpitaph as string) || "";
  const plateSize = extras.plateSize as string | undefined;
  const plateThickness = extras.plateThickness as string | undefined;
  const plateOrientation = extras.plateOrientation as string | undefined;
  const plateChosen = useMemo(() => {
    const uniq = Array.from(new Set(plateIds || []));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta]);

  // Сохранение (патч + принудительный refresh)
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

  // Очистка
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
      setName(""); setPhone(""); setContactNotes("");
      setSizeNotes(""); setEpitaphsText(""); setOrderNotes("");
      setFrontWishes(""); setBackWishes("");
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
    <div style={{ marginTop: compact ? 1 : 10, marginLeft: compact ? 1 : 0, marginRight: compact ? 1 : 0, marginBottom: compact ? 8 : 10 }}>
      {/* Шапка-кнопка */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={open ? "Скрыть данные заказа" : "Показать данные заказа"}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", textAlign: "left",
          padding: compact ? "8px 8px" : "12px 14px",
          borderRadius: compact ? 10 : 12,
          border: p.headerBorder, background: p.headerBg, color: p.headerText,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: compact ? 8 : 12, cursor: "pointer",
          ...paperShadow(theme)
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 10, minWidth: 0 }}>
          <span style={{ fontSize: compact ? 18 : 22, fontWeight: 600, letterSpacing: 0.2 }}>{title}</span>
        </div>

        {/* Справа — ИМЯ + телефон */}
        <div style={{ display: "grid", gap: 3, minWidth: 0, textAlign: "right", justifyItems: "end" }}>
          <div style={{ fontSize: compact ? 14 : 16, fontWeight: 700, whiteSpace: "nowrap", maxWidth: "56vw", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(editing ? name : intro?.customerName) || "—"}
          </div>
          {phoneLine && (
            <div style={{ fontSize: compact ? 12 : 13, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: compact ? "56vw" : "50vw" }} title={phoneLine}>
              {phoneLine}
            </div>
          )}
        </div>
      </button>

      {/* Панель */}
      <div id={panelId} ref={coll.ref} style={{ ...coll.style, willChange: "max-height, opacity, transform", marginTop: open ? (compact ? 6 : 8) : 0 }}>
        <section style={{ background: p.panelBg, border: p.panelBorder, borderRadius: compact ? 10 : 12, color: p.text, ...paperShadow(theme), padding: compact ? 8 : 12, display: "grid", gap: compact ? 8 : 10 }}>
          {/* Действия */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: compact ? 10 : 14, flexWrap: "wrap" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); const next: ThemeMode = theme === "dark" ? "light" : "dark"; setTheme(next); saveTheme(next); }} style={linkButtonStyle(theme)} className="link-like">
              {theme === "dark" ? "Светлый стиль" : "Тёмный стиль"}
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); if (editing) { saveAll(); } setEditing((v) => !v); }} style={linkButtonStyle(theme)} className="link-like">
              {editing ? "Сохранить" : "Редактировать"}
            </button>
          </div>

          {/* Номер заказа */}
          <div style={{ fontSize: 13, opacity: 0.9 }}>№ {orderNumber}</div>

          {/* Контакты */}
          {(editing || contactNotes.trim() || compact) && (
            <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Контакты</div>
              {editing ? (
                compact ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" style={{ ...inputStyle(theme) }} />
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7..." inputMode="tel" style={{ ...inputStyle(theme) }} />
                    <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} placeholder="Примечание (мессенджер, время...)" style={{ ...inputStyle(theme) }} />
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    <Row label="Имя" theme={theme} compact={compact}><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle(theme)} placeholder="Иванов Иван Иванович" /></Row>
                    <Row label="Телефон" theme={theme} compact={compact}><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle(theme)} placeholder="+7 (___) ___-__-__" inputMode="tel" /></Row>
                    <Row label="Примечание" theme={theme} compact={compact}><input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} style={inputStyle(theme)} placeholder="Удобное время, мессенджер…" /></Row>
                  </div>
                )
              ) : (
                contactNotes.trim() && <div>{contactNotes.trim()}</div>
              )}
            </section>
          )}

          {/* Резная работа */}
          <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Резная работа</div>
            <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: 10, alignItems: "stretch" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ ...galleryThumbBoxStyle(), width: "100%", aspectRatio: "1 / 1" }}>
                  {order.item?.url ? (
                    <img src={order.item.url} alt={order.item.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                  ) : <div style={{ color: palette(theme).subText, fontSize: 12 }}>нет</div>}
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
                      <textarea value={sizeNotes} onChange={(e) => setSizeNotes(e.target.value)} rows={compact ? 2 : 3} placeholder="Примечание по размерам…" style={{ ...inputStyle(theme), resize: "vertical" }} />
                    ) : (
                      sizeNotes.trim() && <div style={{ whiteSpace: "pre-wrap" }}>{sizeNotes.trim()}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Люди */}
          {(order.engraving?.persons?.length || 0) > 0 && (
            <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <span style={chip(theme)}>Люди на памятнике</span>
                {(order as any)?.editorBack?.people?.length > 0 && <span style={{ ...chip(theme), opacity: 0.85 }}>Тыльная сторона</span>}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : ((order as any)?.editorBack?.people?.length > 0 ? "1fr 1fr" : "1fr"), gap: 16 }}>
                {/* Лицевая */}
                <div style={{ border: palette(theme).divider, borderRadius: 8, padding: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Лицевая</div>
                  {order.engraving?.persons?.length ? (
                    <div style={{ display: "grid", gap: 0 }}>
                      {(order.engraving?.persons as any[]).map((ppl: any, idx: number) => {
                        const last = idx === (order.engraving?.persons?.length || 0) - 1;
                        const fio1 = (ppl.lastName || "").trim();
                        const fio2 = [ppl.firstName, ppl.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                        const metric = [ppl.birthDate?.trim(), ppl.deathDate?.trim()].filter(Boolean).join(" — ");
                        return (
                          <div key={ppl.id || `person-front-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                              {ppl.photoPreview ? (
                                <img src={ppl.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>}
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
                  ) : (
                    <div style={{ color: palette(theme).subText }}>—</div>
                  )}
                </div>

                {/* Тыльная */}
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
                          <div key={ppl.id || `person-back-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                              {ppl.photoPreview ? (
                                <img src={ppl.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>}
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

          {/* Элементы эскиза */}
          {(frontHasSketch || rearHasSketch) && (
            <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <span style={chip(theme)}></span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : (frontHasSketch && rearHasSketch ? "1fr 1fr" : "1fr"), gap: 16 }}>
                {/* Лицевая */}
                {frontHasSketch && (
                  <div style={{ border: palette(theme).divider, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>

                    {/* Графика (лицевая) */}
                    {frontGraphics.length > 0 && (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Графика</div>
                        {frontUnique.map((g: any) => {
                          const qty = g?.id ? (frontCountsById[g.id] || 0) : 0;
                          return (
                            <div key={`fg-${g.id || Math.random()}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                              <div style={{ borderRadius: 4, border: "1px solid rgba(255,255,255,0.18)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.04)", padding: 2 }}>
                                {g.url ? <img src={g.url} alt={g.name || ""} style={{ maxWidth: 55, maxHeight: 55, width: "auto", height: "auto", display: "block", objectFit: "contain" }} /> : <div style={{ width: 28, height: 28, background: "rgba(255,255,255,0.06)" }} />}
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

                    {/* Эпитафии (лицевая) */}
                    {frontEpitaphs.length > 0 && (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{frontEpitaphs.join("\n")}</div>
                      </div>
                    )}

                    {/* Пожелания (лицевая) */}
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

                    {/* Графика (тыльная) */}
                    {rearUnique.length > 0 && (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Графика</div>
                        {rearUnique.map((g: any, i: number) => {
                          const gid = g?.id || g?.relPath || g?.url || g?.name || `rear-${i}`;
                          const qty = rearCountsById[gid] || 0;
                          return (
                            <div key={`rg-${gid}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                              <div style={{ borderRadius: 4, border: "1px solid rgba(255,255,255,0.18)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.04)", padding: 2 }}>
                                {g.url ? <img src={g.url} alt={g.name || ""} style={{ maxWidth: 55, maxHeight: 55, width: "auto", height: "auto", display: "block", objectFit: "contain" }} /> : <div style={{ width: 28, height: 28, background: "rgba(255,255,255,0.06)" }} />}
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

                    {/* Эпитафии (тыльная) */}
                    {rearEpitaphs.length > 0 && (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{rearEpitaphs.join("\n")}</div>
                      </div>
                    )}

                    {/* Пожелания (тыльная) */}
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

          {/* Плита (extras) */}
          {(!!plateEnabled) && (
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
                        {g.url ? (
                          <img src={g.url} alt={g.name || g.id || ""} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                        ) : <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>}
                      </div>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.name || g.id}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: palette(theme).subText }}>Графика не выбрана</div>
                )}
              </div>
              {plateEpitaph?.trim() && (
                <div style={{ ...accentPanelStyle(theme), marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{plateEpitaph.trim()}</div>
                </div>
              )}
            </section>
          )}

          {/* Очистить всё */}
          <div style={{ marginTop: 2, paddingTop: 10, borderTop: palette(theme).divider, display: "flex", justifyContent: "center" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); void handleClearAll(); }} style={linkButtonStyle(theme, "danger", isClearing)} className="link-like" title="Очистить все данные (с подтверждением)" disabled={isClearing}>
              {isClearing ? "Очищаем…" : "Очистить всё"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
