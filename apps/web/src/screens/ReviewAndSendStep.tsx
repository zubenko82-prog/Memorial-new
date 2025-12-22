// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar).
//
// Требования:
// - Максимальная ширина страницы 600px (центрируем).
// - Сверху: номер заказа + ссылка «Заказ списком», поля клиента. Резную работу НЕ показываем.
// - Эскизы «вписываем»: лицевая — через SketchTemplate БЕЗ отступов и границ; тыльная — снимок со шага BackEditorStep
//   (предпочтительно контур, берём outlineUrl/previewContourUrl, иначе previewHiUrl/previewUrl).
// - Блок «Выбрано для плиты» показываем ТОЛЬКО если выбраны графика и/или эпитафии.
// - Вместо печати — сохраняем в PDF (кнопка «Сохранить PDF»), генерируем PDF на клиенте через html2canvas + jsPDF.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import SketchTemplate from "../components/SketchTemplate";

/* ===== UI ===== */
function pageWrap(): React.CSSProperties {
  return { width: "100%", maxWidth: 600, margin: "0 auto" };
}
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
function linkLike(): React.CSSProperties {
  return { color: "#8ab4ff", textDecoration: "underline", cursor: "pointer", background: "transparent", border: "none", padding: 0, font: "inherit" };
}

/* ===== Utils ===== */
function personLines(p: any): string[] {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}

