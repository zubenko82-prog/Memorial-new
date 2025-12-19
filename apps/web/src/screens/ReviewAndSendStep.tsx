// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Что исправлено по замечаниям:
// 1) Состав заказа:
//    - Лицевая: снова корректно выводим выбранную графику (по draft.graphics), считаем количества.
//    - Тыльная: корректно выводим выбранную графику (editorBack.selectedGraphicsIds + graphicsMeta), считаем количества.
//    - Текст нигде не обрезаем: переносим строки (white-space: pre-wrap; word-break: break-word), при необходимости слегка уменьшаем шрифт.
// 2) Эскизы:
//    - Лицевая: показываем ТОЛЬКО резную работу (plain image itemUrl). БЕЗ подложек/заливок/масок.
//    - Тыльная: показываем ТОЛЬКО резную работу, отзеркалённый ЗАЛИТЫЙ СИЛУЭТ (#282828). БЕЗ градиента/подложек.
//      (Если itemUrl отсутствует — «Нет».)
// 3) Печать (упрощённый вид):
//    - Эскизы теперь состоят ТОЛЬКО из резной работы: лицевой (plain), тыльной (отзеркалённый залитый силуэт).
//    - Если один лист A4 не вмещает — автоматически уменьшаем (масштабируем весь лист), чтобы всё поместилось на 1 страницу.
//    - Поля по 5 мм. Попытка скрыть хедеры/футеры через @page (зависит от браузера).
//
// Прочее:
// - Блок «Выбрано для плиты» и логика сохранения/скрытия — без изменений по сравнению с последней версией.
// - Если «Надгробная плита» выключена — в упрощённом виде пишем «нет».

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";

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
const sectionBox: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 10 };
function chip(txt: string, accent = false) {
  return (
    <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 12, background: accent ? "rgba(138,180,255,0.28)" : "rgba(138,180,255,0.18)", border: accent ? "1px solid rgba(138,180,255,0.65)" : "1px solid rgba(138,180,255,0.35)", color: "#dbe7ff", whiteSpace: "nowrap" }}>
      {txt}
    </span>
  );
}
function wrapText(fontPx = 13): React.CSSProperties {
  return { whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "visible", fontSize: `clamp(${Math.max(11, fontPx - 2)}px, 1.9vw, ${fontPx}px)` };
}

/* ===== Utils ===== */
function orientationLabelShort(o?: string) {
  if (!o) return "";
  const k = String(o).toLowerCase();
  if (k.startsWith("h")) return "горизонтально";
  if (k.startsWith("v")) return "вертикально";
  return "";
}
function personLines(p: any): string[] {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}

/* ===== Навигация ===== */
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

/* ===== Thumb ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
  </div>
);

/* ===== Эскиз: Лицевая — только item; Тыльная — только залитый силуэт, без подложки ===== */
function supportsMask(): boolean {
  try {
    // @ts-ignore
    return typeof CSS !== "undefined" && CSS.supports && (CSS.supports("mask-image", 'url("")') || CSS.supports("-webkit-mask-image", 'url("")'));
  } catch { return false; }
}
function RearSilhouette({ itemUrl }: { itemUrl?: string }) {
  const can = supportsMask();
  if (!itemUrl) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}>Нет</div>;
  const isPng = /\.png(\?|#|$)/i.test(itemUrl);
  return isPng && can ? (
    <div style={{ position: "absolute", inset: 0, background: "#282828", WebkitMaskImage: `url(${itemUrl})`, WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center", WebkitMaskSize: "contain", maskImage: `url(${itemUrl})`, maskRepeat: "no-repeat", maskPosition: "center", maskSize: "contain", transform: "scaleX(-1)" }} />
  ) : (
    <img src={itemUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transform: "scaleX(-1)", filter: "grayscale(1) brightness(0)", opacity: 0.9 }} />
  );
}
function SidePreview({
  title,
  frontItemUrl,
  rearItemUrl,
  aspect,
  side // 'front' | 'rear'
}: {
  title: string;
  frontItemUrl?: string;
  rearItemUrl?: string;
  aspect?: string;
  side: "front" | "rear";
}) {
  return (
    <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || undefined, minHeight: aspect ? undefined : 240, background: "transparent" }}>
        {side === "front" ? (
          frontItemUrl ? (
            <img src={frontItemUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            <div style={{ display: "grid", placeItems: "center", height: "100%" }}>Нет</div>
          )
        ) : (
          <RearSilhouette itemUrl={rearItemUrl} />
        )}
      </div>
    </div>
  );
}

