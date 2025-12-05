// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение без TopBar.
//
// Что изменено по задаче:
// - Миниатюры: у всех превью и миниатюр object-fit: contain (вписываем изображение полностью).
// - В «Резная работа» добавили ориентацию к размерам (вертикальная/горизонтальная), пересчёт «на месте».
// - На тыльной стороне если нет людей — не показываем пустые строки/миниатюры вообще (строки фильтруем).
// - Скрываем все пустые строки (люди без ФИО/дат/фото, графика без имени и url, пустые эпитафии).
// - Визуально разделяем блоки ненавязчивым фоном (легкие подкарточки внутри секций).
// - На эскизе тыльной стороны добавлен «выбранный рисунок изделия», зеркало по X и цветная заливка по маске
//   поверх превью (чтобы было видно даже при непрозрачном PNG).
// - Подсказка (точный текст): «Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные.
//   Для редактирования элементов гравировки перейдите на соответствующий шаг, используйте навигацию вверху.
//   Когда всё верно — нажмите «Отправить заказ».»
// - Навигация берётся из src/components/StepNav.tsx («липко» сверху).
//
// Примечание: компонент StepNav импортируется как есть (active="review").
// Этот экран позволяет редактировать контакты и раздел «Резная работа/размеры».

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import StepNav from "../components/StepNav";

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

