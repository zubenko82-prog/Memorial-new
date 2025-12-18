// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Обновления:
// - Эскизы:
//   • Лицевая — всегда показываем эскиз, сгенерированный по шаблону (SketchTemplate), без подложек/заливок.
//   • Тыльная — убраны все заливки/контуры/подложки; показываем просто «резную работу» (превью редактора), отражённую по горизонтали.
// - Текст: нигде не обрезаем и не прячем; переносим строки и, где нужно, слегка уменьшаем шрифт (через clamp/переносы).
// - Остальной функционал (плита, выбранное, печать, примечания, кнопки удаления эпитафий и пр.) — сохранён.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";
import SketchTemplate from "../components/SketchTemplate";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";

/* ===== UI ===== */
function glassPanelStyle(): React.CSSProperties {
  return { background: "rgba(20,20,24,0.90)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", boxSizing: "border-box" };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const map = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: map[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}
function inputStyle(): React.CSSProperties {
  return { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", boxSizing: "border-box" };
}
function smallText(): React.CSSProperties { return { opacity: 0.8, fontSize: 12 }; }
const sectionBox: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 10 };
function chip(txt: string, accent = false) {
  return (
    <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 12, background: accent ? "rgba(138,180,255,0.28)" : "rgba(138,180,255,0.18)", border: accent ? "1px solid rgba(138,180,255,0.65)" : "1px solid rgba(138,180,255,0.35)", color: "#dbe7ff", whiteSpace: "nowrap" }}>
      {txt}
    </span>
  );
}
function AccentBox({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "rgba(255,242,201,0.15)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 10, padding: 8 }}>{children}</div>;
}
// Переносимый текст (не обрезаем, переносим, разрешаем разрывы)
function wrapTextStyle(font: number = 13): React.CSSProperties {
  return { whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "visible", fontSize: `clamp(${Math.max(11, font - 2)}px, 1.8vw, ${font}px)` };
}

/* ===== Utils ===== */
function orientationLabelShort(o?: string) {
  if (!o) return "";
  const k = String(o).toLowerCase();
  if (k.startsWith("h")) return "горизонтально";
  if (k.startsWith("v")) return "вертикально";
  return "";
}
const isCrossCategoryName = (s?: string) => (s || "").toLowerCase().includes("крест") || (s || "").toLowerCase().includes("cross");
const personLines = (p: any): string[] => {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
};

/* ===== Липкая навигация ===== */
function StickyNav({
  showRear, onGoFront, onGoRear, onGoPreviews, onGoExtras, onSimpleView
}: { showRear: boolean; onGoFront: () => void; onGoRear: () => void; onGoPreviews: () => void; onGoExtras: () => void; onSimpleView: () => void; }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(0,0,0,0.92)", backdropFilter: "saturate(120%) blur(8px)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, padding: "8px 10px", margin: "10px 0" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={onGoFront} style={glassButtonStyle("nano")}>Лицевая</button>
        {showRear && <button type="button" onClick={onGoRear} style={glassButtonStyle("nano")}>Тыльная</button>}
        <button type="button" onClick={onGoPreviews} style={glassButtonStyle("nano")}>Эскизы</button>
        <button type="button" onClick={onGoExtras} style={glassButtonStyle("nano")}>Дополнительно</button>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onSimpleView} style={glassButtonStyle("nano")} title="Упрощенный вид">Упрощенный вид</button>
      </div>
    </div>
  );
}

