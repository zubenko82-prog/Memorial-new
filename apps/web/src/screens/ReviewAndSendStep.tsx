// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение без TopBar.
//
// Исправления:
// - Эскизы отображаем один раз (нижний дубль удалён).
// - Тыльная: заливка резной работы сделана через маску (прозрачное остаётся прозрачным, непрозрачное — сплошной цвет),
//   маска расположена поверх превью, зеркалирована по X — всегда видна.
// - Вернули полный состав заказа в просмотре: Усопшие, Графика, Эпитафии (лицевая/тыльная), Пожелания, Контакты, Резная работа.
// - Ориентацию выводим «вертикально/горизонтально» вместо «вертикальная/горизонтальная».
// - Галерея «Графика на надгробной плите»: категории как закрытые аккордеоны; «Цветы» с подкатегориями.
// - Все миниатюры и превью — object-fit: contain (вписаны).

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
function orientationLabelShort(o?: string) {
  if (!o) return "";
  const k = String(o).toLowerCase();
  if (k.startsWith("h")) return "горизонтально";
  if (k.startsWith("v")) return "вертикально";
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
  // Лицевая: градиент + изделие (contain, opacity 85%).
  // Тыльная: только градиент (маску добавим сверху в SidePreview).
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
        {/* Фон */}
        <Underlay itemUrl={itemUrl} side={side} />

        {/* Превью эскиза */}
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

        {/* Тыльная: маска над превью — непрозрачное заливаем цветом, прозрачное остаётся прозрачным; зеркалим */}
        {itemUrl && side === "back" && (
          <div
            aria-hidden
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
              zIndex: 3,
              pointerEvents: "none"
            }}
          />
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
  const orient = orientationLabelShort(draft?.size?.orientation || (draft as any)?.orientation);

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

/* ===== Грид категорій/подкатегорий плиты ===== */
function CatGrid({
  items,
  plateIds,
  addGraphic,
  removeGraphic
}: {
  items: any[];
  plateIds: string[];
  addGraphic: (g: any) => void;
  removeGraphic: (gid: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 }}>
      {items.map((g: any, idx: number) => {
        const gid = String(g.id || g.relPath || g.url || g.name || idx);
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
              <button type="button" onClick={() => removeGraphic(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
              <span style={{ minWidth: 18, textAlign: "center" }}>{qty}</span>
              <button type="button" onClick={() => addGraphic(g)} style={glassButtonStyle("nano")}>+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===== Основной компонент ===== */
type Props = { onBack?: () => void; onSend?: (payload?: any) => void; };

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

  // Лицевая сторона — данные
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const frontGraphicsRaw: any[] = (draft.graphics as any[])?.filter(Boolean) || [];
  const frontUnique: any[] = useMemo(() => {
    const first: Record<string, any> = {};
    frontGraphicsRaw.forEach((g) => { const id = g?.id || g?.url || g?.name; if (id && !first[id]) first[id] = g; });
    return Object.values(first);
  }, [frontGraphicsRaw]);
  const frontCountsById: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    frontGraphicsRaw.forEach((g) => { const id = g?.id || g?.url || g?.name || ""; if (id) m[id] = (m[id] || 0) + 1; });
    return m;
  }, [frontGraphicsRaw]);
  const frontEpitaphs: string[] = useMemo(() => {
    const arr = Array.isArray(draft.engraving?.epitaphs) ? draft.engraving!.epitaphs!.filter(Boolean) : [];
    if (arr.length) return arr;
    const single = (draft.engraving?.epitaphText || "").trim();
    return single ? [single] : [];
  }, [draft.engraving]);
  const frontWishes = ((draft as any)?.editor?.wishes || "").trim();

  // Тыльная сторона — данные
  const rearPeople = ((((draft as any)?.editorBack?.people as any[]) || []).filter(Boolean)) as Array<{
    id?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string;
    birthDate?: string;
    deathDate?: string;
    photoPreview?: string | null;
  }>;
  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    (rearIds || []).forEach((id) => { m[id] = (m[id] || 0) + 1; });
    return m;
  }, [rearIds]);
  const rearUnique: any[] = useMemo(() => {
    const ids = Array.from(new Set(rearIds || []));
    return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "", preview: "" });
  }, [rearIds, rearMeta]);
  const rearEpitaphs: string[] = useMemo(
    () => ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean)),
    [draft]
  );
  const backWishes = (((draft as any)?.editorBack?.wishes || "").trim());

  // Дополнительно — тумба/цветник={{ ...sectionBox, marginTop: 8 }}>
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

      {/* Эскизы — один раз */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <SidePreview title="Лицевая" miniUrl={(draft as any)?.editor?.previewUrl} itemUrl={itemUrl} side="front" aspect={aspect} />
          <SidePreview title="Тыльная" miniUrl={(draft as any)?.editorBack?.previewUrl} itemUrl={itemUrl} side="back" aspect={aspect} />
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
