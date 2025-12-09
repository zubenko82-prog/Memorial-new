// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение без TopBar.
//
// Обновления:
// - Эскизы отображаем один раз (нижний дубль удалён).
// - Размеры НП: только 100*50, 120*60, 140*70 (радио).
// - Толщина НП: только 5, 8, 10 см (радио).
// - Аккордеон «Гравировка (редактор)» переименован в «Графика на надгробной плите».
// - Все миниатюры (в т.ч. галерея) вписывают изображение (object-fit: contain).
// - Эскизы: лицевая — выбранная резная работа (order.item.url) на фоне, contain, opacity 85%.
//            тыльная — та же работа зеркально, заливка по маске одним цветом (CSS mask).
// - По «Отправить» собираем данные, добавляем оригиналы и показываем подтверждение с именем.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import StepNav from "../components/StepNav";
import { fetchCatalog } from "../api";

/* ===== UI ===== */
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.90)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false) {
  const map = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: map[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1,
    transition: "opacity 160ms ease"
  } as React.CSSProperties;
}
function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    boxSizing: "border-box"
  };
}
function smallText(): React.CSSProperties {
  return { opacity: 0.8, fontSize: 12 };
}
const sectionBox: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 10,
  padding: 10
};
function chip(txt: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        background: "rgba(138,180,255,0.18)",
        color: "#dbe7ff",
        whiteSpace: "nowrap"
      }}
    >
      {txt}
    </span>
  );
}
function AccentBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(255,242,201,0.15)",
        border: "1px solid rgba(255,242,201,0.35)",
        borderRadius: 10,
        padding: 8
      }}
    >
      {children}
    </div>
  );
}

/* ===== Утилиты ===== */
function orientationLabel(o?: string) {
  if (!o) return "";
  const k = String(o).toLowerCase();
  if (k.startsWith("h")) return "горизонтальная";
  if (k.startsWith("v")) return "вертикальная";
  return "";
}

/* ===== Подложка под превью ===== */
function Underlay({
  itemUrl,
  side
}: {
  itemUrl?: string;
  side: "front" | "back";
}) {
  // Градиент всегда подложен.
  // Лицевая: изделие поверх градиента (contain, opacity 85%).
  // Тыльная: сплошная заливка по маске (contain), зеркалим по X.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 10,
        overflow: "hidden",
        background:
          "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)",
        zIndex: 0
      }}
    >
      {itemUrl && side === "front" && (
        <img
          src={itemUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 0.85,
            pointerEvents: "none"
          }}
          draggable={false}
        />
      )}
      {itemUrl && side === "back" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(80, 160, 255, 0.30)",
            WebkitMaskImage: `url(${itemUrl})`,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "contain",
            maskImage: `url(${itemUrl})`,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "contain",
            transform: "scaleX(-1)",
            transformOrigin: "center",
            zIndex: 2,
            pointerEvents: "none"
          }}
        />
      )}
    </div>
  );
}