/* ===== Каталог плиты (Grid) ===== */
function CatGrid({ items, plateIds, addGraphic, removeGraphic }: { items: any[]; plateIds: string[]; addGraphic: (g: any) => void; removeGraphic: (gid: string) => void; }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 12 }}>
      {items.map((g: any, idx: number) => {
        const gid = String(g.id || g.relPath || g.url || g.name || idx);
        const qty = plateIds.filter((x) => x === gid).length;
        const thumbUrl = g.preview || g.url || "";
        const name = g.name || gid;
        return (
          <div key={gid} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 12 }}>
            <div role="button" title={name} onClick={() => addGraphic(g)} style={{ borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer" }}>
              {thumbUrl ? <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ ...smallText() }}>нет</div>}
            </div>
            <div style={{ marginTop: 6, opacity: 0.95, ...wrapTextStyle(12) }}>{name}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => removeGraphic(gid)} disabled={qty === 0} style={glassButtonStyle("nano", qty === 0)}>−</button>
              <span style={{ minWidth: 20, textAlign: "center" }}>{qty}</span>
              <button type="button" onClick={() => addGraphic(g)} style={glassButtonStyle("nano")}>+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===== Thumb ===== */
const Thumb = ({ url, alt = "", size = 60, borderless = false }: { url?: string; alt?: string; size?: number; borderless?: boolean }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: borderless ? "none" : "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ ...smallText() }}>нет</div>}
  </div>
);

/* ===== SidePreview ===== */
/**
 * Лицевая: всегда рендерим SketchTemplate (fallback) — без подложки.
 * Тыльная: без подложки/силуэта/градиента — просто превью редактора, отражённое по горизонтали.
 */
type FallbackTemplate = {
  item: any;
  peopleBlocks: { id: string; lines: string[]; photo?: string | null }[];
  crosses: any[];
  others: any[];
  epitaphs: string[];
  carvingOpacity?: number;
};
function SidePreview({
  title,
  frontTemplate,
  backPreview,
  itemUrl,
  aspect
}: {
  title: string;
  frontTemplate?: FallbackTemplate; // если передан — рендерим его
  backPreview?: string | null;      // тыльное превью редактора
  itemUrl?: string;
  aspect?: string;
}) {
  const isFront = !!frontTemplate;
  return (
    <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || undefined, minHeight: aspect ? undefined : 240, background: "transparent" }}>
        {isFront ? (
          <div style={{ position: "relative", zIndex: 2 }}>
            <SketchTemplate
              item={frontTemplate!.item}
              peopleBlocks={frontTemplate!.peopleBlocks}
              crosses={frontTemplate!.crosses}
              others={frontTemplate!.others}
              epitaphs={frontTemplate!.epitaphs}
              carvingOpacity={frontTemplate!.carvingOpacity ?? 0.4}
            />
          </div>
        ) : backPreview ? (
          <img
            src={backPreview}
            alt=""
            style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain", zIndex: 2, display: "block", transform: "scaleX(-1)" }}
            draggable={false}
          />
        ) : (
          <div style={{ position: "relative", zIndex: 2, width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.9 }}>Нет</div>
        )}
      </div>
    </div>
  );
}

