// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение без TopBar.
//
// Исправления/добавления:
// - Фон тыльного превью: БАЗОВОЕ ИЗДЕЛИЕ теперь гарантированно отображается под превью (object-fit: cover),
//   виден всегда (в том числе при прозрачном PNG превью). Для тыла — зеркалим и кладём цветную маску.
// - Миниатюры (резная работа, кресты, графика): везде object-fit: contain (вписывание целиком).
// - Редактор плиты (графика):
//   • Секция «Надгробная плита» с двумя чекбоксами: «Надгробная плита» и «Гравировка (редактор)».
//   • Изначально «Надгробная плита» НЕ отмечена.
//   • Если отметили «Надгробная плита» — показываем компактные настройки (размер, толщина, ориентация); аккордеон с редактором НЕ открываем автоматически.
//   • Если отметили «Гравировка (редактор)» — автоматически отмечаем «Надгробная плита» (если не отмечена) и ПОЛНОСТЬЮ открываем аккордеон (галерея с подпапками + добавление эпитафии).
//   • Аккордеон можно разворачивать/сворачивать по нажатию.
//   • Галерея — как на шаге «Тыл»: сетка, превью contain, +/−, подпапки.
// - Под эскизами отображаем «Выбранные»: «Надгробная плита — Размер, Толщина, Ориентация», ниже — выбранные элементы и эпитафию плиты.
// - Навигация StepNav (sticky) и подсказка сверху.
// - Скрываем пустые данные.

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
function ensureAspectFromItemUrl(itemUrl?: string): string | undefined {
  if (!itemUrl) return undefined;
  // Будем пытаться быстро оценить из URL (если содержит размеры), иначе вычислится onload
  return undefined;
}

