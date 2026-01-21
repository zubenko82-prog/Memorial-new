// src/screens/BackEditorStep.tsx
// ТЫЛЬНАЯ СТОРОНА — теперь вместо редактора: "Дополнительно" + "Надгробная плита" (плита/эпитафии плиты/графика плиты)
//
// СДЕЛАНО:
// - Полностью удалён прежний редактор тыльной стороны (графика/эпитафии/люди/эскиз и т.д.) по требованию.
// - Перенесены блоки с ReviewAndSendStep:
//   - "Дополнительно" (тумба/цветник/ваза)
//   - "Надгробная плита" (размер/толщина/ориентация/графика/эпитафии, блок "Выбрано для плиты" с красной рамкой)
// - Все сохранения в draft.extras делаются ПАТЧАМИ через saveOrderDraft({ extras: ... }) и удаление через null
//   (для совместимости с обновлённым lib/order.ts).
// - TopBarWithIntro остаётся.
// - Навигация "Назад/Продолжить" сохранена (вызывает onBack/onContinue).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT, type OrderDraft } from "../lib/order";

/* ========= Styles ========= */
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.95)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  };
}
function sectionBoxStyle(): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: 10
  };
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
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false): React.CSSProperties {
  const pad = size === "nano" ? "6px 10px" : size === "sm" ? "10px 14px" : "12px 18px";
  return {
    padding: pad,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  };
}

function dispatchDraftUpdated() {
  try {
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
  } catch {}
}

function Thumb({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box"
      }}
    >
      {url ? (
        <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} />
      ) : (
        <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>
      )}
    </div>
  );
}

