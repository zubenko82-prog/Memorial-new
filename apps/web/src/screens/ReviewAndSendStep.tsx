// src/screens/ReviewAndSendStep.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS } from "../data/epitaphs";
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

/* ========= Header summary ========= */
function EditableOrderSummary({
  orderNo,
  onDirty
}: {
  orderNo: string;
  onDirty?: () => void;
}) {
  const introInitial = loadIntroState().intro || {};
  const [name, setName] = useState<string>(introInitial.customerName || "");
  const [phone, setPhone] = useState<string>(introInitial.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introInitial.customerNotes || "");

  const saveOnBlur = () => {
    const next: Intro = {
      customerName: name.trim(),
      customerPhone: phone.trim(),
      customerNotes: contactNotes.trim() || undefined
    };
    saveIntro(next, { lock: false });
    onDirty?.();
  };

  return (
    <section style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.95 }}>заказ № {orderNo || "—"}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveOnBlur} placeholder="Имя" style={inputStyle()} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={saveOnBlur} placeholder="+7..." inputMode="tel" style={inputStyle()} />
      </div>
      <input value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} onBlur={saveOnBlur} placeholder="Примечание для связи…" style={inputStyle()} />
    </section>
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
    setHasVase,
    onDirty
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  // ВАЖНО: открытость "Надгробная плита" = extraPlate (синхронно с чекбоксом)
  const accPlateOpen = extraPlate;

  const markDirty = () => onDirty?.();

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
        open={accPlateOpen}
        // кликом по заголовку тоже переключаем чекбокс
        onToggle={() => {
          setExtraPlate(!extraPlate);
          markDirty();
        }}
      >
        {extraPlate && (
          <div style={{ display: "grid", gap: 12 }}>
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

            <LoudAccordion title="Эпитафии на плите" open={accEpOpen} onToggle={() => setAccEpOpen((v) => !v)}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ ...sectionBox }}>
                  <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                  <textarea
                    rows={3}
                    value={plateEpitaph}
                    onChange={(e) => setPlateEpitaph(e.target.value)}
                    onBlur={() => markDirty()}
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
                          setPlateEpitaph(next.join("\n\n"));
                          markDirty();
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
                        <CatGrid
                          items={cat.items || []}
                          plateIds={plateIds}
                          addGraphic={(g) => {
                            addPlateGraphic(g);
                            markDirty();
                          }}
                          removeGraphic={(gid) => {
                            removePlateGraphic(gid);
                            markDirty();
                          }}
                        />
                        {(cat.children || []).map((sub: any, j: number) => (
                          <div key={sub._id || `${catKey}-sub-${j}`} style={{ marginTop: 8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                            <CatGrid
                              items={sub.items || []}
                              plateIds={plateIds}
                              addGraphic={(g) => {
                                addPlateGraphic(g);
                                markDirty();
                              }}
                              removeGraphic={(gid) => {
                                removePlateGraphic(gid);
                                markDirty();
                              }}
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

export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);

  const orderNo = String(introState.orderNumber || "").trim();
  const customerName = (introState.intro?.customerName || "").trim();
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  // "Развернуть" (expand webview) при переходе на экран — повторяем несколько раз
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

  // ---- Back: detect empty image by size ----
  function getBackSketchUrl(d: any): string | null {
    const raw = String((d?.editorBack?.previewHiUrl || d?.editorBack?.previewUrl || "") ?? "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }
  const [backCandidateUrl, setBackCandidateUrl] = useState<string | null>(getBackSketchUrl(draft));
  useEffect(() => setBackCandidateUrl(getBackSketchUrl(draft)), [draft]);

  // Проверяем, реально ли картинка "не пустая"
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
      // Отсекаем пустышки типа 1×1, 2×2, 10×10 и т.п.
      const ok = w >= 50 && h >= 50;
      setBackIsRenderable(ok);
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

  // Плита — состояния
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

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  // ---- Delivery states ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [textDelivered, setTextDelivered] = useState<boolean | null>(null);
  const [frontSketchDelivered, setFrontSketchDelivered] = useState<boolean | null>(null);
  const [backSketchDelivered, setBackSketchDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  // ===== API: /api/tg =====
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

  function startMarkerText(no: string): string {
    const n = no || "—";
    return `🪦 НАЧАЛО ЗАЯВКИ №${n}`;
  }
  function endMarkerText(no: string): string {
    const n = no || "—";
    return `🔚🚫⚰️ КОНЕЦ ЗАЯВКИ №${n}`;
  }

  function extractPlateWidthText(): string {
    const effective = (plateSize === "Свой вариант" ? plateCustomSize : plateSize || "").trim();
    if (!effective) return "—";
    const m = effective.match(/(\d+)\s*[×xX]\s*(\d+)/);
    if (m) return `${m[2]} см`;
    const n = effective.match(/(\d+)\s*см/);
    if (n) return `${n[1]} см`;
    return effective;
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

    // Плита (кратко)
    if (extraPlate) {
      lines.push("Надгробная плита:");
      lines.push(`- Размер: ${plateSize === "Свой вариант" ? plateCustomSize || "—" : plateSize || "—"}`);
      lines.push(`- Толщина: ${plateThickness === "Свой вариант" ? plateCustomThickness || "—" : plateThickness || "—"}`);
      lines.push(`- Ориентация: ${plateOrientation === "horizontal" ? "горизонтально" : "вертикально"}`);
      lines.push("");
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

  async function sendTopBarShot(): Promise<{ ok: boolean; error?: string }> {
    const node = document.getElementById("tg-topbar-shot") as HTMLElement | null;
    if (!node) return { ok: false, error: "topbar node not found" };

    const dataUrl = await elementToPngDataUrl(node, { pixelRatio: 2, bg: "#111111" });
    if (!dataUrl) return { ok: false, error: "topbar shot failed" };

    const file = dataUrlToFile(dataUrl, "topbar.png");
    const compressed = await compressImageFileToMaxBytes(file, TARGET_FILE_BYTES, {
      maxWidth: 1400,
      maxHeight: 600,
      mime: "image/jpeg",
      qualityStart: 0.9,
      qualityMin: 0.55,
      qualityStep: 0.08
    });

    const fd = new FormData();
    fd.append("file", new File([compressed], `topbar.jpg`, { type: "image/jpeg" }));
    // caption НЕ добавляем
    return await sendManagerPhoto(fd);
  }

  async function sendSketchFromNode(nodeId: string, caption: string | undefined, fallbackUrl?: string | null): Promise<{ ok: boolean; error?: string }> {
    // 1) DOM → image
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

    // 2) URL
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

  async function sendUserConfirmation(orderNoCur: string) {
    try {
      const tgUser = (window as any)?.Telegram?.WebApp?.initDataUnsafe?.user;
      const userId = tgUser?.id;
      if (!userId) return;

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

      await fetch("/api/tg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dm", userId, text })
      });
    } catch {
      // ignore
    }
  }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  // основной отправщик
  const sendOrderDirect = async () => {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setTextDelivered(null);
    setFrontSketchDelivered(null);
    setBackSketchDelivered(showBack ? null : null);
    setPhotosDelivered(0);

    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();

      await sendManagerMessage(startMarkerText(orderNoCur));

      // topbar shot
      const topShot = await sendTopBarShot();
      if (!topShot.ok && topShot.error) warnings.push(`Скриншот топбара не отправлен: ${topShot.error}`);

      const tRes = await sendLargeText(buildOrderText());
      setTextDelivered(tRes.ok);
      if (!tRes.ok) warnings.push(`Текст не отправлен: ${tRes.errors.join(" | ")}`);

      const frontRes = await sendSketchFromNode("pdf-front-sketch", "Эскиз (лицевая)", null);
      setFrontSketchDelivered(frontRes.ok);
      if (!frontRes.ok && frontRes.error) warnings.push(`Эскиз (лицевая) не отправлен: ${frontRes.error}`);

      if (showBack && backCandidateUrl) {
        const backRes = await sendSketchFromNode("pdf-back-sketch", "Эскиз (тыльная)", backCandidateUrl);
        setBackSketchDelivered(backRes.ok);
        if (!backRes.ok && backRes.error) warnings.push(`Эскиз (тыльная) не отправлен: ${backRes.error}`);
      }

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

      await sendUserConfirmation(orderNoCur);
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

  // UI overlay
  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%` : isSending ? "Отправляем заказ…" : isSaving ? "Формируем PDF…" : "";

  return (
    <div style={safeRoot()}>
      <TopHintNotice />

      {/* Этот блок будет скриншотиться (DOM). Если вам нужно больше инфы в топбаре — править TopBarWithIntro */}
      <div id="tg-topbar-shot" style={{ marginBottom: 10 }}>
        <TopBarWithIntro title="Memorial" />
      </div>

      <EditableOrderSummary orderNo={orderNo} onDirty={() => sentOk && setIsDirtyAfterSend(true)} />

      {/* Аккордеоны */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => {
            setExtraPlate(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: v }, updatedAt: Date.now() });
            if (sentOk) setIsDirtyAfterSend(true);
          }}
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
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;
            const nextIds = plateIds.slice();
            nextIds.splice(idx, 1);
            setPlateIds(nextIds);

            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta }, updatedAt: Date.now() });
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          plateIds={plateIds}
          hasPedestal={hasPedestal}
          setHasPedestal={(v) => {
            setHasPedestal(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, tumba: v }, updatedAt: Date.now() });
          }}
          hasFlowerbed={hasFlowerbed}
          setHasFlowerbed={(v) => {
            setHasFlowerbed(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, flowerbed: v }, updatedAt: Date.now() });
          }}
          hasVase={hasVase}
          setHasVase={(v) => {
            setHasVase(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, vase: v }, updatedAt: Date.now() });
          }}
          onDirty={() => sentOk && setIsDirtyAfterSend(true)}
        />
      </section>

      {/* Эскиз лицевой */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Лицевая</div>
        <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
          <div id="pdf-front-sketch" style={{ position: "absolute", inset: 0 }}>
            <SketchTemplate item={item} peopleBlocks={peopleBlocks} crosses={selectedCrosses} others={selectedOthers} epitaphs={frontEpitaphs} carvingOpacity={0.4} />
          </div>
        </div>
      </section>

      {/* Эскиз тыльной — показываем ТОЛЬКО если backIsRenderable=true */}
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

      {/* Выбрано для плиты */}
      {extraPlate && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ ...sectionBox }}>
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
                {chosenPlateList.map((g, i) => (
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
        <label htmlFor="order-notes" style={{ display: "block", marginBottom: 6 }}>
          Комментарий к заказу
        </label>
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
              <button className="btn" onPointerUp={handleSend} onClick={handleSend} disabled={isSending || uploading} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>
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
            <div style={{ opacity: 0.92, marginBottom: 10 }}>{`Спасибо${customerName ? `, ${customerName}` : ""}! Сохраните PDF заказа при необходимости.`}</div>

            <div style={{ ...sectionBox, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Статус доставки</div>
              <div style={{ display: "grid", gap: 6 }}>
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
              {(textDelivered === false ||
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