/* ===== Информация о заказчике + Резная работа ===== */
function EditableOrderSummary({ orderNo }: { orderNo: string }) {
  const [draft] = useState(() => loadOrderDraft());
  const introState = loadIntroState();
  const [name, setName] = useState<string>(introState.intro?.customerName || "");
  const [phone, setPhone] = useState<string>(introState.intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introState.intro?.customerNotes || "");

  const saveTimer = useRef<number | null>(null);
  const scheduleSave = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const nextIntro: Intro = {
        customerName: (name || "").trim(),
        customerPhone: (phone || "").trim(),
        customerNotes: (contactNotes || "").trim() || undefined
      };
      saveIntro(nextIntro, { lock: false });
    }, 250) as unknown as number;
  };
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const dims =
    `${(draft?.size?.width && Math.round(draft.size.width / 10)) || "—"}×` +
    `${(draft?.size?.height && Math.round(draft.size.height / 10)) || "—"}×` +
    `${(draft?.size?.thickness && Math.round(draft.size.thickness / 10)) || "—"} см`;
  const orient = orientationLabelShort(draft?.size?.orientation || (draft as any)?.orientation);
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  return (
    <section style={{ ...glassPanelStyle(), padding: 12 }}>
      <div style={{ fontSize: 13, opacity: 0.95, marginBottom: 8 }}>заказ № {orderNo || "—"}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input value={name} onChange={(e) => { setName(e.target.value); scheduleSave(); }} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => { setPhone(e.target.value); scheduleSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); scheduleSave(); }} placeholder="Примечание для связи (удобное время, мессенджер…)" style={{ ...inputStyle(), marginBottom: 10 }} />

      {/* Миниатюра резной работы как обычный Thumb */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
        <Thumb url={itemUrl} alt="Резная работа" size={100} />
        <div style={{ display: "grid", gap: 4 }}>
          {(draft?.item?.name || draft?.item?.url) && (
            <div style={wrapTextStyle(13)}>
              {draft?.item?.name || decodeURIComponent((draft?.item?.url || "").split("/").pop() || "")}
            </div>
          )}
          <div style={{ opacity: 0.9, ...wrapTextStyle(13) }}>
            Размеры: {dims}{orient ? ` · ${orient}` : ""}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===== Main ===== */
type Props = { onBack?: () => void; onSend?: (payload?: any) => void };
export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    window.addEventListener("storage", refresh);
    refresh();
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const orderNo = String(introState.orderNumber || "").trim();

  // IDs секций
  const frontId = "section-front";
  const rearId = "section-rear";
  const previewsId = "section-previews";
  const extrasId = "section-extras";
  const goTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: "smooth" });
  };

  // Item / aspect
  const itemUrl = (draft as any)?.item?.url as string | undefined;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth || 0;
      const h = im.naturalHeight || 0;
      if (w && h) setAspect(`${w} / ${h}`);
    };
    im.src = itemUrl;
  }, [itemUrl]);

  // Editor previews
  const frontMini = ((draft as any)?.editor?.previewHiUrl as string | undefined) || ((draft as any)?.editor?.previewUrl as string | undefined) || null;
  const backMini = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  // Лицевая — данные для SketchTemplate (всегда)
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const frontPeopleBlocks = useMemo(() => frontPersons.map((p: any, i: number) => ({
    id: p.id || `p-${i}`,
    lines: personLines(p),
    photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
  })), [frontPersons]);
  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(draft.engraving?.epitaphs) ? draft.engraving!.epitaphs!.filter(Boolean) : [];
    if (arr.length) return arr;
    const single = (draft.engraving?.epitaphText || "").trim();
    return single ? [single] : [];
  }, [draft.engraving]);

  // Тыльная — есть ли контент (для раздела/эскиза)
  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCounts: Record<string, number> = useMemo(() => { const m: Record<string, number> = {}; (rearIds || []).forEach((id) => (m[id] = (m[id] || 0) + 1)); return m; }, [rearIds]);
  const rearUnique = useMemo(() => {
    const ids = Array.from(new Set(rearIds || []));
    return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "" });
  }, [rearIds, rearMeta]);
  const rearEpitaphs: string[] = useMemo(() => ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean)), [draft]);
  const backWishes = (((draft as any)?.editorBack?.wishes || "").trim());
  const rearHasContent = rearUnique.length > 0 || rearEpitaphs.length > 0 || !!backWishes;

  /* ===== Дополнительно (плита) ===== */
  const initialExtras = (draft as any)?.extras || {};
  const initialBase = (initialExtras.base === undefined || initialExtras.base === null) ? true : !!initialExtras.base;
  const [extraBase, setExtraBase] = useState<boolean>(initialBase);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(!!initialExtras.flowerbed);
  const [extraPlate, setExtraPlate] = useState<boolean>(!!initialExtras.headstonePlate);
  const sizeOptions = ["100×50 см", "120×60 см", "140×70 см", "Свой вариант"];
  const thicknessOptions = ["5 см", "8 см", "10 см", "Свой вариант"];
  const defaultPlateOrientation = ((draft?.size?.orientation || (draft as any)?.orientation || "vertical").toLowerCase().startsWith("h")) ? "horizontal" : "vertical";
  const [plateSize, setPlateSize] = useState<string>((initialExtras as any)?.plateSize && sizeOptions.includes((initialExtras as any)?.plateSize) ? (initialExtras as any)?.plateSize : sizeOptions[0]);
  const [plateCustomSize, setPlateCustomSize] = useState<string>((initialExtras as any)?.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>((initialExtras as any)?.plateThickness && thicknessOptions.includes((initialExtras as any)?.plateThickness) ? (initialExtras as any)?.plateThickness : thicknessOptions[0]);
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>((initialExtras as any)?.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>((initialExtras as any)?.plateOrientation || defaultPlateOrientation);
  const [plateEpitaph, setPlateEpitaph] = useState<string>((initialExtras as any)?.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>(((draft as any)?.extras?.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>(((draft as any)?.extras?.plateGraphicsMeta as Record<string, any>) || {});
  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    setPlateIds((prev) => prev.concat(gid));
    setPlateMeta((m) => ({ ...m, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } }));
  };
  const removePlateGraphic = (gid: string) => {
    setPlateIds((prev) => { const i = prev.findIndex((x) => x === gid); if (i === -1) return prev; const next = prev.slice(); next.splice(i, 1); return next; });
  };
  const chosenPlateList = useMemo(() => {
    const index: Record<string, any> = {};
    const cats = (window as any).__cachedCats as any[] | undefined; // не критично, создаём на лету ниже тоже
    // Безопасная сборка из plateMeta + уникальных ids
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta]);

  // Эпитафии плиты (для кнопок удаления)
  const plateEpitaphList = useMemo(() => (plateEpitaph || "").split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean), [plateEpitaph]);
  const deletePlateEpitaphAt = (idx: number) => {
    const arr = plateEpitaphList.slice();
    if (idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    setPlateEpitaph(arr.join("\n\n"));
  };

  // Общие примечания
  const [orderNotes, setOrderNotes] = useState<string>(((draft as any)?.extras?.orderNotes as string) || "");
  const orderNotesTimerRef = useRef<number | null>(null);
  const scheduleSaveOrderNotes = () => {
    if (orderNotesTimerRef.current) window.clearTimeout(orderNotesTimerRef.current);
    orderNotesTimerRef.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      const extras: any = { ...(prev as any).extras, orderNotes: (orderNotes || "").trim() || undefined };
      saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
      setDraft(loadOrderDraft());
    }, 300) as unknown as number;
  };
  useEffect(() => () => { if (orderNotesTimerRef.current) window.clearTimeout(orderNotesTimerRef.current); }, []);

  // Сохранение extras: не стираем plate* при снятом чекбоксе (сохраняем для будущего включения)
  useEffect(() => {
    const prev = loadOrderDraft();
    const prevExtras = ((prev as any).extras || {}) as any;
    const extras: any = { ...prevExtras, base: extraBase, flowerbed: extraFlowerbed, headstonePlate: extraPlate };
    if (extraPlate) {
      extras.plateSize = plateSize;
      extras.plateCustomSize = plateSize === "Свой вариант" ? (plateCustomSize || undefined) : prevExtras.plateCustomSize;
      extras.plateThickness = plateThickness;
      extras.plateCustomThickness = plateThickness === "Свой вариант" ? (plateCustomThickness || undefined) : prevExtras.plateCustomThickness;
      extras.plateOrientation = plateOrientation;
      extras.plateEpitaph = (plateEpitaph || "").trim() || undefined;
      extras.plateGraphicsIds = plateIds;
      extras.plateGraphicsMeta = plateMeta;
    }
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
    setDraft(loadOrderDraft());
  }, [extraBase, extraFlowerbed, extraPlate, plateSize, plateCustomSize, plateThickness, plateCustomThickness, plateOrientation, plateEpitaph, plateIds, plateMeta]);

  /* ===== Упрощенный вид (A4) — печать только его, масштаб до 1 листа ===== */
  const [simpleOpen, setSimpleOpen] = useState(false);
  const hasPrintedRef = useRef(false);
  const openSimple = () => { setSimpleOpen(true); hasPrintedRef.current = false; };
  const closeSimple = () => setSimpleOpen(false);
  const printSimple = () => {
    if (hasPrintedRef.current) return;
    try {
      const el = document.getElementById("print-root");
      if (el) {
        const a4HeightPx = 1122; // ~297мм при 96dpi
        const marginPx = Math.round(5 * 3.78); // 5мм
        const available = a4HeightPx - marginPx * 2;
        const h = el.scrollHeight;
        if (h > available) {
          const scale = Math.max(0.5, Math.min(1, available / h));
          (el as HTMLElement).style.transformOrigin = "top left";
          (el as HTMLElement).style.transform = `scale(${scale})`;
          setTimeout(() => {
            window.print();
            setTimeout(() => {
              (el as HTMLElement).style.transform = "";
              hasPrintedRef.current = false;
            }, 200);
          }, 50);
          hasPrintedRef.current = true;
          return;
        }
      }
    } catch {}
    hasPrintedRef.current = true;
    window.print();
    setTimeout(() => { hasPrintedRef.current = false; }, 600);
  };

  /* ===== Отправка ===== */
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const handleSend = async () => {
    setBusy(true);
    setErr("");

    const attachments: any = {
      frontPreview: (draft as any)?.editor?.previewHiUrl || (draft as any)?.editor?.previewUrl || null,
      backPreview: rearHasContent ? ((draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl || null) : null,
      itemUrl: itemUrl || null,
      plateGraphics: chosenPlateList
    };

    const extras: Extras & {
      base?: boolean; flowerbed?: boolean; headstonePlate?: boolean;
      plateSize?: string; plateCustomSize?: string; plateThickness?: string; plateCustomThickness?: string; plateOrientation?: string; plateEpitaph?: string; plateGraphicsIds?: string[];
      orderNo?: string; orderNotes?: string; attachments?: any;
    } = {
      base: extraBase,
      flowerbed: extraFlowerbed,
      headstonePlate: extraPlate,
      plateSize: extraPlate ? plateSize : undefined,
      plateCustomSize: extraPlate && plateSize === "Свой вариант" ? plateCustomSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateCustomThickness: extraPlate && plateThickness === "Свой вариант" ? plateCustomThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph || "").trim() || undefined : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined,
      orderNo,
      orderNotes: (orderNotes || "").trim() || undefined,
      attachments
    };

    try {
      await sendOrderEmailAndNotifyTg(extras);
      const nm = (introState.intro?.customerName || "").trim() || "Заказчик";
      window.alert(`${nm}, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами по указанному номеру для уточнения деталей и подтверждения заказа.`);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Навигация */}
      <StickyNav
        showRear={rearHasContent}
        onGoFront={() => goTo(frontId)}
        onGoRear={() => goTo(rearId)}
        onGoPreviews={() => goTo(previewsId)}
        onGoExtras={() => goTo(extrasId)}
        onSimpleView={openSimple}
      />

      {/* Информация о заказчике + Резная работа */}
      <EditableOrderSummary orderNo={orderNo} />

      {/* Лицевая — Усопшие/Эпитафии (минимум), текст переносится */}
      {(frontPersons.length || frontEpitaphs.length) ? (
        <section id={frontId} style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12, borderColor: "rgba(138,180,255,0.55)" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Лицевая", true)}</div>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Усопшие</div>
            {frontPersons.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {frontPersons.map((p: any, idx: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
                  const dates = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                  return (
                    <div key={p.id || `fp-${idx}`} style={{ display: "grid", gridTemplateColumns: p.photoPreview ? "40px 1fr" : "1fr", gap: 8, alignItems: "center" }}>
                      {p.photoPreview && <Thumb url={p.photoPreview} size={40} />}
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700, ...wrapTextStyle(13) }}>{fio1}</div>}
                        {fio2 && <div style={wrapTextStyle(13)}>{fio2}</div>}
                        {dates && <div style={{ opacity: 0.9, ...wrapTextStyle(13) }}>{dates}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div>—</div>}
          </div>

          {frontEpitaphs.length > 0 && (
            <AccentBox>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {frontEpitaphs.map((t, i) => (<div key={`fe-${i}`} style={wrapTextStyle(13)}>{t}</div>))}
              </div>
            </AccentBox>
          )}
        </section>
      ) : null}

      {/* Тыльная — (если есть контент) */}
      {rearHasContent ? (
        <section id={rearId} style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Тыльная")}</div>
          {/* Можно дополнить содержимым (графика/эпитафии) по мере необходимости — здесь основной упор на эскиз */}
        </section>
      ) : null}

      {/* Эскизы: Лицевая = SketchTemplate; Тыльная = отражённое превью без подложки */}
      <section id={previewsId} style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: rearHasContent ? "1fr 1fr" : "1fr", gap: 12, alignItems: "stretch" }}>
          <SidePreview
            title="Лицевая"
            frontTemplate={{
              item: (draft as any)?.item || null,
              peopleBlocks: frontPeopleBlocks,
              crosses: [],
              others: [],
              epitaphs: frontEpitaphs,
              carvingOpacity: 0.4
            }}
            itemUrl={itemUrl}
            aspect={aspect}
          />
          {rearHasContent && (
            <SidePreview
              title="Тыльная"
              backPreview={backMini}
              itemUrl={itemUrl}
              aspect={aspect}
            />
          )}
        </div>
      </section>

      {/* Дополнительно (плита) */}
      <ExtrasSection
        extraBase={extraBase}
        setExtraBase={setExtraBase}
        extraFlowerbed={extraFlowerbed}
        setExtraFlowerbed={setExtraFlowerbed}
        extraPlate={extraPlate}
        setExtraPlate={setExtraPlate}
        plateSize={plateSize}
        setPlateSize={setPlateSize}
        plateCustomSize={plateCustomSize}
        setPlateCustomSize={setPlateCustomSize}
        plateThickness={plateThickness}
        setPlateThickness={setPlateThickness}
        plateCustomThickness={plateCustomThickness}
        setPlateCustomThickness={setPlateCustomThickness}
        plateOrientation={plateOrientation}
        setPlateOrientation={setPlateOrientation}
        plateEpitaph={plateEpitaph}
        setPlateEpitaph={setPlateEpitaph}
        chosenPlateList={chosenPlateList}
        plateEpitaphList={plateEpitaphList}
        deletePlateEpitaphAt={deletePlateEpitaphAt}
        addPlateGraphic={addPlateGraphic}
        removePlateGraphic={removePlateGraphic}
      />

      {/* Примечание к заказу */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Примечание к заказу</label>
        <textarea id="order-notes" rows={3} value={orderNotes} onChange={(e) => { setOrderNotes(e.target.value); scheduleSaveOrderNotes(); }} placeholder="Любые замечания к заказу…" style={{ ...inputStyle(), resize: "vertical" }} />
      </section>

      {/* Подсказка перед кнопками */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ opacity: 0.95, ...wrapTextStyle(13) }}>
          Если не нашли нужного элемента или затрудняетесь с выбором — просто отправьте заказ как есть, всё согласуем лично.
        </div>
      </section>

      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>{busy ? "Отправляем…" : "Оформить заказ"}</button>
      </div>

      {/* Упрощенный вид (печать только его) */}
      {simpleOpen && (
        <PrintOverlay
          onClose={() => setSimpleOpen(false)}
          onPrint={printSimple}
          orderNo={orderNo}
          name={(introState.intro?.customerName || "").trim()}
          phone={(introState.intro?.customerPhone || "").trim()}
          itemName={draft?.item?.name || (draft?.item?.url ? decodeURIComponent((draft.item.url || "").split("/").pop() || "") : "")}
          dimsText={() => {
            const dims = `${(draft?.size?.width && Math.round(draft.size.width / 10)) || "—"}×${(draft?.size?.height && Math.round(draft.size.height / 10)) || "—"}×${(draft?.size?.thickness && Math.round(draft.size.thickness / 10)) || "—"} см`;
            const orient = orientationLabelShort(draft?.size?.orientation || (draft as any)?.orientation);
            return `${dims}${orient ? ` · ${orient}` : ""}`;
          }}
          front={{
            persons: frontPersons.map((p: any) => ({
              id: p.id,
              fio1: (p.lastName || "").trim(),
              fio2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
              dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — "),
              photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || ""
            })),
            graphics: [], // без миниатюр графики
            epitaphs: frontEpitaphs.slice()
          }}
          rear={rearHasContent ? { graphics: rearUnique.map((g: any) => ({ name: g.name || (g.url ? decodeURIComponent(g.url.split("/").pop() || "") : g.id), qty: rearCounts[g?.id || g?.url || g?.name] || 0 })), epitaphs: rearEpitaphs.slice() } : null}
          extras={{ base: extraBase, flowerbed: extraFlowerbed }}
          plate={{
            enabled: extraPlate,
            size: extraPlate ? (plateSize === "Свой вариант" ? (plateCustomSize || "Свой вариант") : plateSize) : "нет",
            thickness: extraPlate ? (plateThickness === "Свой вариант" ? (plateCustomThickness || "Свой вариант") : plateThickness) : "нет",
            graphics: extraPlate ? chosenPlateList.map((g) => ({ name: g.name || g.id })) : [],
            epitaph: extraPlate ? (plateEpitaph || "").trim() : ""
          }}
          notes={(orderNotes || "").trim()}
          previews={{ front: frontMini || "", back: rearHasContent ? (backMini || "") : "" }}
        />
      )}
    </>
  );
}