/* ===== Подложка под превью (градиент + изделие, для тыла — маска сверху) ===== */
function Underlay({
  itemUrl,
  mirror = false,
  inset = 8,
  withTintMaskTop = false,
  tint = "rgba(80, 160, 255, 0.30)"
}: {
  itemUrl?: string;
  mirror?: boolean;
  inset?: number;
  withTintMaskTop?: boolean;
  tint?: string;
}) {
  const insetStyle: React.CSSProperties = {
    position: "absolute",
    left: inset,
    top: inset,
    width: `calc(100% - ${inset * 2}px)`,
    height: `calc(100% - ${inset * 2}px)`
  };
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
      {!!itemUrl && (
        <>
          {/* Базовый рисунок изделия, зеркалим при тыле */}
          <img
            src={itemUrl}
            alt=""
            style={{
              ...insetStyle,
              objectFit: "contain",
              opacity: 0.35,
              transform: mirror ? "scaleX(-1)" : "none",
              pointerEvents: "none"
            }}
            draggable={false}
          />
          {/* Цветная маска поверх (по альфа‑каналу), только для тыла */}
          {withTintMaskTop && (
            <div
              style={{
                ...insetStyle,
                background: tint,
                // маска по альфе исходного изделия
                WebkitMaskImage: `url(${itemUrl})`,
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                WebkitMaskSize: "contain",
                maskImage: `url(${itemUrl})`,
                maskRepeat: "no-repeat",
                maskPosition: "center",
                maskSize: "contain",
                // чтобы маска совпала с базовым зеркалом
                transform: "scaleX(-1)",
                transformOrigin: "center",
                zIndex: 2,
                pointerEvents: "none"
              }}
            />
          )}
        </>
      )}
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
  return (
    <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div
        style={{
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
          aspectRatio: aspect || undefined,
          minHeight: aspect ? undefined : 220
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

/* ===== Редактируемый блок «Данные заказа» (контакты + резная работа/размеры) ===== */
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

/* ===== Компонент шага ===== */
type Props = {
  onBack?: () => void;
  onSend?: (payload?: any) => void;
  onGoCatalog?: () => void;
  onGoEditorFront?: () => void;
  onGoEditorBack?: () => void;
};

export default function ReviewAndSendStep({
  onBack,
  onSend,
  onGoCatalog,
  onGoEditorFront,
  onGoEditorBack
}: Props) {
  const draft = useMemo(() => loadOrderDraft(), []);
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  // Соотношение сторон подложки «на месте»
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth || 0,
        h = im.naturalHeight || 0;
      if (w > 0 && h > 0) setAspect(`${w} / ${h}`);
    };
    im.src = itemUrl;
  }, [itemUrl]);

  // Превью
  const frontMini = (draft as any)?.editor?.previewUrl as string | undefined;
  const backMini = (draft as any)?.editorBack?.previewUrl as string | undefined;

  // Данные по сторонам
  const frontPersonsRaw: any[] = (draft.engraving?.persons as any[])?.filter(Boolean) || [];
  // фильтруем пустые строки: без ФИО/дат/фото
  const frontPersons = frontPersonsRaw.filter((p) => {
    const fio1 = (p.lastName || "").trim();
    const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
    const metric = [p.birthDate, p.deathDate].map((x: string) => (x || "").trim()).filter(Boolean).join("");
    const hasPhoto = !!p.photoPreview;
    return fio1 || fio2 || metric || hasPhoto;
  });

  const rearPeopleRaw: any[] = ((draft as any)?.editorBack?.people as any[])?.filter(Boolean) || [];
  const rearPeople = rearPeopleRaw.filter((p) => {
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

  // Дополнительно
  const initialExtras = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(initialExtras.base ?? true);
  const [extraPlate, setExtraPlate] = useState<boolean>(initialExtras.headstonePlate ?? false);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(initialExtras.flowerbed ?? false);
  const [extraOpen, setExtraOpen] = useState<boolean>(true);
  useEffect(() => {
    const prev = loadOrderDraft();
    const extras = { base: extraBase, headstonePlate: extraPlate, flowerbed: extraFlowerbed };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
  }, [extraBase, extraPlate, extraFlowerbed]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const handleSend = async () => {
    setBusy(true);
    setErr("");
    const extras: Extras = { base: extraBase, headstonePlate: extraPlate, flowerbed: extraFlowerbed };
    try {
      await sendOrderEmailAndNotifyTg(extras);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const StepNavAny = StepNav as any;

  // Вписывающая миниатюра
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

  const hasFront =
    frontPersons.length > 0 || frontUnique.length > 0 || frontEpitaphs.length > 0 || !!frontWishes;
  const hasBack =
    rearPeople.length > 0 || rearUnique.length > 0 || rearEpitaphs.length > 0 || !!backWishes;

  return (
    <div style={{ color: "#fff", padding: 12, maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
      {/* Липкая навигация */}
      <div style={{ position: "sticky", top: "calc(env(safe-area-inset-top, 0px))", zIndex: 50 }}>
        <StepNavAny active="review" />
      </div>

      {/* Подсказка — сверху (точный текст) */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные. Для редактирования элементов
        гравировки перейдите на соответствующий шаг, используйте навигацию вверху. Когда всё верно — нажмите «Отправить заказ».
      </section>

      {/* Редактируемые данные заказа */}
      <EditableOrderSummary />

      {/* Лицевая: Люди → Графика → Эпитафии → Пожелания */}
      {hasFront && (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Лицевая")}</div>

          {/* Люди (лицевая) */}
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

          {/* Графика (лицевая) */}
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

          {/* Эпитафии (лицевая) */}
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

          {/* Пожелания (лицевая) */}
          {!!frontWishes && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{frontWishes}</div>
            </div>
          )}
        </section>
      )}

      {/* Тыльная: Люди → Графика → Эпитафии → Пожелания */}
      {hasBack && (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Тыльная")}</div>

          {/* Люди (тыльная) — если нет людей, секция не рендерится */}
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

          {/* Графика (тыльная) */}
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

          {/* Эпитафии (тыльная) */}
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

          {/* Пожелания (тыльная) */}
          {!!backWishes && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{backWishes}</div>
            </div>
          )}
        </section>
      )}

      {/* Превью сторон — 2 столбца; тыльная — с зеркалом и заливкой по маске поверх (видно всегда) */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <SidePreview title="Лицевая" miniUrl={frontMini} itemUrl={itemUrl} mirror={false} aspect={aspect} />
          <SidePreview title="Тыльная" miniUrl={backMini} itemUrl={itemUrl} mirror aspect={aspect} />
        </div>
      </section>

      {/* Дополнительно */}
      <section>
        <div style={{ ...glassPanelStyle(), padding: 0 }}>
          <button
            type="button"
            onClick={() => setExtraOpen((v) => !v)}
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
            <strong>Дополнительно</strong>
            <span aria-hidden>{extraOpen ? "▾" : "▸"}</span>
          </button>

          {extraOpen && (
            <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={extraBase} onChange={(e) => setExtraBase(e.target.checked)} />
                  <span>Тумба</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
                  <span>Надгробная плита</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={extraFlowerbed} onChange={(e) => setExtraFlowerbed(e.target.checked)} />
                  <span>Цветник</span>
                </label>
              </div>
            </div>
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