/* ===== Информация о заказчике ===== */
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
      const nextIntro: Intro = { customerName: (name || "").trim(), customerPhone: (phone || "").trim(), customerNotes: (contactNotes || "").trim() || undefined };
      saveIntro(nextIntro, { lock: false });
    }, 250) as unknown as number;
  };
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);
  const dims = `${(draft?.size?.width && Math.round(draft.size.width / 10)) || "—"}×${(draft?.size?.height && Math.round(draft.size.height / 10)) || "—"}×${(draft?.size?.thickness && Math.round(draft.size.thickness / 10)) || "—"} см`;
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
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
        <Thumb url={itemUrl} alt="Резная работа" size={100} />
        <div style={{ display: "grid", gap: 4 }}>
          {(draft?.item?.name || draft?.item?.url) && <div style={wrapText(13)}>{draft?.item?.name || decodeURIComponent((draft?.item?.url || "").split("/").pop() || "")}</div>}
          <div style={{ opacity: 0.9, ...wrapText(13) }}>Размеры: {dims}{orient ? ` · ${orient}` : ""}</div>
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

  // IDs
  const frontId = "section-front", rearId = "section-rear", previewsId = "section-previews", extrasId = "section-extras";
  const goTo = (id: string) => { const el = document.getElementById(id); if (!el) return; window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 8, behavior: "smooth" }); };

  // Item and aspect
  const itemUrl = (draft as any)?.item?.url as string | undefined;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { const w = im.naturalWidth || 0, h = im.naturalHeight || 0; if (w && h) setAspect(`${w} / ${h}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  // Previews (editor)
  const frontMini = ((draft as any)?.editor?.previewHiUrl as string | undefined) || ((draft as any)?.editor?.previewUrl as string | undefined) || null;
  const backMini = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  /* ——— Лицевая: люди, графика, эпитафии ——— */
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  // Корректный состав графики (по draft.graphics):
  const frontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const frontCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphics.forEach((g) => {
      const id = g?.id || g?.url || g?.name || "";
      if (id) m[id] = (m[id] || 0) + 1;
    });
    return m;
  }, [frontGraphics]);
  const frontUnique = useMemo(() => {
    const seen = new Set<string>(); const out: any[] = [];
    frontGraphics.forEach((g) => {
      const id = g?.id || g?.url || g?.name || "";
      if (id && !seen.has(id)) { seen.add(id); out.push(g); }
    });
    return out;
  }, [frontGraphics]);
  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(draft.engraving?.epitaphs) ? (draft.engraving!.epitaphs || []).filter(Boolean) : [];
    if (arr.length) return arr;
    const single = (draft.engraving?.epitaphText || "").trim();
    return single ? [single] : [];
  }, [draft.engraving]);

  /* ——— Тыльная: графика (editorBack) и эпитафии ——— */
  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCounts: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    (rearIds || []).forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [rearIds]);
  const rearUnique = useMemo(() => {
    const ids = Array.from(new Set(rearIds || []));
    return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "" });
  }, [rearIds, rearMeta]);
  const rearEpitaphs: string[] = useMemo(() => ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean)), [draft]);
  const backWishes = (((draft as any)?.editorBack?.wishes || "").trim());
  const rearHasContent = rearUnique.length > 0 || rearEpitaphs.length > 0 || !!backWishes;

  /* ===== Дополнительно (плита) — логика сохранения оставлена прежней ===== */
  const extras0 = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(extras0.base ?? true);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(extras0.plateOrientation || (((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h")) ? "horizontal" : "vertical"));
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    setPlateIds((prev) => prev.concat(gid));
    setPlateMeta((m) => ({ ...m, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } }));
  };
  const removePlateGraphic = (gid: string) => {
    setPlateIds((prev) => {
      const i = prev.findIndex((x) => x === gid);
      if (i === -1) return prev;
      const next = prev.slice();
      next.splice(i, 1);
      return next;
    });
  };
  // Выбранные графики плиты
  const chosenPlateList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((id) => plateMeta[id] || { id, name: id, url: "" });
  }, [plateIds, plateMeta]);

  // Эпитафии плиты -> список
  const plateEpitaphList = useMemo(() => (plateEpitaph || "").split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean), [plateEpitaph]);
  const deletePlateEpitaphAt = (idx: number) => {
    const arr = plateEpitaphList.slice();
    if (idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    setPlateEpitaph(arr.join("\n\n"));
  };

  // Общие примечания
  const [orderNotes, setOrderNotes] = useState<string>(extras0.orderNotes || "");
  const timerNotes = useRef<number | null>(null);
  const scheduleSaveOrderNotes = () => {
    if (timerNotes.current) window.clearTimeout(timerNotes.current);
    timerNotes.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      const extras: any = { ...(prev as any).extras, orderNotes: (orderNotes || "").trim() || undefined };
      saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
      setDraft(loadOrderDraft());
    }, 300) as unknown as number;
  };
  useEffect(() => () => { if (timerNotes.current) window.clearTimeout(timerNotes.current); }, []);

  // Сохранение extras (плиту не затираем при снятом чекбоксе)
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

  /* ===== Печать (масштаб до 1 листа A4) ===== */
  const [simpleOpen, setSimpleOpen] = useState(false);
  const hasPrintedRef = useRef(false);
  const printSimple = () => {
    if (hasPrintedRef.current) return;
    try {
      const el = document.getElementById("print-root");
      if (el) {
        const a4HeightPx = 1122, marginPx = Math.round(5 * 3.78);
        const available = a4HeightPx - marginPx * 2;
        const h = el.scrollHeight;
        if (h > available) {
          const scale = Math.max(0.5, Math.min(1, available / h));
          (el as HTMLElement).style.transformOrigin = "top left";
          (el as HTMLElement).style.transform = `scale(${scale})`;
          setTimeout(() => { window.print(); setTimeout(() => { (el as HTMLElement).style.transform = ""; hasPrintedRef.current = false; }, 150); }, 50);
          hasPrintedRef.current = true;
          return;
        }
      }
    } catch {}
    hasPrintedRef.current = true;
    window.print();
    setTimeout(() => { hasPrintedRef.current = false; }, 400);
  };

  /* ===== Отправка ===== */
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const handleSend = async () => {
    setBusy(true); setErr("");
    const attachments: any = {
      frontPreview: frontMini || null,
      backPreview: rearHasContent ? (backMini || null) : null,
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
      window.alert(`${nm}, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами для подтверждения деталей.`);
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <StickyNav showRear={rearHasContent} onGoFront={() => goTo(frontId)} onGoRear={() => goTo(rearId)} onGoPreviews={() => goTo(previewsId)} onGoExtras={() => goTo(extrasId)} onSimpleView={() => setSimpleOpen(true)} />

      <EditableOrderSummary orderNo={orderNo} />

      {/* Лицевая — выводим людей, графику (ИСПРАВЛЕНО), эпитафии */}
      {(frontPersons.length || frontUnique.length || frontEpitaphs.length) ? (
        <section id={frontId} style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Лицевая", true)}</div>

          {/* Люди */}
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Усопшие</div>
            {frontPersons.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {frontPersons.map((p: any, idx: number) => {
                  const [l1, l2, l3] = personLines(p);
                  return (
                    <div key={p.id || `fp-${idx}`} style={{ display: "grid", gridTemplateColumns: p.photoPreview ? "40px 1fr" : "1fr", gap: 8, alignItems: "center" }}>
                      {p.photoPreview && <Thumb url={p.photoPreview} size={40} />}
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {l1 && <div style={{ fontWeight: 700, ...wrapText(13) }}>{l1}</div>}
                        {l2 && <div style={wrapText(13)}>{l2}</div>}
                        {l3 && <div style={{ opacity: 0.9, ...wrapText(13) }}>{l3}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div>—</div>}
          </div>

          {/* Графика (ИСПРАВЛЕНО) */}
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
            {frontUnique.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {frontUnique.map((g: any, i: number) => {
                  const id = g?.id || g?.url || g?.name || `fg-${i}`;
                  const qty = (g?.id || g?.url || g?.name) ? (frontCountsById[g?.id || g?.url || g?.name] || 0) : 1;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={id} style={{ display: "grid", gridTemplateColumns: g?.url ? "40px 1fr auto" : "1fr auto", gap: 8, alignItems: "center" }}>
                      {g?.url && <Thumb url={g.url} size={40} />}
                      <div style={wrapText(13)}>{name}</div>
                      {qty > 1 && <div style={{ opacity: 0.85, fontSize: 12 }}>×{qty}</div>}
                    </div>
                  );
                })}
              </div>
            ) : <div>—</div>}
          </div>

          {/* Эпитафии */}
          {frontEpitaphs.length > 0 && (
            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {frontEpitaphs.map((t, i) => (<div key={`fe-${i}`} style={wrapText(13)}>{t}</div>))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* Тыльная — графика и эпитафии */}
      {rearHasContent ? (
        <section id={rearId} style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Тыльная")}</div>

          {/* Графика (ИСПРАВЛЕНО) */}
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
            {rearUnique.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {rearUnique.map((g: any, i: number) => {
                  const id = g?.id || g?.relPath || g?.url || g?.name || `rg-${i}`;
                  const qty = rearCounts[id] || 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={id} style={{ display: "grid", gridTemplateColumns: g?.url ? "40px 1fr auto" : "1fr auto", gap: 8, alignItems: "center" }}>
                      {g?.url && <Thumb url={g.url} size={40} />}
                      <div style={wrapText(13)}>{name}</div>
                      {qty > 1 && <div style={{ opacity: 0.85, fontSize: 12 }}>×{qty}</div>}
                    </div>
                  );
                })}
              </div>
            ) : <div>—</div>}
          </div>

          {/* Эпитафии */}
          {rearEpitaphs.length > 0 && (
            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {rearEpitaphs.map((t, i) => (<div key={`re-${i}`} style={wrapText(13)}>{t}</div>))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* Эскизы — только резная работа: front = item; rear = отзеркалённый залитый силуэт */}
      <section id={previewsId} style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: rearHasContent ? "1fr 1fr" : "1fr", gap: 12 }}>
          <SidePreview title="Лицевая" frontItemUrl={itemUrl} aspect={aspect} side="front" />
          {rearHasContent && <SidePreview title="Тыльная" rearItemUrl={itemUrl} aspect={aspect} side="rear" />}
        </div>
      </section>

      {/* Дополнительно (плита) — блок «Выбрано для плиты», удаление эпитафий и графики */}
      <section id={extrasId} style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Дополнительно</div>

        {extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>

            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                {chosenPlateList.map((g, i) => (
                  <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                    <Thumb url={g.url} />
                    <div style={wrapText(13)}>{g.name || g.id}</div>
                    <button type="button" onClick={() => removePlateGraphic(g.id || g.url || "")} style={glassButtonStyle("nano")}>Удалить</button>
                  </div>
                ))}
              </div>
            )}

            {plateEpitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {plateEpitaphList.map((t, idx) => (
                  <div key={`pe-${idx}`} style={{ ...sectionBox, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 8 }}>
                    <div style={wrapText(13)}>{t}</div>
                    <button type="button" onClick={() => deletePlateEpitaphAt(idx)} style={glassButtonStyle("nano")}>Удалить</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Переключатели тумба/цветник (сохранение осталось прежним) */}
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
      </section>

      {/* Примечание заказа */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Примечание к заказу</label>
        <textarea id="order-notes" rows={3} value={orderNotes} onChange={(e) => { setOrderNotes(e.target.value); scheduleSaveOrderNotes(); }} placeholder="Любые замечания к заказу…" style={{ ...inputStyle(), resize: "vertical" }} />
      </section>

      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      {/* Подсказка перед кнопками */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={wrapText(13)}>Если не нашли нужного элемента или затрудняетесь с выбором — просто отправьте заказ как есть, всё согласуем лично.</div>
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>{busy ? "Отправляем…" : "Оформить заказ"}</button>
      </div>

      {/* Упрощенный вид (Печать) — эскизы: только резная работа (front plain, rear silhouette) */}
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
          front={{ persons: frontPersons.map((p: any) => ({ id: p.id, fio1: (p.lastName || "").trim(), fio2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "), dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — "), photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || "" })), graphics: frontUnique.map((g: any) => ({ name: g.name || (g.url ? decodeURIComponent(g.url.split("/").pop() || "") : g.id), qty: (g?.id || g?.url || g?.name) ? (frontCountsById[g?.id || g?.url || g?.name] || 0) : 1 })), epitaphs: frontEpitaphs.slice() }}
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
          itemUrl={itemUrl || ""}
        />
      )}
    </>
  );
}

/* ===== Упрощённый вид (A4) — эскизы: только резная работа ===== */
function PrintOverlay({
  onClose, onPrint, orderNo, name, phone, itemName, dimsText, front, rear, extras, plate, notes, itemUrl
}: {
  onClose: () => void; onPrint: () => void;
  orderNo: string; name: string; phone: string; itemName?: string; dimsText: () => string;
  front: { persons: { id?: string; fio1: string; fio2: string; dates: string; photo?: string }[]; graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  rear: | null | { graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  extras: { base: boolean; flowerbed: boolean };
  plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string }[]; epitaph?: string };
  notes?: string;
  itemUrl: string;
}) {
  const [printing, setPrinting] = useState(false);
  const canMask = supportsMask();
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "grid", placeItems: "center", padding: 12 }}>
      <div id="print-root" style={{ background: "#fff", color: "#000", width: "100%", maxWidth: "210mm", maxHeight: "95vh", overflow: "auto", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.55)", padding: "5mm" }}>
        {/* Управление */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#f0f0f0", cursor: "pointer" }}>Закрыть</button>
          <button type="button" onClick={() => { if (!printing) { setPrinting(true); onPrint(); setTimeout(() => setPrinting(false), 400); } }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }} disabled={printing}>{printing ? "Печать…" : "Печать"}</button>
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

          {/* Лицевая/Тыльная — состав заказа (3 колонки) — оставлено без изменений */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Лицевая</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                {front.persons.length ? front.persons.map((p, i) => (
                  <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: p.photo ? "24px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    {p.photo && <img src={p.photo} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 4 }} />}
                    <div>
                      {p.fio1 && <div style={{ fontWeight: 600 }}>{p.fio1}</div>}
                      {p.fio2 && <div>{p.fio2}</div>}
                      {p.dates && <div>{p.dates}</div>}
                    </div>
                  </div>
                )) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {front.graphics.length ? front.graphics.map((g, i) => <div key={`fg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {front.epitaphs.length ? front.epitaphs.map((t, i) => <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
              </div>
            </div>
          </div>
          <hr />
          {rear && (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Тыльная</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                  <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div><div>—</div></div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                    {rear.graphics.length ? rear.graphics.map((g, i) => <div key={`rg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                    {rear.epitaphs.length ? rear.epitaphs.map((t, i) => <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
                  </div>
                </div>
              </div>
              <hr />
            </>
          )}

          {/* Дополнительно/Плита */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Дополнительно</div>
            <div>Тумба: {extras.base ? "да" : "нет"}; Цветник: {extras.flowerbed ? "да" : "нет"}</div>
          </div>
          <hr />
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Надгробная плита</div>
            <div>Размер: {plate.enabled ? (plate.size || "—") : "нет"}; Толщина: {plate.enabled ? (plate.thickness || "—") : "нет"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 4 }}>
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div><div>—</div></div>
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>{plate.enabled ? (plate.graphics.length ? plate.graphics.map((g, i) => <div key={`pg-${i}`}>{g.name}</div>) : <div>—</div>) : <div>нет</div>}</div>
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>{plate.enabled ? (plate.epitaph ? <div style={{ whiteSpace: "pre-wrap" }}>{plate.epitaph}</div> : <div>—</div>) : <div>нет</div>}</div>
            </div>
          </div>
          <hr />

          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Примечания</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{notes || "—"}</div>
          </div>
          <hr />

          {/* Эскизы: ТОЛЬКО резная работа (front plain, rear silhouette) */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Эскизы</div>
            <div style={{ display: "grid", gridTemplateColumns: rear ? "1fr 1fr" : "1fr", gap: 8 }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", border: "1px solid #ddd" }}>
                {itemUrl ? <img src={itemUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ display: "grid", placeItems: "center", height: "100%" }}>Нет</div>}
              </div>
              {rear && (
                <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", border: "1px solid #ddd" }}>
                  {itemUrl ? (
                    canMask && /\.png(\?|#|$)/i.test(itemUrl)
                      ? <div style={{ position: "absolute", inset: 0, background: "#282828", WebkitMaskImage: `url(${itemUrl})`, WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center", WebkitMaskSize: "contain", maskImage: `url(${itemUrl})`, maskRepeat: "no-repeat", maskPosition: "center", maskSize: "contain", transform: "scaleX(-1)" }} />
                      : <img src={itemUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", transform: "scaleX(-1)", filter: "grayscale(1) brightness(0)", opacity: 0.9 }} />
                  ) : (
                    <div style={{ display: "grid", placeItems: "center", height: "100%" }}>Нет</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Печать: только этот лист, поля 5мм, масштабируем если нужно */}
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