/* ===== Блок «Дополнительно» с плитой и «Выбрано для плиты» ===== */
function ExtrasSection(props: {
  extraBase: boolean; setExtraBase: (v: boolean) => void;
  extraFlowerbed: boolean; setExtraFlowerbed: (v: boolean) => void;
  extraPlate: boolean; setExtraPlate: (v: boolean) => void;
  plateSize: string; setPlateSize: (v: string) => void;
  plateCustomSize: string; setPlateCustomSize: (v: string) => void;
  plateThickness: string; setPlateThickness: (v: string) => void;
  plateCustomThickness: string; setPlateCustomThickness: (v: string) => void;
  plateOrientation: string; setPlateOrientation: (v: string) => void;
  plateEpitaph: string; setPlateEpitaph: (v: string) => void;
  chosenPlateList: { id: string; name: string; url: string }[];
  plateEpitaphList: string[];
  deletePlateEpitaphAt: (idx: number) => void;
  addPlateGraphic: (g: any) => void;
  removePlateGraphic: (gid: string) => void;
}) {
  const {
    extraBase, setExtraBase,
    extraFlowerbed, setExtraFlowerbed,
    extraPlate, setExtraPlate,
    plateSize, setPlateSize,
    plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness,
    plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    chosenPlateList, plateEpitaphList, deletePlateEpitaphAt,
    addPlateGraphic, removePlateGraphic
  } = props;

  return (
    <section id="section-extras" style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>Дополнительно</div>

      {/* «Выбрано для плиты» — скрываем весь блок, если чекбокс снят (но данные НЕ стираем) */}
      {props.extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
        <div style={{ ...sectionBox }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>

          {/* Графика */}
          {chosenPlateList.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
              {chosenPlateList.map((g, i) => (
                <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                  <Thumb url={g.url} />
                  <div style={wrapTextStyle(13)}>{g.name || g.id}</div>
                  <button type="button" onClick={() => removePlateGraphic(g.id || g.url || "")} style={glassButtonStyle("nano")} title="Удалить">
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Эпитафии — каждая с кнопкой «Удалить» */}
          {plateEpitaphList.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {plateEpitaphList.map((t, idx) => (
                <div key={`plate-ep-${idx}`} style={{ ...sectionBox, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 8 }}>
                  <div style={wrapTextStyle(13)}>{t}</div>
                  <button type="button" onClick={() => deletePlateEpitaphAt(idx)} style={glassButtonStyle("nano")} title="Удалить эпитафию">
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Тумба/Цветник */}
      <div style={{ ...sectionBox }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={extraBase} onChange={(e) => setExtraBase(e.target.checked)} />
            <span>Тумба</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={extraFlowerbed} onChange={(e) => setExtraFlowerbed(e.target.checked)} />
            <span>Цветник</span>
          </label>
        </div>
      </div>

      {/* Настройки плиты */}
      <PlateBlock
        extraPlate={extraPlate}
        setExtraPlate={setExtraPlate}
        plateSize={plateSize}
        setPlateSize={setPlateSize}
        plateCustomSize={plateCustomSize}
        setPlateCustomSize={setPlateCustomSize}
        plateThickness={plateThickness}
        setPlateThickness={setPlateThickness}
        plateCustomThickness={plateCustomThickness}
        setPlateCustomThickness={setPlateCustomThickness}
        plateOrientation={plateOrientation}
        setPlateOrientation={setPlateOrientation}
        plateEpitaph={plateEpitaph}
        setPlateEpitaph={setPlateEpitaph}
        catsLoading={false}
        catsError={""}
        cats={[]}
        catOpen={{}}
        setCatOpen={() => {}}
        addPlateGraphic={addPlateGraphic}
        removePlateGraphic={removePlateGraphic}
        plateIds={[]}
      />
    </section>
  );
}

/* ===== Блок плиты (простая версия настроек) ===== */
function PlateBlock(props: {
  extraPlate: boolean;
  setExtraPlate: (v: boolean) => void;
  plateSize: string;
  setPlateSize: (v: string) => void;
  plateCustomSize: string;
  setPlateCustomSize: (v: string) => void;
  plateThickness: string;
  setPlateThickness: (v: string) => void;
  plateCustomThickness: string;
  setPlateCustomThickness: (v: string) => void;
  plateOrientation: string;
  setPlateOrientation: (v: string) => void;
  plateEpitaph: string;
  setPlateEpitaph: (v: string) => void;
  catsLoading: boolean;
  catsError: string;
  cats: any[];
  catOpen: Record<string, boolean>;
  setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void;
  removePlateGraphic: (gid: string) => void;
  plateIds: string[];
}) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize, plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness, plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph
  } = props;

  const [plateEpitaphs, setPlateEpitaphs] = useState<string[]>((plateEpitaph || "").trim() ? (plateEpitaph as string).split(/\n{2,}/g) : []);
  useEffect(() => { setPlateEpitaph(plateEpitaphs.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n")); }, [plateEpitaphs, setPlateEpitaph]);

  const norm = (t: string) => (t || "").replace(/\r\n?/g, "\n").trim();
  const hasByNorm = (list: string[], t: string) => list.some((x) => norm(x) === norm(t));
  const toggleEpitaph = (t: string) => setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev.filter((x) => norm(x) !== norm(t)) : prev.concat([t])));
  const [customText, setCustomText] = useState("");

  return (
    <div style={{ ...sectionBox, display: "grid", gap: 12 }}>
      {/* Вкл/выкл плиты */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
          <span style={{ fontWeight: 700 }}>Надгробная плита</span>
        </label>
      </div>

      {extraPlate && (
        <>
          {/* Размер */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Размер</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-size" checked={plateSize === v} onChange={() => setPlateSize(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
            {plateSize === "Свой вариант" && (
              <input value={plateCustomSize} onChange={(e) => setPlateCustomSize(e.target.value)} placeholder="Укажите свой размер (например, 130×60 см)" style={inputStyle()} />
            )}
          </div>

          {/* Толщина */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Толщина</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-thickness" checked={plateThickness === v} onChange={() => setPlateThickness(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
            {plateThickness === "Свой вариант" && (
              <input value={plateCustomThickness} onChange={(e) => setPlateCustomThickness(e.target.value)} placeholder="Укажите толщину (например, 7 см)" style={inputStyle()} />
            )}
          </div>

          {/* Ориентация */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Ориентация</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => setPlateOrientation(v)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Эпитафии: быстрый выбор + свой текст */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Эпитафии</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {QUICK_EPITAPHS.map((t) => {
                const active = hasByNorm(plateEpitaphs, t);
                return (
                  <button key={t} type="button" onClick={() => toggleEpitaph(t)} style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }}>
                    {t}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <textarea rows={3} value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Введите текст и нажмите «Добавить»" style={{ ...inputStyle(), resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" style={glassButtonStyle("nano")} onClick={() => { const t = (customText || "").trim(); if (!t) return; setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([t]))); setCustomText(""); }}>Добавить</button>
                <button type="button" style={glassButtonStyle("nano")} onClick={() => setPlateEpitaphs([])}>Очистить выбранные</button>
                {plateEpitaphs.length > 0 && <div style={{ ...smallText() }}>Выбрано: {plateEpitaphs.length}</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ===== Упрощённый вид (A4) — печать только его ===== */
function PrintOverlay({
  onClose, onPrint, orderNo, name, phone, itemName, dimsText, front, rear, extras, plate, notes, previews
}: {
  onClose: () => void; onPrint: () => void;
  orderNo: string; name: string; phone: string; itemName?: string; dimsText: () => string;
  front: { persons: { id?: string; fio1: string; fio2: string; dates: string; photo?: string }[]; graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  rear: | null | { graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  extras: { base: boolean; flowerbed: boolean };
  plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string }[]; epitaph?: string };
  notes?: string;
  previews: { front?: string; back?: string };
}) {
  const [printing, setPrinting] = useState(false);
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "grid", placeItems: "center", padding: 12 }}>
      <div id="print-root" style={{ background: "#fff", color: "#000", width: "100%", maxWidth: "210mm", maxHeight: "95vh", overflow: "auto", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.55)", padding: "5mm" }}>
        {/* Управление */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#f0f0f0", cursor: "pointer" }}>
            Закрыть
          </button>
          <button type="button" onClick={() => { if (!printing) { setPrinting(true); onPrint(); setTimeout(() => setPrinting(false), 600); } }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }} disabled={printing}>
            {printing ? "Печать…" : "Печать"}
          </button>
        </div>

        {/* Контент */}
        <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", fontSize: 12, lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>заказ № {orderNo || "—"}</div>
          <hr />
          <div style={{ marginBottom: 6 }}>
            <div style={{ marginBottom: 4 }}>{name || "—"} · {phone || "—"}</div>
            <div><strong>Резная работа:</strong> {itemName || "—"}</div>
            <div><strong>Размер/ориентация:</strong> {dimsText()}</div>
          </div>
          <hr />

          {/* Лицевая */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Лицевая</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                {front.persons.length > 0 ? (
                  front.persons.map((p, i) => (
                    <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: p.photo ? "24px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      {p.photo && <img src={p.photo} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 4 }} />}
                      <div>
                        {p.fio1 && <div style={{ fontWeight: 600 }}>{p.fio1}</div>}
                        {p.fio2 && <div>{p.fio2}</div>}
                        {p.dates && <div>{p.dates}</div>}
                      </div>
                    </div>
                  ))
                ) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {front.graphics.length > 0 ? front.graphics.map((g, i) => <div key={`fg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {front.epitaphs.length > 0 ? front.epitaphs.map((t, i) => <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
              </div>
            </div>
          </div>
          <hr />

          {/* Тыльная */}
          {rear && (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Тыльная</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                    <div>—</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                    {rear.graphics.length > 0 ? rear.graphics.map((g, i) => <div key={`rg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                    {rear.epitaphs.length > 0 ? rear.epitaphs.map((t, i) => <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
                  </div>
                </div>
              </div>
              <hr />
            </>
          )}

          {/* Дополнительно */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Дополнительно</div>
            <div>Тумба: {extras.base ? "да" : "нет"}; Цветник: {extras.flowerbed ? "да" : "нет"}</div>
          </div>
          <hr />

          {/* Плита */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Надгробная плита</div>
            <div>Размер: {plate.enabled ? (plate.size || "—") : "нет"}; Толщина: {plate.enabled ? (plate.thickness || "—") : "нет"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 4 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                <div>—</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {plate.enabled ? (plate.graphics.length ? plate.graphics.map((g, i) => <div key={`pg-${i}`}>{g.name}</div>) : <div>—</div>) : <div>нет</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {plate.enabled ? (plate.epitaph ? <div style={{ whiteSpace: "pre-wrap" }}>{plate.epitaph}</div> : <div>—</div>) : <div>нет</div>}
              </div>
            </div>
          </div>
          <hr />

          {/* Примечания */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Примечания</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{notes || "—"}</div>
          </div>
          <hr />

          {/* Эскизы */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Эскизы</div>
            <div style={{ display: "grid", gridTemplateColumns: previews.back ? "1fr 1fr" : "1fr", gap: 8 }}>
              {previews.front ? <img src={previews.front} alt="" style={{ width: "100%", height: "auto" }} /> : <div style={{ padding: 8, border: "1px solid #ddd", textAlign: "center" }}>Нет</div>}
              {previews.back && <img src={previews.back} alt="" style={{ width: "100%", height: "auto" }} />}
            </div>
          </div>
        </div>
      </div>

      {/* Печать: A4, поля 5мм, печать только листа, попытка скрыть хедеры/футеры */}
      <style>{`
        @page {
          size: A4;
          margin: 5mm;
          @top-left { content: '' }
          @top-center { content: '' }
          @top-right { content: '' }
          @bottom-left { content: '' }
          @bottom-center { content: '' }
          @bottom-right { content: '' }
        }
        @media print {
          body * { visibility: hidden !important; }
          #print-root, #print-root * { visibility: visible !important; }
          #print-root {
            position: fixed;
            inset: 0;
            width: 210mm;
            height: auto;
            max-height: none;
            padding: 5mm;
            box-shadow: none !important;
            transform-origin: top left;
          }
          [role="dialog"] { background: transparent !important; }
          button { display: none !important; }
        }
      `}</style>
    </div>
  );
}
