// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение».
//
// Новое по задаче:
// - В галерее графики помечаем выбранные элементы: подсветка карточки + бейдж с галочкой и количеством.
// - Тыльная сторона скрывается, если на ней НЕТ: графики, эпитафии, метрики или портрета (даже если есть картинка).
//   Показ/включение в PDF — только когда И картинка реально загружается, И есть содержимое.
// - Блок «Выбрано для плиты» перенесён вниз, сразу над «Комментарий к заказу».
// - Аккордеон «Надгробная плита» — с чекбоксом в заголовке, который включает параметры.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS } from "../data/epitaphs";
import { generateOrderPdf, downloadBlob, sendPdfToServer } from "../lib/pdf/generateOrderPdf";

/* ===== UI helpers ===== */
function safeRoot(): React.CSSProperties {
  return {
    width: "100%",
    maxWidth: 600,
    margin: "0 auto",
    paddingTop: "10px",
    paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
    paddingLeft: "calc(12px + env(safe-area-inset-left))",
    paddingRight: "calc(12px + env(safe-area-inset-right))",
    boxSizing: "border-box",
    overflowX: "hidden"
  };
}
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.90)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  };
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const pad = size === "nano" ? "6px 10px" : size === "sm" ? "10px 14px" : "12px 18px";
  return {
    padding: pad, borderRadius: 12, border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}
function inputStyle(): React.CSSProperties {
  return {
    width: "100%", padding: "8px 10px", borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)",
    color: "#fff", outline: "none", boxSizing: "border-box"
  };
}
const sectionBox: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 10,
  padding: 10
};
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
function toParagraphs(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}

/* ===== Мини-компоненты ===== */
function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
      {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
    </div>
  );
}

/* ===== Заголовок: № заказа + линк справа ===== */
function EditableOrderSummary({ orderNo, onOpenTop, onDirty }: { orderNo: string; onOpenTop: () => void; onDirty?: () => void }) {
  const introInitial = loadIntroState().intro || {};
  const [name, setName] = useState<string>(introInitial.customerName || "");
  const [phone, setPhone] = useState<string>(introInitial.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introInitial.customerNotes || "");
  const saveOnBlur = () => {
    const next: Intro = { customerName: name.trim(), customerPhone: phone.trim(), customerNotes: contactNotes.trim() || undefined };
    saveIntro(next, { lock: false });
    onDirty?.();
  };

  return (
    <section style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
        <div style={{ marginLeft: "auto" }}>
          <button type="button" onClick={onOpenTop} style={linkLike()}>Посмотреть состав заказа</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveOnBlur} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={saveOnBlur} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} onBlur={saveOnBlur} placeholder="Примечание для связи…" style={inputStyle()} />
    </section>
  );
}

