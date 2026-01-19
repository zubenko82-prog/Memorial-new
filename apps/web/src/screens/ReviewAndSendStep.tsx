// src/screens/ReviewAndSendStep.tsx

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
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
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
    <div style={{ width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box" }}>
      {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
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

/* ========= CatGrid ========= */
function CatGrid({ items, plateIds, addGraphic, removeGraphic }: { items: any[]; plateIds: string[]; addGraphic: (g: any) => void; removeGraphic: (gid: string) => void; }) {
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
          <div key={gid} aria-selected={selected} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 12, position: "relative", borderColor: selected ? "#9cc4ff" : "rgba(255,255,255,0.14)", boxShadow: selected ? "0 0 0 1px #9cc4ff inset" : undefined }}>
            <div aria-hidden style={{ position: "absolute", top: 8, right: 8, display: selected ? "inline-flex" : "none", alignItems: "center", gap: 4, background: "rgba(10,127,46,0.95)", color: "#fff", borderRadius: 999, padding: "0 6px", fontSize: 11, lineHeight: "18px", height: 18 }} title={`Выбрано: ${qty}`}>
              <span>✓</span><span>{qty}</span>
            </div>
            <div role="button" title={name} onClick={() => addGraphic(g)} style={{ borderRadius: 10, overflow: "hidden", background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)", aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", border: selected ? "1px solid #9cc4ff" : "1px solid rgba(255,255,255,0.12)", cursor: "pointer", outline: "none" }}>
              {thumbUrl ? <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>}
            </div>
            <div title={name} style={{ marginTop: 6, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 }}>{name}</div>
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
  onDirty?: () => void;
}) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize,
    plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness,
    plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic, plateIds,
    hasPedestal, setHasPedestal,
    hasFlowerbed, setHasFlowerbed,
    hasVase, setHasVase,
    onDirty
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accPlateOpen, setAccPlateOpen] = useState(!!extraPlate);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  useEffect(() => { if (!extraPlate) setAccPlateOpen(false); }, [extraPlate]);
  const markDirty = () => onDirty?.();

  const plateTitle = (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={extraPlate}
        onChange={(e) => {
          setExtraPlate(e.target.checked);
          if (e.target.checked) setAccPlateOpen(true);
          markDirty();
          const prev = loadOrderDraft();
          saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: e.target.checked }, updatedAt: Date.now() });
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <span>Надгробная плита</span>
    </label>
  );

  const persistPlateEpitaph = (text: string) => {
    const prev = loadOrderDraft();
    const extras: any = { ...(prev as any).extras, plateEpitaph: text || "" };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
    markDirty();
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Дополнительно */}
      <LoudAccordion title="Дополнительно" open={accExtrasOpen} onToggle={() => setAccExtrasOpen(v => !v)}>
        <div style={{ ...sectionBox }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hasPedestal}
                onChange={(e) => {
                  setHasPedestal(e.target.checked);
                  markDirty();
                  const prev = loadOrderDraft();
                  saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, tumba: e.target.checked }, updatedAt: Date.now() });
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
                  const prev = loadOrderDraft();
                  saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, flowerbed: e.target.checked }, updatedAt: Date.now() });
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
                  const prev = loadOrderDraft();
                  saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, vase: e.target.checked }, updatedAt: Date.now() });
                }}
              />
              <span>Ваза</span>
            </label>
          </div>
        </div>
      </LoudAccordion>

      {/* Надгробная плита */}
      <LoudAccordion
        title={plateTitle}
        open={accPlateOpen}
        onToggle={() => {
          if (!accPlateOpen) {
            if (!extraPlate) {
              setExtraPlate(true);
              const prev = loadOrderDraft();
              saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: true }, updatedAt: Date.now() });
              markDirty();
            }
            setAccPlateOpen(true);
          } else {
            setAccPlateOpen(false);
          }
        }}
      >
        {extraPlate && (
          <div style={{ display: "grid", gap: 12 }}>
            {/* Размер */}
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
                        const prev = loadOrderDraft();
                        saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateSize: v }, updatedAt: Date.now() });
                      }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateSize === "Свой вариант" && (
                <input
                  value={plateCustomSize}
                  onChange={(e) => { setPlateCustomSize(e.target.value); }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const prev = loadOrderDraft();
                    saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateCustomSize: v || "" }, updatedAt: Date.now() });
                    if (v) markDirty();
                  }}
                  placeholder="Укажите свой размер (например, 130×60 см)"
                  style={inputStyle()}
                />
              )}
            </div>

            {/* Толщина */}
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
                        const prev = loadOrderDraft();
                        saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateThickness: v }, updatedAt: Date.now() });
                      }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateThickness === "Свой вариант" && (
                <input
                  value={plateCustomThickness}
                  onChange={(e) => setPlateCustomThickness(e.target.value)}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const prev = loadOrderDraft();
                    saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateCustomThickness: v || "" }, updatedAt: Date.now() });
                    if (v) markDirty();
                  }}
                  placeholder="Укажите толщину (например, 7 см)"
                  style={inputStyle()}
                />
              )}
            </div>

            {/* Ориентация */}
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
                        const prev = loadOrderDraft();
                        saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateOrientation: v }, updatedAt: Date.now() });
                      }}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Эпитафии */}
            <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen(v => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ ...sectionBox }}>
                  <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                  <textarea
                    rows={3}
                    value={plateEpitaph}
                    onChange={(e) => { setPlateEpitaph(e.target.value); }}
                    onBlur={(e) => { persistPlateEpitaph(e.target.value); }}
                    placeholder="Введите текст…"
                    style={{ ...inputStyle(), resize: "vertical" }}
                  />
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
                          persistPlateEpitaph(joined);
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

            {/* Графика */}
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
          </div>
        )}
      </LoudAccordion>
    </div>
  );
}

