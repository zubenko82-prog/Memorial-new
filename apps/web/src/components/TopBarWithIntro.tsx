// src/components/TopBarWithIntro.tsx
// Шапка-кнопка с раскрывающейся панелью заказа.
// Правки:
// - "(тыл)" в заголовке «Люди на памятнике» теперь показывается только если есть люди на тыльной стороне (backHasPeople).
// - Остальной функционал без изменений.

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

/* ===== UI-хелперы и локальные стили ===== */
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
function glassPanelStyle(themeParam?: ThemeMode): React.CSSProperties {
  const t = themeParam ?? loadTheme();
  const p = palette(t);
  return { background: p.neutralBg, border: p.neutralBorder, borderRadius: 10, color: p.text };
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
function orientationLabel(o?: "vertical" | "horizontal"): string {
  if (!o) return "—";
  return o === "horizontal" ? "горизонтальная" : "вертикальная";
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

  // Эпитафии общим текстом (лицевая)
  const [epitaphsText, setEpitaphsText] = useState(
    (order.engraving?.epitaphs && order.engraving!.epitaphs!.join("\n")) ||
      order.engraving?.epitaphText ||
      ""
  );
  const [orderNotes, setOrderNotes] = useState(order.notes || "");

  // Пожелания (лицо/тыл)
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

  const contactValid = useMemo(() => {
    const nm = (name || "").trim().length > 1;
    return nm && isPhoneValid(phone || "");
  }, [name, phone]);

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

  // Эпитафии
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

  // Эскизы (hi/mini)
  const editorMini = order?.editor?.previewUrl as string | undefined;
  const editorBig = order?.editor?.previewHiUrl as string | undefined;
  const backMini = (order as any)?.editorBack?.previewUrl as string | undefined;
  const backBig = (order as any)?.editorBack?.previewHiUrl as string | undefined;

  const [frontWH, setFrontWH] = useState<{ w: number; h: number } | null>(null);
  const [backWH, setBackWH] = useState<{ w: number; h: number } | null>(null);
  const frontAR = frontWH ? `${frontWH.w} / ${frontWH.h}` : undefined;
  const backAR = backWH ? `${backWH.w} / ${backWH.h}` : undefined;

  // orientation для отображения
  const draftOrientation = (order.size?.orientation as "vertical" | "horizontal" | undefined) ?? ((order as any).orientation as "vertical" | "horizontal" | undefined);

  // Сохранить эскиз (скачивание)
  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const askSaveSketch = (side: "front" | "back") => {
    const url = side === "front" ? (editorBig || editorMini) : (backBig || backMini);
    if (!url) { window.alert("Эскиз ещё не сформирован"); return; }
    const ok = window.confirm(`Сохранить эскиз (${side === "front" ? "лицевая" : "тыльная"})?`);
    if (!ok) return;
    downloadDataUrl(url, side === "front" ? "front-sketch.jpg" : "rear-sketch.jpg");
  };

  const coll = useCollapse(open, 280);
  const panelId = "order-panel";

  const renderGraphicRow = (g: any, qty: number, theme: ThemeMode) => {
    const url = g.preview || g.url || "";
    const fname = g.name || fileNameFromUrl(url) || g.id || "—";
    return (
      <div key={`row-${g.id || url || fname}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
        <div
          style={{
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.18)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.04)",
            padding: 2
          }}
          title={fname}
        >
          {url ? (
            <img
              src={url}
              alt={fname}
              style={{ maxWidth: 55, maxHeight: 55, width: "auto", height: "auto", display: "block", objectFit: "contain" }}
            />
          ) : (
            <div style={{ width: 28, height: 28, background: "rgba(255,255,255,0.06)" }} />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div style={{ color: palette(theme).text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {fname}
          </div>
          {qty > 1 && <div style={{ fontSize: 12, opacity: 0.8, color: palette(theme).subText }}>×{qty}</div>}
        </div>
      </div>
    );
  };

  // Данные людей (лицо/тыл)
  const frontPersons = ((order.engraving?.persons as any[]) || []).filter(Boolean);
  const backPersons = ((((order as any)?.editorBack?.people as any[]) || []).filter(Boolean)) as Array<{
    id?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string;
    birthDate?: string;
    deathDate?: string;
    photoPreview?: string | null;
  }>;
  const backElements: any[] = (((order as any)?.editorBack?.elements as any[]) || []);
  const backHasPeople = backPersons.length > 0;
  const backHasMetric = backElements.some((el) => el?.type === "metric");

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
          border: palette(theme).headerBorder,
          background: palette(theme).headerBg,
          color: palette(theme).headerText,
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
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ display: "block", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 220ms ease" }}>
              <path d="M6 9l6 6 6-6" fill="none" stroke={palette(theme).chevronStroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </button>

      {/* Панель с коллапсом */}
      <div id={panelId} ref={coll.ref} style={{ ...coll.style, willChange: "max-height, opacity, transform", marginTop: open ? 8 : 0 }}>
        <section style={{ background: palette(theme).panelBg, border: palette(theme).panelBorder, borderRadius: 12, color: palette(theme).text, ...paperShadow(theme), padding: 12, display: "grid", gap: 10 }}>
          {/* Верхняя полоса действий */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 14 }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); const next: ThemeMode = theme === "dark" ? "light" : "dark"; setTheme(next); saveTheme(next); }} style={linkButtonStyle(theme)} className="link-like">
              {theme === "dark" ? "Светлый стиль" : "Тёмный стиль"}
            </button>

            {!editing ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }} style={linkButtonStyle(theme)} className="link-like">
                Редактировать
              </button>
            ) : (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation();
                  const curIntro = loadIntroState().intro;
                  setName(curIntro?.customerName || "");
                  setPhone(curIntro?.customerPhone || "");
                  setContactNotes(curIntro?.customerNotes || "");
                  const cur = loadOrderDraft();
                  setOrder(cur);
                  setSizeNotes(cur.size?.notes || "");
                  setEpitaphsText(cur.engraving?.epitaphs?.join("\n") || cur.engraving?.epitaphText || "");
                  setOrderNotes(cur.notes || "");
                  setFrontWishes((cur as any)?.editor?.wishes || "");
                  setBackWishes((cur as any)?.editorBack?.wishes || "");
                  setEditing(false);
                }} style={linkButtonStyle(theme)} className="link-like">Отменить</button>

                <button type="button" onClick={(e) => { e.stopPropagation();
                  if (!contactValid) return;
                  const introNext: Intro = {
                    customerName: (name || "").trim(),
                    customerPhone: (phone || "").trim(),
                    customerNotes: (contactNotes || "").trim() || undefined
                  };
                  saveIntro(introNext, { lock: false });

                  const cur = loadOrderDraft();
                  const epLines = (epitaphsText || "").split("\n").map((s) => s.trim()).filter(Boolean);

                  const sizePatch = {
                    ...(cur.size || {}),
                    notes: sizeNotes?.trim() || undefined
                  };

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
                  setEditing(false);
                }} style={linkButtonStyle(theme, "default", !contactValid)} className="link-like" aria-disabled={!contactValid}>
                  Сохранить
                </button>
              </>
            )}
          </div>

          {/* Контакты */}
          <section style={{ background: palette(theme).neutralBg, border: palette(theme).neutralBorder, borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Контакты</div>
            {!editing ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ padding: "8px 0", borderBottom: palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}><div style={{ color: palette(theme).text }}>{intro?.customerName || "—"}</div></div>
                <div style={{ padding: "8px 0", borderBottom: palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}><div style={{ color: palette(theme).text }}>{intro?.customerPhone || "—"}</div></div>
                <div style={{ padding: "8px 0", display: "flex", alignItems: "center", gap: 10 }}><div style={{ color: palette(theme).text }}>{intro?.customerNotes || "—"}</div></div>
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
          <section style={{ background: palette(theme).neutralBg, border: palette(theme).neutralBorder, borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Резная работа</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ ...galleryThumbBoxStyle(), width: 100, height: 100 }}>
                {order.item?.url ? (
                  <img src={order.item.url} alt={order.item.name || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                ) : <div style={{ color: palette(theme).subText, fontSize: 12 }}>нет</div>}
              </div>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: palette(theme).text, maxWidth: "60vw" }}>
                {order.item?.name || fileNameFromUrl(order.item?.url) || "—"}
              </div>
            </div>
          </section>

          {/* Размеры/характеристики */}
          <section style={{ background: palette(theme).neutralBg, border: palette(theme).neutralBorder, borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Размеры/характеристики</div>
            {!editing ? (
              <div style={{ display: "grid", gap: 4, color: palette(theme).text }}>
                <div style={{ padding: "6px 0" }}>
                  {cmValue(mmToCm(order.size?.width))}×{cmValue(mmToCm(order.size?.height))}×{cmValue(mmToCm(order.size?.thickness))} см
                </div>
                <div style={{ padding: "4px 0", opacity: 0.9 }}>
                  Ориентация: {orientationLabel(draftOrientation)}
                </div>
                {sizeNotes ? <div style={{ padding: "8px 0" }}>{sizeNotes}</div> : null}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <Row label="Примечание" theme={theme}><input value={sizeNotes} onChange={(e) => setSizeNotes(e.target.value)} style={inputStyle(theme)} placeholder="Например: уточнить толщину по наличию…" /></Row>
              </div>
            )}
          </section>

          {/* Люди */}
          <section style={{ background: palette(theme).neutralBg, border: palette(theme).neutralBorder, borderRadius: 10, padding: 10 }}>
            <div style={{ textAlign: "center", textDecoration: "underline", fontWeight: 600, marginBottom: 8, color: palette(theme).text }}>
              Люди на памятнике
              {backHasPeople && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}> (тыл)</span>
              )}
            </div>

            {backHasPeople ? (
              // Две колонки: левая — лицевая, правая — тыльная
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Левая колонка — лицевая */}
                <div>
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>лицевая сторона</span>
                  {frontPersons.length ? (
                    <div style={{ display: "grid", gap: 0 }}>
                      {frontPersons.map((p: any, idx: number) => {
                        const last = idx === frontPersons.length - 1;
                        const fio1 = (p.lastName || "").trim();
                        const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                        const metric = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                        return (
                          <div key={p.id || `person-front-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ ...galleryThumbBoxStyle(), width: 64, height: 64 }}>
                              {p.photoPreview ? (
                                <img src={p.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>}
                            </div>
                            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                              {fio1 && <div style={{ fontWeight: 700, color: palette(theme).text, lineHeight: 1.15, wordBreak: "break-word" }}>{fio1}</div>}
                              {fio2 && <div style={{ color: palette(theme).text, opacity: 0.95, lineHeight: 1.15, wordBreak: "break-word" }}>{fio2}</div>}
                              <div style={{ color: palette(theme).text, opacity: 0.9, lineHeight: 1.15, wordBreak: "break-word" }}>{metric || "—"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: palette(theme).subText }}>—</div>
                  )}
                </div>

                {/* Правая колонка — тыльная */}
                <div>
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>тыльная сторона</span>
                  {backPersons.length ? (
                    <div style={{ display: "grid", gap: 0 }}>
                      {backPersons.map((p: any, idx: number) => {
                        const last = idx === backPersons.length - 1;
                        const fio1 = (p.lastName || "").trim();
                        const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                        const metric = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                        return (
                          <div  key={p.id || `person-back-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ ...galleryThumbBoxStyle(), width: 64, height: 64 }}>
                              {p.photoPreview ? (
                                <img src={p.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>}
                            </div>
                            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                              {fio1 && <div style={{ fontWeight: 700, color: palette(theme).text, lineHeight: 1.15, wordBreak: "break-word" }}>{fio1}</div>}
                              {fio2 && <div style={{ color: palette(theme).text, opacity: 0.95, lineHeight: 1.15, wordBreak: "break-word" }}>{fio2}</div>}
                              <div style={{ color: palette(theme).text, opacity: 0.9, lineHeight: 1.15, wordBreak: "break-word" }}>{metric || "—"}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: palette(theme).subText }}>—</div>
                  )}
                </div>
              </div>
            ) : (
              // Одна колонка (лицевая)
              <>
                {frontPersons.length ? (
                  <div style={{ display: "grid", gap: 0 }}>
                    {frontPersons.map((p: any, idx: number) => {
                      const last = idx === frontPersons.length - 1;
                      const fio1 = (p.lastName || "").trim();
                      const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                      const metric = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                      return (
                        <div key={p.id || `person-${idx}`} style={{ padding: "8px 0", borderBottom: last ? "none" : palette(theme).divider, display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ ...galleryThumbBoxStyle(), width: 64, height: 64 }}>
                            {p.photoPreview ? (
                              <img src={p.photoPreview} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            ) : <div style={{ color: palette(theme).subText, fontSize: 11 }}>нет</div>}
                          </div>
                          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                            {fio1 && <div style={{ fontWeight: 700, color: palette(theme).text, lineHeight: 1.15, wordBreak: "break-word" }}>{fio1}</div>}
                            {fio2 && <div style={{ color: palette(theme).text, opacity: 0.95, lineHeight: 1.15, wordBreak: "break-word" }}>{fio2}</div>}
                            <div style={{ color: palette(theme).text, opacity: 0.9, lineHeight: 1.15, wordBreak: "break-word" }}>{metric || "—"}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: palette(theme).subText }}>—</div>
                )}
              </>
            )}
          </section>

          {/* Эскизы — две колонки (списки сверху, эскиз и пожелания снизу) */}
          <section style={{ background: palette(theme).neutralBg, border: palette(theme).neutralBorder, borderRadius: 10, padding: 10 }}>
            <div style={{ textAlign: "center", textDecoration: "underline", fontWeight: 600, marginBottom: 8, color: palette(theme).text }}>Эскизы</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "stretch" }}>
              {/* Левая колонка (лицевая) */}
              <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto auto", gap: 10, minHeight: 0 }}>
                {/* row 1 — списки */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Графика (лицевая)</div>
                    {frontUnique.length === 0 ? (
                      <div style={{ color: palette(theme).subText }}>Нет выбранных элементов</div>
                    ) : (
                      <div style={{ ...glassPanelStyle(theme), padding: 8 }}>
                        {frontUnique.map((g: any) => renderGraphicRow(g, frontCountsById[g.id] || 0, theme))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Эпитафии (лицевая)</div>
                    {frontEpitaphs.length === 0 ? (
                      <div style={{ color: palette(theme).subText }}>—</div>
                    ) : (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, display: "grid", gap: 6 }}>
                        {frontEpitaphs.map((t, i) => (
                          <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* row 2 — spacer */}
                <div style={{ minHeight: 0 }} />

                {/* row 3 — мини-эскиз (снизу) */}
                <div
                  role="button"
                  title={(editorBig || editorMini) ? "Сохранить эскиз (лицевая)" : "Нет превью"}
                  onClick={() => (editorBig || editorMini) && askSaveSketch("front")}
                  style={{ ...galleryThumbBoxStyle(), width: "100%", aspectRatio: (frontAR || "1 / 1"), cursor: (editorBig || editorMini) ? "pointer" : "default" }}
                >
                  {(editorBig || editorMini) ? (
                    <img
                      src={editorBig || editorMini}
                      alt="Эскиз (лицевая)"
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth && img.naturalHeight) setFrontWH({ w: img.naturalWidth, h: img.naturalHeight });
                      }}
                    />
                  ) : (
                    <div style={{ color: palette(theme).subText, fontSize: 12 }}>нет</div>
                  )}
                </div>

                {/* row 4 — пожелания */}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: palette(theme).text, fontSize: 13 }}>
                    Пожелания по эскизу (лицевая)
                  </div>
                  {!editing ? (
                    <div style={{ ...inputStyle(theme), padding: 8, minHeight: 60, whiteSpace: "pre-wrap" }}>
                      {frontWishes ? frontWishes : <span style={smallText(theme)}>—</span>}
                    </div>
                  ) : (
                    <textarea
                      value={frontWishes}
                      onChange={(e) => setFrontWishes(e.target.value)}
                      rows={3}
                      placeholder="Например: крест справа, бутоны направить влево, метрику сделать ПРОПИСНОЙ…"
                      style={{ ...inputStyle(theme), resize: "vertical" }}
                    />
                  )}
                </div>
              </div>

              {/* Правая колонка (тыльная) */}
              <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto auto", gap: 10, minHeight: 0 }}>
                {/* row 1 — списки */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Графика (тыльная)</div>
                    {rearUnique.length === 0 ? (
                      <div style={{ color: palette(theme).subText }}>Нет выбранных элементов</div>
                    ) : (
                      <div style={{ ...glassPanelStyle(theme), padding: 8 }}>
                        {rearUnique.map((g: any) => {
                          const gid = g?.id || g?.relPath || g?.url || g?.name;
                          const qty = rearCountsById[gid] || 0;
                          const rowObj = { id: gid, name: g?.name || fileNameFromUrl(g?.url) || gid, url: g?.url, preview: g?.preview };
                          return renderGraphicRow(rowObj, qty, theme);
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6, color: palette(theme).text }}>Эпитафии (тыльная)</div>
                    {rearEpitaphs.length === 0 ? (
                      <div style={{ color: palette(theme).subText }}>—</div>
                    ) : (
                      <div style={{ ...glassPanelStyle(theme), padding: 8, display: "grid", gap: 6 }}>
                        {rearEpitaphs.map((t, i) => (
                          <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* row 2 — spacer */}
                <div style={{ minHeight: 0 }} />

                {/* row 3 — мини-эскиз (снизу) */}
                <div
                  role="button"
                  title={(backBig || backMini) ? "Сохранить эскиз (тыльная)" : "Нет превью"}
                  onClick={() => (backBig || backMini) && askSaveSketch("back")}
                  style={{ ...galleryThumbBoxStyle(), width: "100%", aspectRatio: (backAR || "1 / 1"), cursor: (backBig || backMini) ? "pointer" : "default" }}
                >
                  {(backBig || backMini) ? (
                    <img
                      src={backBig || backMini}
                      alt="Эскиз (тыльная)"
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth && img.naturalHeight) setBackWH({ w: img.naturalWidth, h: img.naturalHeight });
                      }}
                    />
                  ) : (
                    <div style={{ color: palette(theme).subText, fontSize: 12 }}>нет</div>
                  )}
                </div>

                {/* row 4 — пожелания */}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: palette(theme).text, fontSize: 13 }}>
                    Пожелания по эскизу (тыльная)
                  </div>
                  {!editing ? (
                    <div style={{ ...inputStyle(theme), padding: 8, minHeight: 60, whiteSpace: "pre-wrap" }}>
                      {backWishes ? backWishes : <span style={smallText(theme)}>—</span>}
                    </div>
                  ) : (
                    <textarea
                      value={backWishes}
                      onChange={(e) => setBackWishes(e.target.value)}
                      rows={3}
                      placeholder="Например: на тыльной стороне добавить эпитафию, выровнять по правому краю…"
                      style={{ ...inputStyle(theme), resize: "vertical" }}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Низ панели: «Очистить всё» */}
          <div style={{ marginTop: 2, paddingTop: 10, borderTop: palette(theme).divider, display: "flex", justifyContent: "center" }}>
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
