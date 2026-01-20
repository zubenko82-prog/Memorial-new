// src/screens/ReviewAndSendStep.tsx
//
// Шаг «Обзор и подтверждение»
//
// ИСПРАВЛЕНИЯ ПО ЗАПРОСУ:
// 1) Топбар открывается при входе на шаг и держится открытым:
//    - делаем "force open" через событие memorial:openTopBarPanel в цикле
//    - цикл останавливаем, когда видим, что в DOM появился раскрытый panel ([data-topbar-panel="1"])
//    - на focus/visibilitychange снова принудительно открываем
//    ВАЖНО: это не требует изменения TopBarWithIntro и не зависит от ack-события.
//
// 2) Блок «Выбрано для плиты» переносим ПОД аккордеон «Надгробная плита» (внутрь PlateBlock),
//    выделяем обводкой красной толщины 1px (как прочие).
//    Добавляем возможность удалить выбранную графику (кнопка × у элемента).
//
// 3) Исправляем удаление эпитафий на плите:
//    - раньше удаление могло не работать из-за key={t} (для одинаковых строк) и/или рассинхронизации.
//    - теперь key стабильный: `${idx}-${normEpitaph(t)}`
//    - persist в draft.extras всегда обновляет extras.plateEpitaph/plateEpitaphs и диспатчит DRAFT_UPDATED_EVENT
//
// 4) Топбар теперь видит изменения эпитафий плиты и графики, потому что мы:
//    - сохраняем в localStorage через saveOrderDraft
//    - диспатчим DRAFT_UPDATED_EVENT после каждого save (TopBarWithIntro слушает его)
//
// 5) Скриншот включает и кнопку TopBarWithIntro, и раскрытую панель:
//    - TopBarWithIntro обёрнут в #topbar-shot-root
//    - снимаем #topbar-shot-root
//    - перед скрином дополнительно принудительно открываем и ждём появления data-topbar-panel="1"

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import { generateOrderPdf, downloadBlob } from "../lib/pdf/generateOrderPdf";
import { compressImageFileToMaxBytes } from "../lib/media/resize";

/* ========= Styles and helpers ========= */
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
const sectionBox: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 10,
  padding: 10
};

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

function BusyOverlay({ text = "Идёт обработка…" }: { text?: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          background: "#111",
          color: "#fff",
          padding: 16,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.2)",
          minWidth: 220,
          textAlign: "center",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
        }}
      >
        <div
          className="spinner"
          style={{
            margin: "0 auto 10px",
            width: 28,
            height: 28,
            border: "3px solid rgba(255,255,255,0.35)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite"
          }}
        />
        <div>{text}</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}

/* ========= Utils ========= */
function personLines(p: any): string[] {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}
function toParagraphs(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map((s) => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map((s) => s.trim()).filter(Boolean);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ===== Plate epitaph helpers (как в EpitaphStep) ===== */
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

function dispatchDraftUpdated() {
  try {
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
  } catch {}
}

/* ========= Top hint ========= */
function TopHintNotice() {
  return (
    <div
      role="note"
      aria-live="polite"
      style={{
        margin: "10px 0",
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.25)",
        color: "#ddd",
        fontWeight: 400,
        fontStyle: "italic"
      }}
    >
      Если необходимо внести изменения — вернитесь к соответствующему шагу. Воспользуйтесь навигацией вверху.
    </div>
  );
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

/* ========= PlateBlock ========= */
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

  // Epitaph list UI
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
        <div style={{ ...sectionBox }}>
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
            {/* ПОД АККОРДЕОНОМ "НАДГРОБНАЯ ПЛИТА" — блок выбранного (с красной рамкой) */}
            <div
              style={{
                ...sectionBox,
                border: "1px solid rgba(255,80,80,0.95)" // красная, толщина 1px
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div><strong>Размер:</strong> {(plateSize === "Свой вариант" ? plateCustomSize : plateSize) || "—"}</div>
                <div><strong>Ширина:</strong> {extractPlateWidthText()}</div>
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
                          onClick={() => onRemoveChosenPlateItem(String(g.id || g.name || g.url || ""))}
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

              {plateEpitaphList.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {plateEpitaphList.map((t, idx) => (
                    <div key={`plate-ep-preview-${idx}-${normEpitaph(t)}`} style={{ ...sectionBox, padding: 8 }}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...sectionBox }}>
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

            <div style={{ ...sectionBox }}>
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

            <div style={{ ...sectionBox }}>
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

            {/* ===== Эпитафии на плите ===== */}
            <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ ...sectionBox }}>
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

                <div style={{ ...sectionBox }}>
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
                            <div style={{ marginTop: 6, fontSize: 12 }}>
                              {active ? "Удалить из выбранных" : "Добавить к выбранным"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ ...sectionBox }}>
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
                  <div style={{ ...sectionBox }}>
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

/* ========= Sending helpers ========= */
const TARGET_FILE_BYTES = Math.floor(2.7 * 1024 * 1024);
const TELEGRAM_CHUNK_SIZE = 3500;

async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if ((window as any).htmlToImage) return (window as any).htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("html-to-image load error"));
    document.head.appendChild(s);
  });
  if (!(window as any).htmlToImage) throw new Error("html-to-image unavailable");
  return (window as any).htmlToImage;
}
async function elementToPngDataUrl(node: HTMLElement | null, opts?: { pixelRatio?: number; bg?: string }): Promise<string | null> {
  if (!node) return null;
  const hti = await ensureHtmlToImage();
  return await hti.toPng(node, {
    backgroundColor: opts?.bg || "#ffffff",
    pixelRatio: Math.max(1, Math.min(2, opts?.pixelRatio || 2)),
    cacheBust: true
  });
}
function dataUrlToFile(dataUrl: string, name = "image.png"): File {
  const arr = dataUrl.split(",");
  const mime = (arr[0].match(/data:(.*);base64/) || [])[1] || "image/png";
  const bin = atob(arr[1] || "");
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: mime });
}

