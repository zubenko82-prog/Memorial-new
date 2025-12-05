// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение без TopBar.
// В этом варианте:
// - Навигация: берём готовую src/components/StepNav.tsx и показываем её «липко» сверху.
// - Подсказка перенесена вверх (точный текст из ТЗ).
// - Редактируемые: Контакты и «Резная работа/размеры».
// - Остальные элементы отсортированы по сторонам:
//   Лицевая: Люди → Графика → Эпитафии → Пожелания.
//   Тыльная: Люди → Графика → Эпитафии → Пожелания.
//   Пустые секции не показываем (например, если нет «Люди (тыльная)», блока не будет).
// - Миниатюры «вписывают изображение» (object-fit: contain).
// - Превью сторон оставляем как раньше — в 2 столбца. Для тыльной стороны подложка зеркалится.

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
  return { opacity: 0.85, fontSize: 12 };
}

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

/* ===== Подложка под превью (градиент + изделие) ===== */
function Underlay({
  itemUrl,
  mirror = false,
  inset = 8
}: { itemUrl?: string; mirror?: boolean; inset?: number }) {
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
        <img
          src={itemUrl}
          alt=""
          style={{
            position: "absolute",
            left: inset,
            top: inset,
            width: `calc(100% - ${inset * 2}px)`,
            height: `calc(100% - ${inset * 2}px)`,
            objectFit: "contain",
            opacity: 0.35,
            transform: mirror ? "scaleX(-1)" : "none",
            zIndex: 0,
            pointerEvents: "none"
          }}
          draggable={false}
        />
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
        <Underlay itemUrl={itemUrl} mirror={mirror} />
        {miniUrl ? (
          <img
            src={miniUrl}
            alt=""
            style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain", zIndex: 1 }}
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

  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 700 }}>Данные заказа</div>

      {/* Контакты */}
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Контакты</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={name} onChange={(e) => { setName(e.target.value); scheduleSave(); }} placeholder="Имя" style={inputStyle()} />
          <input value={phone} onChange={(e) => { setPhone(e.target.value); scheduleSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
        </div>
        <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); scheduleSave(); }} placeholder="Примечание (удобное время, мессенджер…)" style={inputStyle()} />
      </div>

      {/* Резная работа / размеры */}
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Резная работа</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
          <div
            style={{
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background:
                "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)",
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
            ) : (
              <div style={{ opacity: 0.7, fontSize: 12 }}>нет</div>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {draft?.item?.name || (draft?.item?.url ? decodeURIComponent(draft.item.url.split("/").pop() || "") : "—")}
            </div>
            <div style={{ opacity: 0.9, marginTop: 2 }}>Размеры: {dims}</div>
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

  // Соотношение сторон подложки
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
  const frontPersons: any[] = (draft.engraving?.persons as any[])?.filter(Boolean) || [];
  const rearPeople: any[] = ((draft as any)?.editorBack?.people as any[])?.filter(Boolean) || [];

  const frontGraphics: any[] = (draft.graphics as any[])?.filter(Boolean) || [];
  const frontCountsById: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphics.forEach((g) => (m[g.id] = (m[g.id] || 0) + 1));
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
    return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "" });
  }, [rearSelectedIds, rearMeta]);

  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(draft.engraving?.epitaphs) ? draft.engraving!.epitaphs!.filter(Boolean) : [];
    if (arr.length) return arr;
    if (draft.engraving?.epitaphText?.trim()) return [draft.engraving!.epitaphText!.trim()];
    return [];
  }, [draft.engraving]);
  const rearEpitaphs: string[] = useMemo(
    () => (((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean),
    [draft]
  );

  const [frontWishes, setFrontWishes] = useState<string>((draft as any)?.editor?.wishes || "");
  const [backWishes, setBackWishes] = useState<string>((draft as any)?.editorBack?.wishes || "");
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = loadOrderDraft();
      saveOrderDraft({
        ...cur,
        editor: { ...(cur as any).editor, wishes: frontWishes?.trim() || undefined },
        editorBack: { ...(cur as any).editorBack, wishes: backWishes?.trim() || undefined },
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

  // Липкая навигация: берём готовую StepNav
  const StepNavAny = StepNav as any;

  // Хелп для миниатюр (вписываем изображение)
  const Thumb = ({ url, alt = "", size = 56 }: { url?: string; alt?: string; size?: number }) => (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.14)",
        overflow: "hidden",
        background: "rgba(255,255,255,0.04)",
        width: size,
        height: size,
        display: "grid",
        placeItems: "center"
      }}
    >
      {url ? (
        <img src={url} alt={alt} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
      ) : (
        <div style={{ ...smallText() }}>—</div>
      )}
    </div>
  );

  const hasFront =
    frontPersons.length > 0 || frontUnique.length > 0 || frontEpitaphs.length > 0 || !!frontWishes.trim();
  const hasBack =
    rearPeople.length > 0 || rearUnique.length > 0 || rearEpitaphs.length > 0 || !!backWishes.trim();

  return (
    <div style={{ color: "#fff", padding: 12, maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
      {/* Липкая навигация по шагам (готовая компонентa) */}
      <div
        style={{
          position: "sticky",
          top: "calc(env(safe-area-inset-top, 0px))",
          zIndex: 50
        }}
      >
        <StepNavAny active="review" />
      </div>

      {/* Подсказка — сверху */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные. Для редактирования элементов
        гравировки перейдите на соответствующий шаг. Когда всё верно — нажмите «Отправить заказ».
      </section>

      {/* Редактируемые данные заказа */}
      <EditableOrderSummary />

      {/* Лицевая сторона: Люди → Графика → Эпитафии → Пожелания (показываем только то, что есть) */}
      {hasFront && (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            {chip("Лицевая")}
          </div>

          {/* Люди (лицевая) */}
          {frontPersons.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Люди</div>
              <div style={{ display: "grid", gap: 8 }}>
                {frontPersons.map((p: any, i: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                  const metric = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                  return (
                    <div key={p.id || `fp-${i}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, alignItems: "center" }}>
                      <Thumb url={p.photoPreview || ""} />
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                        {fio2 && <div>{fio2}</div>}
                        <div style={{ opacity: 0.9 }}>{metric || "—"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Графика (лицевая) */}
          {frontUnique.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
              <div style={{ display: "grid", gap: 8 }}>
                {frontUnique.map((g: any) => {
                  const id = g?.id || g?.url || g?.name;
                  const qty = id ? (frontCountsById[id] || 0) : 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={`fg-${id}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 8, alignItems: "center" }}>
                      <Thumb url={g?.url} />
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
          {!!frontWishes.trim() && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{frontWishes.trim()}</div>
            </div>
          )}
        </section>
      )}

      {/* Тыльная сторона: Люди → Графика → Эпитафии → Пожелания */}
      {hasBack && (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
            {chip("Тыльная")}
          </div>

          {/* Люди (тыльная) */}
          {rearPeople.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Люди</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rearPeople.map((p: any, i: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((x: string) => (x || "").trim()).filter(Boolean).join(" ");
                  const metric = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                  return (
                    <div key={p.id || `rp-${i}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 8, alignItems: "center" }}>
                      <Thumb url={p.photoPreview || ""} />
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                        {fio2 && <div>{fio2}</div>}
                        <div style={{ opacity: 0.9 }}>{metric || "—"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Графика (тыльная) */}
          {rearUnique.length > 0 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rearUnique.map((g: any, i: number) => {
                  const id = g?.id || g?.relPath || g?.url || g?.name || `rear-${i}`;
                  const qty = rearCountsById[id] || 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={`rg-${id}`} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 8, alignItems: "center" }}>
                      <Thumb url={g?.url} />
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
          {!!backWishes.trim() && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{backWishes.trim()}</div>
            </div>
          )}
        </section>
      )}

      {/* Превью сторон — 2 столбца, с подложкой; слово «эскиз» не используем */}
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
        <button type="button" onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const extras: Extras = { base: extraBase, headstonePlate: extraPlate, flowerbed: extraFlowerbed };
            await sendOrderEmailAndNotifyTg(extras);
            onSend?.({ extras });
          } catch (e: any) {
            setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
          } finally {
            setBusy(false);
          }
        }} style={glassButtonStyle("sm", busy)} disabled={busy}>
          {busy ? "Отправляем…" : "Отправить заказ"}
        </button>
      </div>
    </div>
  );
}
