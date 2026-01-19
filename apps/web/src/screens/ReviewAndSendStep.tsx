// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение»
//
// Требования:
// - Топбар разворачиваем при переходе на шаг (и гарантируем раскрытие перед скриншотом).
// - Блок с номером заказа/контактами под топбаром НЕ отображаем.
// - По нажатию «Отправить» делаем скриншот топбара (вместе с кнопкой) и отправляем его БЕЗ подписи.
// - Тыльная сторона: используем растр из draft.editorBack.previewHiUrl/previewUrl, показываем img и отправляем его как фото (URL).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS } from "../data/epitaphs";
import { generateOrderPdf, downloadBlob } from "../lib/pdf/generateOrderPdf";
import { compressImageFileToMaxBytes } from "../lib/media/resize";

/* ========= Styles ========= */
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
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
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
    <div style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111", color: "#fff", padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", minWidth: 220, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div className="spinner" style={{ margin: "0 auto 10px", width: 28, height: 28, border: "3px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
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
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
    const ro = new (window as any).ResizeObserver?.(m);
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
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ========= Graphics grid ========= */
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
    const el = rootRef.current;
    if (!el) return;
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

/* ========= Plate block ========= */
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
  plateEpitaph: string;
  setPlateEpitaph: (v: string) => void;
  catsLoading: boolean;
  catsError: string;
  cats: any[];
  catOpen: Record<string, boolean>;
  setCatOpen: (m: Record<string, boolean>) => void;
  addPlateGraphic: (g: any) => void;
  removePlateGraphic: (gid: string) => void;
  plateIds: string[];
  hasPedestal: boolean;
  setHasPedestal: (v: boolean) => void;
  hasFlowerbed: boolean;
  setHasFlowerbed: (v: boolean) => void;
  hasVase: boolean;
  setHasVase: (v: boolean) => void;
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
    plateEpitaph,
    setPlateEpitaph,
    catsLoading,
    catsError,
    cats,
    catOpen,
    setCatOpen,
    addPlateGraphic,
    removePlateGraphic,
    plateIds,
    hasPedestal,
    setHasPedestal,
    hasFlowerbed,
    setHasFlowerbed,
    hasVase,
    setHasVase
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accPlateOpen, setAccPlateOpen] = useState(!!extraPlate);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  useEffect(() => {
    if (!extraPlate) setAccPlateOpen(false);
  }, [extraPlate]);

  const persistExtras = (patch: any) => {
    const prev = loadOrderDraft();
    saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, ...patch }, updatedAt: Date.now() });
  };

  const plateTitle = (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={extraPlate}
        onChange={(e) => {
          setExtraPlate(e.target.checked);
          if (e.target.checked) setAccPlateOpen(true);
          persistExtras({ headstonePlate: e.target.checked });
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
                  persistExtras({ tumba: e.target.checked });
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
                  persistExtras({ flowerbed: e.target.checked });
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
                  persistExtras({ vase: e.target.checked });
                }}
              />
              <span>Ваза</span>
            </label>
          </div>
        </div>
      </LoudAccordion>

      <LoudAccordion
        title={plateTitle}
        open={accPlateOpen}
        onToggle={() => {
          if (!accPlateOpen) {
            if (!extraPlate) {
              setExtraPlate(true);
              persistExtras({ headstonePlate: true });
            }
            setAccPlateOpen(true);
          } else {
            setAccPlateOpen(false);
          }
        }}
      >
        {extraPlate && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["100×50 см", "120×60 см", "140×70 см", "Свой вариант"].map((v) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="plate-size" checked={plateSize === v} onChange={() => { setPlateSize(v); persistExtras({ plateSize: v }); }} />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateSize === "Свой вариант" && (
                <input value={plateCustomSize} onChange={(e) => setPlateCustomSize(e.target.value)} onBlur={(e) => persistExtras({ plateCustomSize: e.target.value.trim() })} placeholder="Укажите свой размер (например, 130×60 см)" style={inputStyle()} />
              )}
            </div>

            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["5 см", "8 см", "10 см", "Свой вариант"].map((v) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="plate-thickness" checked={plateThickness === v} onChange={() => { setPlateThickness(v); persistExtras({ plateThickness: v }); }} />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateThickness === "Свой вариант" && (
                <input value={plateCustomThickness} onChange={(e) => setPlateCustomThickness(e.target.value)} onBlur={(e) => persistExtras({ plateCustomThickness: e.target.value.trim() })} placeholder="Укажите толщину (например, 7 см)" style={inputStyle()} />
              )}
            </div>

            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                  <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => { setPlateOrientation(v); persistExtras({ plateOrientation: v }); }} />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>

            <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ ...sectionBox }}>
                  <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                  <textarea rows={3} value={plateEpitaph} onChange={(e) => setPlateEpitaph(e.target.value)} onBlur={(e) => persistExtras({ plateEpitaph: e.target.value })} placeholder="Введите текст…" style={{ ...inputStyle(), resize: "vertical" }} />
                </div>
                <div>
                  <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {QUICK_EPITAPHS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          const list = toParagraphs(plateEpitaph);
                          const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
                          const exists = list.some((s) => norm(s) === norm(t));
                          const next = exists ? list.filter((s) => norm(s) !== norm(t)) : list.concat([t]);
                          const joined = next.join("\n\n");
                          setPlateEpitaph(joined);
                          persistExtras({ plateEpitaph: joined });
                        }}
                        style={glassButtonStyle("nano")}
                        title={t}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
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
                        <CatGrid items={cat.items || []} plateIds={plateIds} addGraphic={(g) => addPlateGraphic(g)} removeGraphic={(gid) => removePlateGraphic(gid)} />
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

