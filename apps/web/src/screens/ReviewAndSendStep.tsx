// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Что показываем:
// - Номер заказа и информацию о заказчике (Имя, Телефон, примечание для связи).
// - Эскизы: лицевая из SketchTemplate, тыльная — превью из драфта.
// - Дополнительно (тумба/цветник + надгробная плита).
// - Примечания к заказу.
// - «Заказ списком» — оставляем как есть, открывается как оверлей печати.
// Навигацию по разделам УБРАНА. Ссылка «Заказ списком» находится в ОДНОЙ строке с номером заказа.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import SketchTemplate from "../components/SketchTemplate";

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
function wrapText(fontPx = 13): React.CSSProperties {
  return { whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "visible", fontSize: `clamp(${Math.max(11, fontPx - 2)}px, 1.9vw, ${fontPx}px)` };
}
function gradientUnderlay(): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)",
    zIndex: 0
  };
}
function linkLike(): React.CSSProperties {
  return {
    color: "#8ab4ff",
    textDecoration: "underline",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    padding: 0,
    font: "inherit"
  };
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

/* ===== Thumb (миниатюры) ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
  </div>
);

/* ===== Эскиз-карточка для тыльной (превью из драфта) ===== */
function SketchCard({ title, url, aspect }: { title: string; url?: string | null; aspect?: string }) {
  return (
    <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || "4 / 3", minHeight: 220 }}>
        <div style={gradientUnderlay()} />
        {url ? (
          <img src={url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1 }} />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 1 }}>Нет</div>
        )}
      </div>
    </div>
  );
}

/* ===== Каталог графики для плиты ===== */
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
              {thumbUrl ? <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
            </div>
            <div title={name} style={{ marginTop: 6, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 }}>{name}</div>
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

/* ===== Раздел с номером заказа, клиентом и ссылкой «Заказ списком» ===== */
function EditableOrderSummary({ orderNo, onOpenSimple }: { orderNo: string; onOpenSimple: () => void }) {
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

  const dims = `${(draft?.size?.width && Math.round(draft.size.width / 10)) || "—"}×${(draft?.size?.height && Math.round(draft.size.height / 10)) || "—"}×${(draft?.size?.thickness && Math.round(draft.size.thickness / 10)) || "—"} см`;
  const orient = orientationLabelShort(draft?.size?.orientation || (draft as any)?.orientation);
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      {/* Номер заказа + ссылка «Заказ списком» в одной строке */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onOpenSimple} style={linkLike()} title="Показать заказ списком (печать)">
          Заказ списком
        </button>
      </div>

      {/* Данные заказчика */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, alignItems: "center" }}>
        <input value={name} onChange={(e) => { setName(e.target.value); scheduleSave(); }} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => { setPhone(e.target.value); scheduleSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); scheduleSave(); }} placeholder="Примечание для связи (удобное время, мессенджер…)" style={inputStyle()} />

      {/* Миниатюра резной работы */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", width: 100, height: 100, borderRadius: 10, overflow: "hidden" }}>
          <div style={gradientUnderlay()} />
          {itemUrl ? (
            <img src={itemUrl} alt="Резная работа" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1 }} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 1, opacity: 0.9 }}>нет</div>
          )}
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {(draft?.item?.name || draft?.item?.url) && <div style={wrapText(13)}>{draft?.item?.name || decodeURIComponent((draft?.item?.url || "").split("/").pop() || "")}</div>}
          <div style={{ opacity: 0.9, ...wrapText(13) }}>Размеры: {dims}{orient ? ` · ${orient}` : ""}</div>
        </div>
      </div>
    </section>
  );
}

