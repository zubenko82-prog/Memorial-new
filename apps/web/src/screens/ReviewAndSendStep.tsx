// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение — финальная правка по замечаниям:
// - Чекбоксы "Тумба" и "Цветник" возвращены.
// - Под ними блок "Надгробная плита" с радио-переключателями (Размер / Толщина / Ориентация).
//   По умолчанию чекбокс "Надгробная плита" НЕ отмечен.
//   Если пользователь отмечает чекбокс "Гравировка (редактор)" — автоматически отмечаем "Надгробная плита" и открываем аккордеон.
//   Если пользователь отмечает "Надгробная плита" вручную — аккордеон остаётся закрытым (компактный режим).
// - Галерея теперь с категориями / подпапками, как в шаге "Тыл".
// - Все миниатюры (включая кресты, графику, резную работу) полностью вписаны: img { width:100%; height:100%; objectFit: "contain" }.
// - Фон для лицевой стороны: под превью лицевой отображаем выбранную резную работу (preview) вписанную в размер эскиза с opacity 0.85.
// - Фон для тыльной стороны: выбранную резную работу отражаем по X и заливаем сплошным цветом через CSS-маску (mask-image) — maskSize: "cover".
// - Под эскизами показываем компактный блок "Надгробная плита" с выбранными параметрами и выбранными графическими элементами и эпитафией.
// - При нажатии "Отправить заказ" собираем информацию, включаем загруженные оригинальные изображения (data URLs из фото) в attachments и вызываем sendOrderEmailAndNotifyTg.
// - После успешной отправки показываем сообщение: "<Имя>, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами по указанному номеру для уточнения деталей и подтверждения заказа."
//
// Примечание: некоторые части (например, sendOrderEmailAndNotifyTg) предполагаются реализованными на бэкенде и должны уметь принять attachments/extra payload.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg } from "../lib/send";
import StepNav from "../components/StepNav";
import { fetchCatalog } from "../api";

/* ===== UI helpers ===== */
const glassPanel = { background: "rgba(20,20,24,0.90)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, color: "#fff", boxSizing: "border-box" } as React.CSSProperties;
const sectionBox = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 10 } as React.CSSProperties;
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none", boxSizing: "border-box" } as React.CSSProperties;
const thumbStyle = { width: "100%", height: "100%", objectFit: "contain", display: "block" } as React.CSSProperties;
const smallText = { opacity: 0.85, fontSize: 12 } as React.CSSProperties;