/* ===== Подложка под превью (градиент + изделие, для тыла — маска сверху) ===== */
function Underlay({
  itemUrl,
  mirror = false,
  withTintMaskTop = false,
  tint = "rgba(80, 160, 255, 0.30)"
}: {
  itemUrl?: string;
  mirror?: boolean;
  withTintMaskTop?: boolean;
  tint?: string;
}) {
  // ВАЖНО: базовую картинку изделия и маску растягиваем на ВСЮ область (object-fit: cover).
  // Это гарантирует, что подложка видна, а не только градиент.
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
      {itemUrl ? (
        <>
          <img
            src={itemUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: mirror ? "scaleX(-1)" : "none",
              opacity: 0.35,
              pointerEvents: "none"
            }}
            draggable={false}
          />
          {withTintMaskTop && (
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
                transform: "scaleX(-1)",
                transformOrigin: "center",
                zIndex: 2,
                pointerEvents: "none"
              }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/* ===== Превью стороны (карточка) ===== */
function SidePreview({
  title,
  miniUrl,
  itemUrl,
  mirror = false,
  aspect
}: {
  title: string;
  miniUrl?: string;
  itemUrl?: string;
  mirror?: boolean;
  aspect?: string;
}) {
  // Чтобы фон точно отобразился — рендерим Underlay до картинки превью
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
        <Underlay itemUrl={itemUrl} mirror={mirror} withTintMaskTop={mirror} />
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

/* ===== Вписывающая миниатюра (общая) ===== */
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
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  // Соотношение сторон подложки
  const [aspect, setAspect] = useState<string | undefined>(ensureAspectFromItemUrl(itemUrl));
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

  /* ===== Дополнительно: плита и редактор плиты ===== */

  // Плитa изначально НЕ отмечена
  const initialExtras = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(initialExtras.base ?? true);
  const [extraPlate, setExtraPlate] = useState<boolean>(!!initialExtras.headstonePlate && false === true ? false : !!initialExtras.headstonePlate); // принудительно не отмечаем по умолчанию
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(initialExtras.flowerbed ?? false);

  const stelaOrientation = (draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase();
  const defaultPlateOrientation = stelaOrientation.startsWith("h") ? "horizontal" : "vertical";

  // Настройки плиты (при включении показываем "компактно")
  const [plateSize, setPlateSize] = useState<string>((initialExtras as any)?.plateSize || "");
  const [plateThickness, setPlateThickness] = useState<string>((initialExtras as any)?.plateThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>((initialExtras as any)?.plateOrientation || defaultPlateOrientation);

  // "Редактор" (полный) — аккордеон
  const [plateOpen, setPlateOpen] = useState<boolean>(false); // по умолчанию закрыт
  const [plateEpitaph, setPlateEpitaph] = useState<string>((initialExtras as any)?.plateEpitaph || "");

  // Каталог для редактора плиты
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [plateIds, setPlateIds] = useState<string[]>(((draft as any)?.extras?.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>(((draft as any)?.extras?.plateGraphicsMeta as Record<string, any>) || {});

  // Сохранение extras
  useEffect(() => {
    const prev = loadOrderDraft();
    const extras: any = {
      ...(prev as any).extras,
      base: extraBase,
      headstonePlate: extraPlate,
      flowerbed: extraFlowerbed,
      plateSize: extraPlate ? plateSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph?.trim() || undefined) : undefined,
      plateGraphicsIds: extraPlate ? plateIds : [],
      plateGraphicsMeta: extraPlate ? plateMeta : {}
    };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
  }, [extraBase, extraPlate, extraFlowerbed, plateSize, plateThickness, plateOrientation, plateEpitaph, plateIds, plateMeta]);

  // Если включили редактор (checkbox), автоматически включаем плиту и открываем аккордеон полностью
  const [editorCheckbox, setEditorCheckbox] = useState<boolean>(false);
  useEffect(() => {
    if (editorCheckbox) {
      if (!extraPlate) setExtraPlate(true);
      setPlateOpen(true);
    }
  }, [editorCheckbox, extraPlate]);

  // Если отметили плиту — показываем компактные настройки (plateOpen не трогаем).
  useEffect(() => {
    if (extraPlate) {
      // проставим ориентацию, если ещё не выбрана
      if (!plateOrientation) setPlateOrientation(defaultPlateOrientation);
      if (!plateSize) setPlateSize("100×50 см");
      if (!plateThickness) setPlateThickness("5 см");
    } else {
      // очистка настроек при снятии галочки
      // (оставляем значения, но extras не будет отправлять их — см. useEffect выше)
    }
  }, [extraPlate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Загрузка каталога при открытии аккордеона
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!plateOpen) return;
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
    load();
    return () => { alive = false; };
  }, [plateOpen]);

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

  // Все для экранов
  const hasFront =
    frontPersons.length > 0 || frontUnique.length > 0 || frontEpitaphs.length > 0 || !!frontWishes;
  const hasBack =
    rearPeople.length > 0 || rearUnique.length > 0 || rearEpitaphs.length > 0 || !!backWishes;

  // Подсчёт выбранного для плиты (для вывода под эскизами)
  const chosenPlateList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" }).filter((x) => x?.url || x?.name);
  }, [plateIds, plateMeta]);

  // Отправка
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const handleSend = async () => {
    setBusy(true); setErr("");
    const extras: Extras & {
      plateSize?: string; plateThickness?: string; plateOrientation?: string; plateEpitaph?: string; plateGraphicsIds?: string[];
    } = {
      base: extraBase,
      headstonePlate: extraPlate,
      flowerbed: extraFlowerbed,
      plateSize: extraPlate ? plateSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph?.trim() || undefined) : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined
    };
    try {
      await sendOrderEmailAndNotifyTg(extras);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ color: "#fff", padding: 12, maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
      {/* Липкая навигация */}
      <div style={{ position: "sticky", top: "calc(env(safe-area-inset-top, 0px))", zIndex: 50 }}>
        <StepNav active="review" />
      </div>

      {/* Подсказка — сверху */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные. Для редактирования элементов
        гравировки перейдите на соответствующий шаг, используйте навигацию вверху. Когда всё верно — нажмите «Отправить заказ».
      </section>

      {/* Редактируемые данные заказа */}
      <EditableOrderSummary />

      {/* Лицевая */}
      {hasFront && (
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
      {hasBack && (
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

      {/* Превью сторон — 2 столбца (фон тыла гарантирован) */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <SidePreview title="Лицевая" miniUrl={frontMini} itemUrl={itemUrl} mirror={false} aspect={aspect} />
          <SidePreview title="Тыльная" miniUrl={backMini} itemUrl={itemUrl} mirror aspect={aspect} />
        </div>
      </section>

      {/* Дополнительно — плита и редактор плиты */}
      <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Дополнительно</div>

        {/* Чекбоксы строки */}
        <div style={{ ...sectionBox }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={extraPlate}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setExtraPlate(checked);
                  // При отметке плиты — просто показываем настройки (аккордеон НЕ открываем)
                  if (checked) {
                    if (!plateOrientation) setPlateOrientation(defaultPlateOrientation);
                    if (!plateSize) setPlateSize("100×50 см");
                    if (!plateThickness) setPlateThickness("5 см");
                  }
                }}
              />
              <span>Надгробная плита</span>
            </label>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={plateOpen}
                onChange={(e) => {
                  const next = e.target.checked;
                  setPlateOpen(next);
                  if (next && !extraPlate) {
                    setExtraPlate(true);
                    if (!plateOrientation) setPlateOrientation(defaultPlateOrientation);
                  }
                }}
              />
              <span>Гравировка (редактор)</span>
            </label>
          </div>
        </div>

        {/* Компактные настройки плиты — сразу под чекбоксами, если плита отмечена */}
        {extraPlate && (
          <div style={{ ...sectionBox, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 600 }}>Параметры плиты</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13 }}>Размер</span>
                <select value={plateSize} onChange={(e) => setPlateSize(e.target.value)} style={{ ...inputStyle(), padding: "8px 10px" }}>
                  <option value="100×50 см">100×50 см</option>
                  <option value="120×60 см">120×60 см</option>
                  <option value="140×70 см">140×70 см</option>
                  <option value="160×80 см">160×80 см</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13 }}>Толщина</span>
                <select value={plateThickness} onChange={(e) => setPlateThickness(e.target.value)} style={{ ...inputStyle(), padding: "8px 10px" }}>
                  <option value="3 см">3 см</option>
                  <option value="5 см">5 см</option>
                  <option value="7 см">7 см</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13 }}>Ориентация</span>
                <select value={plateOrientation} onChange={(e) => setPlateOrientation(e.target.value)} style={{ ...inputStyle(), padding: "8px 10px" }}>
                  <option value="vertical">вертикальная</option>
                  <option value="horizontal">горизонтальная</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {/* Полный редактор плиты — аккордеон (галерея с подпапками + эпитафия) */}
        <Accordion
          title="Редактор плиты (графика/эпитафия)"
          open={plateOpen}
          onToggle={() => {
            const next = !plateOpen;
            setPlateOpen(next);
            if (next && !extraPlate) {
              setExtraPlate(true);
              if (!plateOrientation) setPlateOrientation(defaultPlateOrientation);
            }
          }}
        >
          {catsLoading && <div>Загрузка каталога…</div>}
          {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
          {!catsLoading && !catsError && cats.length === 0 && <div>Каталог пуст.</div>}
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
                    {(cat.children || []).map((sub: any) =>
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
            </div>
          )}
        </Accordion>
      </section>

      {/* Выбранные (под эскизами): плита и её содержимое */}
      {(extraPlate || chosenPlateList.length > 0 || plateEpitaph.trim()) && (
        <section style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Выбранные</div>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Надгробная плита</div>
            <div style={{ marginBottom: 8 }}>
              {extraPlate ? (
                <>
                  <span>Размер: {plateSize || "—"}</span>
                  <span style={{ margin: "0 8px" }}>·</span>
                  <span>Толщина: {plateThickness || "—"}</span>
                  <span style={{ margin: "0 8px" }}>·</span>
                  <span>Ориентация: {orientationLabel(plateOrientation) || "—"}</span>
                </>
              ) : (
                <span style={{ opacity: 0.8 }}>—</span>
              )}
            </div>

            {/* Элементы плиты */}
            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                {chosenPlateList.map((g, i) => (
                  <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: (g.url ? "56px 1fr" : "1fr"), gap: 8, alignItems: "center" }}>
                    {g.url && <Thumb url={g.url} />}
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Эпитафия плиты */}
            {plateEpitaph.trim() && (
              <AccentBox>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафия плиты</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{plateEpitaph.trim()}</div>
              </AccentBox>
            )}
          </div>
        </section>
      )}

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