/* ===== Главный компонент ===== */
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

  // Эскизы: back — из драфта, front — рисуем из SketchTemplate (UI)
  const frontPreviewForSend = ((draft as any)?.editor?.previewHiUrl as string | undefined) || ((draft as any)?.editor?.previewUrl as string | undefined) || null;
  const backSketchUrl = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  // Параметры изделия (для аспектов)
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { const w = im.naturalWidth || 0, h = im.naturalHeight || 0; if (w && h) setAspect(`${w} / ${h}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  /* ——— Лицевая для SketchTemplate ——— */
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(
    () => frontPersons.map((p: any, i: number) => ({
      id: p.id || `p-${i}`,
      lines: personLines(p),
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
    })),
    [frontPersons]
  );
  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => ((g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross"));
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);
  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    if (Array.isArray(engr.epitaphs) && engr.epitaphs.length) return (engr.epitaphs as string[]).filter(Boolean);
    const t = (engr.epitaphText || "").trim();
    return t ? t.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean) : [];
  }, [draft]);

  /* ===== Дополнительно (плита) ===== */
  const extras0 = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(extras0.base ?? true);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const sizeOptions = ["100×50 см", "120×60 см", "140×70 см", "Свой вариант"];
  const thicknessOptions = ["5 см", "8 см", "10 см", "Свой вариант"];
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize && sizeOptions.includes(extras0.plateSize) ? extras0.plateSize : sizeOptions[0]);
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness && thicknessOptions.includes(extras0.plateThickness) ? extras0.plateThickness : thicknessOptions[0]);
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

  // Каталог для выбора графики на плите
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      setCatsLoading(true); setCatsError("");
      try {
        const data = await fetchCatalog("graphics");
        const root = (data as any)?.categories || data;
        const catsArr = Array.isArray(root) ? root : [];
        if (alive) setCats(catsArr);
      } catch {
        if (alive) setCatsError("Не удалось загрузить каталог графики.");
      } finally {
        if (alive) setCatsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!cats.length) return;
    setCatOpen((prev) => {
      const next = { ...prev };
      for (const c of cats) {
        const key = String(c._id || c.name || "");
        if (!(key in next)) next[key] = false;
      }
      return next;
    });
  }, [cats]);

  const chosenPlateList = useMemo(() => {
    const index: Record<string, any> = {};
    cats.forEach((cat: any) => {
      const collect = (arr: any[]) => (arr || []).forEach((it: any) => {
        const id = String(it.id || it.relPath || it.url || it.name || "");
        if (!id) return;
        if (!index[id]) index[id] = { id, name: it.name || id, url: it.preview || it.url || "" };
      });
      collect(cat.items || []);
      (cat.children || []).forEach((sub: any) => collect(sub.items || []));
    });
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || index[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta, cats]);

  // Эпитафии плиты -> список
  const plateEpitaphList = useMemo(() => (plateEpitaph || "").split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean), [plateEpitaph]);
  const deletePlateEpitaphAt = (idx: number) => {
    const arr = plateEpitaphList.slice();
    if (idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    setPlateEpitaph(arr.join("\n\n"));
  };

  // Примечания
  const [orderNotes, setOrderNotes] = useState<string>(extras0.orderNotes || "");
  const notesTimer = useRef<number | null>(null);
  const scheduleSaveOrderNotes = () => {
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      const extras: any = { ...(prev as any).extras, orderNotes: (orderNotes || "").trim() || undefined };
      saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
      setDraft(loadOrderDraft());
    }, 300) as unknown as number;
  };
  useEffect(() => () => { if (notesTimer.current) window.clearTimeout(notesTimer.current); }, []);

  // Сохранение extras (плита/тумба/цветник)
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

  /* ===== Печать («Заказ списком») ===== */
  const [simpleOpen, setSimpleOpen] = useState(false);
  const hasPrintedRef = useRef(false);
  const printSimple = () => {
    if (hasPrintedRef.current) return;
    try {
      const el = document.getElementById("print-root");
      if (el) {
        const a4HeightPx = 1122; // ~297мм
        const marginPx = Math.round(5 * 3.78);
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
      frontPreview: frontPreviewForSend || null, // для отправки оставляем превью из драфта
      backPreview: backSketchUrl || null,
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
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  };

  return (
    <>
      {/* Номер заказа + клиент + ссылка «Заказ списком» */}
      <EditableOrderSummary orderNo={orderNo} onOpenSimple={() => setSimpleOpen(true)} />

      {/* Эскизы: лицевая — SketchTemplate; тыльная — превью из драфта */}
      <section id="section-previews" style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: backSketchUrl ? "1fr 1fr" : "1fr", gap: 12 }}>
          {/* Лицевая — SketchTemplate */}
          <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Лицевая</div>
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || "4 / 3", minHeight: 220 }}>
              <div style={gradientUnderlay()} />
              <div style={{ position: "absolute", inset: 0, zIndex: 1, padding: 8, boxSizing: "border-box" }}>
                <SketchTemplate
                  item={item}
                  peopleBlocks={peopleBlocks}
                  crosses={selectedCrosses}
                  others={selectedOthers}
                  epitaphs={frontEpitaphs}
                  carvingOpacity={0.4}
                />
              </div>
            </div>
          </div>
          {/* Тыльная — превью из редактора тыла */}
          {backSketchUrl && <SketchCard title="Тыльная" url={backSketchUrl} aspect={aspect} />}
        </div>
      </section>

      {/* Дополнительно — чекбоксы, плита */}
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
        catsLoading={catsLoading}
        catsError={catsError}
        cats={cats}
        catOpen={catOpen}
        setCatOpen={setCatOpen}
        addPlateGraphic={addPlateGraphic}
        removePlateGraphic={removePlateGraphic}
        plateIds={plateIds}
      />

      {/* Примечание к заказу */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Примечание к заказу</label>
        <textarea id="order-notes" rows={3} value={orderNotes} onChange={(e) => { setOrderNotes(e.target.value); scheduleSaveOrderNotes(); }} placeholder="Любые замечания к заказу…" style={{ ...inputStyle(), resize: "vertical" }} />
      </section>

      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      {/* Действия */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>{busy ? "Отправляем…" : "Оформить заказ"}</button>
      </div>

      {/* Заказ списком (Печать) — оставляем как есть */}
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
            persons: ((draft.engraving?.persons as any[]) || []).filter(Boolean).map((p: any) => ({
              id: p.id,
              fio1: (p.lastName || "").trim(),
              fio2: [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
              dates: [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — "),
              photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || ""
            })),
            graphics: (allFrontGraphics || []).map((g: any) => ({
              name: g.name || (g.url ? decodeURIComponent(g.url.split("/").pop() || "") : g.id),
              qty: 1
            })),
            epitaphs: frontEpitaphs.slice()
          }}
          rear={backSketchUrl ? {
            graphics: [],
            epitaphs: []
          } : null}
          extras={{ base: extraBase, flowerbed: extraFlowerbed }}
          plate={{
            enabled: extraPlate,
            size: extraPlate ? (plateSize === "Свой вариант" ? (plateCustomSize || "Свой вариант") : plateSize) : "нет",
            thickness: extraPlate ? (plateThickness === "Свой вариант" ? (plateCustomThickness || "Свой вариант") : plateThickness) : "нет",
            graphics: extraPlate ? chosenPlateList.map((g) => ({ name: g.name || g.id })) : [],
            epitaph: extraPlate ? (plateEpitaph || "").trim() : ""
          }}
          notes={(orderNotes || "").trim()}
          previewFront={frontPreviewForSend || ""}
          previewBack={backSketchUrl || ""}
        />
      )}
    </>
  );
}

/* ===== Дополнительно: обёртка с плейт-блоком ===== */
function LoudAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode; }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const m = () => setH(ref.current?.scrollHeight || 0);
    m();
    const ro = new (window as any).ResizeObserver?.(m);
    if (ref.current && ro) ro.observe(ref.current);
    return () => ro?.disconnect?.();
  }, [children]);
  return (
    <div style={{ ...glassPanelStyle(), padding: 0, borderWidth: 2, borderColor: "rgba(138,180,255,0.35)" }}>
      <button type="button" onClick={onToggle} style={{ width: "100%", textAlign: "left", padding: "12px 14px", background: "rgba(255,255,255,0.06)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 15, fontWeight: 700 }}>
        <span>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

function PlateBlock(props: {
  extraPlate: boolean;
  setExtraPlate: (v: boolean) => void;
  plateSize: string; setPlateSize: (v: string) => void;
  plateCustomSize: string; setPlateCustomSize: (v: string) => void;
  plateThickness: string; setPlateThickness: (v: string) => void;
  plateCustomThickness: string; setPlateCustomThickness: (v: string) => void;
  plateOrientation: string; setPlateOrientation: (v: string) => void;
  plateEpitaph: string; setPlateEpitaph: (v: string) => void;
  catsLoading: boolean; catsError: string; cats: any[];
  catOpen: Record<string, boolean>; setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void; removePlateGraphic: (gid: string) => void;
  plateIds: string[];
}) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize, plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness, plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic,
    plateIds
  } = props;

  const [graphicsOpen, setGraphicsOpen] = useState(false);
  const [showMoreEpitaphs, setShowMoreEpitaphs] = useState(false);
  const [plateEpitaphs, setPlateEpitaphs] = useState<string[]>((plateEpitaph || "").trim() ? (plateEpitaph as string).split(/\n{2,}/g) : []);
  useEffect(() => { setPlateEpitaph(plateEpitaphs.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n")); }, [plateEpitaphs, setPlateEpitaph]);

  const norm = (t: string) => (t || "").replace(/\r\n?/g, "\n").trim();
  const hasByNorm = (list: string[], t: string) => list.some((x) => norm(x) === norm(t));
  const toggleEpitaph = (t: string) => setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev.filter((x) => norm(x) !== norm(t)) : prev.concat([t])));
  const [customText, setCustomText] = useState("");

  return (
    <div style={{ ...sectionBox, display: "grid", gap: 12 }}>
      {/* Переключатель плиты */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
          <span style={{ fontWeight: 700 }}>Надгробная плита</span>
        </label>
      </div>

      {extraPlate && (
        <>
          {/* Размер */}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Размер</div>
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
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Толщина</div>
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
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Ориентация</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => setPlateOrientation(v)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Эпитафии */}
          <LoudAccordion title="Эпитафия на надгробной плите" open={true} onToggle={() => null}>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => {
                    const active = hasByNorm(plateEpitaphs, t);
                    return (
                      <button key={t} type="button" onClick={() => toggleEpitaph(t)} style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }} title={t}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <button type="button" onClick={() => setShowMoreEpitaphs((v) => !v)} style={glassButtonStyle("nano")}>
                  {showMoreEpitaphs ? "Скрыть список" : "Все эпитафии"}
                </button>
                {showMoreEpitaphs && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                    {MORE_EPITAPHS.map((t, idx) => {
                      const active = hasByNorm(plateEpitaphs, t);
                      return (
                        <button key={idx} type="button" onClick={() => toggleEpitaph(t)} title={t}
                          style={{ textAlign: "left", ...glassPanelStyle(), borderRadius: 10, padding: 10, cursor: "pointer", outline: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)", fontSize: 13, lineHeight: 1.25, whiteSpace: "pre-wrap" }}>
                          {t}
                          <div style={{ marginTop: 6, fontSize: 12 }}>{active ? "Удалить из выбранных" : "Добавить к выбранным"}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea rows={3} value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Введите текст и нажмите «Добавить»" style={{ ...inputStyle(), resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => {
                      const t = (customText || "").trim();
                      if (!t) return;
                      setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([t])));
                      setCustomText("");
                    }}>Добавить</button>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => setPlateEpitaphs([])}>Очистить выбранные</button>
                    {plateEpitaphs.length > 0 && <div style={{ opacity: 0.8, fontSize: 12 }}>Выбрано: {plateEpitaphs.length}</div>}
                  </div>
                </div>
              </div>
            </div>
          </LoudAccordion>

          {/* Графика на плите */}
          <LoudAccordion title="Графика на надгробной плите" open={graphicsOpen} onToggle={() => setGraphicsOpen((v) => !v)}>
            {catsLoading && <div>Загрузка каталога…</div>}
            {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
            {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}
            {!catsLoading && cats.length > 0 && (
              <div style={{ display: "grid", gap: 12 }}>
                {cats.map((cat: any, idx: number) => {
                  const catKey = String(cat._id || cat.name || idx);
                  const open = !!(catOpen || {})[catKey];
                  const setToggle = () => setCatOpen({ ...(catOpen || {}), [catKey]: !open });
                  return (
                    <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={setToggle}>
                      <CatGrid items={cat.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removeGraphic={removePlateGraphic} />
                      {(cat.children || []).map((sub: any, j: number) => (
                        <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                          <CatGrid items={sub.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removePlateGraphic={removePlateGraphic as any} />
                        </div>
                      ))}
                    </LoudAccordion>
                  );
                })}
              </div>
            )}
          </LoudAccordion>
        </>
      )}
    </div>
  );
}

/* ===== Печать (A4) — «Заказ списком» ===== */
function PrintOverlay({
  onClose, onPrint, orderNo, name, phone, itemName, dimsText, front, rear, extras, plate, notes, previewFront, previewBack
}: {
  onClose: () => void; onPrint: () => void;
  orderNo: string; name: string; phone: string; itemName?: string; dimsText: () => string;
  front: { persons: { id?: string; fio1: string; fio2: string; dates: string; photo?: string }[]; graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  rear: | null | { graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  extras: { base: boolean; flowerbed: boolean };
  plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string }[]; epitaph?: string };
  notes?: string;
  previewFront?: string;
  previewBack?: string;
}) {
  const [printing, setPrinting] = useState(false);
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "grid", placeItems: "center", padding: 12 }}>
      <div id="print-root" style={{ background: "#fff", color: "#000", width: "100%", maxWidth: "210mm", maxHeight: "95vh", overflow: "auto", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.55)", padding: "5mm" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#f0f0f0", cursor: "pointer" }}>Закрыть</button>
          <button type="button" onClick={() => { if (!printing) { setPrinting(true); onPrint(); setTimeout(() => setPrinting(false), 400); } }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #999", background: "#e6f2ff", cursor: "pointer" }} disabled={printing}>{printing ? "Печать…" : "Печать"}</button>
        </div>

        <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", fontSize: 12, lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>заказ № {orderNo || "—"}</div>
          <hr />
          <div style={{ marginBottom: 6 }}>
            <div style={{ marginBottom: 4 }}>{name || "—"} · {phone || "—"}</div>
            <div><strong>Резная работа:</strong> {itemName || "—"}</div>
            <div><strong>Размер/ориентация:</strong> {dimsText()}</div>
          </div>
          <hr />

          {/* Состав заказа */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Лицевая</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>{front.persons.length ? front.persons.map((p, i) => (
                <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: p.photo ? "24px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 4 }}>
                  {p.photo && <img src={p.photo} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 4 }} />}
                  <div>
                    {p.fio1 && <div style={{ fontWeight: 600 }}>{p.fio1}</div>}
                    {p.fio2 && <div>{p.fio2}</div>}
                    {p.dates && <div>{p.dates}</div>}
                  </div>
                </div>
              )) : <div>—</div>}</div>
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>{front.graphics.length ? front.graphics.map((g, i) => <div key={`fg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}</div>
              <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>{front.epitaphs.length ? front.epitaphs.map((t, i) => <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}</div>
            </div>
          </div>
          <hr />
          {rear && (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Тыльная</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                  <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div><div>—</div></div>
                  <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>{rear.graphics.length ? rear.graphics.map((g, i) => <div key={`rg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}</div>
                  <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>{rear.epitaphs.length ? rear.epitaphs.map((t, i) => <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}</div>
                </div>
              </div>
              <hr />
            </>
          )}

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

          {/* Эскизы */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Эскизы</div>
            <div style={{ display: "grid", gridTemplateColumns: rear ? "1fr 1fr" : "1fr", gap: 8 }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)" }} />
                {previewFront ? (
                  <img src={previewFront} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>Нет</div>
                )}
              </div>
              {rear && (
                <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)" }} />
                  {previewBack ? (
                    <img src={previewBack} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>Нет</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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