/* ===== Превью стороны ===== */
function SidePreview({
  title,
  miniUrl,
  itemUrl,
  side,
  aspect
}: {
  title: string;
  miniUrl?: string;
  itemUrl?: string;
  side: "front" | "back";
  aspect?: string;
}) {
  return (
    <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          aspectRatio: aspect || undefined,
          minHeight: aspect ? undefined : 240
        }}
      >
        <Underlay itemUrl={itemUrl} side={side} />
        {miniUrl ? (
          <img
            src={miniUrl}
            alt=""
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              zIndex: 1,
              display: "block"
            }}
            draggable={false}
          />
        ) : (
          <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.9 }}>
            Превью отсутствует
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== Редактируемый блок «Данные заказа» ===== */
function EditableOrderSummary() {
  const [draft, setDraft] = useState(() => loadOrderDraft());
  const introState = loadIntroState();

  const [name, setName] = useState<string>(introState.intro?.customerName || "");
  const [phone, setPhone] = useState<string>(introState.intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introState.intro?.customerNotes || "");
  const [sizeNotes, setSizeNotes] = useState<string>(draft?.size?.notes || "");

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

      const cur = loadOrderDraft();
      const next = saveOrderDraft({
        ...cur,
        size: { ...(cur.size || {}), notes: (sizeNotes || "").trim() || undefined },
        updatedAt: Date.now()
      });
      setDraft(next);
    }, 250) as unknown as number;
  };
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const dims =
    `${draft?.size?.width ? Math.round(draft.size.width / 10) : "—"}×` +
    `${draft?.size?.height ? Math.round(draft.size.height / 10) : "—"}×` +
    `${draft?.size?.thickness ? Math.round(draft.size.thickness / 10) : "—"} см`;
  const orient = orientationLabel(draft?.size?.orientation || (draft as any)?.orientation);

  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 700 }}>Данные заказа</div>

      {/* Контакты */}
      <div style={{ ...sectionBox, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Контакты</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={name} onChange={(e) => { setName(e.target.value); scheduleSave(); }} placeholder="Имя" style={inputStyle()} />
          <input value={phone} onChange={(e) => { setPhone(e.target.value); scheduleSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
        </div>
        <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); scheduleSave(); }} placeholder="Примечание (удобное время, мессенджер…)" style={inputStyle()} />
      </div>

      {/* Резная работа / размеры */}
      <div style={{ ...sectionBox, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Резная работа</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.04)",
              width: 96,
              height: 96,
              overflow: "hidden",
              display: "grid",
              placeItems: "center"
            }}
          >
            {draft?.item?.url ? (
              <img
                src={draft.item.url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                draggable={false}
              />
            ) : null}
          </div>
          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
            {(draft?.item?.name || draft?.item?.url) && (
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {draft?.item?.name || decodeURIComponent((draft?.item?.url || "").split("/").pop() || "")}
              </div>
            )}
            <div style={{ opacity: 0.9 }}>
              Размеры: {dims}
              {orient ? ` · ориентация: ${orient}` : ""}
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>Примечание</div>
          <textarea
            value={sizeNotes}
            onChange={(e) => { setSizeNotes(e.target.value); scheduleSave(); }}
            rows={3}
            placeholder="Примечание по размерам…"
            style={{ ...inputStyle(), resize: "vertical" }}
          />
        </div>
      </div>
    </section>
  );
}

/* ===== Вписывающая миниатюра ===== */
const Thumb = ({ url, alt = "", size = 56 }: { url?: string; alt?: string; size?: number }) => (
  <div
    style={{
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.10)",
      overflow: "hidden",
      background: "rgba(255,255,255,0.04)",
      width: size,
      height: size,
      display: "grid",
      placeItems: "center"
    }}
  >
    {url ? <img src={url} alt={alt} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} /> : null}
  </div>
);