/* ===== Thumb ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
  </div>
);

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

/* ===== Раздел с номером заказа, клиентом и ссылкой «Заказ списком» (без резной работы) ===== */
function EditableOrderSummary({ orderNo, onOpenSimple }: { orderNo: string; onOpenSimple: () => void }) {
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

  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      {/* Номер заказа + «Заказ списком» */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onOpenSimple} style={linkLike()} title="Показать заказ списком (PDF)">
          Заказ списком
        </button>
      </div>

      {/* Данные заказчика */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
        <input value={name} onChange={(e) => { setName(e.target.value); scheduleSave(); }} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => { setPhone(e.target.value); scheduleSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); scheduleSave(); }} placeholder="Примечание для связи (удобное время, мессенджер…)" style={inputStyle()} />
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

  // Тыльная: предпочитаем контур (outline), иначе снимок
  const backSketchUrl = (
    ((draft as any)?.editorBack?.outlineUrl as string | undefined) ||
    ((draft as any)?.editorBack?.previewContourUrl as string | undefined) ||
    ((draft as any)?.editorBack?.previewHiUrl as string | undefined) ||
    ((draft as any)?.editorBack?.previewUrl as string | undefined) ||
    null
  );

  // Параметры изделия (для aspect)
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { const w = im.naturalWidth || 0, h = im.naturalHeight || 0; if (w && h) setAspect(`${w} / ${h}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  /* ——— Лицевая: данные для SketchTemplate ——— */
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

  // Сохранение extras
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

  /* ===== PDF (Заказ списком) ===== */
  const [simpleOpen, setSimpleOpen] = useState(false);
  const pdfRootId = "pdf-root";

  const handleSavePdf = async () => {
    try {
      const [{ default: html2canvas }, jsPdfMod] = await Promise.all([
        import("html2canvas"),
        import("jspdf")
      ]);
      const jsPDF = (jsPdfMod as any).default || (jsPdfMod as any).jsPDF || (jsPdfMod as any);
      const el = document.getElementById(pdfRootId);
      if (!el) return;

      // Сделаем скрин root блока шириной до 600px
      const canvas = await html2canvas(el, {
        scale: 2, // качество
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: 600
      });
      const imgData = canvas.toDataURL("image/png");

      // PDF: A4, портрет
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Масштабируем под ширину страницы
      const pxToMm = (px: number) => px * 0.264583; // 96dpi → mm
      const imgWidthMm = pageWidth;
      const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;

      if (imgHeightMm <= pageHeight) {
        pdf.addImage(imgData, "PNG", 0, 0, imgWidthMm, imgHeightMm, undefined, "FAST");
      } else {
        // Многостраничное добавление
        let heightLeft = imgHeightMm;
        let position = 0;
        pdf.addImage(imgData, "PNG", 0, position, imgWidthMm, imgHeightMm, undefined, "FAST");
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
          position = heightLeft * -1; // смещаем вверх
          pdf.addPage();
          pdf.addImage(imgData, "PNG", 0, position, imgWidthMm, imgHeightMm, undefined, "FAST");
          heightLeft -= pageHeight;
        }
      }

      pdf.save(`order_${orderNo || "no"}.pdf`);
    } catch (e) {
      console.error("PDF save error:", e);
      window.alert("Не удалось сохранить PDF. Попробуйте ещё раз.");
    }
  };

  // Выбрано для плиты — показываем, только если что-то выбрано
  const hasPlateSelection = chosenPlateList.length > 0 || plateEpitaphList.length > 0;

  return (
    <div style={pageWrap()}>
      {/* Номер заказа + клиент + ссылка «Заказ списком» */}
      <EditableOrderSummary orderNo={orderNo} onOpenSimple={() => setSimpleOpen(true)} />

      {/* Эскизы: лицевая — SketchTemplate (full-bleed), тыльная — превью (outline/preview) */}
      <section id="section-previews" style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: backSketchUrl ? "1fr 1fr" : "1fr", gap: 12 }}>
          {/* Лицевая — full-bleed, без отступов и границ */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Лицевая</div>
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || "4 / 3" }}>
              {/* full-bleed: без padding/border */}
              <div style={{ position: "absolute", inset: 0 }}>
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

          {/* Тыльная — снимок с шага BackEditor (предпочтительно контур) */}
          {backSketchUrl && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>Тыльная</div>
              <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || "4 / 3", background: "rgba(255,255,255,0.04)" }}>
                <img
                  src={backSketchUrl}
                  alt="Тыльная"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Выбрано для плиты — показываем ТОЛЬКО если что-то выбрано */}
      {hasPlateSelection && (
        <section style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                {chosenPlateList.map((g, i) => (
                  <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                    <Thumb url={g.url} />
                    <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.name || g.id}
                    </div>
                    <button type="button" onClick={() => removePlateGraphic(g.id || g.url || "")} style={glassButtonStyle("nano")} title="Удалить">
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
            {plateEpitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {plateEpitaphList.map((t, idx) => (
                  <div key={`plate-ep-${idx}`} style={{ ...sectionBox, display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", padding: 8 }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    <button type="button" onClick={() => deletePlateEpitaphAt(idx)} style={glassButtonStyle("nano")} title="Удалить эпитафию">
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Дополнительно — чекбоксы и плита */}
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

      {/* Ошибка отправки */}
      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      {/* Действия */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 12 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>{busy ? "Отправляем…" : "Оформить заказ"}</button>
      </div>

      {/* Заказ списком (PDF-оверлей) */}
      {simpleOpen && (
        <PdfOverlay
          rootId={pdfRootId}
          onClose={() => setSimpleOpen(false)}
          onSavePdf={handleSavePdf}
          orderNo={orderNo}
          name={(loadIntroState().intro?.customerName || "").trim()}
          phone={(loadIntroState().intro?.customerPhone || "").trim()}
          // Лицевая: SketchTemplate (full-bleed, без отступов)
          frontSketch={
            <div style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0 }}>
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
          }
          previewBack={backSketchUrl || ""}
          // Состав заказа
          frontData={{
            persons: frontPersons.map((p: any) => ({
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
          rearData={backSketchUrl ? { graphics: [], epitaphs: [] } : null}
          extras={{ base: extraBase, flowerbed: extraFlowerbed }}
          plate={{
            enabled: hasPlateSelection,
            size: hasPlateSelection ? (plateSize === "Свой вариант" ? (plateCustomSize || "Свой вариант") : plateSize) : "нет",
            thickness: hasPlateSelection ? (plateThickness === "Свой вариант" ? (plateCustomThickness || "Свой вариант") : plateThickness) : "нет",
            graphics: chosenPlateList.map((g) => ({ name: g.name || g.id })),
            epitaph: (plateEpitaph || "").trim()
          }}
          notes={(orderNotes || "").trim()}
          aspect={aspect}
        />
      )}
    </div>
  );
}

/* ===== Дополнительно: аккордеоны и плита ===== */
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
                          <CatGrid items={sub.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removeGraphic={removePlateGraphic} />
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

/* ===== Обёртка «Дополнительно» (секция) ===== */
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
  catsLoading: boolean; catsError: string; cats: any[];
  catOpen: Record<string, boolean>; setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void; removePlateGraphic: (gid: string) => void;
  plateIds: string[];
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
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic,
    plateIds
  } = props;

  return (
    <section id="section-extras" style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>Дополнительно</div>

      {/* Тумба / Цветник */}
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

      {/* Надгробная плита */}
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
        catsLoading={catsLoading}
        catsError={catsError}
        cats={cats}
        catOpen={catOpen}
        setCatOpen={setCatOpen}
        addPlateGraphic={addPlateGraphic}
        removePlateGraphic={removePlateGraphic}
        plateIds={plateIds}
      />
    </section>
  );
}

/* ===== PDF Overlay ===== */
function PdfOverlay({
  rootId, onClose, onSavePdf, orderNo, name, phone,
  frontSketch, previewBack, frontData, rearData, extras, plate, notes, aspect
}: {
  rootId: string; onClose: () => void; onSavePdf: () => void;
  orderNo: string; name: string; phone: string;
  frontSketch: React.ReactNode;
  previewBack?: string;
  frontData: { persons: { id?: string; fio1: string; fio2: string; dates: string; photo?: string }[]; graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  rearData: | null | { graphics: { name: string; qty: number }[]; epitaphs: string[]; };
  extras: { base: boolean; flowerbed: boolean };
  plate: { enabled: boolean; size?: string; thickness?: string; graphics: { name: string }[]; epitaph?: string };
  notes?: string;
  aspect?: string;
}) {
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9999, display: "grid", placeItems: "center", padding: 12 }}>
      <div style={{ width: "100%", maxWidth: 600, maxHeight: "95vh", overflow: "auto", borderRadius: 12, background: "#fff", color: "#000", boxShadow: "0 20px 60px rgba(0,0,0,0.55)" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: 10, position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid #e5e5e5", zIndex: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #bbb", background: "#f7f7f7", cursor: "pointer" }}>Закрыть</button>
          <button type="button" onClick={onSavePdf} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #2c5fb8", background: "#e6f2ff", cursor: "pointer", color: "#174ea6" }}>Сохранить PDF</button>
        </div>

        {/* PDF root */}
        <div id={rootId} style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>заказ № {orderNo || "—"}</div>
          <div style={{ marginBottom: 8 }}>{name || "—"} · {phone || "—"}</div>

          {/* Состав заказа — кратко */}
          <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Усопшие</div>
                {frontData.persons.length ? frontData.persons.map((p, i) => (
                  <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: p.photo ? "20px 1fr" : "1fr", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    {p.photo && <img src={p.photo} alt="" style={{ width: 20, height: 20, objectFit: "cover", borderRadius: 4 }} />}
                    <div>
                      {p.fio1 && <div style={{ fontWeight: 600 }}>{p.fio1}</div>}
                      {p.fio2 && <div>{p.fio2}</div>}
                      {p.dates && <div style={{ opacity: 0.9 }}>{p.dates}</div>}
                    </div>
                  </div>
                )) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
                {frontData.graphics.length ? frontData.graphics.map((g, i) => <div key={`fg-${i}`}>{g.name}{g.qty > 1 ? ` ×${g.qty}` : ""}</div>) : <div>—</div>}
              </div>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
                {frontData.epitaphs.length ? frontData.epitaphs.map((t, i) => <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap" }}>{t}</div>) : <div>—</div>}
              </div>
            </div>
          </div>

          {rearData && (
            <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
              {/* (по требованиям — контур/превью) */}
            </div>
          )}

          {/* Дополнительно */}
          <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Дополнительно</div>
            <div>Тумба: {extras.base ? "да" : "нет"}; Цветник: {extras.flowerbed ? "да" : "нет"}</div>
          </div>

          {/* Плита */}
          <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Надгробная плита</div>
            <div>Размер: {plate.enabled ? (plate.size || "—") : "нет"}; Толщина: {plate.enabled ? (plate.thickness || "—") : "нет"}</div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Графика</div>
              {plate.enabled ? (plate.graphics.length ? plate.graphics.map((g, i) => <div key={`pg-${i}`}>{g.name}</div>) : <div>—</div>) : <div>нет</div>}
            </div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Эпитафии</div>
              {plate.enabled ? (plate.epitaph ? <div style={{ whiteSpace: "pre-wrap" }}>{plate.epitaph}</div> : <div>—</div>) : <div>нет</div>}
            </div>
          </div>

          {/* Примечания */}
          <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Примечания</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{notes || "—"}</div>
          </div>

          {/* Эскизы: лицевая full-bleed (без отступов и границ), тыльная — превью */}
          <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Эскизы</div>
            <div style={{ display: "grid", gridTemplateColumns: previewBack ? "1fr 1fr" : "1fr", gap: 8 }}>
              {/* Front */}
              <div style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden", borderRadius: 8 }}>
                <div style={{ position: "absolute", inset: 0 }}>
                  {frontSketch}
                </div>
              </div>
              {/* Back */}
              {previewBack && (
                <div style={{ position: "relative", width: "100%", aspectRatio: aspect || "4 / 3", overflow: "hidden", borderRadius: 8, background: "#f5f5f5" }}>
                  <img src={previewBack} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
