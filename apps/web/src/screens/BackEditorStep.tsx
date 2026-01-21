// src/screens/BackEditorStep.tsx
//
// Шаг «Тыл»
//
// Требование:
// - Скопировать блок "Надгробная плита" (стили/верстка/поведение: Выбрано + Эпитафии + Графика-каталог)
// - Адаптировать под "Тыльная сторона" (пишем в draft.editorBack)
// - Два блока должны быть визуально одинаковые
// - Аккордеон "усопшие" для тыла пока не делаем
//
// Превью:
// - Тыл: draft.editorBack.previewUrl/previewHiUrl (генерим из тыл-графики + тыл-эпитафий)
// - Плита: draft.extras.platePreviewUrl/platePreviewHiUrl (генерим из plate-графики + plate-эпитафий) с фоном из PLATE_BG_URL
// - Если элементов нет — previewUrl/previewHiUrl = null

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
  for (const t of list) if (!hasByNorm(out, t)) out.push(t);
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

/* ========= Preview helpers ========= */
const PLATE_BG_URL = "/images/carvings/Резные/Прямой вертикально.png";

function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function wrapLinesCanvas(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  const paras = String(text || "").split(/\r?\n/);
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) line = test;
      else {
        if (line) out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

async function renderStackedPreview(params: {
  W: number;
  H: number;
  bg?: { type: "gradient" } | { type: "image"; url: string };
  graphics: { url?: string; preview?: string }[];
  epitaphs: string[];
}): Promise<string | null> {
  const { W, H, bg, graphics, epitaphs } = params;
  if (W <= 0 || H <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // bg
  if (!bg || bg.type === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const im = await loadImageSafe(bg.url);
    if (im) {
      const sr = im.width / im.height;
      const dr = W / H;
      let dw = W,
        dh = H,
        dx = 0,
        dy = 0;
      if (sr > dr) {
        dh = Math.round(W / sr);
        dy = Math.round((H - dh) / 2);
      } else {
        dw = Math.round(H * sr);
        dx = Math.round((W - dw) / 2);
      }
      ctx.drawImage(im, dx, dy, dw, dh);
    }
  }

  const items: { kind: "g" | "t"; url?: string; text?: string }[] = [];
  for (const g of graphics) items.push({ kind: "g", url: g.preview || g.url });
  for (const t of epitaphs) items.push({ kind: "t", text: t });

  if (items.length === 0) return null;

  // layout
  const pad = Math.round(Math.min(W, H) * 0.06);
  const top = pad;
  const bottom = H - pad;
  const gap = Math.round(Math.min(W, H) * 0.02);
  const usable = Math.max(10, bottom - top);
  const blockH = Math.max(60, Math.floor((usable - gap * (items.length - 1)) / items.length));
  const totalH = items.length * blockH + gap * (items.length - 1);
  let y = Math.max(top, Math.floor((H - totalH) / 2));

  const blockW = Math.floor(W * 0.35);
  const x = Math.floor((W - blockW) / 2);

  for (const it of items) {
    const r = { x, y, w: blockW, h: blockH };

    if (it.kind === "g" && it.url) {
      const im = await loadImageSafe(it.url);
      if (im) {
        const sr = im.width / im.height;
        const dr = r.w / r.h;
        let dw = r.w,
          dh = r.h,
          dx = r.x,
          dy = r.y;
        if (sr > dr) {
          dh = Math.round(r.w / sr);
          dy = r.y + Math.round((r.h - dh) / 2);
        } else {
          dw = Math.round(r.h * sr);
          dx = r.x + Math.round((r.w - dw) / 2);
        }
        ctx.drawImage(im, dx, dy, dw, dh);
      }
    }

    if (it.kind === "t" && it.text) {
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // чуть уменьшили базовый множитель, чтобы не было "огромного текста"
      const fontSize = Math.max(12, Math.floor(r.h * 0.14));
      ctx.font = `${fontSize}px "Times New Roman", serif`;
      const maxW = r.w - 12;
      const lines = wrapLinesCanvas(ctx, it.text, maxW);
      const lh = Math.round(fontSize * 1.18);
      const total = lines.length * lh;
      let ty = r.y + Math.round(r.h / 2 - total / 2 + lh / 2);
      for (const line of lines) {
        ctx.fillText(line, r.x + r.w / 2, ty);
        ty += lh;
      }
      ctx.restore();
    }

    y += blockH + gap;
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

/* ========= SideLikePlateBlock =========
   Универсальный блок (копия "Надгробной плиты") для:
   - rear: пишет в draft.editorBack (rearGraphicsIds/rearGraphicsMeta + rearEpitaphs)
   - plate: пишет в draft.extras (plateGraphicsIds/plateGraphicsMeta + plateEpitaph/plateEpitaphs)
*/
type SideKind = "rear" | "plate";

function SideLikePlateBlock(props: {
  title: string;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;

  // epitaph state (UI)
  selectedEpitaphs: string[];
  setSelectedEpitaphs: (v: string[] | ((p: string[]) => string[])) => void;
  showMore: boolean;
  setShowMore: (v: boolean | ((p: boolean) => boolean)) => void;
  customText: string;
  setCustomText: (v: string) => void;
  onToggleEpitaph: (t: string) => void;
  onAddCustom: () => void;
  onRemoveEpitaph: (t: string) => void;
  epitaphList: string[];

  // graphics state (UI)
  catsLoading: boolean;
  catsError: string;
  cats: any[];
  catOpen: Record<string, boolean>;
  setCatOpen: (m: Record<string, boolean>) => void;
  addGraphic: (g: any) => void;
  removeGraphic: (gid: string) => void;
  ids: string[];
  chosenList: any[];
  onRemoveChosenItem: (gid: string) => void;
}) {
  const {
    title,
    enabled,
    onToggleEnabled,

    selectedEpitaphs,
    setSelectedEpitaphs,
    showMore,
    setShowMore,
    customText,
    setCustomText,
    onToggleEpitaph,
    onAddCustom,
    onRemoveEpitaph,
    epitaphList,

    catsLoading,
    catsError,
    cats,
    catOpen,
    setCatOpen,
    addGraphic,
    removeGraphic,
    ids,

    chosenList,
    onRemoveChosenItem
  } = props;

  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

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
          const qty = ids.filter((x) => x === gid).length;
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
                <button type="button" onClick={() => removeGraphic(gid)} disabled={qty === 0} style={glassButtonStyle("nano", qty === 0)}>
                  −
                </button>
                <span style={{ minWidth: 20, textAlign: "center" }}>{qty}</span>
                <button type="button" onClick={() => addGraphic(g)} style={glassButtonStyle("nano")}>
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const blockTitle = (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggleEnabled(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      <span>{title}</span>
    </label>
  );

  return (
    <LoudAccordion title={blockTitle} open={enabled} onToggle={() => onToggleEnabled(!enabled)}>
      {enabled && (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Выбрано (красная рамка) */}
          <div style={{ ...sectionBoxStyle(), border: "1px solid rgba(255,80,80,0.95)" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано</div>

            {chosenList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: epitaphList.length ? 8 : 0 }}>
                {chosenList.map((g, i) => {
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
                        onClick={() => onRemoveChosenItem(String(g.id || g.name || g.url || ""))}
                        style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {epitaphList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {epitaphList.map((t, idx) => (
                  <div
                    key={`ep-preview-${idx}-${normEpitaph(t)}`}
                    style={{ ...sectionBoxStyle(), padding: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start" }}
                  >
                    <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
                    <button
                      type="button"
                      title="Удалить эпитафию"
                      onClick={() => onRemoveEpitaph(t)}
                      style={{ ...glassButtonStyle("nano"), padding: "6px 10px", borderColor: "rgba(255,80,80,0.9)" }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {chosenList.length === 0 && epitaphList.length === 0 && <div style={{ opacity: 0.85 }}>Пока ничего не выбрано.</div>}
          </div>

          {/* Эпитафии */}
          <LoudAccordion title="Эпитафии" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={sectionBoxStyle()}>
                <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => {
                    const active = hasByNorm(selectedEpitaphs, t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onToggleEpitaph(t)}
                        style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }}
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
                <button type="button" onClick={() => setShowMore((v) => !v)} style={glassButtonStyle("nano")}>
                  {showMore ? "Свернуть список" : "Развернуть список"}
                </button>

                {showMore && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, padding: 2 }}>
                    {MORE_EPITAPHS.map((t, idx) => {
                      const active = hasByNorm(selectedEpitaphs, t);
                      return (
                        <button
                          key={`more-${idx}-${normEpitaph(t)}`}
                          type="button"
                          onClick={() => onToggleEpitaph(t)}
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
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Введите текст и нажмите «Добавить»"
                    style={{ ...inputStyle(), resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" style={glassButtonStyle("nano")} onClick={onAddCustom}>
                      Добавить
                    </button>
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => setSelectedEpitaphs([])}>
                      Очистить выбранные
                    </button>
                    {selectedEpitaphs.length > 0 && <div>Выбрано: {selectedEpitaphs.length}</div>}
                  </div>
                </div>
              </div>

              {selectedEpitaphs.length > 0 && (
                <div style={sectionBoxStyle()}>
                  <div style={{ marginBottom: 6, textAlign: "left" }}>Выбранные эпитафии:</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {selectedEpitaphs.map((t, idx) => (
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
                        <button type="button" style={glassButtonStyle("nano")} onClick={() => onRemoveEpitaph(t)}>
                          Удалить
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </LoudAccordion>

          {/* Графика */}
          <LoudAccordion title="Графика" open={accGraphicsOpen} onToggle={() => setAccGraphicsOpen((v) => !v)}>
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
  );
}

/* ========= Main step ========= */
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
// === Anti-OOM sanitizer: remove heavy preview fields if they are too large ===
useEffect(() => {
  try {
    const d: any = loadOrderDraft();
    const eb: any = d?.editorBack || {};
    const ex: any = d?.extras || {};

    const tooBig = (v: any, maxChars: number) => typeof v === "string" && v.length > maxChars;

    // Порог по символам: 250k ~ 250 KB текста (base64 обычно намного больше)
    // hi-res превью часто > 1-3 млн символов.
    const MAX = 250_000;

    const patchEB: any = {};
    const patchEX: any = {};

    let changed = false;

    if (tooBig(eb.previewUrl, MAX)) {
      patchEB.previewUrl = null;
      changed = true;
    }
    if (tooBig(eb.previewHiUrl, MAX)) {
      patchEB.previewHiUrl = null;
      changed = true;
    }

    if (tooBig(ex.platePreviewUrl, MAX)) {
      patchEX.platePreviewUrl = null;
      changed = true;
    }
    if (tooBig(ex.platePreviewHiUrl, MAX)) {
      patchEX.platePreviewHiUrl = null;
      changed = true;
    }

    if (changed) {
      if (Object.keys(patchEB).length) saveOrderDraft({ editorBack: patchEB } as any);
      if (Object.keys(patchEX).length) saveOrderDraft({ extras: patchEX } as any);
      dispatchDraftUpdated();
      setDraft(loadOrderDraft());
    }
  } catch {
    // если loadOrderDraft упал — лучше хотя бы не падать здесь
  }
}, []);

  /* ========= Shared catalog for both blocks ========= */
  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState("");
  const [cats, setCats] = useState<any[]>([]);
  const [catOpenRear, setCatOpenRear] = useState<Record<string, boolean>>({});
  const [catOpenPlate, setCatOpenPlate] = useState<Record<string, boolean>>({});

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
    setCatOpenRear((prev) => {
      const next = { ...prev };
      for (const c of cats) {
        const key = String(c._id || c.name || "");
        if (!(key in next)) next[key] = false;
      }
      return next;
    });
    setCatOpenPlate((prev) => {
      const next = { ...prev };
      for (const c of cats) {
        const key = String(c._id || c.name || "");
        if (!(key in next)) next[key] = false;
      }
      return next;
    });
  }, [cats]);

  /* =========================
   * REAR (editorBack) state
   * ========================= */
  const editorBack0: any = (draft as any)?.editorBack || {};
  const [rearEnabled, setRearEnabled] = useState<boolean>(true); // тыльная сторона всегда включена
  const [rearIds, setRearIds] = useState<string[]>((editorBack0.selectedGraphicsIds as string[]) || []);
  const [rearMeta, setRearMeta] = useState<Record<string, any>>((editorBack0.graphicsMeta as Record<string, any>) || {});
  const [rearSelectedEpitaphs, setRearSelectedEpitaphs] = useState<string[]>(((editorBack0.epitaphTexts as string[]) || []).filter(Boolean));
  const [rearShowMore, setRearShowMore] = useState(false);
  const [rearCustomText, setRearCustomText] = useState("");

  // persist rear epitaphs
  const prevRearEpiJsonRef = useRef<string>("");
  useEffect(() => {
    const list = uniqueByNorm(rearSelectedEpitaphs);
    const snapshot = JSON.stringify(list);
    if (snapshot === prevRearEpiJsonRef.current) return;
    prevRearEpiJsonRef.current = snapshot;
    saveOrderDraft({ editorBack: { epitaphTexts: list.length ? list : null } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  }, [rearSelectedEpitaphs]);

  // rear graphics helpers (+/- and meta)
  const rearCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    rearIds.forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [rearIds]);

  const addRearGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    if (!gid) return;
    const qty = rearCountsById[gid] || 0;
    if (qty >= 3) {
      window.alert("Нельзя добавить более трёх одинаковых изображений");
      return;
    }
    const nextIds = [...rearIds, gid];
    const nextMeta = { ...rearMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
    setRearIds(nextIds);
    setRearMeta(nextMeta);
    saveOrderDraft({ editorBack: { selectedGraphicsIds: nextIds, graphicsMeta: nextMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const removeRearGraphic = (gid: string) => {
    const idx = rearIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = rearIds.slice();
    nextIds.splice(idx, 1);
    setRearIds(nextIds);
    saveOrderDraft({ editorBack: { selectedGraphicsIds: nextIds, graphicsMeta: rearMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const rearChosenList = useMemo(() => {
    const uniq = Array.from(new Set(rearIds));
    return uniq.map((gid) => rearMeta[gid] || { id: gid, name: gid, url: "" });
  }, [rearIds, rearMeta]);

  const removeRearChosenOne = (gidRaw: string) => removeRearGraphic(String(gidRaw || "").trim());

  const rearEpitaphList = useMemo(() => rearSelectedEpitaphs, [rearSelectedEpitaphs]);

  const toggleRearEpitaph = (text: string) => {
    const t = normEpitaph(text);
    if (!t) return;
    setRearSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, t);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return prev.concat([text]);
    });
  };
  const addRearCustom = () => {
    const raw = (rearCustomText || "").trim();
    const t = normEpitaph(raw);
    if (!t) return;
    setRearSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
    setRearCustomText("");
  };
  const removeRearEpitaph = (text: string) => {
    setRearSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
  };

  // rear preview generation
  useEffect(() => {
  let alive = true;

  const run = async () => {
    const d = loadOrderDraft();
    const eb: any = (d as any)?.editorBack || {};
    const ids: string[] = Array.isArray(eb.selectedGraphicsIds) ? eb.selectedGraphicsIds : [];
    const meta: Record<string, any> = eb.graphicsMeta || {};
    const ep: string[] = Array.isArray(eb.epitaphTexts) ? eb.epitaphTexts : [];

    const graphicsUniq = Array.from(new Set(ids)).map((gid) => meta[gid] || { id: gid, url: "" }).filter(Boolean);
    const epitaphs = ep.map((s) => String(s || "").trim()).filter(Boolean);

    const hasRear = graphicsUniq.length > 0 || epitaphs.length > 0;
    if (!hasRear) {
      saveOrderDraft({ editorBack: { previewUrl: null, previewHiUrl: null } as any });
      dispatchDraftUpdated();
      return;
    }

    const mini = await renderStackedPreview({
      W: 900,
      H: 1200,
      bg: { type: "gradient" },
      graphics: graphicsUniq,
      epitaphs
    });

    if (!alive) return;

    // SAFE: no hi-res
    saveOrderDraft({ editorBack: { previewUrl: mini || null, previewHiUrl: null } as any });
    dispatchDraftUpdated();
  };

  const t = window.setTimeout(() => void run(), 800);
  return () => {
    alive = false;
    clearTimeout(t);
  };
}, [rearIds, rearMeta, rearSelectedEpitaphs]);


  /* =========================
   * PLATE (extras) state
   * ========================= */
  const extras0: any = (draft as any)?.extras || {};

  const [plateEnabled, setPlateEnabled] = useState<boolean>(!!extras0.headstonePlate);
  const [plateIds, setPlateIds] = useState<string[]>((extras0.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>((extras0.plateGraphicsMeta as Record<string, any>) || {});

  // plate epitaphs state (kept like you had: plateEpitaph or plateEpitaphs)
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

  // persist plate enabled
  useEffect(() => {
    saveOrderDraft({ extras: { headstonePlate: plateEnabled } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateEnabled]);

  // persist plate epitaphs
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
    const snap = JSON.stringify(patchExtras);
    if (snap === prevPlateEpiJsonRef.current) return;
    prevPlateEpiJsonRef.current = snap;
    saveOrderDraft({ extras: patchExtras } as any);
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  }, [plateSelectedEpitaphs]);

  // plate graphics add/remove
  const plateCountsById = useMemo(() => {
    const m: Record<string, number> = {};
    plateIds.forEach((id) => (m[id] = (m[id] || 0) + 1));
    return m;
  }, [plateIds]);

  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    if (!gid) return;
    const qty = plateCountsById[gid] || 0;
    if (qty >= 3) {
      window.alert("Нельзя добавить более трёх одинаковых изображений");
      return;
    }
    const nextIds = [...plateIds, gid];
    const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
    setPlateIds(nextIds);
    setPlateMeta(nextMeta);
    saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const removePlateGraphic = (gid: string) => {
    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const nextIds = plateIds.slice();
    nextIds.splice(idx, 1);
    setPlateIds(nextIds);
    saveOrderDraft({ extras: { plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta } as any });
    dispatchDraftUpdated();
    setDraft(loadOrderDraft());
  };

  const chosenPlateList = useMemo(() => {
    const uniq = Array.from(new Set(plateIds));
    return uniq.map((gid) => plateMeta[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta]);

  const removePlateChosenOne = (gidRaw: string) => removePlateGraphic(String(gidRaw || "").trim());

  const togglePlateEpitaph = (text: string) => {
    const t = normEpitaph(text);
    if (!t) return;
    setPlateSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, t);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return prev.concat([text]);
    });
  };
  const addPlateCustom = () => {
    const raw = (plateCustomText || "").trim();
    const t = normEpitaph(raw);
    if (!t) return;
    setPlateSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([raw])));
    setPlateCustomText("");
  };
  const removePlateEpitaph = (text: string) => {
    setPlateSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });
  };

  // plate preview generation
  useEffect(() => {
  let alive = true;

  const run = async () => {
    const d = loadOrderDraft();
    const ex: any = (d as any)?.extras || {};
    const ids: string[] = Array.isArray(ex.plateGraphicsIds) ? ex.plateGraphicsIds : [];
    const meta: Record<string, any> = ex.plateGraphicsMeta || {};

    const arr: string[] = Array.isArray(ex.plateEpitaphs) ? ex.plateEpitaphs : [];
    const one: string[] = typeof ex.plateEpitaph === "string" && ex.plateEpitaph.trim() ? [ex.plateEpitaph.trim()] : [];
    const epitaphs = [...one, ...arr].map((s) => String(s || "").trim()).filter(Boolean);

    const graphicsUniq = Array.from(new Set(ids)).map((gid) => meta[gid] || { id: gid, url: "" }).filter(Boolean);

    const hasPlate = !!ex.headstonePlate && (graphicsUniq.length > 0 || epitaphs.length > 0);
    if (!hasPlate) {
      saveOrderDraft({ extras: { platePreviewUrl: null, platePreviewHiUrl: null } as any });
      dispatchDraftUpdated();
      return;
    }

    const mini = await renderStackedPreview({
      W: 900,
      H: 1200,
      bg: { type: "image", url: PLATE_BG_URL },
      graphics: graphicsUniq,
      epitaphs
    });

    if (!alive) return;

    // SAFE: no hi-res
    saveOrderDraft({ extras: { platePreviewUrl: mini || null, platePreviewHiUrl: null } as any });
    dispatchDraftUpdated();
  };

  const t = window.setTimeout(() => void run(), 800);
  return () => {
    alive = false;
    clearTimeout(t);
  };
}, [plateEnabled, plateIds, plateMeta, plateSelectedEpitaphs]);


  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease", maxWidth: 600, margin: "0 auto" }}>
      <TopBarWithIntro title="Тыл" />

      {/* 1) Тыльная сторона — визуальная копия "плиты" */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <SideLikePlateBlock
          title="Тыльная сторона"
          enabled={rearEnabled}
          onToggleEnabled={(v) => setRearEnabled(v)} // можно позже сделать как чекбокс "нужна тыльная сторона"
          selectedEpitaphs={rearSelectedEpitaphs}
          setSelectedEpitaphs={setRearSelectedEpitaphs}
          showMore={rearShowMore}
          setShowMore={setRearShowMore}
          customText={rearCustomText}
          setCustomText={setRearCustomText}
          onToggleEpitaph={toggleRearEpitaph}
          onAddCustom={addRearCustom}
          onRemoveEpitaph={removeRearEpitaph}
          epitaphList={rearEpitaphList}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpenRear}
          setCatOpen={setCatOpenRear}
          addGraphic={addRearGraphic}
          removeGraphic={removeRearGraphic}
          ids={rearIds}
          chosenList={rearChosenList}
          onRemoveChosenItem={removeRearChosenOne}
        />
      </section>

      {/* 2) Надгробная плита — тот же самый блок (визуально 1-в-1) */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 12 }}>
        <SideLikePlateBlock
          title="Надгробная плита"
          enabled={plateEnabled}
          onToggleEnabled={setPlateEnabled}
          selectedEpitaphs={plateSelectedEpitaphs}
          setSelectedEpitaphs={setPlateSelectedEpitaphs}
          showMore={plateShowMore}
          setShowMore={setPlateShowMore}
          customText={plateCustomText}
          setCustomText={setPlateCustomText}
          onToggleEpitaph={togglePlateEpitaph}
          onAddCustom={addPlateCustom}
          onRemoveEpitaph={removePlateEpitaph}
          epitaphList={plateEpitaphList}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpenPlate}
          setCatOpen={setCatOpenPlate}
          addGraphic={addPlateGraphic}
          removeGraphic={removePlateGraphic}
          ids={plateIds}
          chosenList={chosenPlateList}
          onRemoveChosenItem={removePlateChosenOne}
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