/* ===== Accordion (title может быть ReactNode) ===== */
function LoudAccordion({ title, open, onToggle, children }: { title: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode; }) {
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
    <div style={{ ...glassPanelStyle(), padding: 0 }}>
      <button type="button" onClick={onToggle} style={{ width: "100%", textAlign: "left", padding: "12px 14px", background: "rgba(255,255,255,0.06)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 15, fontWeight: 700 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Грид каталога (для плиты) — с пометкой выбранных ===== */
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number>(2);
  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth || 0;
      setCols(Math.max(2, Math.floor(w / 160)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={rootRef} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>
      {items.map((g: any, idx: number) => {
        const gid = String(g.id || g.relPath || g.url || g.name || idx);
        const qty = plateIds.filter((x) => x === gid).length;
        const selected = qty > 0;
        const thumbUrl = g.preview || g.url || "";
        const name = g.name || gid;
        return (
          <div
            key={gid}
            aria-selected={selected}
            style={{
              ...glassPanelStyle(),
              padding: 8,
              borderRadius: 12,
              position: "relative",
              borderColor: selected ? "#9cc4ff" : "rgba(255,255,255,0.14)",
              boxShadow: selected ? "0 0 0 1px #9cc4ff inset" : undefined
            }}
          >
            {/* Бейдж выбранного */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                display: selected ? "inline-flex" : "none",
                alignItems: "center",
                gap: 4,
                background: "rgba(10,127,46,0.95)",
                color: "#fff",
                borderRadius: 999,
                padding: "0 6px",
                fontSize: 11,
                lineHeight: "18px",
                height: 18
              }}
              title={`Выбрано: ${qty}`}
            >
              <span>✓</span>
              <span>{qty}</span>
            </div>

            <div
              role="button"
              title={name}
              onClick={() => addGraphic(g)}
              style={{
                borderRadius: 10,
                overflow: "hidden",
                background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                aspectRatio: "1/1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: selected ? "1px solid #9cc4ff" : "1px solid rgba(255,255,255,0.12)",
                cursor: "pointer",
                outline: "none"
              }}
            >
              {thumbUrl ? <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
            </div>
            <div title={name} style={{ marginTop: 6, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 }}>
              {name}
            </div>
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

/* ===== Блок аккордеонов: Дополнительно + Надгробная плита (с чекбоксом в заголовке) ===== */
function PlateBlock(props: {
  // Включение и настройки плиты
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

  // Дополнительно — чекбоксы в одну строку
  hasPedestal: boolean; setHasPedestal: (v: boolean) => void;   // tumba
  hasFlowerbed: boolean; setHasFlowerbed: (v: boolean) => void; // flowerbed
  hasVase: boolean; setHasVase: (v: boolean) => void;           // vase

  onDirty?: () => void;
}) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize, plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness, plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic,
    plateIds,
    hasPedestal, setHasPedestal,
    hasFlowerbed, setHasFlowerbed,
    hasVase, setHasVase,
    onDirty
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accPlateOpen, setAccPlateOpen] = useState(true);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  const markDirty = () => onDirty?.();

  // Заголовок «Надгробная плита» — чекбокс прямо в заголовке (не триггерит раскрытие)
  const plateTitle = (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={extraPlate}
        onChange={(e) => { setExtraPlate(e.target.checked); markDirty(); }}
        onClick={(e) => e.stopPropagation()}
      />
      <span>Надгробная плита</span>
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* 1) Дополнительно */}
      <LoudAccordion title="Дополнительно" open={accExtrasOpen} onToggle={() => setAccExtrasOpen(v => !v)}>
        <div style={{ ...sectionBox }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={hasPedestal} onChange={(e) => { setHasPedestal(e.target.checked); markDirty(); }} />
              <span>Тумба</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={hasFlowerbed} onChange={(e) => { setHasFlowerbed(e.target.checked); markDirty(); }} />
              <span>Цветник</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={hasVase} onChange={(e) => { setHasVase(e.target.checked); markDirty(); }} />
              <span>Ваза</span>
            </label>
          </div>
        </div>
      </LoudAccordion>

      {/* 2) Надгробная плита — один аккордеон с чекбоксом в заголовке */}
      <LoudAccordion title={plateTitle} open={accPlateOpen} onToggle={() => setAccPlateOpen(v => !v)}>
        <div style={{ display: "grid", gap: 12, opacity: extraPlate ? 1 : 0.6 }}>
          {!extraPlate && (
            <div style={{ ...sectionBox }}>
              Включите плиту (чекбокс в заголовке), чтобы настроить параметры.
            </div>
          )}

          {extraPlate && (
            <>
              <div style={{ ...sectionBox }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-size" checked={plateSize === v} onChange={() => { setPlateSize(v); markDirty(); }} />
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
                {plateSize === "Свой вариант" && (
                  <input value={plateCustomSize} onChange={(e) => { setPlateCustomSize(e.target.value); markDirty(); }} placeholder="Укажите свой размер (например, 130×60 см)" style={inputStyle()} />
                )}
              </div>

              <div style={{ ...sectionBox }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-thickness" checked={plateThickness === v} onChange={() => { setPlateThickness(v); markDirty(); }} />
                      <span>{v}</span>
                    </label>
                  ))}
                </div>
                {plateThickness === "Свой вариант" && (
                  <input value={plateCustomThickness} onChange={(e) => { setPlateCustomThickness(e.target.value); markDirty(); }} placeholder="Укажите толщину (например, 7 см)" style={inputStyle()} />
                )}
              </div>

              <div style={{ ...sectionBox }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                    <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => { setPlateOrientation(v); markDirty(); }} />
                      <span>{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen(v => !v)}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ ...sectionBox }}>
                    <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                    <textarea rows={3} value={plateEpitaph} onChange={(e) => { setPlateEpitaph(e.target.value); markDirty(); }} placeholder="Введите текст…" style={{ ...inputStyle(), resize: "vertical" }} />
                  </div>
                  <div>
                    <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {QUICK_EPITAPHS.map((t) => (
                        <button key={t} type="button" onClick={() => {
                          const list = toParagraphs(plateEpitaph);
                          const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
                          const exists = list.some((s) => norm(s) === norm(t));
                          const next = exists ? list.filter((s) => norm(s) !== norm(t)) : list.concat([t]);
                          setPlateEpitaph(next.join("\n\n")); markDirty();
                        }} style={glassButtonStyle("nano")} title={t}>{t}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </LoudAccordion>

              <LoudAccordion title="Графика на плите" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen(v => !v)}>
                {catsLoading && <div>Загрузка каталога…</div>}
                {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
                {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}
                {!catsLoading && cats.length > 0 && (
                  <div style={{ display: "grid", gap: 12 }}>
                    {cats.map((cat: any, idx: number) => {
                      const catKey = String(cat._id || cat.name || idx);
                      const open = !!(catOpen || {})[catKey];
                      const toggle = () => setCatOpen({ ...(catOpen || {}), [catKey]: !open });
                      return (
                        <LoudAccordion key={catKey} title={cat.name || `Категория ${idx + 1}`} open={open} onToggle={toggle}>
                          <CatGrid
                            items={cat.items || []}
                            plateIds={plateIds}
                            addGraphic={(g) => { addPlateGraphic(g); markDirty(); }}
                            removeGraphic={(gid) => { removePlateGraphic(gid); markDirty(); }}
                          />
                          {(cat.children || []).map((sub: any, j: number) => (
                            <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                              <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                              <CatGrid
                                items={sub.items || []}
                                plateIds={plateIds}
                                addGraphic={(g) => { addPlateGraphic(g); markDirty(); }}
                                removeGraphic={(gid) => { removePlateGraphic(gid); markDirty(); }}
                              />
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
      </LoudAccordion>
    </div>
  );
}

/* ===== Индикатор обработки (оверлей) ===== */
function BusyOverlay({ text = "Идёт обработка…" }: { text?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111", color: "#fff", padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", minWidth: 220, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div className="spinner" style={{ margin: "0 auto 10px", width: 28, height: 28, border: "3px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <div>{text}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}

/* ===== Подсказка после отправки (в самый низ) ===== */
function AfterSendHint({ customerName, onSavePdf, saving }: { customerName?: string; onSavePdf: () => void; saving: boolean }) {
  const name = (customerName || "").trim();
  return (
    <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
      <div style={{ opacity: 0.92, marginBottom: 10 }}>
        {`Спасибо${name ? `, ${name}` : ""}! Сохраните PDF заказа при необходимости.`}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onPointerUp={onSavePdf} onClick={onSavePdf} disabled={saving} style={glassButtonStyle("sm", saving)} title="Сохранить PDF заказ">
          {saving ? "Формируем PDF…" : "Сохранить PDF"}
        </button>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
        Примечание: генерация PDF может занять до 5–10 секунд. Пожалуйста, подождите.
      </div>
    </section>
  );
}

/* ===== Окно-успех после отправки ===== */
function SuccessBottomSheet({ customerName, onClose, onSave, saving }: { customerName?: string; onClose: () => void; onSave: () => void; saving: boolean }) {
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  const name = (customerName || "").trim();
  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 15000, background: "rgba(0,0,0,0.35)" }} onPointerUp={onClose}>
      <div
        onPointerUp={stop}
        onClick={stop as any}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111",
          borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16,
          boxShadow: "0 -20px 60px rgba(0,0,0,0.45)", transform: "translateY(8px)", opacity: 0,
          animation: "sheetIn 180ms ease forwards"
        }}
      >
        <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <button onPointerUp={onClose} onClick={onClose} title="Закрыть" className="btn">×</button>
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6, color: "#0a7f2e" }}>Заявка отправлена</div>
        <div style={{ marginBottom: 12 }}>
          {`Спасибо${name ? `, ${name}` : ""}! Сохраните PDF заказа при необходимости.`}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn" onPointerUp={onSave} onClick={onSave} disabled={saving} style={{ background: "#eef6ff", borderColor: "#9cc4ff" }}>
            {saving ? "Формируем PDF…" : "Сохранить PDF"}
          </button>
          <button className="btn" onPointerUp={onClose} onClick={onClose} style={{ background: "#f7f7f7" }}>Готово</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Окно подтверждения отправки ===== */
function ConfirmBottomSheet({ onClose, onSend, sending }: { onClose: () => void; onSend: () => void; sending: boolean }) {
  const onBackdropPointer = () => { if (!sending) onClose(); };
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }} onPointerUp={onBackdropPointer}>
      <div
        onPointerUp={stop}
        onClick={stop as any}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111",
          borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16,
          boxShadow: "0 -20px 60px rgba(0,0,0,0.45)", transform: "translateY(8px)", opacity: 0,
          animation: "sheetIn 180ms ease forwards"
        }}
      >
        <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <button onPointerUp={onClose} onClick={onClose} title="Закрыть" className="btn" disabled={sending}>×</button>
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам для просчёта стоимости?</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onPointerUp={onSend} onClick={onSend} disabled={sending} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>
            {sending ? "Отправляем…" : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Основной компонент ===== */
type Props = { onBack?: () => void };

// helper: URL тыльной стороны (null если пусто/заглушка)
function getBackSketchUrl(draft: any): string | null {
  const raw = String((draft?.editorBack?.previewHiUrl || draft?.editorBack?.previewUrl || "") ?? "").trim();
  if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
  return raw;
}

// helper: есть ли содержимое на тыльной стороне (графика/эпитафия/метрика/портрет)
function hasBackContent(draft: any): boolean {
  const eb = (draft as any)?.editorBack || {};
  const engr = (draft as any)?.engraving || {};

  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const str = (v: any) => (typeof v === "string" ? v : "");
  const nonEmptyText = (v: any) => toParagraphs(v).length > 0;

  const graphics =
    arr((draft as any)?.graphicsBack).length > 0 ||
    arr((eb as any)?.graphics).length > 0 ||
    arr((eb as any)?.items).length > 0 ||
    arr((eb as any)?.layers).length > 0 ||
    arr((eb as any)?.objects).length > 0;

  const epitaph =
    nonEmptyText(str((engr as any)?.backEpitaph)) ||
    nonEmptyText(str((engr as any)?.epitaphBack)) ||
    nonEmptyText(arr((engr as any)?.backEpitaphs).join("\n\n"));

  const portraits =
    arr((draft as any)?.portraitsBack).length > 0 ||
    arr((eb as any)?.portraits).length > 0;

  const metrics =
    !!str((engr as any)?.metricsBack).trim() ||
    !!str((engr as any)?.backMetrics).trim() ||
    arr((engr as any)?.metricsBack).length > 0;

  return !!(graphics || epitaph || portraits || metrics);
}

export default function ReviewAndSendStep({ onBack }: Props) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);

  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    const markDirtyOnDraft = () => { if (sentOk) setIsDirtyAfterSend(true); refresh(); };
    window.addEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
  }, []);

  const orderNo = String(introState.orderNumber || "").trim();
  const customerName = (introState.intro?.customerName || "").trim();
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  const openTopbar = () => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-controls="order-panel"]');
    if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Тыльная сторона: показываем только если есть содержимое и картинка реально подгрузилась
  const [backCandidateUrl, setBackCandidateUrl] = useState<string | null>(getBackSketchUrl(draft));
  useEffect(() => { setBackCandidateUrl(getBackSketchUrl(draft)); }, [draft]);

  const hasBackContentFlag = useMemo(() => hasBackContent(draft), [draft]);

  const [backImageOk, setBackImageOk] = useState<boolean>(false);
  useEffect(() => {
    if (!backCandidateUrl) { setBackImageOk(false); return; }
    let cancelled = false;
    const im = new Image();
    im.onload = () => { if (!cancelled) setBackImageOk((im.naturalWidth || 0) > 5 && (im.naturalHeight || 0) > 5); };
    im.onerror = () => { if (!cancelled) setBackImageOk(false); };
    im.src = backCandidateUrl;
    return () => { cancelled = true; };
  }, [backCandidateUrl]);

  const showBack = hasBackContentFlag && backImageOk;

  // Эскизы и данные лицевой
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(() => frontPersons.map((p: any, i: number) => ({
    id: p.id || `p-${i}`,
    lines: personLines(p),
    photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
  })), [frontPersons]);

  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => ((g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross"));
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  // Плита (сохранение/состояние)
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(extras0.plateOrientation || (((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h")) ? "horizontal" : "vertical"));
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});

  // Дополнительно: тумба, цветник, ваза (тумба по умолчанию включена)
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // helper: сохраняем extras в черновик
  function persistExtras(patch: Record<string, any>) {
    const prev = loadOrderDraft();
    const nextExtras = { ...(prev as any).extras, ...patch };
    saveOrderDraft({ ...prev, extras: nextExtras, updatedAt: Date.now() });
    setDraft(loadOrderDraft());
    if (sentOk) setIsDirtyAfterSend(true);
  }

  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    setPlateIds((prev) => prev.concat(gid));
    setPlateMeta((m) => ({ ...m, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } }));
  };
  const removePlateGraphic = (gid: string) => {
    setPlateIds((prev) => {
      const i = prev.findIndex((x) => x === gid);
      if (i === -1) return prev;
      const next = prev.slice(); next.splice(i, 1); return next;
    });
  };

  // Каталог для плиты
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
      } catch { if (alive) setCatsError("Не удалось загрузить каталог графики."); }
      finally { if (alive) setCatsLoading(false); }
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

  // Выбранные позиции для плиты (для «Выбрано для плиты»)
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

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  // Bottom sheets и статусы
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);

  // ===== Генерация/сохранение PDF =====
  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));
      const blob = await generateOrderPdf({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: showBack ? document.getElementById("pdf-back-sketch") : null,
        backUrlFallback: showBack ? backCandidateUrl : null
      });
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } catch (e: any) { alert(e?.message || "Не удалось сформировать PDF."); }
    finally { setIsSaving(false); }
  }

  async function handleSendPdf() {
    if (isSending) return;
    try {
      setIsSending(true);
      await new Promise((r) => setTimeout(r, 0));
      const blob = await generateOrderPdf({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: showBack ? document.getElementById("pdf-back-sketch") : null,
        backUrlFallback: showBack ? backCandidateUrl : null
      });
      await sendPdfToServer(blob, {
        orderNo: String(loadIntroState().orderNumber || "").trim(),
        intro: loadIntroState().intro || {},
        extras: (loadOrderDraft() as any)?.extras || {}
      });

      setConfirmOpen(false);
      setSentOk(true);
      setSuccessOpen(true);
      setIsDirtyAfterSend(false);

      setTimeout(() => { afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, 150);
    } catch (e: any) { alert(e?.message || "Не удалось отправить PDF."); }
    finally { setIsSending(false); }
  }

  const showBottomButtons = !sentOk || isDirtyAfterSend;

  return (
    <div style={safeRoot()}>
      {/* TopBar */}
      <TopBarWithIntro title="Memorial" />

      {/* № заказа + линк справа */}
      <EditableOrderSummary orderNo={orderNo} onOpenTop={openTopbar} onDirty={() => sentOk && setIsDirtyAfterSend(true)} />

      {/* Аккордеоны: Дополнительно + Надгробная плита (с чекбоксом в заголовке) */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => { setExtraPlate(v); persistExtras({ headstonePlate: v }); }}
          plateSize={plateSize} setPlateSize={(v) => { setPlateSize(v); if (sentOk) setIsDirtyAfterSend(true); }}
          plateCustomSize={plateCustomSize} setPlateCustomSize={(v) => { setPlateCustomSize(v); if (sentOk) setIsDirtyAfterSend(true); }}
          plateThickness={plateThickness} setPlateThickness={(v) => { setPlateThickness(v); if (sentOk) setIsDirtyAfterSend(true); }}
          plateCustomThickness={plateCustomThickness} setPlateCustomThickness={(v) => { setPlateCustomThickness(v); if (sentOk) setIsDirtyAfterSend(true); }}
          plateOrientation={plateOrientation} setPlateOrientation={(v) => { setPlateOrientation(v); if (sentOk) setIsDirtyAfterSend(true); }}
          plateEpitaph={plateEpitaph} setPlateEpitaph={(v) => { setPlateEpitaph(v); if (sentOk) setIsDirtyAfterSend(true); }}
          catsLoading={catsLoading} catsError={catsError} cats={cats}
          catOpen={catOpen} setCatOpen={setCatOpen}
          addPlateGraphic={(g) => { addPlateGraphic(g); if (sentOk) setIsDirtyAfterSend(true); }}
          removePlateGraphic={(gid) => { removePlateGraphic(gid); if (sentOk) setIsDirtyAfterSend(true); }}
          plateIds={plateIds}
          hasPedestal={hasPedestal} setHasPedestal={(v) => { setHasPedestal(v); persistExtras({ tumba: v }); }}
          hasFlowerbed={hasFlowerbed} setHasFlowerbed={(v) => { setHasFlowerbed(v); persistExtras({ flowerbed: v }); }}
          hasVase={hasVase} setHasVase={(v) => { setHasVase(v); persistExtras({ vase: v }); }}
          onDirty={() => sentOk && setIsDirtyAfterSend(true)}
        />
      </section>

      {/* Эскиз лицевой стороны */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
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
      </section>

      {/* Тыльная — показываем только при наличии содержимого и корректной картинки */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img id="pdf-back-sketch" src={backCandidateUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* ВЫБРАНО ДЛЯ ПЛИТЫ — ПЕРЕНЕСЕНО ВНИЗ прямо над «Комментарий к заказу» */}
      {extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                {chosenPlateList.map((g, i) => (
                  <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8, alignItems: "center" }}>
                    <Thumb url={g.url} />
                    <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || g.id}</div>
                  </div>
                ))}
              </div>
            )}
            {plateEpitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {plateEpitaphList.map((t, idx) => (
                  <div key={`plate-ep-${idx}`} style={{ ...sectionBox, padding: 8 }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Комментарий */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>Комментарий к заказу</label>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
          Не беспокойтесь: даже при отсутствии нужного пункта финальное подтверждение — по телефону или лично.
        </div>
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={(extras0.orderNotes || "").trim()}
          onBlur={(e) => {
            const prev = loadOrderDraft();
            const extras: any = { ...(prev as any).extras, orderNotes: (e.target.value || "").trim() || undefined };
            saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
            setDraft(loadOrderDraft());
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          placeholder="Добавьте комментарий…"
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </section>

      {/* Кнопки (низ) */}
      {showBottomButtons && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
          <button type="button" onPointerUp={onBack} onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
          <button type="button" onPointerUp={() => setConfirmOpen(true)} onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Рассчитать стоимость</button>
        </div>
      )}

      {/* Bottom sheets */}
      {confirmOpen && (
        <ConfirmBottomSheet
          onClose={() => setConfirmOpen(false)}
          onSend={handleSendPdf}
          sending={isSending}
        />
      )}
      {successOpen && (
        <SuccessBottomSheet
          customerName={customerName}
          onClose={() => setSuccessOpen(false)}
          onSave={handleSavePdf}
          saving={isSaving}
        />
      )}

      {/* Низовая подсказка после отправки */}
      <div ref={afterHintRef}>{sentOk && <AfterSendHint customerName={customerName} onSavePdf={handleSavePdf} saving={isSaving} />}</div>

      {/* Оверлеи занятости */}
      {isSending && <BusyOverlay text="Отправляем заказ…" />}
      {isSaving && <BusyOverlay text="Формируем PDF…" />}
    </div>
  );
}