/* ========= Epitaph helpers ========= */
const normEpitaph = (t: string) =>
  (t || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

function indexOfByNorm(list: string[], needle: string): number {
  const n = normEpitaph(needle);
  for (let i = 0; i < list.length; i++) {
    if (normEpitaph(list[i]) === n) return i;
  }
  return -1;
}
function hasByNorm(list: string[], needle: string) {
  return indexOfByNorm(list, needle) !== -1;
}
function uniqueByNorm(list: string[]): string[] {
  const out: string[] = [];
  for (const t of list) {
    if (!hasByNorm(out, t)) out.push(t);
  }
  return out;
}

/* ========= Accordion ========= */
function LoudAccordion({
  title,
  open,
  onToggle,
  children
}: {
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const m = () => setH(ref.current?.scrollHeight || 0);
    m();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(m) : null;
    if (ref.current && ro) ro.observe(ref.current);
    return () => ro?.disconnect?.();
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
          justifyContent: "space-between",
          fontSize: 15,
          fontWeight: 700
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ========= PlateBlock (перенесён без изменений логики) ========= */
function PlateBlock(props: {
  extraPlate: boolean;
  setExtraPlate: (v: boolean) => void;

  plateSize: string;
  setPlateSize: (v: string) => void;
  plateCustomSize: string;
  setPlateCustomSize: (v: string) => void;

  plateThickness: string;
  setPlateThickness: (v: string) => void;
  plateCustomThickness: string;
  setPlateCustomThickness: (v: string) => void;

  plateOrientation: string;
  setPlateOrientation: (v: string) => void;

  plateSelectedEpitaphs: string[];
  setPlateSelectedEpitaphs: (v: string[] | ((p: string[]) => string[])) => void;
  plateShowMore: boolean;
  setPlateShowMore: (v: boolean | ((p: boolean) => boolean)) => void;
  plateCustomText: string;
  setPlateCustomText: (v: string) => void;
  onTogglePlateEpitaph: (t: string) => void;
  onAddPlateCustom: () => void;
  onRemovePlateEpitaph: (t: string) => void;

  catsLoading: boolean;
  catsError: string;
  cats: any[];
  catOpen: Record<string, boolean>;
  setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void;
  removePlateGraphic: (gid: string) => void;
  plateIds: string[];

  chosenPlateList: any[];
  onRemoveChosenPlateItem: (gid: string) => void;

  plateEpitaphList: string[];

  hasPedestal: boolean;
  setHasPedestal: (v: boolean) => void;
  hasFlowerbed: boolean;
  setHasFlowerbed: (v: boolean) => void;
  hasVase: boolean;
  setHasVase: (v: boolean) => void;

  extractPlateWidthText: () => string;

  onDirty?: () => void;
}) {
  const {
    extraPlate,
    setExtraPlate,
    plateSize,
    setPlateSize,
    plateCustomSize,
    setPlateCustomSize,
    plateThickness,
    setPlateThickness,
    plateCustomThickness,
    setPlateCustomThickness,
    plateOrientation,
    setPlateOrientation,

    plateSelectedEpitaphs,
    setPlateSelectedEpitaphs,
    plateShowMore,
    setPlateShowMore,
    plateCustomText,
    setPlateCustomText,
    onTogglePlateEpitaph,
    onAddPlateCustom,
    onRemovePlateEpitaph,

    catsLoading,
    catsError,
    cats,
    catOpen,
    setCatOpen,
    addPlateGraphic,
    removePlateGraphic,
    plateIds,

    chosenPlateList,
    onRemoveChosenPlateItem,
    plateEpitaphList,

    hasPedestal,
    setHasPedestal,
    hasFlowerbed,
    setHasFlowerbed,
    hasVase,
    setHasVase,

    extractPlateWidthText,

    onDirty
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  const plateOpen = extraPlate;
  const markDirty = () => onDirty?.();

  // сетка каталога графики
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number>(2);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth || 0;
      setCols(Math.max(2, Math.floor(w / 160)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function CatGrid({ items }: { items: any[] }) {
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
                onClick={() => {
                  addPlateGraphic(g);
                  markDirty();
                }}
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
                {thumbUrl ? (
                  <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} />
                ) : (
                  <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>
                )}
              </div>

              <div title={name} style={{ marginTop: 6, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 }}>
                {name}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    removePlateGraphic(gid);
                    markDirty();
                  }}
                  disabled={qty === 0}
                  style={glassButtonStyle("nano", qty === 0)}
                >
                  −
                </button>
                <span style={{ minWidth: 20, textAlign: "center" }}>{qty}</span>
                <button
                  type="button"
                  onClick={() => {
                    addPlateGraphic(g);
                    markDirty();
                  }}
                  style={glassButtonStyle("nano")}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const plateTitle = (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={extraPlate}
        onChange={(e) => {
          setExtraPlate(e.target.checked);
          markDirty();
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <span>Надгробная плита</span>
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <LoudAccordion title="Дополнительно" open={accExtrasOpen} onToggle={() => setAccExtrasOpen((v) => !v)}>
        <div style={sectionBoxStyle()}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasPedestal}
                onChange={(e) => {
                  setHasPedestal(e.target.checked);
                  markDirty();
                }}
              />
              <span>Тумба</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasFlowerbed}
                onChange={(e) => {
                  setHasFlowerbed(e.target.checked);
                  markDirty();
                }}
              />
              <span>Цветник</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasVase}
                onChange={(e) => {
                  setHasVase(e.target.checked);
                  markDirty();
                }}
              />
              <span>Ваза</span>
            </label>
          </div>
        </div>
      </LoudAccordion>

      <LoudAccordion
        title={plateTitle}
        open={plateOpen}
        onToggle={() => {
          setExtraPlate(!extraPlate);
          markDirty();
        }}
      >
        {extraPlate && (
          <div style={{ display: "grid", gap: 12 }}>
            {/* Выбрано для плиты (красная рамка) */}
            <div style={{ ...sectionBoxStyle(), border: "1px solid rgba(255,80,80,0.95)" }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <strong>Размер:</strong> {(plateSize === "Свой вариант" ? plateCustomSize : plateSize) || "—"}
                </div>
                <div>
                  <strong>Ширина:</strong> {extractPlateWidthText()}
                </div>
              </div>

              {chosenPlateList.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                  {chosenPlateList.map((g, i) => {
                    const gid = String(g.id || g.url || i);
                    return (
                      <div key={`chosen-${gid}-${i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 8, alignItems: "center" }}>
                        <Thumb url={g.url} />
                        <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.name || g.id}
                        </div>
                        <button
                          type="button"
                          title="Удалить"
                          onClick={() => {
                            onRemoveChosenPlateItem(String(g.id || g.name || g.url || ""));
                            markDirty();
                          }}
                          style={{
                            ...glassButtonStyle("nano"),
                            padding: "6px 10px",
                            borderColor: "rgba(255,80,80,0.9)"
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Удаление эпитафий прямо из блока "Выбрано для плиты" */}
              {plateEpitaphList.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {plateEpitaphList.map((t, idx) => (
                    <div
                      key={`plate-ep-preview-${idx}-${normEpitaph(t)}`}
                      style={{
                        ...sectionBoxStyle(),
                        padding: 8,
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 10,
                        alignItems: "start"
                      }}
                    >
                      <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                      <button
                        type="button"
                        title="Удалить эпитафию"
                        onClick={() => {
                          onRemovePlateEpitaph(t);
                          markDirty();
                        }}
                        style={{
                          ...glassButtonStyle("nano"),
                          padding: "6px 10px",
                          borderColor: "rgba(255,80,80,0.9)"
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="plate-size"
                      checked={plateSize === v}
                      onChange={() => {
                        setPlateSize(v);
                        markDirty();
                      }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateSize === "Свой вариант" && (
                <input
                  value={plateCustomSize}
                  onChange={(e) => {
                    setPlateCustomSize(e.target.value);
                    markDirty();
                  }}
                  placeholder="Укажите свой размер (например, 130×60 см)"
                  style={inputStyle()}
                />
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="plate-thickness"
                      checked={plateThickness === v}
                      onChange={() => {
                        setPlateThickness(v);
                        markDirty();
                      }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateThickness === "Свой вариант" && (
                <input
                  value={plateCustomThickness}
                  onChange={(e) => {
                    setPlateCustomThickness(e.target.value);
                    markDirty();
                  }}
                  placeholder="Укажите толщину (например, 7 см)"
                  style={inputStyle()}
                />
              )}
            </div>

            <div style={sectionBoxStyle()}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="plate-orient"
                      checked={plateOrientation === v}
                      onChange={() => {
                        setPlateOrientation(v);
                        markDirty();
                      }}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Эпитафии на плите */}
            <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {QUICK_EPITAPHS.map((t) => {
                      const active = hasByNorm(plateSelectedEpitaphs, t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            onTogglePlateEpitaph(t);
                            markDirty();
                          }}
                          style={{
                            ...glassButtonStyle("nano"),
                            border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)"
                          }}
                          title={t}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 8, textAlign: "left" }}>Еще варианты:</div>
                  <button type="button" onClick={() => setPlateShowMore((v) => !v)} style={glassButtonStyle("nano")}>
                    {plateShowMore ? "Свернуть список" : "Развернуть список"}
                  </button>

                  {plateShowMore && (
                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                        gap: 8,
                        padding: 2
                      }}
                    >
                      {MORE_EPITAPHS.map((t, idx) => {
                        const active = hasByNorm(plateSelectedEpitaphs, t);
                        return (
                          <button
                            key={`more-${idx}-${normEpitaph(t)}`}
                            type="button"
                            onClick={() => {
                              onTogglePlateEpitaph(t);
                              markDirty();
                            }}
                            title={t}
                            style={{
                              textAlign: "left",
                              ...glassPanelStyle(),
                              borderRadius: 10,
                              padding: 10,
                              cursor: "pointer",
                              outline: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)",
                              fontSize: 13,
                              lineHeight: 1.25,
                              whiteSpace: "pre-wrap"
                            }}
                          >
                            {t}
                            <div style={{ marginTop: 6, fontSize: 12 }}>{active ? "Удалить из выбранных" : "Добавить к выбранным"}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 6, textAlign: "left" }}>Свой вариант:</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <textarea
                      rows={3}
                      value={plateCustomText}
                      onChange={(e) => setPlateCustomText(e.target.value)}
                      placeholder="Введите текст и нажмите «Добавить»"
                      style={{ ...inputStyle(), resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        style={glassButtonStyle("nano")}
                        onClick={() => {
                          onAddPlateCustom();
                          markDirty();
                        }}
                      >
                        Добавить
                      </button>
                      <button
                        type="button"
                        style={glassButtonStyle("nano")}
                        onClick={() => {
                          setPlateSelectedEpitaphs([]);
                          markDirty();
                        }}
                      >
                        Очистить выбранные
                      </button>
                      {plateSelectedEpitaphs.length > 0 && <div>Выбрано: {plateSelectedEpitaphs.length}</div>}
                    </div>
                  </div>
                </div>

                {plateSelectedEpitaphs.length > 0 && (
                  <div style={sectionBoxStyle()}>
                    <div style={{ marginBottom: 6, textAlign: "left" }}>Выбранные эпитафии:</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {plateSelectedEpitaphs.map((t, idx) => (
                        <div
                          key={`sel-${idx}-${normEpitaph(t)}`}
                          style={{
                            ...glassPanelStyle(),
                            borderRadius: 10,
                            padding: 10,
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            justifyContent: "space-between"
                          }}
                        >
                          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                          <button
                            type="button"
                            style={glassButtonStyle("nano")}
                            onClick={() => {
                              onRemovePlateEpitaph(t);
                              markDirty();
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </LoudAccordion>

            <LoudAccordion title="Графика на плите" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen((v) => !v)}>
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
                        <CatGrid items={cat.items || []} />
                        {(cat.children || []).map((sub: any, j: number) => (
                          <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                            <CatGrid items={sub.items || []} />
                          </div>
                        ))}
                      </LoudAccordion>
                    );
                  })}
                </div>
              )}
            </LoudAccordion>
          </div>
        )}
      </LoudAccordion>
    </div>
  );
}

/* ========= Step component ========= */
type Props = { onBack?: () => void; onContinue?: (payload?: any) => void };

export default function BackEditorStep({ onBack, onContinue }: Props) {
  const [outro, setOutro] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());

  useEffect(() => {
    const sync = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // ===== Plate state (из draft.extras) =====
  const extras0: any = (draft as any)?.extras || {};

  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(
    extras0.plateOrientation ||
      (((draft?.size?.orientation || (draft as any)?.orientation || "") as string).toLowerCase().startsWith("h") ? "horizontal" : "vertical")
  );

  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // ===== Plate epitaphs =====
  const initialPlateSelected = useMemo(() => {
    const d = loadOrderDraft();
    const ex: any = (d as any)?.extras || {};
    const arr: string[] | undefined = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : undefined;
    const single: string | undefined = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? ex.plateEpitaph.trim() : undefined;
    return uniqueByNorm((arr && arr.length ? arr : single ? [single] : []) as string[]);
  }, []);

  const [plateSelectedEpitaphs, setPlateSelectedEpitaphs] = useState<string[]>(initialPlateSelected);
  const [plateShowMore, setPlateShowMore] = useState(false);
  const [plateCustomText, setPlateCustomText] = useState("");
  const plateEpitaphList = useMemo(() => plateSelectedEpitaphs, [plateSelectedEpitaphs]);

  // Persist plate epitaphs to draft.extras (патчами; удаление через null)
  const prevPlateEpiJsonRef = useRef<string>("");
  useEffect(() => {
    const list = uniqueByNorm(plateSelectedEpitaphs);

    const patchExtras: any = {};
    if (list.length === 0) {
      patchExtras.plateEpitaph = null;
      patchExtras.plateEpitaphs = null;
      patchExtras.plateEpitaphTexts = null;
    } else if (list.length === 1) {
      patchExtras.plateEpitaph = list[0];
      patchExtras.plateEpitaphs = null;
      patchExtras.plateEpitaphTexts = null;
    } else {
      patchExtras.plateEpitaph = null;
      patchExtras.plateEpitaphs = list.slice();
      patchExtras.plateEpitaphTexts = null;
    }

    const snapshot = JSON.stringify(patchExtras);
    if (snapshot !== prevPlateEpiJsonRef.current) {
      prevPlateEpiJsonRef.current = snapshot;
      saveOrderDraft({ extras: patchExtras } as any);
      dispatchDraftUpdated();
      setDraft(loadOrderDraft());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateSelectedEpitaphs]);

  // ===== Catalog for plate graphics =====
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      setCatsLoading(true);
      setCatsError("");
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
    return () => {
      alive = false;
    };
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
      const collect = (arr: any[]) =>
        (arr || []).forEach((it: any) => {
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

  function extractPlateWidthText(): string {
    const effective = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
    if (!effective) return "—";
    const m = effective.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (m) return `${m[2]} см`;
    const n = effective.match(/(\d+)\s*см/);
    if (n) return `${n[1]} см`;
    return effective;
  }

  const removeChosenPlateOne = (gidRaw: string) => {
    const gid = String(gidRaw || "").trim();
    if (!gid) return;

    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;

    const nextIds = plateIds.slice();
    nextIds.splice(idx, 1);
    setPlateIds(nextIds);

    saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease", maxWidth: 600, margin: "0 auto" }}>
      <TopBarWithIntro title="Тыл" />

      {/* Вместо редактора — блоки плиты */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => {
            setExtraPlate(v);
            saveOrderDraft({ extras: { headstonePlate: v } as any });
            dispatchDraftUpdated();
          }}
          plateSize={plateSize}
          setPlateSize={(v) => {
            setPlateSize(v);
            saveOrderDraft({ extras: { plateSize: v } as any });
            dispatchDraftUpdated();
          }}
          plateCustomSize={plateCustomSize}
          setPlateCustomSize={(v) => {
            setPlateCustomSize(v);
            saveOrderDraft({ extras: { plateCustomSize: v } as any });
            dispatchDraftUpdated();
          }}
          plateThickness={plateThickness}
          setPlateThickness={(v) => {
            setPlateThickness(v);
            saveOrderDraft({ extras: { plateThickness: v } as any });
            dispatchDraftUpdated();
          }}
          plateCustomThickness={plateCustomThickness}
          setPlateCustomThickness={(v) => {
            setPlateCustomThickness(v);
            saveOrderDraft({ extras: { plateCustomThickness: v } as any });
            dispatchDraftUpdated();
          }}
          plateOrientation={plateOrientation}
          setPlateOrientation={(v) => {
            setPlateOrientation(v);
            saveOrderDraft({ extras: { plateOrientation: v } as any });
            dispatchDraftUpdated();
          }}
          plateSelectedEpitaphs={plateSelectedEpitaphs}
          setPlateSelectedEpitaphs={setPlateSelectedEpitaphs}
          plateShowMore={plateShowMore}
          setPlateShowMore={setPlateShowMore}
          plateCustomText={plateCustomText}
          setPlateCustomText={setPlateCustomText}
          onTogglePlateEpitaph={(text) => {
            const t = normEpitaph(text);
            if (!t) return;
            setPlateSelectedEpitaphs((prev) => {
              const idx = indexOfByNorm(prev, t);
              if (idx !== -1) return prev.filter((_, i) => i !== idx);
              return prev.concat([text]);
            });
          }}
          onAddPlateCustom={() => {
            const raw = (plateCustomText || "").trim();
            const t = normEpitaph(raw);
            if (!t) return;
            setPlateSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
            setPlateCustomText("");
          }}
          onRemovePlateEpitaph={(text) => {
            setPlateSelectedEpitaphs((prev) => {
              const idx = indexOfByNorm(prev, text);
              return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
            });
          }}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpen}
          setCatOpen={setCatOpen}
          addPlateGraphic={(g) => {
            const gid = String(g.id || g.relPath || g.url || g.name);
            const nextIds = [...plateIds, gid];
            const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };

            setPlateIds(nextIds);
            setPlateMeta(nextMeta);

            saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;

            const nextIds = plateIds.slice();
            nextIds.splice(idx, 1);
            setPlateIds(nextIds);

            saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta } as any });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
          }}
          plateIds={plateIds}
          chosenPlateList={chosenPlateList}
          onRemoveChosenPlateItem={removeChosenPlateOne}
          plateEpitaphList={plateEpitaphList}
          hasPedestal={hasPedestal}
          setHasPedestal={(v) => {
            setHasPedestal(v);
            saveOrderDraft({ extras: { tumba: v } as any });
            dispatchDraftUpdated();
          }}
          hasFlowerbed={hasFlowerbed}
          setHasFlowerbed={(v) => {
            setHasFlowerbed(v);
            saveOrderDraft({ extras: { flowerbed: v } as any });
            dispatchDraftUpdated();
          }}
          hasVase={hasVase}
          setHasVase={(v) => {
            setHasVase(v);
            saveOrderDraft({ extras: { vase: v } as any });
            dispatchDraftUpdated();
          }}
          extractPlateWidthText={extractPlateWidthText}
          onDirty={() => void 0}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            setOutro(true);
            setTimeout(() => onBack?.(), 320);
          }}
          style={glassButtonStyle("sm")}
        >
          Назад
        </button>

        <button
          type="button"
          onClick={() => {
            setOutro(true);
            setTimeout(() => onContinue?.(), 320);
          }}
          style={glassButtonStyle("sm")}
        >
          Продолжить
        </button>
      </div>
    </div>
  );
}