/* ===== Простой Аккордеон ===== */
function Accordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const m = () => setH(contentRef.current?.scrollHeight || 0);
    m();
    const ro = new ResizeObserver(m);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div style={{ ...glassPanelStyle(), padding: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "12px 14px",
          background: "rgba(255,255,255,0.06)",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <strong>{title}</strong>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={contentRef} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Компонент шага ===== */
type Props = {
  onBack?: () => void;
  onSend?: (payload?: any) => void;
};

export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const draft = useMemo(() => loadOrderDraft(), []);
  const introState = loadIntroState();
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth || 0, h = im.naturalHeight || 0;
      if (w > 0 && h > 0) setAspect(`${w} / ${h}`);
    };
    im.src = itemUrl;
  }, [itemUrl]);

  const frontMini = (draft as any)?.editor?.previewUrl as string | undefined;
  const backMini = (draft as any)?.editorBack?.previewUrl as string | undefined;

  // Стороны
  const frontPersons: any[] = (draft.engraving?.persons as any[])?.filter(Boolean).filter((p: any) => {
    const fio1 = (p.lastName || "").trim();
    const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
    const metric = [p.birthDate, p.deathDate].map((x: string) => (x || "").trim()).filter(Boolean).join("");
    const hasPhoto = !!p.photoPreview;
    return fio1 || fio2 || metric || hasPhoto;
  }) || [];
  const rearPeople: any[] = (((draft as any)?.editorBack?.people as any[]) || []).filter(Boolean).filter((p: any) => {
    const fio1 = (p.lastName || "").trim();
    const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
    const metric = [p.birthDate, p.deathDate].map((x: string) => (x || "").trim()).filter(Boolean).join("");
    const hasPhoto = !!p.photoPreview;
    return fio1 || fio2 || metric || hasPhoto;
  });

  const frontGraphicsRaw: any[] = (draft.graphics as any[])?.filter(Boolean) || [];
  const frontGraphics = frontGraphicsRaw.filter((g) => g?.url || g?.name || g?.id);
  const frontCountsById: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphics.forEach((g) => {
      const id = g?.id || g?.url || g?.name || "";
      if (id) m[id] = (m[id] || 0) + 1;
    });
    return m;
  }, [frontGraphics]);
  const frontUnique: any[] = useMemo(() => {
    const first: Record<string, any> = {};
    frontGraphics.forEach((g) => {
      const id = g?.id || g?.url || g?.name;
      if (id && !first[id]) first[id] = g;
    });
    return Object.values(first);
  }, [frontGraphics]);

  const rearSelectedIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCountsById: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    (rearSelectedIds || []).forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [rearSelectedIds]);
  const rearUnique: any[] = useMemo(() => {
    const ids = Array.from(new Set(rearSelectedIds || []));
    return ids
      .map((id) => rearMeta?.[id] || { id, name: id, url: "" })
      .filter((g) => g?.url || g?.name || g?.id);
  }, [rearSelectedIds, rearMeta]);

  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(draft.engraving?.epitaphs) ? draft.engraving!.epitaphs!.map((t) => (t || "").trim()).filter(Boolean) : [];
    if (arr.length) return arr;
    const single = (draft.engraving?.epitaphText || "").trim();
    return single ? [single] : [];
  }, [draft.engraving]);
  const rearEpitaphs: string[] = useMemo(
    () => ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).map((t) => (t || "").trim()).filter(Boolean)),
    [draft]
  );

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

  /* ===== Дополнительно ===== */

  const initialExtras = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(!!initialExtras.base);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(!!initialExtras.flowerbed);

  // Плита
  const [extraPlate, setExtraPlate] = useState<boolean>(!!initialExtras.headstonePlate);
  const stelaOrientation = (draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase();
  const defaultPlateOrientation = stelaOrientation.startsWith("h") ? "horizontal" : "vertical";

  // Значения по умолчанию + список вариантов
  const plateSizeOptions = ["100*50 см", "120*60 см", "140*70 см"];
  const plateThicknessOptions = ["5 см", "8 см", "10 см"];

  const [plateSize, setPlateSize] = useState<string>((initialExtras as any)?.plateSize && plateSizeOptions.includes((initialExtras as any)?.plateSize) ? (initialExtras as any)?.plateSize : plateSizeOptions[0]);
  const [plateThickness, setPlateThickness] = useState<string>((initialExtras as any)?.plateThickness && plateThicknessOptions.includes((initialExtras as any)?.plateThickness) ? (initialExtras as any)?.plateThickness : plateThicknessOptions[0]);
  const [plateOrientation, setPlateOrientation] = useState<string>((initialExtras as any)?.plateOrientation || defaultPlateOrientation);
  const [plateOpen, setPlateOpen] = useState<boolean>(false);
  const [plateEpitaph, setPlateEpitaph] = useState<string>((initialExtras as any)?.plateEpitaph || "");

  // Каталог плиты
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [plateIds, setPlateIds] = useState<string[]>(((draft as any)?.extras?.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>(((draft as any)?.extras?.plateGraphicsMeta as Record<string, any>) || {});
  const chosenPlateList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" }).filter((x) => x?.url || x?.name);
  }, [plateIds, plateMeta]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!plateOpen) return;
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
  }, [plateOpen]);

  // Сохранить extras
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
      plateEpitaph: extraPlate ? (plateEpitaph?.trim() || undefined) : undefined,
      plateGraphicsIds: extraPlate ? plateIds : [],
      plateGraphicsMeta: extraPlate ? plateMeta : {}
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
    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const next = plateIds.slice();
    next.splice(idx, 1);
    setPlateIds(next);
  };
  const handleDeletePlate = () => {
    setExtraPlate(false);
    setPlateIds([]);
    setPlateMeta({});
    setPlateEpitaph("");
  };

  // Отправка
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const handleSend = async () => {
    setBusy(true); setErr("");
    const name = (introState.intro?.customerName || "").trim();

    const attachments: any = {
      frontPreview: (draft as any)?.editor?.previewHiUrl || (draft as any)?.editor?.previewUrl || null,
      backPreview: (draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl || null,
      itemUrl: itemUrl || null,
      peoplePhotos: [
        ...(frontPersons.map((p: any) => p.photoPreview).filter(Boolean) as string[]),
        ...(rearPeople.map((p: any) => p.photoPreview).filter(Boolean) as string[])
      ].filter(Boolean),
      plateGraphics: chosenPlateList
    };

    const extras: Extras & {
      base?: boolean;
      flowerbed?: boolean;
      headstonePlate?: boolean;
      plateSize?: string;
      plateThickness?: string;
      plateOrientation?: string;
      plateEpitaph?: string;
      plateGraphicsIds?: string[];
      attachments?: any;
    } = {
      base: extraBase,
      flowerbed: extraFlowerbed,
      headstonePlate: extraPlate,
      plateSize: extraPlate ? plateSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph?.trim() || undefined) : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined,
      attachments
    };

    try {
      await sendOrderEmailAndNotifyTg(extras);
      const nm = name || "Заказчик";
      window.alert(`${nm}, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами по указанному номеру для уточнения деталей и подтверждения заказа.`);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ color: "#fff", padding: 12, maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
      {/* Навигация */}
      <div style={{ position: "sticky", top: "calc(env(safe-area-inset-top, 0px))", zIndex: 50 }}>
        <StepNav active="review" />
      </div>

      {/* Подсказка */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные. Для редактирования элементов
        гравировки перейдите на соответствующий шаг, используйте навигацию вверху. Когда всё верно — нажмите «Отправить заказ».
      </section>

      {/* Редактируемые данные */}
      <EditableOrderSummary />

      {/* Лицевая */}
      {(frontPersons.length > 0 || frontUnique.length > 0 || frontEpitaphs.length > 0 || !!frontWishes) && (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Лицевая")}</div>

          {/* Люди */}
          {frontPersons.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Люди</div>
              <div style={{ display: "grid", gap: 8 }}>
                {frontPersons.map((p: any, i: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                  const metricArr = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean);
                  return (
                    <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: (p.photoPreview ? "56px 1fr" : "1fr"), gap: 8, alignItems: "center" }}>
                      {p.photoPreview && <Thumb url={p.photoPreview} />}
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                        {fio2 && <div>{fio2}</div>}
                        {metricArr.length > 0 && <div style={{ opacity: 0.9 }}>{metricArr.join(" — ")}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Графика */}
          {frontUnique.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
              <div style={{ display: "grid", gap: 8 }}>
                {frontUnique.map((g: any) => {
                  const id = g?.id || g?.url || g?.name;
                  const qty = id ? (frontCountsById[id] || 0) : 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={`fg-${id}`} style={{ display: "grid", gridTemplateColumns: (g.url ? "56px 1fr auto" : "1fr auto"), gap: 8, alignItems: "center" }}>
                      {g.url && <Thumb url={g.url} />}
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      {qty > 1 && <div style={{ ...smallText() }}>×{qty}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Эпитафии */}
          {frontEpitaphs.length > 0 && (
            <AccentBox>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {frontEpitaphs.map((t, i) => (
                  <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                ))}
              </div>
            </AccentBox>
          )}

          {/* Пожелания */}
          {!!frontWishes && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{frontWishes}</div>
            </div>
          )}
        </section>
      )}

      {/* Тыльная */}
      {(rearPeople.length > 0 || rearUnique.length > 0 || rearEpitaphs.length > 0 || !!backWishes) && (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Тыльная")}</div>

          {/* Люди */}
          {rearPeople.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Люди</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rearPeople.map((p: any, i: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                  const metricArr = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean);
                  return (
                    <div key={p.id || `rp-${i}`} style={{ display: "grid", gridTemplateColumns: (p.photoPreview ? "56px 1fr" : "1fr"), gap: 8, alignItems: "center" }}>
                      {p.photoPreview && <Thumb url={p.photoPreview} />}
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                        {fio2 && <div>{fio2}</div>}
                        {metricArr.length > 0 && <div style={{ opacity: 0.9 }}>{metricArr.join(" — ")}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Графика */}
          {rearUnique.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rearUnique.map((g: any, i: number) => {
                  const id = g?.id || g?.relPath || g?.url || g?.name || `rear-${i}`;
                  const qty = rearCountsById[id] || 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={`rg-${id}`} style={{ display: "grid", gridTemplateColumns: (g.url ? "56px 1fr auto" : "1fr auto"), gap: 8, alignItems: "center" }}>
                      {g.url && <Thumb url={g.url} />}
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      {qty > 1 && <div style={{ ...smallText() }}>×{qty}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Эпитафии */}
          {rearEpitaphs.length > 0 && (
            <AccentBox>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {rearEpitaphs.map((t, i) => (
                  <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                ))}
              </div>
            </AccentBox>
          )}

          {/* Пожелания */}
          {!!backWishes && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{backWishes}</div>
            </div>
          )}
        </section>
      )}

      {/* Эскизы — 2 столбца (только один раз, нижний дубль удалён) */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <SidePreview title="Лицевая" miniUrl={frontMini} itemUrl={itemUrl} side="front" aspect={aspect} />
          <SidePreview title="Тыльная" miniUrl={backMini} itemUrl={itemUrl} side="back" aspect={aspect} />
        </div>
      </section>

      {/* Дополнительно — Тумба/Цветник/Плита */}
      <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
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
        <div style={{ ...sectionBox, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
              <span style={{ fontWeight: 600 }}>Надгробная плита</span>
            </label>

            {extraPlate && (
              <button type="button" onClick={handleDeletePlate} style={glassButtonStyle("nano")}>
                Удалить плиту
              </button>
            )}
          </div>

          {extraPlate && (
            <>
              {/* Размеры НП: 100*50, 120*60, 140*70 */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {["100*50 см", "120*60 см", "140*70 см"].map((v) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-size" checked={plateSize === v} onChange={() => setPlateSize(v)} />
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Толщина НП: 5, 8, 10 см */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {["5 см", "8 см", "10 см"].map((v) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-thickness" checked={plateThickness === v} onChange={() => setPlateThickness(v)} />
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Ориентация */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {[
                    { v: "vertical", t: "вертикальная" },
                    { v: "horizontal", t: "горизонтальная" }
                  ].map(({ v, t }) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => setPlateOrientation(v)} />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Эпитафия плиты */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Эпитафия</div>
                <textarea
                  value={plateEpitaph}
                  onChange={(e) => setPlateEpitaph(e.target.value)}
                  rows={3}
                  placeholder="Текст эпитафии на плите…"
                  style={{ ...inputStyle(), resize: "vertical" }}
                />
              </div>

              {/* Галерея: «Графика на надгробной плите» */}
              <Accordion
                title="Графика на надгробной плите"
                open={plateOpen}
                onToggle={() => setPlateOpen((v) => !v)}
              >
                {catsLoading && <div>Загрузка каталога…</div>}
                {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
                {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}
                {!catsLoading && cats.length > 0 && (
                  <div style={{ display: "grid", gap: 12 }}>
                    {cats.map((cat: any) => (
                      <div key={cat._id || cat.name}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{cat.name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
                          {(cat.items || []).map((g: any) => {
                            const gid = String(g.id || g.relPath || g.url || g.name);
                            const qty = plateIds.filter((x) => x === gid).length;
                            return (
                              <div key={gid} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 10 }}>
                                <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "grid", placeItems: "center" }}>
                                  {g.url ? (
                                    <img src={g.preview || g.url} alt={g.name || gid} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                                  ) : (
                                    <div style={{ ...smallText() }}>нет</div>
                                  )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                  <button type="button" onClick={() => removePlateGraphic(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                                  <span style={{ minWidth: 18, textAlign: "center" }}>{qty}</span>
                                  <button type="button" onClick={() => addPlateGraphic(g)} style={glassButtonStyle("nano")}>+</button>
                                </div>
                              </div>
                            );
                          })}
                          {(cat.children || []).flatMap((sub: any) =>
                            (sub.items || []).map((g: any) => {
                              const gid = String(g.id || g.relPath || g.url || g.name);
                              const qty = plateIds.filter((x) => x === gid).length;
                              return (
                                <div key={`${sub._id || sub.name}-${gid}`} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 10 }}>
                                  <div style={{ borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "grid", placeItems: "center" }}>
                                    {g.url ? (
                                      <img src={g.preview || g.url} alt={g.name || gid} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                                    ) : (
                                      <div style={{ ...smallText() }}>нет</div>
                                    )}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                    <button type="button" onClick={() => removePlateGraphic(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                                    <span style={{ minWidth: 18, textAlign: "center" }}>{qty}</span>
                                    <button type="button" onClick={() => addPlateGraphic(g)} style={glassButtonStyle("nano")}>+</button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Accordion>

              {/* Выбранные для плиты (в самом блоке) */}
              {(chosenPlateList.length > 0 || plateEpitaph.trim()) && (
                <div style={{ ...sectionBox, marginTop: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Выбрано для плиты</div>
                  {chosenPlateList.length > 0 && (
                    <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                      {chosenPlateList.map((g, i) => (
                        <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: (g.url ? "56px 1fr auto" : "1fr auto"), gap: 8, alignItems: "center" }}>
                          {g.url && <Thumb url={g.url} />}
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                          <button type="button" onClick={() => removePlateGraphic(g.id || g.url || "")} style={glassButtonStyle("nano")}>Удалить</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {plateEpitaph.trim() && (
                    <AccentBox>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафия</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{plateEpitaph.trim()}</div>
                    </AccentBox>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Ошибка */}
      {err && (
        <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>
          {err}
        </div>
      )}

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>
          Назад
        </button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>
          {busy ? "Отправляем…" : "Отправить заказ"}
        </button>
      </div>
    </div>
  );
}