/* ========= Main component ========= */
export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  // контейнер топбара для скриншота
  const topbarWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refresh = () => {
      setDraft(loadOrderDraft());
      setIntroState(loadIntroState());
    };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
  }, []);

  // разворачиваем топбар при входе на шаг
  useEffect(() => {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    setTimeout(() => {
      const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
      if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    }, 50);
  }, []);

  // back preview
  const backCandidateUrl = useMemo(() => {
    const raw = String((draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl || "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }, [draft]);
  const showBack = !!backCandidateUrl;

  // front sketch inputs
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
  const peopleBlocks = useMemo(
    () => frontPersons.map((p: any, i: number) => ({ id: p.id || `p-${i}`, lines: personLines(p), photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null })),
    [frontPersons]
  );

  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => (g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross");
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  // plate state
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(extras0.plateOrientation || "vertical");
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // catalog for plate
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

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  // sending state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // delivery statuses
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [topbarDelivered, setTopbarDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  // helpers
  function buildOrderText(): string {
    const d = loadOrderDraft();
    const intro = loadIntroState();
    const lines: string[] = [];

    lines.push(intro?.orderNumber ? `Заявка №${intro.orderNumber}` : "Заявка");
    lines.push("");

    lines.push("Клиент:");
    lines.push(`- Имя: ${(intro?.intro?.customerName || "").trim() || "—"}`);
    lines.push(`- Телефон: ${(intro?.intro?.customerPhone || "").trim() || "—"}`);
    if ((intro?.intro?.customerNotes || "").trim()) lines.push(`- Примечание: ${(intro?.intro?.customerNotes || "").trim()}`);
    lines.push("");

    const persons = (((d?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      fio: [String(p?.lastName || "").trim(), [p?.firstName, p?.middleName].map((x: string) => String(x || "").trim()).filter(Boolean).join(" ")].filter(Boolean).join(" "),
      dates: [p?.birthDate, p?.deathDate].map((x: string) => String(x || "").trim()).filter(Boolean).join(" — ")
    }));

    lines.push("Люди:");
    if (!persons.length) lines.push("- —");
    else {
      for (const p of persons) {
        lines.push(`- ${p.fio || "—"}`);
        if (p.dates) lines.push(`  ${p.dates}`);
      }
    }
    lines.push("");

    const epsFront = toParagraphs((d?.engraving as any)?.epitaphs ?? (d?.engraving as any)?.epitaphText);
    if (epsFront.length) {
      lines.push("Эпитафии (лицевая):");
      epsFront.forEach((x) => lines.push(`- ${x}`));
      lines.push("");
    }

    const epsRear = toParagraphs(((d as any)?.editorBack?.epitaphTexts || []).join("\n\n"));
    if (epsRear.length) {
      lines.push("Эпитафии (тыльная):");
      epsRear.forEach((x) => lines.push(`- ${x}`));
      lines.push("");
    }

    if (extraPlate) {
      lines.push("Надгробная плита:");
      lines.push(`- Размер: ${(plateSize === "Свой вариант" ? plateCustomSize : plateSize) || "—"}`);
      lines.push(`- Толщина: ${plateThickness || "—"}`);
      lines.push(`- Ориентация: ${plateOrientation === "horizontal" ? "горизонтально" : "вертикально"}`);
      if (plateEpitaphList.length) {
        lines.push("- Эпитафии:");
        plateEpitaphList.forEach((x) => lines.push(`  • ${x}`));
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  async function ensureTopbarOpen() {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
    if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
  }

  async function captureTopbarAsFile(): Promise<File | null> {
    // ищем в DOM панель (div#order-panel) и кнопку-родителя
    const wrap = topbarWrapRef.current;
    if (!wrap) return null;

    // открываем
    await ensureTopbarOpen();
    window.scrollTo({ top: 0, behavior: "auto" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(220);

    // снимаем "обрезание": принудительно снимаем ограничения с элемента коллапса (id="order-panel"),
    // т.к. он обычно overflow:hidden и max-height для анимации.
    const panel = wrap.querySelector("#order-panel") as HTMLElement | null;
    const prevPanelOverflow = panel?.style.overflow;
    const prevPanelMaxH = panel?.style.maxHeight;

    if (panel) {
      panel.style.overflow = "visible";
      panel.style.maxHeight = "none";
    }

    let dataUrl: string | null = null;
    try {
      dataUrl = await elementToPngDataUrl(wrap, { pixelRatio: 2, bg: "#ffffff" });
    } finally {
      if (panel) {
        panel.style.overflow = prevPanelOverflow || "";
        panel.style.maxHeight = prevPanelMaxH || "";
      }
    }

    if (!dataUrl) return null;
    return dataUrlToFile(dataUrl, "topbar.png");
  }

  async function handleSend() {
    if (isSending) return;

    setIsSending(true);
    setUploading(true);
    setDeliveryVisible(true);

    setLastWarnings([]);
    setTextDelivered(null);
    setTopbarDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(showBack ? null : null);
    setPhotosDelivered(0);

    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      await sendMessage(`🪦 НАЧАЛО ЗАЯВКИ №${orderNoCur || "—"}`);

      // 1) Скриншот топбара (без подписи)
      const topbarFile = await captureTopbarAsFile();
      if (topbarFile) {
        const r = await sendPhotoByFileNoCaption(topbarFile, "topbar.jpg");
        setTopbarDelivered(r.ok);
        if (!r.ok && r.error) warnings.push(`Топбар не отправлен: ${r.error}`);
      } else {
        setTopbarDelivered(false);
        warnings.push("Топбар не отправлен: не удалось сделать скриншот");
      }

      // 2) Текст
      const full = buildOrderText();
      const tRes = await sendLargeText(full);
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      // 3) Лицевая (DOM → PNG) без подписи
      {
        const el = document.getElementById("pdf-front-sketch");
        const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, "front.png");
          const r = await sendPhotoByFileNoCaption(file, "front.jpg");
          setFrontSketchDelivered(r.ok);
          if (!r.ok && r.error) warnings.push(`Лицевая не отправлена: ${r.error}`);
        } else {
          setFrontSketchDelivered(false);
          warnings.push("Лицевая не отправлена: не удалось растрировать");
        }
      }

      // 4) Тыльная (URL) без подписи
      if (showBack && backCandidateUrl) {
        const r = await sendPhotoByUrlNoCaption(backCandidateUrl);
        setBackSketchDelivered(r.ok);
        if (!r.ok && r.error) warnings.push(`Тыльная не отправлена: ${r.error}`);
      }

      // 5) Фото персон (без подписи)
      const photos = collectPersonPhotos(loadOrderDraft());
      setPhotosTotal(photos.length);
      let delivered = 0;
      for (let i = 0; i < photos.length; i++) {
        const r = await sendPhotoByFileNoCaption(photos[i], `person-${i + 1}.jpg`);
        if (!r.ok && r.error) warnings.push(`Фото ${i + 1} не отправлено: ${r.error}`);
        else {
          delivered += 1;
          setPhotosDelivered(delivered);
        }
        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(150);
      }

      await sendMessage(`🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${orderNoCur || "—"}`);

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);
      setUploadProgress(100);

      setTimeout(() => afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 150);
    } finally {
      setUploading(false);
      setIsSending(false);
      setConfirmOpen(false);
    }
  }

  async function handleSavePdf() {
    try {
      setIsSaving(true);
      await new Promise((r) => setTimeout(r, 0));
      const blob = await generateOrderPdf({
        draft: loadOrderDraft(),
        intro: loadIntroState(),
        frontNode: document.getElementById("pdf-front-sketch"),
        backNode: null,
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

  // plate chosen summary
  const plateChosenList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta]);

  const overlayText =
    uploading ? `Отправляем… ${Math.max(0, Math.min(100, uploadProgress || 0))}%`
    : isSending ? "Отправляем заказ…"
    : isSaving ? "Формируем PDF…"
    : "";

  return (
    <div style={safeRoot()}>
      {/* TopBar: разворачиваем при входе, скриншотим этот контейнер */}
      <div id="topbar-capture" ref={topbarWrapRef}>
        <TopBarWithIntro title="Memorial" />
      </div>

      {/* Блок с номером заказа/контактами (ниже топбара) — УБРАН */}

      {/* Плита/допы */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
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
          addPlateGraphic={(g) => {
            const gid = String(g.id || g.relPath || g.url || g.name);
            const nextIds = [...plateIds, gid];
            const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
            setPlateIds(nextIds);
            setPlateMeta(nextMeta);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta }, updatedAt: Date.now() });
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;
            const nextIds = plateIds.slice();
            nextIds.splice(idx, 1);
            setPlateIds(nextIds);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta }, updatedAt: Date.now() });
          }}
          plateIds={plateIds}
          hasPedestal={hasPedestal}
          setHasPedestal={setHasPedestal}
          hasFlowerbed={hasFlowerbed}
          setHasFlowerbed={setHasFlowerbed}
          hasVase={hasVase}
          setHasVase={setHasVase}
        />
      </section>

      {/* Лицевая */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
            <SketchTemplate item={item} peopleBlocks={peopleBlocks} crosses={selectedCrosses} others={selectedOthers} epitaphs={frontEpitaphs} carvingOpacity={0.4} />
          </div>
        </div>
      </section>

      {/* Тыльная — только растр */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img src={backCandidateUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* Плита — выбрано */}
      {extraPlate && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>

            {plateChosenList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                {plateChosenList.map((g, i) => (
                  <div key={`${g.id || g.url || i}`} style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8, alignItems: "center" }}>
                    <Thumb url={g.url} />
                    <div title={g.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {g.name || g.id}
                    </div>
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
        <textarea
          id="order-notes"
          rows={3}
          defaultValue={String((extras0.orderNotes || "")).trim()}
          onBlur={(e) => {
            const prev = loadOrderDraft();
            const extras: any = { ...(prev as any).extras, orderNotes: (e.target.value || "").trim() || undefined };
            saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
            setDraft(loadOrderDraft());
          }}
          placeholder="Добавьте комментарий…"
          style={{ ...inputStyle(), resize: "vertical" }}
        />
      </section>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Отправить менеджеру</button>
        <button type="button" onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>
          {isSaving ? "Формируем PDF…" : "Скачать PDF"}
        </button>
      </div>

      {/* Подтверждение */}
      {confirmOpen && (
        <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, boxShadow: "0 -20px 60px rgba(0,0,0,0.45)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам в Telegram?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmOpen(false)} disabled={isSending || uploading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #999", background: "#f7f7f7", cursor: "pointer" }}>
                Отмена
              </button>
              <button className="btn" onClick={handleSend} disabled={isSending || uploading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #99d199", background: "#e5ffe5", cursor: "pointer" }}>
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
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Статус доставки</div>
            <div style={{ ...sectionBox }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div><span style={{ opacity: 0.85 }}>Топбар — </span><strong style={{ color: topbarDelivered == null ? "#ccc" : topbarDelivered ? "#7dffa0" : "#ffb4b4" }}>{topbarDelivered == null ? "—" : topbarDelivered ? "да" : "нет"}</strong></div>
                <div><span style={{ opacity: 0.85 }}>Текст — </span><strong style={{ color: textDelivered == null ? "#ccc" : textDelivered ? "#7dffa0" : "#ffb4b4" }}>{textDelivered == null ? "—" : textDelivered ? "да" : "нет"}</strong></div>
                <div><span style={{ opacity: 0.85 }}>Лицевая — </span><strong style={{ color: frontSketchDelivered == null ? "#ccc" : frontSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>{frontSketchDelivered == null ? "—" : frontSketchDelivered ? "да" : "нет"}</strong></div>
                {showBack && (<div><span style={{ opacity: 0.85 }}>Тыльная — </span><strong style={{ color: backSketchDelivered == null ? "#ccc" : backSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>{backSketchDelivered == null ? "—" : backSketchDelivered ? "да" : "нет"}</strong></div>)}
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
                    {lastWarnings.map((w, i) => (<li key={`w-${i}`} style={{ marginBottom: 4 }}>{w}</li>))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        </div>
      )}

      {(isSending || isSaving || uploading) && <BusyOverlay text={uploading ? `Отправляем… ${uploadProgress}%` : (isSaving ? "Формируем PDF…" : "Отправляем…")} />}
    </div>
  );
}
