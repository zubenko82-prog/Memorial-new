// src/components/TopBarWithIntro.tsx
// Шапка-кнопка с раскрывающейся панелью заказа.
// Улучшена читаемость:
// - Каждую «секцию/шаг» оборачиваем в отдельный нейтральный бокс с мягкой заливкой и рамкой.
// - В списках элементы разделяем тонкой полосой (персоны, графика).
// - Эпитафии, если их несколько — показываем по строке и разделяем полосой снизу каждую (кроме последней).
// - Внизу — две миниатюры эскизов (лицевая/тыльная), каждая 40% ширины, сохраняют пропорции, клик — большое превью.
// Остальной функционал сохранён.

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
  return v.toLowerCase() === "dark" ? "dark" : "light";
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
      divider: "1px solid #ece8de"
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
    divider: "1px solid rgba(255,255,255,0.12)"
  };
}
function paperShadow(t: ThemeMode): React.CSSProperties {
  return t === "light"
    ? { boxShadow: "0 10px 24px rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.06)" }
    : { boxShadow: "0 8px 24px rgba(0,0,0,0.45)" };
}

/* ===== Общие утилиты ===== */
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
function bottomUnderlayGradient(): React.CSSProperties {
  return {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6eff 0%, #464545ff 20%, #424242ff 40%, #888888 70%, #ffffff 100%)"
  };
}
function galleryThumbBoxStyle(): React.CSSProperties {
  return {
    ...bottomUnderlayGradient(),
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
    color: disabled ? (theme === "light" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.45)") : color,
    cursor: disabled ? "not-allowed" : "pointer",
    textDecoration: "none",
    font: "inherit",
    lineHeight: 1.2
  };
}
function Row({ label, theme, children }: { label: string; theme: ThemeMode; children: React.ReactNode }) {
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

/* ===== Анимация раскрытия ===== */
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

/* ===== Локальные стили для «шагов» и разделителей ===== */
function stepBoxStyle(theme: ThemeMode): React.CSSProperties {
  const p = palette(theme);
  return {
    background: p.neutralBg,
    border: p.neutralBorder,
    borderRadius: 10,
    padding: 10
  };
}
function listItemStyle(theme: ThemeMode, withDivider: boolean): React.CSSProperties {
  const p = palette(theme);
  return {
    padding: "8px 0",
    borderBottom: withDivider ? p.divider : "none",
    display: "flex",
    alignItems: "center",
    gap: 10
  };
}
function epitaphItemStyle(theme: ThemeMode, withDivider: boolean): React.CSSProperties {
  const p = palette(theme);
  return {
    padding: "6px 0",
    borderBottom: withDivider ? p.divider : "none",
    whiteSpace: "pre-wrap",
    color: p.text
  };
}

/* ===== Компонент ===== */
export default function TopBarWithIntro({ title = "Memorial" }: { title?: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());

  const introState = loadIntroState();
  const intro = introState.intro;
  const orderNumber = introState.orderNumber || "—";
  const [order, setOrder] = useState<OrderDraft>(() => loadOrderDraft());

  // Поля редактирования
  const [name, setName] = useState(intro?.customerName || "");
  const [phone, setPhone] = useState(intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState(intro?.customerNotes || "");
  const [sizeNotes, setSizeNotes] = useState(order.size?.notes || "");

  // Эпитафии/заметки
  const [epitaphsText, setEpitaphsText] = useState(
    (order.engraving?.epitaphs && order.engraving!.epitaphs!.join("\n")) ||
      order.engraving?.epitaphText ||
      ""
  );
  const [orderNotes, setOrderNotes] = useState(order.notes || "");

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

  // Подтягиваем стор при раскрытии
  useEffect(() => {
    if (open) {
      const cur = loadOrderDraft();
      setOrder(cur);
      setSizeNotes(cur.size?.notes || "");
      setEpitaphsText(cur.engraving?.epitaphs?.join("\n") || cur.engraving?.epitaphText || "");
      setOrderNotes(cur.notes || "");
    }
  }, [open]);

  const contactValid = useMemo(() => {
    const nm = (name || "").trim().length > 1;
    return nm && isPhoneValid(phone || "");
  }, [name, phone]);

  const graphics = order.graphics || [];

  const handleSave = () => {
    const introNext: Intro = {
      customerName: (name || "").trim(),
      customerPhone: (phone || "").trim(),
      customerNotes: (contactNotes || "").trim() || undefined
    };
    saveIntro(introNext, { lock: false });

    const epLines = (epitaphsText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const next = saveOrderDraft({
      size: { ...(order.size || {}), notes: sizeNotes?.trim() || undefined },
      engraving: {
        ...(order.engraving || {}),
        epitaphs: epLines.length ? epLines : undefined,
        epitaphText: epLines.length === 1 ? epLines[0] : undefined
      },
      notes: orderNotes?.trim() || undefined
    });

    setOrder(next);
    setEditing(false);
  };

  const handleCancel = () => {
    const curIntro = loadIntroState().intro;
    setName(curIntro?.customerName || "");
    setPhone(curIntro?.customerPhone || "");
    setContactNotes(curIntro?.customerNotes || "");
    const cur = loadOrderDraft();
    setOrder(cur);
    setSizeNotes(cur.size?.notes || "");
    setEpitaphsText(cur.engraving?.epitaphs?.join("\n") || cur.engraving?.epitaphText || "");
    setOrderNotes(cur.notes || "");
    setEditing(false);
  };

  const doClearAll = async () => {
    const ok = window.confirm("Очистить ВСЕ данные заказа, включая номер заявки? Действие необратимо.");
    if (!ok) return;
    await clearOrderDraft();
    clearIntroAll();
    setEditing(false);
    setOpen(false);
    setOrder({ graphics: [], updatedAt: Date.now() });
    setName(""); setPhone(""); setContactNotes(""); setSizeNotes(""); setEpitaphsText(""); setOrderNotes("");
  };

  const toggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
  };

  // Коллапс и палитра
  const coll = useCollapse(open, 280);
  const panelId = "order-panel";
  const pal = palette(theme);
  const panelStyle: React.CSSProperties = {
    background: pal.panelBg,
    border: pal.panelBorder,
    borderRadius: 12,
    color: pal.text,
    ...paperShadow(theme)
  };

  // Размеры/ориентация
  const hCm = mmToCm(order.size?.height);
  const wCm = mmToCm(order.size?.width);
  const tCm = mmToCm(order.size?.thickness);
  const savedOrientation = (order.size as any)?.orientation as "horizontal" | "vertical" | undefined;
  const orientationLabel = (() => {
    if (savedOrientation) return savedOrientation === "horizontal" ? "горизонтально" : "вертикально";
    if (typeof hCm === "number" && typeof wCm === "number") return hCm >= wCm ? "вертикально" : "горизонтально";
    return "";
  })();

  // Гравировка — все персоны
  type Person = {
    id?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string;
    birthDate?: string;
    deathDate?: string;
    photoPreview?: string | null;
  };
  const persons: Person[] = (order.engraving?.persons as any) || [];

  // Эскизы: лицевой/тыльный
  const editorMini = order?.editor?.previewUrl as string | undefined;
  const editorBig = order?.editor?.previewHiUrl as string | undefined;
  const backMini = (order as any)?.editorBack?.previewUrl as string | undefined;
  const backBig = (order as any)?.editorBack?.previewHiUrl as string | undefined;

  const [frontWH, setFrontWH] = useState<{ w: number; h: number } | null>(null);
  const [backWH, setBackWH] = useState<{ w: number; h: number } | null>(null);
  const frontAR = frontWH ? `${frontWH.w} / ${frontWH.h}` : undefined;
  const backAR = backWH ? `${backWH.w} / ${backWH.h}` : undefined;

  const openBig = (url?: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <style>{`
        @keyframes nudge { 0% { transform: translateY(0); } 100% { transform: translateY(3px); } }
        .link-like:hover { text-decoration: underline; }
      `}</style>

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
          padding: "12px 14px",
          borderRadius: 12,
          border: pal.headerBorder,
          background: pal.headerBg,
          color: pal.headerText,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
          ...paperShadow(theme),
          transition: "box-shadow 220ms ease, background 220ms ease, transform 120ms ease"
        }}
        onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.995)")}
        onPointerUp={(e) => (e.currentTarget.style.transform = "")}
        onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
        onMouseEnter={(e) =>
          (e.currentTarget.style.boxShadow =
            theme === "light" ? "0 12px 26px rgba(0,0,0,0.12)" : "0 10px 28px rgba(0,0,0,0.55)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = paperShadow(theme).boxShadow as string)}
      >
        {/* Слева — название */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, position: "relative" }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: 0.2 }}>{title}</span>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0, right: 0, bottom: -2, height: 2,
              background: theme === "light"
                ? "linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,0.25), rgba(0,0,0,0))"
                : "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.25), rgba(255,255,255,0))",
              opacity: open ? 0 : 0.5,
              transition: "opacity 220ms ease"
            }}
          />
        </div>

        {/* Справа — №, имя, телефон + chevron */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ display: "grid", gridAutoRows: "min-content", textAlign: "right", lineHeight: 1.15, gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 13, opacity: 0.98, whiteSpace: "nowrap" }}>№ {orderNumber}</div>
            <div style={{ fontSize: 13, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60vw" }} title={intro?.customerName || ""}>
              {intro?.customerName || "—"}
            </div>
            <div style={{ fontSize: 13, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60vw" }} title={intro?.customerPhone || ""}>
              {intro?.customerPhone || "—"}
            </div>
          </div>
          <div aria-hidden style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: palette(theme).chevronCircleBg, border: palette(theme).chevronCircleBorder, transition: "background 220ms ease, border-color 220ms ease, transform 220ms ease" }}>
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ display: "block", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 220ms ease", animation: open ? (undefined as any) : "nudge 900ms ease-in-out infinite alternate" }}>
              <path d="M6 9l6 6 6-6" fill="none" stroke={palette(theme).chevronStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </button>

      {/* Панель с коллапсом */}
      <div id={panelId} ref={coll.ref} style={{ ...coll.style, willChange: "max-height, opacity, transform", marginTop: open ? 8 : 0 }}>
        <section style={{ ...panelStyle, padding: 12, display: "grid", gap: 10 }}>
          {/* Верхняя полоса действий */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 14 }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleTheme(); }} style={linkButtonStyle(theme)} className="link-like">
              {theme === "dark" ? "Светлый стиль" : "Тёмный стиль"}
            </button>

            {!editing ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }} style={linkButtonStyle(theme)} className="link-like">
                Редактировать
              </button>
            ) : (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); handleCancel(); }} style={linkButtonStyle(theme)} className="link-like">Отменить</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (contactValid) handleSave(); }} style={linkButtonStyle(theme, "default", !contactValid)} className="link-like" aria-disabled={!contactValid}>
                  Сохранить
                </button>
              </>
            )}
          </div>

          {/* Контакты */}
          <section style={stepBoxStyle(theme)}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: pal.text }}>Контакты</div>
            {!editing ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={listItemStyle(theme, true)}><div style={{ color: pal.text }}>{intro?.customerName || "—"}</div></div>
                <div style={listItemStyle(theme, true)}><div style={{ color: pal.text }}>{intro?.customerPhone || "—"}</div></div>
                <div style={listItemStyle(theme, false)}><div style={{ color: pal.text }}>{intro?.customerNotes || "—"}</div></div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <Row label="Имя" theme={theme}><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle(theme)} placeholder="Иванов Иван Иванович" /></Row>
                <Row label="Телефон" theme={theme}><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle(theme)} placeholder="+7 (___) ___-__-__" inputMode="tel" /></Row>
                <Row label="Примечание" theme={theme}><input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} style={inputStyle(theme)} placeholder="Удобное время, мессенджер…" /></Row>
                {!isPhoneValid(phone) && (<div style={{ color: theme === "light" ? "#b91c1c" : "#ffb4b4", fontSize: 12 }}>Неверный телефон. Введите 10–11 цифр.</div>)}
              </div>
            )}
          </section>

          {/* Резная работа */}
          <section style={stepBoxStyle(theme)}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: pal.text }}>Резная работа</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ ...galleryThumbBoxStyle(), width: 100, height: 100 }}>
                {order.item?.url ? (
                  <img src={order.item.url} alt={order.item.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                ) : <div style={{ color: pal.subText, fontSize: 12 }}>нет</div>}
              </div>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: pal.text, maxWidth: "60vw" }}>
                {order.item?.name || fileNameFromUrl(order.item?.url) || "—"}
              </div>
            </div>
          </section>

          {/* Размеры/характеристики */}
          <section style={stepBoxStyle(theme)}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: pal.text }}>Размеры/характеристики</div>
            {!editing ? (
              <div style={{ display: "grid", gap: 4, color: pal.text }}>
                <div style={listItemStyle(theme, !!sizeNotes)}>
                  {cmValue(hCm)}&#215;{cmValue(wCm)}&#215;{cmValue(tCm)} см{orientationLabel ? ` — ${orientationLabel}` : ""}
                </div>
                {sizeNotes ? <div style={listItemStyle(theme, false)}>{sizeNotes}</div> : null}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <Row label="Примечание" theme={theme}><input value={sizeNotes} onChange={(e) => setSizeNotes(e.target.value)} style={inputStyle(theme)} placeholder="Например: уточнить толщину по наличию…" /></Row>
              </div>
            )}
          </section>

          {/* Гравировка */}
          <section style={stepBoxStyle(theme)}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: pal.text }}>Гравировка</div>
            {persons.length === 0 ? (
              <div style={{ color: pal.subText }}>—</div>
            ) : (
              <div style={{ display: "grid", gap: 0 }}>
                {persons.map((p, idx) => {
                  const last = idx === persons.length - 1;
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
                  const metric = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                  return (
                    <div key={(p as any).id || `person-${idx}`} style={listItemStyle(theme, !last)}>
                      <div style={{ ...galleryThumbBoxStyle(), width: 64, height: 64 }}>
                        {p.photoPreview ? (
                          <img src={p.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : <div style={{ color: pal.subText, fontSize: 11 }}>нет</div>}
                      </div>
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700, color: pal.text, lineHeight: 1.15, wordBreak: "break-word" }}>{fio1}</div>}
                        {fio2 && <div style={{ color: pal.text, opacity: 0.95, lineHeight: 1.15, wordBreak: "break-word" }}>{fio2}</div>}
                        <div style={{ color: pal.text, opacity: 0.9, lineHeight: 1.15, wordBreak: "break-word" }}>{metric || "—"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Эпитафии (каждая — отдельной строкой с полосой снизу) */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: pal.text }}>Эпитафии</div>
              {!editing ? (
                <>
                  {Array.isArray(order.engraving?.epitaphs) && order.engraving!.epitaphs!.length > 1 ? (
                    <div>
                      {order.engraving!.epitaphs!.map((t, i) => (
                        <div key={i} style={epitaphItemStyle(theme, i !== order.engraving!.epitaphs!.length - 1)}>{t}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={epitaphItemStyle(theme, false)}>
                      {order.engraving?.epitaphs?.[0] || order.engraving?.epitaphText || "—"}
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <div style={{ marginBottom: 6, color: pal.text, opacity: 0.9 }}>По одной на строку</div>
                  <textarea
                    value={epitaphsText}
                    onChange={(e) => setEpitaphsText(e.target.value)}
                    rows={3}
                    style={{ ...inputStyle(theme), resize: "vertical" }}
                    placeholder="Любим, помним…"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Выбранная графика */}
          <section style={stepBoxStyle(theme)}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: pal.text }}>Выбранная графика</div>
            {graphics.length === 0 ? (
              <div style={{ color: pal.subText }}>—</div>
            ) : (
              <div style={{ display: "grid", gap: 0 }}>
                {graphics.map((g, idx) => (
                  <div key={g.id} style={listItemStyle(theme, idx !== graphics.length - 1)}>
                    <div style={{ ...galleryThumbBoxStyle(), width: 100, height: 100 }}>
                      <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                    </div>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: pal.text, maxWidth: "60vw" }}>
                      {g.name || fileNameFromUrl(g.url)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Эскизы (внизу): слева лицевой, справа тыльный */}
          <section style={stepBoxStyle(theme)}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: pal.text }}>Эскизы</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              {/* Лицевая */}
              <div
                style={{
                  ...galleryThumbBoxStyle(),
                  width: "40%",
                  aspectRatio: frontAR || "1 / 1",
                  cursor: editorMini || editorBig ? "pointer" : "default"
                }}
                title={editorBig ? "Открыть большое превью (лицевая)" : editorMini ? "Открыть превью (лицевая)" : "Нет превью"}
                onClick={() => (editorMini || editorBig) && openBig(editorBig || editorMini)}
              >
                {editorMini ? (
                  <img
                    src={editorMini}
                    alt="Эскиз (лицевая)"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) setFrontWH({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                ) : (
                  <div style={{ color: pal.subText, fontSize: 12 }}>нет</div>
                )}
                <div style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, padding: "2px 6px", borderRadius: 6 }}>
                  Лицевая
                </div>
              </div>

              {/* Тыльная */}
              <div
                style={{
                  ...galleryThumbBoxStyle(),
                  width: "40%",
                  aspectRatio: backAR || "1 / 1",
                  cursor: backMini || backBig ? "pointer" : "default"
                }}
                title={backBig ? "Открыть большое превью (тыльная)" : backMini ? "Открыть превью (тыльная)" : "Нет превью"}
                onClick={() => (backMini || backBig) && openBig(backBig || backMini)}
              >
                {backMini ? (
                  <img
                    src={backMini}
                    alt="Эскиз (тыльная)"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) setBackWH({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                  />
                ) : (
                  <div style={{ color: pal.subText, fontSize: 12 }}>нет</div>
                )}
                <div style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, padding: "2px 6px", borderRadius: 6 }}>
                  Тыльная
                </div>
              </div>
            </div>
          </section>

          {/* Низ панели: «Очистить всё» */}
          <div
            style={{
              marginTop: 2,
              paddingTop: 10,
              borderTop: pal.divider,
              display: "flex",
              justifyContent: "center"
            }}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); doClearAll(); }}
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