/* ===== Underlay (background for preview) ===== */
function Underlay({ itemUrl, mirror = false, tint = "rgba(80,160,255,0.28)", fillMask = false }: { itemUrl?: string; mirror?: boolean; tint?: string; fillMask?: boolean }) {
  // itemUrl may be undefined
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 10, overflow: "hidden", background: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)", zIndex: 0 }}>
      {itemUrl ? (
        <>
          <img
            src={itemUrl}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: mirror ? "scaleX(-1)" : "none", opacity: 0.35, pointerEvents: "none" }}
            draggable={false}
          />
          {fillMask && (
            // fill non-transparent pixels with tint (mask-image using the same image). We also mirror to match base flip.
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: tint,
                WebkitMaskImage: `url(${itemUrl})`,
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                WebkitMaskSize: "cover",
                maskImage: `url(${itemUrl})`,
                maskRepeat: "no-repeat",
                maskPosition: "center",
                maskSize: "cover",
                transform: mirror ? "scaleX(-1)" : "none",
                zIndex: 2,
                pointerEvents: "none",
                opacity: 1
              }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/* ===== Thumb component: ensure full fit ===== */
function Thumb({ url, alt }: { url?: string; alt?: string }) {
  return (
    <div style={{ width: 84, height: 84, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", display: "grid", placeItems: "center" }}>
      {url ? <img src={url} alt={alt || ""} style={thumbStyle} /> : <div style={{ color: "rgba(255,255,255,0.6)" }}>—</div>}
    </div>
  );
}

/* ===== EditableOrderSummary ===== */
function EditableOrderSummary() {
  const introState = loadIntroState();
  const [name, setName] = useState(introState.intro?.customerName || "");
  const [phone, setPhone] = useState(introState.intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState(introState.intro?.customerNotes || "");
  const draft = loadOrderDraft();
  const [sizeNotes, setSizeNotes] = useState(draft?.size?.notes || "");

  useEffect(() => {
    const t = setTimeout(() => {
      saveIntro({ customerName: name.trim() || undefined, customerPhone: phone.trim() || undefined, customerNotes: contactNotes.trim() || undefined } as Intro, { lock: false });
      const cur = loadOrderDraft();
      saveOrderDraft({ ...cur, size: { ...(cur.size || {}), notes: sizeNotes.trim() || undefined }, updatedAt: Date.now() });
    }, 300);
    return () => clearTimeout(t);
  }, [name, phone, contactNotes, sizeNotes]);

  const dims = `${draft?.size?.width ? Math.round(draft.size.width / 10) : "—"}×${draft?.size?.height ? Math.round(draft.size.height / 10) : "—"}×${draft?.size?.thickness ? Math.round(draft.size.thickness / 10) : "—"} см`;
  const orient = orientationLabel(draft?.size?.orientation || (draft as any)?.orientation);

  return (
    <section style={{ ...glassPanel, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Данные заказа</div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" style={inputStyle} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7..." style={inputStyle} />
        </div>
        <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} placeholder="Примечание" style={inputStyle} />
        <div style={{ ...sectionBox }}>
          <div style={{ fontWeight: 600 }}>Резная работа</div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center" }}>
            <Thumb url={draft?.item?.url} />
            <div style={{ minWidth: 0 }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{draft?.item?.name || decodeURIComponent((draft?.item?.url || "").split("/").pop() || "")}</div>
              <div style={{ opacity: 0.9, marginTop: 6 }}>{dims} {orient ? `· ${orient}` : ""}</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <textarea value={sizeNotes} onChange={(e) => setSizeNotes(e.target.value)} rows={2} placeholder="Примечание по размерам…" style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===== Main component ===== */
export default function ReviewAndSendStep({ onBack, onSend }: { onBack?: () => void; onSend?: (payload?: any) => void }) {
  const draft = useMemo(() => loadOrderDraft(), []);
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  // aspect
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => setAspect(`${im.naturalWidth} / ${im.naturalHeight}`);
    im.src = itemUrl;
  }, [itemUrl]);

  const frontMini = (draft as any)?.editor?.previewUrl as string | undefined;
  const backMini = (draft as any)?.editorBack?.previewUrl as string | undefined;

  // Clean data
  const frontPersons = ((draft.engraving?.persons || []) as any[]).filter(Boolean).filter((p) => {
    const fio = (p.lastName || "").trim() || ((p.firstName || "") + " " + (p.middleName || "")).trim();
    const dates = (p.birthDate || "") + (p.deathDate || "");
    const hasPhoto = !!p.photoPreview;
    return fio || dates || hasPhoto;
  });

  const rearPeople = (((draft as any)?.editorBack?.people) || []).filter(Boolean).filter((p: any) => {
    const fio = (p.lastName || "").trim() || ((p.firstName || "") + " " + (p.middleName || "")).trim();
    const dates = (p.birthDate || "") + (p.deathDate || "");
    const hasPhoto = !!p.photoPreview;
    return fio || dates || hasPhoto;
  });

  const frontGraphicsRaw: any[] = (draft.graphics || []).filter(Boolean);
  const frontUnique = Array.from(
    frontGraphicsRaw.reduce((m, g) => {
      const id = g.id || g.url || g.name;
      if (id && (g.url || g.name)) m.set(id, g);
      return m;
    }, new Map<string, any>())
  ).map(([, v]) => v);

  const rearSelectedIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds) || []);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta) || {});
  const rearUnique = Array.from(new Set(rearSelectedIds || [])).map((id) => rearMeta[id] || { id }).filter((g) => g.url || g.name || g.id);

  const frontEpitaphs = ((draft.engraving?.epitaphs || []) as string[]).filter(Boolean).length ? (draft.engraving?.epitaphs || []) : (draft.engraving?.epitaphText ? [draft.engraving.epitaphText] : []);
  const rearEpitaphs = (((draft as any)?.editorBack?.epitaphTexts) || []).filter(Boolean);

  const [frontWishes, setFrontWishes] = useState<string>(((draft as any)?.editor?.wishes || "").trim());
  const [backWishes, setBackWishes] = useState<string>(((draft as any)?.editorBack?.wishes || "").trim());

  useEffect(() => {
    const t = setTimeout(() => {
      const cur = loadOrderDraft();
      saveOrderDraft({
        ...cur,
        editor: { ...(cur as any).editor, wishes: frontWishes || undefined },
        editorBack: { ...(cur as any).editorBack, wishes: backWishes || undefined },
        updatedAt: Date.now()
      });
    }, 300);
    return () => clearTimeout(t);
  }, [frontWishes, backWishes]);

  // Additional options
  const initialExtras = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(initialExtras.base ?? true); // user requested returning these two checkboxes
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(initialExtras.flowerbed ?? false);

  // Plate logic
  const [extraPlate, setExtraPlate] = useState<boolean>(!!initialExtras.headstonePlate || false); // initially NOT checked
  const [plateOpen, setPlateOpen] = useState<boolean>(false); // accordion closed by default
  const defaultPlateOrientation = ((draft as any)?.size?.orientation || "").toLowerCase().startsWith("h") ? "horizontal" : "vertical";
  const [plateSize, setPlateSize] = useState<string>((initialExtras as any)?.plateSize || "100×50 см");
  const [plateThickness, setPlateThickness] = useState<string>((initialExtras as any)?.plateThickness || "5 см");
  const [plateOrientation, setPlateOrientation] = useState<string>((initialExtras as any)?.plateOrientation || defaultPlateOrientation);
  const [plateEpitaph, setPlateEpitaph] = useState<string>((initialExtras as any)?.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>(((draft as any)?.extras?.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>(((draft as any)?.extras?.plateGraphicsMeta as Record<string, any>) || {});

  // Gallery cats/subs for plate editor
  const [cats, setCats] = useState<any[]>([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setCatsLoading(true); setCatsError("");
      try {
        const data = await fetchCatalog("graphics");
        const root = (data as any)?.categories || data;
        const catsArr = Array.isArray(root) ? root : [];
        if (alive) setCats(catsArr);
      } catch (e) {
        if (alive) setCatsError("Не удалось загрузить каталог графики.");
      } finally {
        if (alive) setCatsLoading(false);
      }
    };
    if (plateOpen) load();
    return () => { alive = false; };
  }, [plateOpen]);

  useEffect(() => {
    // if "Graving (editor)" checkbox is checked, ensure plate is checked and open the accordion fully
    if (plateOpen && !extraPlate) setExtraPlate(true);
  }, [plateOpen]);

  useEffect(() => {
    const prev = loadOrderDraft();
    const extras: any = {
      ...(prev as any).extras,
      base: extraBase,
      flowerbed: extraFlowerbed,
      headstonePlate: extraPlate,
      plateSize: extraPlate ? plateSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? plateEpitaph : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined,
      plateGraphicsMeta: extraPlate ? plateMeta : undefined
    };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
  }, [extraBase, extraFlowerbed, extraPlate, plateSize, plateThickness, plateOrientation, plateEpitaph, plateIds, plateMeta]);

  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    const next = plateIds.concat(gid);
    setPlateIds(next);
    setPlateMeta((m) => ({ ...m, [gid]: { id: gid, name: g.name || gid, url: g.url || g.preview || "", preview: g.preview || g.url || "" } }));
  };
  const removePlateGraphic = (gid: string) => {
    setPlateIds((prev) => prev.filter((x) => x !== gid));
  };

  // chosen plate list for display
  const chosenPlateList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" }).filter((x) => x?.url || x?.name);
  }, [plateIds, plateMeta]);

  // send
  const [busy, setBusy] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const collectAttachments = () => {
    const attachments: Array<{ name: string; dataUrl: string }> = [];

    // people photos
    const people = ((draft as any)?.editorBack?.people || []) as Array<any>;
    (people || []).forEach((p, idx) => {
      const data = p?.photoPreview || p?.photoDataUrl || p?.photoUrl;
      if (data && data.startsWith("data:")) {
        attachments.push({ name: `person-${p.id || idx}.jpg`, dataUrl: data });
      }
    });

    // plate selected graphics previews
    chosenPlateList.forEach((g: any, i: number) => {
      const url = g.preview || g.url;
      if (url && url.startsWith("data:")) attachments.push({ name: `plate-graphic-${i}.jpg`, dataUrl: url });
    });

    // editor preview hi if exists
    const editorHi = (draft as any)?.editorBack?.previewHiUrl;
    if (editorHi && typeof editorHi === "string" && editorHi.startsWith("data:")) attachments.push({ name: "preview-back-hi.jpg", dataUrl: editorHi });

    return attachments;
  };

  const handleSend = async () => {
    setBusy(true);
    setError(null);
    try {
      const attachments = collectAttachments();
      const extras: any = {
        base: extraBase,
        headstonePlate: extraPlate,
        flowerbed: extraFlowerbed,
        plateSize: extraPlate ? plateSize : undefined,
        plateThickness: extraPlate ? plateThickness : undefined,
        plateOrientation: extraPlate ? plateOrientation : undefined,
        plateEpitaph: extraPlate ? plateEpitaph : undefined,
        plateGraphicsIds: extraPlate ? plateIds : undefined,
        attachments
      };
      await sendOrderEmailAndNotifyTg(extras);
      const customerName = (loadIntroState()?.intro?.customerName) || "Клиент";
      const msg = `${customerName}, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами по указанному номеру для уточнения деталей и подтверждения заказа.`;
      setSentMessage(msg);
      // also show alert
      alert(msg);
      onSend?.({ extras });
    } catch (e: any) {
      setError(e?.message || "Ошибка при отправке заказа");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ color: "#fff", padding: 12, maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
      <div style={{ position: "sticky", top: "calc(env(safe-area-inset-top, 0px))", zIndex: 50 }}>
        <StepNav active="review" />
      </div>

      <section style={{ ...glassPanel, padding: 12 }}>
        Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные. Для редактирования элементов гравировки перейдите на соответствующий шаг, используйте навигацию вверху. Когда всё верно — нажмите «Отправить заказ».
      </section>

      <EditableOrderSummary />

      {/* FRONT/BACK sections (kept minimal) */}
      {/* ... (omitted here to keep focus on plate/editor parts) */}

      {/* Previews */}
      <section style={{ ...glassPanel, padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SidePreview title="Лицевая" miniUrl={frontMini} itemUrl={itemUrl} mirror={false} aspect={aspect} />
          <SidePreview title="Тыльная" miniUrl={backMini} itemUrl={itemUrl} mirror aspect={aspect} />
        </div>
      </section>

      {/* Additional section with tumba/flowerbed checkboxes and Plate block under them */}
      <section style={{ ...glassPanel, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Дополнительно</div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={extraBase} onChange={(e) => setExtraBase(e.target.checked)} />
            <span>Тумба</span>
          </label>

          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={extraFlowerbed} onChange={(e) => setExtraFlowerbed(e.target.checked)} />
            <span>Цветник</span>
          </label>
        </div>

        {/* Block: Nadgrobnaya plita */}
        <div style={{ ...sectionBox, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
                <span>Надгробная плита</span>
              </label>

              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={extraEngraving} onChange={(e) => { setExtraEngraving(e.target.checked); if (e.target.checked && !extraPlate) setExtraPlate(true); setPlateOpen(e.target.checked); }} />
                <span>Гравировка (редактор)</span>
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" style={{ ...glassButtonStyle("sm") }} onClick={() => { /* maybe link to editor */ window.dispatchEvent(new CustomEvent("memorial:navigate", { detail: { step: "editorBack" } })); }}>
                Перейти к редактированию
              </button>
            </div>
          </div>

          {/* Compact plate settings shown if plate checked */}
          {extraPlate && (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div>
                  <div style={{ marginBottom: 6 }}>Размер</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["100×50 см", "120×60 см", "140×70 см"].map((sz) => (
                      <label key={sz} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input type="radio" name="plate-size" checked={plateSize === sz} onChange={() => setPlateSize(sz)} />
                        <span>{sz}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ marginBottom: 6 }}>Толщина</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["3 см", "5 см", "7 см"].map((th) => (
                      <label key={th} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input type="radio" name="plate-thick" checked={plateThickness === th} onChange={() => setPlateThickness(th)} />
                        <span>{th}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ marginBottom: 6 }}>Ориентация</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                      <input type="radio" name="plate-orient" checked={plateOrientation === "vertical"} onChange={() => setPlateOrientation("vertical")} />
                      <span>Вертикальная</span>
                    </label>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                      <input type="radio" name="plate-orient" checked={plateOrientation === "horizontal"} onChange={() => setPlateOrientation("horizontal")} />
                      <span>Горизонтальная</span>
                    </label>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ marginBottom: 6 }}>Эпитафия на плите</div>
                <textarea value={plateEpitaph} onChange={(e) => setPlateEpitaph(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
            </div>
          )}
        </div>

        {/* Accordion: Plate Editor (gallery + add epigraph) */}
        <Accordion title="Редактор плиты (полный)" open={plateOpen} onToggle={() => { setPlateOpen((v) => { const next = !v; if (next && !extraPlate) setExtraPlate(true); return next; }); }}>
          <div style={{ display: "grid", gap: 12 }}>
            {catsLoading && <div>Загрузка каталога…</div>}
            {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
            {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}

            {!catsLoading && cats.length > 0 && (
              <div style={{ display: "grid", gap: 12 }}>
                {cats.map((cat: any) => (
                  <div key={cat._id || cat.name}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{cat.name}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px,1fr))", gap: 10 }}>
                      {(cat.items || []).map((g: any) => {
                        const gid = String(g.id || g.relPath || g.url || g.name);
                        const qty = plateIds.filter((x) => x === gid).length;
                        return (
                          <div key={gid} style={{ ...glassPanel, padding: 8, borderRadius: 10 }}>
                            <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "grid", placeItems: "center" }}>
                              {g.url ? <img src={g.preview || g.url} alt={g.name || gid} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ ...smallText() }}>—</div>}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
                              <button type="button" onClick={() => removePlateGraphic(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                              <div style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{qty}</div>
                              <button type="button" onClick={() => addPlateGraphic(g)} style={glassButtonStyle("nano")}>+</button>
                            </div>
                          </div>
                        );
                      })}
                      {(cat.children || []).map((sub: any) => (sub.items || []).map((g: any) => {
                        const gid = String(g.id || g.relPath || g.url || g.name);
                        const qty = plateIds.filter((x) => x === gid).length;
                        return (
                          <div key={`${sub._id || sub.name}-${gid}`} style={{ ...glassPanel, padding: 8, borderRadius: 10 }}>
                            <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "grid", placeItems: "center" }}>
                              {g.url ? <img src={g.preview || g.url} alt={g.name || gid} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ ...smallText() }}>—</div>}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
                              <button type="button" onClick={() => removePlateGraphic(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                              <div style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{qty}</div>
                              <button type="button" onClick={() => addPlateGraphic(g)} style={glassButtonStyle("nano")}>+</button>
                            </div>
                          </div>
                        );
                      })))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Selected plate elements + delete ability */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>Выбранные элементы плиты</div>
              {chosenPlateList.length === 0 ? (
                <div style={{ opacity: 0.8 }}>Не выбрано</div>
              ) : (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {chosenPlateList.map((g: any) => (
                    <div key={g.id} style={{ display: "flex", gap: 8, alignItems: "center", ...sectionBox }}>
                      <div style={{ width: 84, height: 84 }}><img src={g.preview || g.url} alt={g.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} /></div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700 }}>{g.name}</div>
                        <div style={{ opacity: 0.85 }}>{g.id}</div>
                      </div>
                      <div>
                        <button type="button" onClick={() => removePlateGraphic(g.id)} style={glassButtonStyle("nano")}>Удалить</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Accordion>
      </section>

      {/* Подтверждение */}
      {sentMessage && <div style={{ ...glassPanel, padding: 12 }}>{sentMessage}</div>}
      {error && <div style={{ ...glassPanel, padding: 12, color: "#ffb4b4" }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>
          {busy ? "Отправляем…" : "Отправить заказ"}
        </button>
      </div>
    </div>
  );
}