/* ========= HTML-to-image ========= */
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
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
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

  // Разворачиваем топбар на этой странице
  useEffect(() => {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    // Фолбэк: пытаемся кликнуть по кнопке топбара, если не раскрылся по событию.
    setTimeout(() => {
      const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
      if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    }, 50);
  }, []);

  // Следим за драфтом
  useEffect(() => {
    const refresh = () => {
      setDraft(loadOrderDraft());
      setIntroState(loadIntroState());
    };
    window.addEventListener(DRAFT_UPDATED_EVENT, refresh as any);
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, refresh as any);
  }, []);

  // Лицевая — пропорции по исходной картинке
  const item = (draft as any)?.item || null;
  const itemUrl = (item?.url || "") as string;
  const [aspectFront, setAspectFront] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspectFront(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = itemUrl;
  }, [itemUrl]);

  // Тыльная — ТОЛЬКО растр из BackEditor
  function getBackSketchUrl(d: any): string | null {
    const eb = (d || {}).editorBack || {};
    const raw = String(eb.previewHiUrl || eb.previewUrl || "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }
  const [backCandidateUrl, setBackCandidateUrl] = useState<string | null>(getBackSketchUrl(draft));
  const [aspectBack, setAspectBack] = useState<string | undefined>(undefined);
  useEffect(() => {
    const url = getBackSketchUrl(draft);
    setBackCandidateUrl(url);
    if (!url) { setAspectBack(undefined); return; }
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) setAspectBack(`${im.naturalWidth} / ${im.naturalHeight}`); };
    im.src = url;
  }, [draft]);
  const showBack = !!backCandidateUrl;

  // People / graphics / epitaphs (front)
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

  // Плита
  const extras0 = (draft as any)?.extras || {};
  const [extraPlate, setExtraPlate] = useState<boolean>(!!extras0.headstonePlate);
  const [plateSize, setPlateSize] = useState<string>(extras0.plateSize || "100×50 см");
  const [plateCustomSize, setPlateCustomSize] = useState<string>(extras0.plateCustomSize || "");
  const [plateThickness, setPlateThickness] = useState<string>(extras0.plateThickness || "5 см");
  const [plateCustomThickness, setPlateCustomThickness] = useState<string>(extras0.plateCustomThickness || "");
  const [plateOrientation, setPlateOrientation] = useState<string>(extras0.plateOrientation || ((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h") ? "horizontal" : "vertical"));
  const [plateEpitaph, setPlateEpitaph] = useState<string>(extras0.plateEpitaph || "");
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});
  const [hasPedestal, setHasPedestal] = useState<boolean>(extras0.tumba ?? true);
  const [hasFlowerbed, setHasFlowerbed] = useState<boolean>(!!extras0.flowerbed);
  const [hasVase, setHasVase] = useState<boolean>(!!extras0.vase);

  // Каталог
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

  /* ========= Отправка и статусы ========= */
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

  const TARGET_FILE_BYTES = Math.floor(2.7 * 1024 * 1024);

  async function sendLargeText(fullText: string): Promise<{ ok: boolean; errors: string[] }> {
    const TELEGRAM_CHUNK_SIZE = 3500;
    const parts: string[] = [];
    let cursor = 0;
    while (cursor < fullText.length) { parts.push(fullText.slice(cursor, cursor + TELEGRAM_CHUNK_SIZE)); cursor += TELEGRAM_CHUNK_SIZE; }
    const errors: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const resp = await fetch("/api/tg-send-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: parts[i] }) });
      const raw = await resp.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!resp.ok || !json?.ok) errors.push(json?.error || raw || resp.statusText);
      await sleep(150);
    }
    return { ok: errors.length === 0, errors };
  }

  async function ensureTopbarOpenAndReady() {
    try { window.dispatchEvent(new Event("memorial:openTopBarPanel")); } catch {}
    window.scrollTo({ top: 0, behavior: "auto" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // фолбэк «кликнуть» по кнопке, если всё ещё закрыт
    const btn = document.querySelector('#topbar-capture button[aria-expanded]') as HTMLButtonElement | null;
    if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    await sleep(160);
  }

  async function sendNodeShotNoCaption(nodeId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const el = document.getElementById(nodeId);
      if (!el) return { ok: false, error: "node not found" };
      const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
      if (!dataUrl) return { ok: false, error: "toPng failed" };
      const file = dataUrlToFile(dataUrl, `${nodeId}.png`);
      const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
      const fd = new FormData();
      fd.append("file", new File([compressed], `${nodeId}.jpg`, { type: "image/jpeg" }));
      const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }

  async function sendPhotoByUrlNoCaption(url: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const fd = new FormData();
      fd.append("url", url);
      const r = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
      const raw = await r.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      return { ok: !!(r.ok && json?.ok), error: json?.error || raw || r.statusText };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }

  async function sendFrontSketchNoCaption(): Promise<{ ok: boolean; error?: string }> {
    try {
      const el = document.getElementById("pdf-front-sketch");
      if (!el) return { ok: false, error: "front node not found" };
      const dataUrl = await elementToPngDataUrl(el, { pixelRatio: 2, bg: "#ffffff" });
      if (!dataUrl) return { ok: false, error: "toPng failed" };
      const file = dataUrlToFile(dataUrl, "front.png");
      const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
      const fd = new FormData();
      fd.append("file", new File([compressed], "front.jpg", { type: "image/jpeg" }));
      const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      return { ok: !!(resp.ok && json?.ok), error: json?.error || raw || resp.statusText };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }

  async function sendOrderDirect(showBackInner: boolean, backUrlInner: string | null) {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setTextDelivered(null);
    setTopbarDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(showBackInner ? null : null);
    setPhotosDelivered(0);

    const warnings: string[] = [];
    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();

      await sendMessage(`🪦 НАЧАЛО ЗАЯВКИ №${orderNoCur || "—"}`);

      await ensureTopbarOpenAndReady();
      const tbRes = await sendNodeShotNoCaption("topbar-capture");
      setTopbarDelivered(tbRes.ok);
      if (!tbRes.ok && tbRes.error) warnings.push(`Шапка не отправлена: ${tbRes.error}`);

      const full = buildOrderText();
      const tRes = await sendLargeText(full);
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      const fRes = await sendFrontSketchNoCaption();
      setFrontSketchDelivered(fRes.ok);
      if (!fRes.ok && fRes.error) warnings.push(`Эскиз (лицевая) не отправлен: ${fRes.error}`);

      if (showBackInner && backUrlInner) {
        const bRes = await sendPhotoByUrlNoCaption(backUrlInner);
        setBackSketchDelivered(bRes.ok);
        if (!bRes.ok && bRes.error) warnings.push(`Эскиз (тыльная) не отправлен: ${bRes.error}`);
      }

      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      setPhotosTotal(photos.length);
      let delivered = 0;
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, { maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.9, qualityMin: 0.55, qualityStep: 0.08 });
        const fd = new FormData();
        fd.append("file", new File([compressed], ph.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
        const r = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
        const raw = await r.text().catch(() => ""); let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
        if (!r.ok || !json?.ok) { warnings.push(`Фото не отправлено (${ph.name}): ${json?.error || raw || r.statusText}`); }
        else { delivered += 1; setPhotosDelivered(delivered); }
        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(200);
      }

      await sendMessage(`🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${orderNoCur || "—"}`);

      setSentOk(true);
      if (warnings.length) setLastWarnings(warnings);
      setUploadProgress(100);
    } finally {
      setUploading(false);
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
        backUrlFallback: backCandidateUrl,
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
      await sendOrderDirect(showBack, backCandidateUrl);
      setConfirmOpen(false);
      setTimeout(() => {
        const el = document.getElementById("after-hint");
        el?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 150);
    } finally {
      setIsSending(false);
    }
  }

  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%`
      : isSending ? "Отправляем заказ…"
      : isSaving ? "Формируем PDF…"
      : "";

  return (
    <div style={safeRoot()}>
      {/* Топбар (разворачиваем на этой странице) */}
      <div id="topbar-capture">
        <TopBarWithIntro title="Memorial" />
      </div>

      {/* Блок с номером заказа и контактами — НЕ показываем */}

      {/* Плита / Дополнительно */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => { setExtraPlate(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: v }, updatedAt: Date.now() }); }}
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
            setPlateIds(nextIds); setPlateMeta(nextMeta);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta }, updatedAt: Date.now() });
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;
            const nextIds = plateIds.slice(); nextIds.splice(idx, 1); setPlateIds(nextIds);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta }, updatedAt: Date.now() });
          }}
          plateIds={plateIds}
          hasPedestal={hasPedestal}
          setHasPedestal={(v) => { setHasPedestal(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, tumba: v }, updatedAt: Date.now() }); }}
          hasFlowerbed={hasFlowerbed}
          setHasFlowerbed={(v) => { setHasFlowerbed(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, flowerbed: v }, updatedAt: Date.now() }); }}
          hasVase={hasVase}
          setHasVase={(v) => { setHasVase(v); const prev = loadOrderDraft(); saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, vase: v }, updatedAt: Date.now() }); }}
          onDirty={() => {}}
        />
      </section>

      {/* Эскиз лицевой */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspectFront || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
            <SketchTemplate item={item} peopleBlocks={peopleBlocks} crosses={selectedCrosses} others={selectedOthers} epitaphs={frontEpitaphs} carvingOpacity={0.4} />
          </div>
        </div>
      </section>

      {/* Эскиз тыльной — ТОЛЬКО растр из BackEditor */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspectBack || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img id="pdf-back-sketch" src={backCandidateUrl} crossOrigin="anonymous" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* Выбрано для плиты */}
      {extraPlate && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div><strong>Размер:</strong> {(plateSize === "Свой вариант" ? plateCustomSize : plateSize) || "—"}</div>
              <div><strong>Ширина:</strong> {(() => {
                const eff = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
                if (!eff) return "—";
                const m = eff.match(/(\d+)\s*[×xX]\s*(\d+)/);
                if (m) return `${m[2]} см`;
                const n = eff.match(/(\d+)\s*см/);
                if (n) return `${n[1]} см`;
                return eff;
              })()}</div>
            </div>
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

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
        <button type="button" onPointerUp={onBack} onClick={onBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onPointerUp={() => setConfirmOpen(true)} onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>Отправить менеджеру</button>
        <button type="button" onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>{isSaving ? "Формируем PDF…" : "Скачать PDF"}</button>
      </div>

      {/* Подтверждение */}
      {confirmOpen && (
        <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }} onPointerUp={() => { if (!isSending && !uploading) setConfirmOpen(false); }}>
          <div onPointerUp={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation() as any)} style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, boxShadow: "0 -20px 60px rgba(0,0,0,0.45)", transform: "translateY(8px)", opacity: 0, animation: "sheetIn 180ms ease forwards" }}>
            <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <button onPointerUp={() => setConfirmOpen(false)} onClick={() => setConfirmOpen(false)} title="Закрыть" className="btn" disabled={isSending || uploading}>×</button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам в Telegram?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onPointerUp={async () => { if (isSending) return; setIsSending(true); await sendOrderDirect(showBack, backCandidateUrl); setIsSending(false); setConfirmOpen(false); }} onClick={async () => { if (isSending) return; setIsSending(true); await sendOrderDirect(showBack, backCandidateUrl); setIsSending(false); setConfirmOpen(false); }} disabled={isSending || uploading} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>
                {isSending || uploading ? "Отправляем…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Статусы */}
      <div id="after-hint">
        {(deliveryVisible || sentOk) && (
          <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
            <div style={{ opacity: 0.92, marginBottom: 10 }}>Спасибо! Сохраните PDF заказа при необходимости.</div>
            <div style={{ ...sectionBox, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Статус доставки</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div><span style={{ opacity: 0.85 }}>Шапка — </span><strong style={{ color: topbarDelivered == null ? "#ccc" : topbarDelivered ? "#7dffa0" : "#ffb4b4" }}>{topbarDelivered == null ? "—" : topbarDelivered ? "да" : "нет"}</strong></div>
                <div><span style={{ opacity: 0.85 }}>Текст — </span><strong style={{ color: textDelivered == null ? "#ccc" : textDelivered ? "#7dffa0" : "#ffb4b4" }}>{textDelivered == null ? "—" : textDelivered ? "да" : "нет"}</strong></div>
                <div><span style={{ opacity: 0.85 }}>Эскиз (лицевая) — </span><strong style={{ color: frontSketchDelivered == null ? "#ccc" : frontSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>{frontSketchDelivered == null ? "—" : frontSketchDelivered ? "да" : "нет"}</strong></div>
                {showBack && (<div><span style={{ opacity: 0.85 }}>Эскиз (тыльная) — </span><strong style={{ color: backSketchDelivered == null ? "#ccc" : backSketchDelivered ? "#7dffa0" : "#ffb4b4" }}>{backSketchDelivered == null ? "—" : backSketchDelivered ? "да" : "нет"}</strong></div>)}
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
        )}
      </div>

      {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}
    </div>
  );
}