/* ========= Main component ========= */
export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);

  const customerName = (introState.intro?.customerName || "").trim();
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  // Telegram expand (высота webview) при переходе
  useEffect(() => {
    let alive = true;
    const run = () => {
      try {
        const tg = (window as any)?.Telegram?.WebApp;
        tg?.ready?.();
        tg?.expand?.();
        tg?.requestViewport?.();
      } catch {}
    };
    const t1 = setTimeout(() => alive && run(), 0);
    const t2 = setTimeout(() => alive && run(), 120);
    const t3 = setTimeout(() => alive && run(), 400);
    const t4 = setTimeout(() => alive && run(), 900);
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      setDraft(loadOrderDraft());
      setIntroState(loadIntroState());
    };
    const markDirtyOnDraft = () => {
      if (sentOk) setIsDirtyAfterSend(true);
      refresh();
    };
    window.addEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
  }, []);

  // ===== Force open TopBarWithIntro & keep open (DOM-based) =====
  useEffect(() => {
    let alive = true;

    const isOpen = () => !!document.querySelector('[data-topbar-panel="1"]');
    const openTopbar = () => {
      try {
        window.dispatchEvent(new Event("memorial:openTopBarPanel"));
      } catch {}
    };

    // Запускаем частые попытки, пока не увидим DOM-панель
    openTopbar();
    const timer = window.setInterval(() => {
      if (!alive) return;
      if (isOpen()) return;
      openTopbar();
    }, 120);

    const onFocus = () => openTopbar();
    const onVisible = () => {
      if (document.visibilityState === "visible") openTopbar();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ===== Back sketch: detect "empty" by actual image size =====
  function getBackSketchUrl(d: any): string | null {
    const raw = String((d?.editorBack?.previewHiUrl || d?.editorBack?.previewUrl || "") ?? "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }
  const [backCandidateUrl, setBackCandidateUrl] = useState<string | null>(getBackSketchUrl(draft));
  useEffect(() => setBackCandidateUrl(getBackSketchUrl(draft)), [draft]);

  const [backIsRenderable, setBackIsRenderable] = useState(false);
  useEffect(() => {
    setBackIsRenderable(false);
    if (!backCandidateUrl) return;

    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      setBackIsRenderable(w >= 50 && h >= 50);
    };
    img.onerror = () => {
      if (!alive) return;
      setBackIsRenderable(false);
    };
    img.crossOrigin = "anonymous";
    img.src = backCandidateUrl;
    return () => {
      alive = false;
    };
  }, [backCandidateUrl]);

  const showBack = !!backCandidateUrl && backIsRenderable;

  // Front
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => {
      if (im.naturalWidth && im.naturalHeight) setAspect(`${im.naturalWidth} / ${im.naturalHeight}`);
    };
    im.src = itemUrl;
  }, [itemUrl]);

  // Люди на эскизе — с фото
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const peopleBlocks = useMemo(
    () =>
      frontPersons.map((p: any, i: number) => ({
        id: p.id || `p-${i}`,
        lines: personLines(p),
        photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
      })),
    [frontPersons]
  );

  // Графика лицевой
  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) =>
    (g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross");
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  // ===== Plate state =====
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(
    extras0.plateOrientation ||
      ((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h") ? "horizontal" : "vertical")
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

  // Persist plate epitaphs to draft.extras (+ dispatch event so TopBar refreshes)
  const prevPlateEpiJsonRef = useRef<string>("");
  useEffect(() => {
    const list = uniqueByNorm(plateSelectedEpitaphs);
    const prevAll = loadOrderDraft();
    const exPrev: any = { ...(prevAll as any).extras };

    const exNext: any = { ...exPrev };
    delete exNext.plateEpitaph;
    delete exNext.plateEpitaphs;

    if (list.length === 1) {
      exNext.plateEpitaph = list[0];
    } else if (list.length > 1) {
      exNext.plateEpitaphs = list.slice();
    }

    const snapshot = JSON.stringify({ extras: exNext });
    if (snapshot !== prevPlateEpiJsonRef.current) {
      prevPlateEpiJsonRef.current = snapshot;
      saveOrderDraft({ ...prevAll, extras: exNext, updatedAt: Date.now() });
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

  // ===== Sending state =====
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [topbarDelivered, setTopbarDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  // ===== Helpers =====
  function extractPlateWidthText(): string {
    const effective = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
    if (!effective) return "—";
    const m = effective.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (m) return `${m[2]} см`;
    const n = effective.match(/(\d+)\s*см/);
    if (n) return `${n[1]} см`;
    return effective;
  }

  // ===== Telegram API (/api/tg) =====
  async function sendManagerMessage(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch("/api/tg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manager_message", text })
      });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {}
      return { ok: !!(resp.ok && json?.ok), error: json?.error || json?.description || raw || resp.statusText };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function sendManagerPhoto(fd: FormData): Promise<{ ok: boolean; error?: string }> {
    try {
      fd.append("action", "manager_photo");
      const resp = await fetch("/api/tg", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {}
      if (resp.ok && json?.ok) return { ok: true };
      return { ok: false, error: json?.error || json?.description || raw || resp.statusText };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function sendDmToUser(userId: number, text: string): Promise<void> {
    try {
      await fetch("/api/tg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dm", userId, text })
      });
    } catch {
      // ignore
    }
  }

  function startMarkerText(no: string): string {
    const n = no || "—";
    return `🪦 НАЧАЛО ЗАЯВКИ №${n}`;
  }
  function endMarkerText(no: string): string {
    const n = no || "—";
    return `🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${n}`;
  }

  function buildOrderText(): string {
    const intro = loadIntroState();
    const d = loadOrderDraft();

    const persons = (((d?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      last: (p?.lastName || "").trim(),
      namePatr: [p?.firstName, p?.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" "),
      dates: [p?.birthDate, p?.deathDate].map((s: string) => (s || "").trim()).filter(Boolean).join(" — ")
    }));

    const lines: string[] = [];
    lines.push(intro?.orderNumber ? `Заявка №${intro.orderNumber}` : "Заявка", "");

    lines.push("Клиент:");
    lines.push(`- Имя: ${(intro?.intro?.customerName || "").trim() || "—"}`);
    lines.push(`- Телефон: ${(intro?.intro?.customerPhone || "").trim() || "—"}`);
    if ((intro?.intro?.customerNotes || "").trim()) lines.push(`- Примечание: ${(intro?.intro?.customerNotes || "").trim()}`);
    lines.push("");

    const itemName = String((d as any)?.item?.name || "").trim();
    if (itemName) {
      lines.push("Изделие:");
      lines.push(`- Модель: ${itemName}`);
      lines.push("");
    }

    lines.push("Люди:");
    if (persons.length === 0) lines.push("- —");
    else {
      persons.forEach((p) => {
        const fio = [p.last, p.namePatr].filter(Boolean).join(" ");
        lines.push(`- ${fio || "—"}`);
        if (p.dates) lines.push(`  ${p.dates}`);
      });
    }
    lines.push("");

    if (extraPlate) {
      const pSize = plateSize === "Свой вариант" ? (plateCustomSize || "—") : plateSize || "—";
      const pThick = plateThickness === "Свой вариант" ? (plateCustomThickness || "—") : plateThickness || "—";
      const pOrient = plateOrientation === "horizontal" ? "горизонтально" : "вертикально";
      const pWidth = extractPlateWidthText();

      lines.push("Надгробная плита:");
      lines.push(`- Размер: ${pSize}`);
      lines.push(`- Ширина: ${pWidth}`);
      lines.push(`- Толщина: ${pThick}`);
      lines.push(`- Ориентация: ${pOrient}`);

      if (chosenPlateList.length) {
        lines.push("- Графика:");
        chosenPlateList.forEach((g) => lines.push(`  • ${g.name || g.id}`));
      }
      if (plateEpitaphList.length) {
        lines.push("- Эпитафии:");
        plateEpitaphList.forEach((t) => lines.push(`  • ${t}`));
      }
      lines.push("");
    }

    const notes = String((d as any)?.extras?.orderNotes || "").trim();
    if (notes) {
      lines.push("Комментарий к заказу:");
      lines.push(notes, "");
    }

    return lines.join("\n");
  }

  async function sendLargeText(fullText: string): Promise<{ ok: boolean; errors: string[] }> {
    const parts: string[] = [];
    for (let i = 0; i < fullText.length; i += TELEGRAM_CHUNK_SIZE) parts.push(fullText.slice(i, i + TELEGRAM_CHUNK_SIZE));
    const errors: string[] = [];
    for (const part of parts) {
      const r = await sendManagerMessage(part);
      if (!r.ok) errors.push(r.error || "send error");
      await sleep(150);
    }
    return { ok: errors.length === 0, errors };
  }

  async function ensureTopBarPanelOpenForShot(): Promise<void> {
    const openTopbar = () => {
      try {
        window.dispatchEvent(new Event("memorial:openTopBarPanel"));
      } catch {}
    };
    const isOpen = () => !!document.querySelector('[data-topbar-panel="1"]');

    openTopbar();

    const start = Date.now();
    while (Date.now() - start < 900) {
      if (isOpen()) break;
      await sleep(120);
      openTopbar();
    }

    // небольшой запас под анимацию/перерисовку
    await sleep(150);
  }

  function findTopBarShotRootNode(): HTMLElement | null {
    return document.getElementById("topbar-shot-root");
  }

  async function sendTopbarShotWithHeaderAndPanel(): Promise<{ ok: boolean; error?: string }> {
    try {
      await ensureTopBarPanelOpenForShot();

      const node = findTopBarShotRootNode();
      if (!node) return { ok: false, error: "TopBar shot root not found" };

      const dataUrl = await elementToPngDataUrl(node, { pixelRatio: 2, bg: "#111111" });
      if (!dataUrl) return { ok: false, error: "TopBar shot failed" };

      const file = dataUrlToFile(dataUrl, "topbar.png");
      const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
        maxWidth: 1600,
        maxHeight: 3000,
        mime: "image/jpeg",
        qualityStart: 0.9,
        qualityMin: 0.55,
        qualityStep: 0.08
      });

      const fd = new FormData();
      fd.append("file", new File([compressed], "topbar.jpg", { type: "image/jpeg" }));
      return await sendManagerPhoto(fd);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function sendSketchFromNode(nodeId: string, caption: string | undefined, fallbackUrl?: string | null): Promise<{ ok: boolean; error?: string }> {
    try {
      const el = document.getElementById(nodeId) as HTMLElement | null;
      if (el) {
        const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, `${nodeId}.png`);
          const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
            maxWidth: 2000,
            maxHeight: 2000,
            mime: "image/jpeg",
            qualityStart: 0.9,
            qualityMin: 0.55,
            qualityStep: 0.08
          });

          const fd = new FormData();
          fd.append("file", new File([compressed], `${nodeId}.jpg`, { type: "image/jpeg" }));
          if (caption) fd.append("caption", caption);

          const r = await sendManagerPhoto(fd);
          if (r.ok) return { ok: true };
        }
      }
    } catch {
      // ignore, try URL
    }

    if (fallbackUrl) {
      const fd2 = new FormData();
      fd2.append("url", fallbackUrl);
      if (caption) fd2.append("caption", caption);
      const r2 = await sendManagerPhoto(fd2);
      if (r2.ok) return { ok: true };
      return { ok: false, error: r2.error || "url send failed" };
    }

    return { ok: false, error: "Не удалось отправить эскиз" };
  }

  function collectPersonPhotosWithCaptions(d: any): { file: File; caption: string; name: string }[] {
    const persons = (((d || {}).engraving || {}).persons || []).filter(Boolean);
    const out: { file: File; caption: string; name: string }[] = [];
    for (const p of persons) {
      const lastName = (p?.lastName || "").trim();
      const first = (p?.firstName || "").trim();
      const middle = (p?.middleName || "").trim();
      const birth = (p?.birthDate || "").trim();
      const death = (p?.deathDate || "").trim();
      const fio = [lastName, [first, middle].filter(Boolean).join(" ")].filter(Boolean).join(" ");
      const dates = [birth, death].filter(Boolean).join(" — ");
      const caption = [fio, dates].filter(Boolean).join("\n");

      const dataUrl = (p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || "").trim();
      if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) continue;

      const bin = atob(dataUrl.split(",")[1]);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

      const safeName = (fio || "photo").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
      const file = new File([u8], `${safeName}.jpg`, { type: "image/jpeg" });
      out.push({ file, caption, name: `${safeName}.jpg` });
    }
    return out;
  }

  async function notifyUserAfterSend(orderNoCur: string) {
    const tgUser = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user;
    const userId = Number(tgUser?.id);
    if (!Number.isFinite(userId) || userId <= 0) return;

    const intro = loadIntroState();
    const name = (intro?.intro?.customerName || "").trim() || "—";
    const phone = (intro?.intro?.customerPhone || "").trim() || "—";
    const uname = tgUser?.username ? `@${tgUser.username}` : "";
    const full = [uname, tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(" ").trim();

    const text =
      `Заявка №${orderNoCur || "—"} отправлена.\n` +
      `Спасибо, ${name}! Наш менеджер свяжется с вами по указанному номеру ${phone}.\n\n` +
      `Telegram: ${full || "—"}\n` +
      `ID: ${userId}`;

    await sendDmToUser(userId, text);
  }

  // ===== Main send =====
  const sendOrderDirect = async () => {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setTextDelivered(null);
    setTopbarDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(null);
    setPhotosDelivered(0);

    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();

      await sendManagerMessage(startMarkerText(orderNoCur));

      // 1) Скриншот топбара (кнопка + панель)
      const topRes = await sendTopbarShotWithHeaderAndPanel();
      setTopbarDelivered(topRes.ok);
      if (!topRes.ok && topRes.error) warnings.push(`Топбар не отправлен: ${topRes.error}`);

      // 2) Текст заявки
      const tRes = await sendLargeText(buildOrderText());
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      // 3) Эскиз (лицевая)
      const frontRes = await sendSketchFromNode("pdf-front-sketch", "Эскиз (лицевая)", null);
      setFrontSketchDelivered(frontRes.ok);
      if (!frontRes.ok && frontRes.error) warnings.push(`Эскиз (лицевая) не отправлен: ${frontRes.error}`);

      // 4) Эскиз (тыльная) — только если showBack=true
      if (showBack && backCandidateUrl) {
        const backRes = await sendSketchFromNode("pdf-back-sketch", "Эскиз (тыльная)", backCandidateUrl);
        setBackSketchDelivered(backRes.ok);
        if (!backRes.ok && backRes.error) warnings.push(`Эскиз (тыльная) не отправлен: ${backRes.error}`);
      } else {
        setBackSketchDelivered(null);
      }

      // 5) Фото портретов
      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      setPhotosTotal(photos.length);

      let delivered = 0;
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, {
          maxWidth: 2000,
          maxHeight: 2000,
          mime: "image/jpeg",
          qualityStart: 0.9,
          qualityMin: 0.55,
          qualityStep: 0.08
        });

        const fd = new FormData();
        fd.append("file", new File([compressed], ph.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
        fd.append("caption", ph.caption);

        const r = await sendManagerPhoto(fd);
        if (!r.ok) warnings.push(`Фото не отправлено (${ph.name}): ${r.error || "send failed"}`);
        else {
          delivered += 1;
          setPhotosDelivered(delivered);
        }

        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(200);
      }

      await sendManagerMessage(endMarkerText(orderNoCur));

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);
      setUploadProgress(100);

      await notifyUserAfterSend(orderNoCur);
    } finally {
      setUploading(false);
    }
  };

  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));
      const blob = await generateOrderPdf({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: showBack ? document.getElementById("pdf-back-sketch") : null,
        backUrlFallback: showBack ? backCandidateUrl : null,
        includeAttachedPhotos: true
      });
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } catch (e: any) {
      alert(`Не удалось сформировать PDF\n\n${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSend() {
    if (isSending) return;
    try {
      setIsSending(true);
      await sendOrderDirect();
      setConfirmOpen(false);
      setIsDirtyAfterSend(false);
      setTimeout(() => afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 150);
    } finally {
      setIsSending(false);
    }
  }

  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%` :
    isSending ? "Отправляем заказ…" :
    isSaving ? "Формируем PDF…" : "";

  // ===== Remove chosen plate graphic from selection (remove ONE occurrence) =====
  const removeChosenPlateOne = (gidRaw: string) => {
    const gid = String(gidRaw || "").trim();
    if (!gid) return;

    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;

    const nextIds = plateIds.slice();
    nextIds.splice(idx, 1);
    setPlateIds(nextIds);

    const prev = loadOrderDraft();
    saveOrderDraft({
      ...prev,
      extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta },
      updatedAt: Date.now()
    });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  return (
    <div style={safeRoot()}>
      <TopHintNotice />

      {/* Скриншотим этот контейнер целиком: кнопка + панель */}
      <div id="topbar-shot-root">
        <TopBarWithIntro title="Обзор и отправка" />
      </div>

      {/* Аккордеоны: Дополнительно/Плита */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => {
            setExtraPlate(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          plateSize={plateSize}
          setPlateSize={(v) => {
            setPlateSize(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateSize: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          plateCustomSize={plateCustomSize}
          setPlateCustomSize={(v) => {
            setPlateCustomSize(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateCustomSize: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          plateThickness={plateThickness}
          setPlateThickness={(v) => {
            setPlateThickness(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateThickness: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          plateCustomThickness={plateCustomThickness}
          setPlateCustomThickness={(v) => {
            setPlateCustomThickness(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateCustomThickness: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          plateOrientation={plateOrientation}
          setPlateOrientation={(v) => {
            setPlateOrientation(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateOrientation: v }, updatedAt: Date.now() });
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

            const prev = loadOrderDraft();
            saveOrderDraft({
              ...prev,
              extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta },
              updatedAt: Date.now()
            });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());

            if (sentOk) setIsDirtyAfterSend(true);
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;

            const nextIds = plateIds.slice();
            nextIds.splice(idx, 1);
            setPlateIds(nextIds);

            const prev = loadOrderDraft();
            saveOrderDraft({
              ...prev,
              extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta },
              updatedAt: Date.now()
            });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());

            if (sentOk) setIsDirtyAfterSend(true);
          }}
          plateIds={plateIds}
          chosenPlateList={chosenPlateList}
          onRemoveChosenPlateItem={removeChosenPlateOne}
          plateEpitaphList={plateEpitaphList}
          hasPedestal={hasPedestal}
          setHasPedestal={(v) => {
            setHasPedestal(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, tumba: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          hasFlowerbed={hasFlowerbed}
          setHasFlowerbed={(v) => {
            setHasFlowerbed(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, flowerbed: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          hasVase={hasVase}
          setHasVase={(v) => {
            setHasVase(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, vase: v }, updatedAt: Date.now() });
            dispatchDraftUpdated();
          }}
          extractPlateWidthText={extractPlateWidthText}
          onDirty={() => sentOk && setIsDirtyAfterSend(true)}
        />
      </section>

      {/* Эскиз лицевой */}
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

      {/* Эскиз тыльной — только если не пустой */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img
              id="pdf-back-sketch"
              src={backCandidateUrl}
              crossOrigin="anonymous"
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        </section>
      )}

      {/* Комментарий к заказу */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>
          Комментарий к заказу
        </label>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
          Не беспокойтесь: даже при отсутствии нужного пункта финальное подтверждение — по телефону или лично.
        </div>
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={String((extras0.orderNotes || "")).trim()}
          onBlur={(e) => {
            const prev = loadOrderDraft();
            const extras: any = { ...(prev as any).extras, orderNotes: (e.target.value || "").trim() || undefined };
            saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
            dispatchDraftUpdated();
            setDraft(loadOrderDraft());
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          placeholder="Добавьте комментарий…"
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </section>

      {/* Кнопки */}
      {(!sentOk || isDirtyAfterSend) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
          <button type="button" onPointerUp={onBack} onClick={onBack} style={glassButtonStyle("sm")}>
            Назад
          </button>
          <button type="button" onPointerUp={() => setConfirmOpen(true)} onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>
            Отправить менеджеру
          </button>
        </div>
      )}

      {/* Подтверждение */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }}
          onPointerUp={() => {
            if (!isSending && !uploading) setConfirmOpen(false);
          }}
        >
          <div
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => (e.stopPropagation() as any)}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              background: "#fff",
              color: "#111",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              boxShadow: "0 -20px 60px rgba(0,0,0,0.45)",
              transform: "translateY(8px)",
              opacity: 0,
              animation: "sheetIn 180ms ease forwards"
            }}
          >
            <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <button onPointerUp={() => setConfirmOpen(false)} onClick={() => setConfirmOpen(false)} title="Закрыть" className="btn" disabled={isSending || uploading}>
                ×
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам в Telegram?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn"
                onPointerUp={handleSend}
                onClick={handleSend}
                disabled={isSending || uploading}
                style={{ background: "#e5ffe5", borderColor: "#99d199" }}
              >
                {isSending || uploading ? "Отправляем…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Статус */}
      {(deliveryVisible || sentOk) && (
        <div ref={afterHintRef}>
          <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
            <div style={{ opacity: 0.92, marginBottom: 10 }}>
              {`Спасибо${customerName ? `, ${customerName}` : ""}! Сохраните PDF заказа при необходимости.`}
            </div>

            <div style={{ ...sectionBox, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Статус доставки</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div>
                  <span style={{ opacity: 0.85 }}>Топбар (кнопка+панель) — </span>
                  <strong style={{ color: topbarDelivered == null ? "#ccc" : topbarDelivered ? "#7dffa0" : "#ffb4b4" }}>
                    {topbarDelivered == null ? "—" : topbarDelivered ? "да" : "нет"}
                  </strong>
                </div>
                <div>
                  <span style={{ opacity: 0.85 }}>Текст — </span>
                  <strong style={{ color: textDelivered == null ? "#ccc" : textDelivered ? "#7dffa0" : "#ffb4b4" }}>
                    {textDelivered == null ? "—" : textDelivered ? "да" : "нет"}
                  </strong>
                </div>
                <div>
                  <span style={{ opacity: 0.85 }}>Эскиз (лицевая) — </span>
                  <strong style={{ color: frontSketchDelivered == null ? "#ccc" : frontSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>
                    {frontSketchDelivered == null ? "—" : frontSketchDelivered ? "да" : "нет"}
                  </strong>
                </div>
                {showBack && (
                  <div>
                    <span style={{ opacity: 0.85 }}>Эскиз (тыльная) — </span>
                    <strong style={{ color: backSketchDelivered == null ? "#ccc" : backSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>
                      {backSketchDelivered == null ? "—" : backSketchDelivered ? "да" : "нет"}
                    </strong>
                  </div>
                )}
                <div>
                  <span style={{ opacity: 0.85 }}>Фото — </span>
                  <strong style={{ color: photosDelivered === photosTotal ? "#7dffa0" : photosDelivered > 0 ? "#ffd666" : photosTotal === 0 ? "#ccc" : "#ffb4b4" }}>
                    {photosTotal > 0 ? `${photosDelivered} из ${photosTotal}` : "—"}
                  </strong>
                </div>
              </div>

              {lastWarnings.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer" }}>Подробности</summary>
                  <ul style={{ margin: "6px 0 0 20px" }}>
                    {lastWarnings.map((w, i) => (
                      <li key={`w-${i}`} style={{ marginBottom: 4 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(topbarDelivered === false ||
                textDelivered === false ||
                frontSketchDelivered === false ||
                (showBack && backSketchDelivered === false) ||
                (photosTotal > 0 && photosDelivered < photosTotal)) && (
                <button type="button" onClick={() => sendOrderDirect()} disabled={uploading || isSending} style={glassButtonStyle("sm", uploading || isSending)}>
                  {uploading ? "Повторяем…" : "Повторить отправку"}
                </button>
              )}
              <button type="button" onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>
                {isSaving ? "Формируем PDF…" : "Скачать PDF"}
              </button>
            </div>
          </section>
        </div>
      )}

      {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}
    </div>
  );
}
