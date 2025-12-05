// src/components/TopBarWithIntro.tsx
// Шапка-кнопка с раскрывающейся панелью заказа.
//
// По требованиям:
// - «Ориентация» — не показываем (строку полностью убрали).
// - Компактный режим (<= 420px): один столбец везде, внешние отступы сверху/слева/справа — 1px (снизу без изменений),
//   всё вмещается по ширине (включая поля ввода).
// - В компактном режиме при РЕДАКТИРОВАНИИ поля контактов и примечание — с НОВОЙ строки, на всю ширину
//   (никаких инлайновых инпутов в шапке — чтобы не «накладывалось» на Memorial).
// - Разделы «Элементы эскиза» и «Люди»: визуальная отделённость сторон; не показываем пустые блоки.
// - Эпитафии выделены акцентной плашкой.
// - Контакты: имя и телефон одной строкой (если помещаются) в шапке; «примечание к контактам» показывается только если есть.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  loadIntroState,
  saveIntro,
  isPhoneValid,
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
    accentBorder: "1px solid rgba(255,242,201,0.35)",
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

/* ===== UI-хелперы и стили ===== */
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
function smallText(theme: ThemeMode): React.CSSProperties {
  return { opacity: theme === "light" ? 0.8 : 0.9, fontSize: 12, color: palette(theme).subText };
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
    color: disabled ? (p.subText) : color,
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
  return {
    background: p.accentBg,
    border: p.accentBorder,
    borderRadius: 10,
    padding: 8
  };
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
    } else {
      setStyle({
        overflow: "hidden",
        maxHeight: 0,
        opacity: 0,
        transform: "translateY(-6px)",
        transition: `max-height ${duration}ms ease, opacity ${duration}ms ease, transform ${duration}ms ease`
      });
    }
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

  const introState = loadIntroState();
  const intro = introState.intro;
  const orderNumber = introState.orderNumber || "—";
  const [order, setOrder] = useState<OrderDraft>(() => loadOrderDraft());

  // Поля редактирования (редактируем «на месте»)
  const [name, setName] = useState(intro?.customerName || "");
  const [phone, setPhone] = useState(intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState(intro?.customerNotes || "");
  const [sizeNotes, setSizeNotes] = useState(order.size?.notes || "");
  const [epitaphsText, setEpitaphsText] = useState(
    (order.engraving?.epitaphs && order.engraving!.epitaphs!.join("\n")) ||
      order.engraving?.epitaphText ||
      ""
  );
  const [orderNotes, setOrderNotes] = useState(order.notes || "");
  const [frontWishes, setFrontWishes] = useState<string>((order as any)?.editor?.wishes || "");
  const [backWishes, setBackWishes] = useState<string>((order as any)?.editorBack?.wishes || "");

  // Live-обновления из драфта
  useEffect(() => {
    const onUpd = () => setOrder(loadOrderDraft());
    window.addEventListener("storage", onUpd);
    window.addEventListener("memorial:orderDraftUpdated", onUpd as any);
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    return () => {
      window.removeEventListener("storage", onUpd);
      window.removeEventListener("memorial:orderDraftUpdated", onUpd as any);
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    };
  }, []);

  // Подтянуть стор при раскрытии
  useEffect(() => {
    if (open) {
      const cur = loadOrderDraft();
      setOrder(cur);
      setSizeNotes(cur.size?.notes || "");
      setEpitaphsText(cur.engraving?.epitaphs?.join("\n") || cur.engraving?.epitaphText || "");
      setOrderNotes(cur.notes || "");
      setFrontWishes((cur as any)?.editor?.wishes || "");
      setBackWishes((cur as any)?.editorBack?.wishes || "");
    }
  }, [open]);

  // Контакты в одну строку (отображение)
  const contactLine = useMemo(() => {
    const a = (editing ? name : intro?.customerName) || "";
    const b = (editing ? phone : intro?.customerPhone) || "";
    if (!a && !b) return "";
    if (!a) return b;
    if (!b) return a;
    return `${a} • ${b}`;
  }, [editing, name, phone, intro?.customerName, intro?.customerPhone]);

  // Графика (лицевая)
  const frontGraphics = (order.graphics || []) as any[];
  const frontCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphics.forEach((g: any) => { m[g.id] = (m[g.id] || 0) + 1; });
    return m;
  }, [frontGraphics]);
  const frontUnique = useMemo(() => {
    const first: Record<string, any> = {};
    frontGraphics.forEach((g: any) => { if (!first[g.id]) first[g.id] = g; });
    return Object.values(first);
  }, [frontGraphics]);

  // Графика (тыльная)
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

  // Эпитафии (по сторонам)
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

  // Есть ли элементы по сторонам
  const frontHasSketch =
    (frontUnique && frontUnique.length > 0) ||
    (frontEpitaphs && frontEpitaphs.length > 0) ||
    (frontWishes && frontWishes.trim().length > 0);
  const rearHasSketch =
    (rearUnique && rearUnique.length > 0) ||
    (rearEpitaphs && rearEpitaphs.length > 0) ||
    (backWishes && backWishes.trim().length > 0);

  const saveAll = () => {
    const epLines = (epitaphsText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const introNext: Intro = {
      customerName: (name || "").trim(),
      customerPhone: (phone || "").trim(),
      customerNotes: (contactNotes || "").trim() || undefined
    };
    saveIntro(introNext, { lock: false });

    const cur = loadOrderDraft();
    const sizePatch = { ...(cur.size || {}), notes: sizeNotes?.trim() || undefined };
    const next = saveOrderDraft({
      size: sizePatch as any,
      engraving: {
        ...(cur.engraving || {}),
        epitaphs: epLines.length ? epLines : undefined,
        epitaphText: epLines.length === 1 ? epLines[0] : undefined
      },
      editor: { ...(cur as any).editor, wishes: (frontWishes || "").trim() || undefined },
      editorBack: { ...(cur as any).editorBack, wishes: (backWishes || "").trim() || undefined },
      notes: orderNotes?.trim() || undefined
    });
    setOrder(next);
  };

  const coll = useCollapse(open, 280);
  const panelId = "order-panel";
  const p = palette(theme);

  return (
    <div
      style={{
        marginTop: compact ? 1 : 10,
        marginLeft: compact ? 1 : 0,
        marginRight: compact ? 1 : 0,
        marginBottom: compact ? 8 : 10
      }}
    >
      {/* Шапка-кнопка */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={open ? "Скрыть данные заказа" : "Показать данные заказа"}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: compact ? "8px 8px" : "12px 14px",
          borderRadius: compact ? 10 : 12,
          border: p.headerBorder,
          background: p.headerBg,
          color: p.headerText,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: compact ? 8 : 12,
          cursor: "pointer",
          ...paperShadow(theme)
        }}
      >
        {/* Слева — заголовок */}
        <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 10, minWidth: 0 }}>
          <span style={{ fontSize: compact ? 19 : 22, fontWeight: 600, letterSpacing: 0.2 }}>{title}</span>
        </div>

        {/* Справа — № + строка контактов (в компактном режиме при редактировании строку не показываем во избежание наложений) */}
        <div style={{ display: "grid", gap: 4, minWidth: 0, textAlign: "right", justifyItems: "end" }}>
          <div style={{ fontSize: 13, opacity: 0.98, whiteSpace: "nowrap" }}>№ {orderNumber}</div>
          {!compact && contactLine && !editing && (
            <div style={{ fontSize: 13, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60vw" }} title={contactLine}>
              {contactLine}
            </div>
          )}
          {compact && contactLine && !editing && (
            <div style={{ fontSize: 12, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62vw" }} title={contactLine}>
              {contactLine}
            </div>
          )}
        </div>
      </button>

      {/* Панель с коллапсом */}
      <div id={panelId} ref={coll.ref} style={{ ...coll.style, willChange: "max-height, opacity, transform", marginTop: open ? (compact ? 6 : 8) : 0 }}>
        <section
          style={{
            background: p.panelBg,
            border: p.panelBorder,
            borderRadius: compact ? 10 : 12,
            color: p.text,
            ...paperShadow(theme),
            padding: compact ? 8 : 12,
            display: "grid",
            gap: compact ? 8 : 10
          }}
        >
          {/* Действия */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: compact ? 10 : 14, flexWrap: "wrap" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); const next: ThemeMode = theme === "dark" ? "light" : "dark"; setTheme(next); saveTheme(next); }} style={linkButtonStyle(theme)} className="link-like">
              {theme === "dark" ? "Светлый стиль" : "Тёмный стиль"}
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); if (!editing) return; saveAll(); }} style={linkButtonStyle(theme)} className="link-like">
              {editing ? "Сохранить" : "Редактировать"}
            </button>
          </div>

          {/* Контакты — в компактном РЕДАКТИРОВАНИИ: с новой строки, ширина 100% */}
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
                    <Row label="Имя" theme={theme} compact={compact}>
                      <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle(theme)} placeholder="Иванов Иван Иванович" />
                    </Row>
                    <Row label="Телефон" theme={theme} compact={compact}>
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle(theme)} placeholder="+7 (___) ___-__-__" inputMode="tel" />
                    </Row>
                    <Row label="Примечание" theme={theme} compact={compact}>
                      <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} style={inputStyle(theme)} placeholder="Удобное время, мессенджер…" />
                    </Row>
                  </div>
                )
              ) : (
                contactNotes.trim() && <div>{contactNotes.trim()}</div>
              )}
            </section>
          )}

          {/* Резная работа: компакт — один столбец */}
          <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Резная работа</div>
            <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: 10, alignItems: "stretch" }}>
              {/* Левая — превью и имя */}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ ...galleryThumbBoxStyle(), width: "100%", aspectRatio: "1 / 1" }}>
                  {order.item?.url ? (
                    <img src={order.item.url} alt={order.item.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                  ) : (
                    <div style={{ color: p.subText, fontSize: 12 }}>нет</div>
                  )}
                </div>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {order.item?.name || fileNameFromUrl(order.item?.url) || "—"}
                </div>
              </div>

              {/* Правая — характеристики (без «Ориентация») */}
              <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                <div style={{ fontWeight: 600 }}>Характеристики</div>
                <div style={{ opacity: 0.95 }}>
                  {cmValue(mmToCm(order.size?.width))}×{cmValue(mmToCm(order.size?.height))}×{cmValue(mmToCm(order.size?.thickness))} см
                </div>
                {(editing || sizeNotes.trim()) && (
                  <div>
                    {editing ? (
                      <textarea
                        value={sizeNotes}
                        onChange={(e) => setSizeNotes(e.target.value)}
                        rows={compact ? 2 : 3}
                        placeholder="Примечание по размерам…"
                        style={{ ...inputStyle(theme), resize: "vertical" }}
                      />
                    ) : (
                      sizeNotes.trim() && <div style={{ whiteSpace: "pre-wrap" }}>{sizeNotes.trim()}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Люди — показываем если есть на хотя бы одной стороне; компакт — один столбец */}
          {(order.engraving?.persons?.length || 0) > 0 && (
            <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <span style={chip(theme)}>Люди на памятнике</span>
                {(order as any)?.editorBack?.people?.length > 0 && <span style={{ ...chip(theme), opacity: 0.85 }}>Тыльная сторона есть</span>}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : ((order as any)?.editorBack?.people?.length > 0 ? "1fr 1fr" : "1fr"), gap: 16 }}>
                {/* Лицевая */}
                <div style={{ border: p.divider, borderRadius: 8, padding: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Лицевая</div>
                  {order.engraving?.persons?.length ? (
                    <div style={{ display: "grid", gap: 0 }}>
                      {(order.engraving?.persons as any[]).map((ppl: any, idx: number) => {
                        const last = idx === (order.engraving?.persons?.length || 0) - 1;
                        const fio1 = (ppl.lastName || "").trim();
                        const fio2 = [ppl.firstName, ppl.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                        const metric = [ppl.birthDate?.trim(), ppl.deathDate?.trim()].filter(Boolean).join(" — ");
                        return (
                          <div key={ppl.id || `person-front-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : p.divider, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                              {ppl.photoPreview ? (
                                <img src={ppl.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : <div style={{ color: p.subText, fontSize: 11 }}>нет</div>}
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
                    <div style={{ color: p.subText }}>—</div>
                  )}
                </div>

                {/* Тыльная */}
                {(order as any)?.editorBack?.people?.length > 0 && (
                  <div style={{ border: p.divider, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Тыльная</div>
                    <div style={{ display: "grid", gap: 0 }}>
                      {((order as any)?.editorBack?.people as any[]).map((ppl: any, idx: number) => {
                        const last = idx === ((order as any)?.editorBack?.people?.length || 0) - 1;
                        const fio1 = (ppl.lastName || "").trim();
                        const fio2 = [ppl.firstName, ppl.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                        const metric = [ppl.birthDate?.trim(), ppl.deathDate?.trim()].filter(Boolean).join(" — ");
                        return (
                          <div key={ppl.id || `person-back-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : p.divider, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ ...galleryThumbBoxStyle(), width: 56, height: 56 }}>
                              {ppl.photoPreview ? (
                                <img src={ppl.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : <div style={{ color: p.subText, fontSize: 11 }}>нет</div>}
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

          {/* Элементы эскиза — показываем только если есть на хотя бы одной стороне; компакт — один столбец */}
          {(frontHasSketch || rearHasSketch) && (
            <section style={{ ...glassPanelStyle(theme), padding: compact ? 8 : 10 }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <span style={chip(theme)}>Элементы эскиза</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : (frontHasSketch && rearHasSketch ? "1fr 1fr" : "1fr"), gap: 16 }}>
                {/* Лицевая */}
                {frontHasSketch && (
                  <div style={{ border: p.divider, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>

                    {frontGraphics.length > 0 && (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Графика</div>
                        {frontUnique.map((g: any) => {
                          const qty = frontCountsById[g.id] || 0;
                          return (
                            <div key={`fg-${g.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                              <div style={{ borderRadius: 4, border: "1px solid rgba(255,255,255,0.18)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.04)", padding: 2 }}>
                                {g.url ? <img src={g.url} alt={g.name || ""} style={{ maxWidth: 55, maxHeight: 55, width: "auto", height: "auto", display: "block", objectFit: "contain" }} /> : <div style={{ width: 28, height: 28, background: "rgba(255,255,255,0.06)" }} />}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                <div style={{ color: p.text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                  {g.name || fileNameFromUrl(g.url) || g.id || "—"}
                                </div>
                                {qty > 1 && <div style={{ fontSize: 12, opacity: 0.8, color: p.subText }}>×{qty}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {frontEpitaphs.length > 0 && (
                      <div style={{ ...accentPanelStyle(theme), marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {frontEpitaphs.map((t, i) => (
                            <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(editing || frontWishes.trim()) && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Пожелания</div>
                        {editing ? (
                          <textarea
                            value={frontWishes}
                            onChange={(e) => setFrontWishes(e.target.value)}
                            rows={compact ? 2 : 3}
                            placeholder="Пожелания по лицевой…"
                            style={{ ...inputStyle(theme), resize: "vertical" }}
                          />
                        ) : (
                          frontWishes.trim() && <div style={{ whiteSpace: "pre-wrap" }}>{frontWishes.trim()}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Тыльная */}
                {rearHasSketch && (
                  <div style={{ border: p.divider, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>

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
                                <div style={{ color: p.text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                                  {g.name || fileNameFromUrl(g.url) || gid}
                                </div>
                                {qty > 1 && <div style={{ fontSize: 12, opacity: 0.8, color: p.subText }}>×{qty}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {rearEpitaphs.length > 0 && (
                      <div style={{ ...accentPanelStyle(theme), marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
                        <div style={{ display: "grid", gap: 6 }}>
                          {rearEpitaphs.map((t, i) => (
                            <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(editing || backWishes.trim()) && (
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Пожелания</div>
                        {editing ? (
                          <textarea
                            value={backWishes}
                            onChange={(e) => setBackWishes(e.target.value)}
                            rows={compact ? 2 : 3}
                            placeholder="Пожелания по тыльной…"
                            style={{ ...inputStyle(theme), resize: "vertical" }}
                          />
                        ) : (
                          backWishes.trim() && <div style={{ whiteSpace: "pre-wrap" }}>{backWishes.trim()}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Низ панели: действие «Очистить всё» */}
          <div style={{ marginTop: 2, paddingTop: 10, borderTop: p.divider, display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const ok = window.confirm("Очистить ВСЕ данные заказа, включая номер заявки? Действие необратимо.");
                if (!ok) return;
                await clearOrderDraft();
                clearIntroAll();
                setEditing(false);
                setOpen(false);
                setOrder({ graphics: [], updatedAt: Date.now() });
                setName(""); setPhone(""); setContactNotes(""); setSizeNotes(""); setEpitaphsText(""); setOrderNotes("");
                setFrontWishes(""); setBackWishes("");
              }}
              style={linkButtonStyle(theme, "danger")}
              className="link-like"
              title="Очистить все данные (с подтверждением)"
            >
              Очистить всё
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
