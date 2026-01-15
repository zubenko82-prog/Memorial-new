// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение»
//
// Новое:
// - Прямая отправка в Telegram без Blob-хранилищ: текст → PDF (document) → фото (photo).
// - Сжатие PDF/фото до безопасного размера для serverless.
// - Явный блок статуса доставки: “Доставлено: PDF — да/нет, фото: X из Y”.
// - Кнопка “Повторить недоставленные”.
// - В крайнем случае — инструкция и кнопка “Скачать PDF и отправить вручную”.

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
        <img
          src={url}
          alt={alt}
          style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }}
        />
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
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
  onOpenTop,
  onDirty
}: {
  orderNo: string;
  onOpenTop: () => void;
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
  items, plateIds, addGraphic, removeGraphic
}: {
  items: any[]; plateIds: string[]; addGraphic: (g: any) => void; removeGraphic: (gid: string) => void;
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
                <img
                  src={thumbUrl}
                  alt={name}
                  style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }}
                />
              ) : (
                <div style={{ opacity: 0.8, fontSize: 12 }}>нет</div>
              )}
            </div>
            <div
              title={name}
              style={{
                marginTop: 6,
                fontSize: 12,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                opacity: 0.95
              }}
            >
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
  hasPedestal: boolean; setHasPedestal: (v: boolean) => void;
  hasFlowerbed: boolean; setHasFlowerbed: (v: boolean) => void;
  hasVase: boolean; setHasVase: (v: boolean) => void;
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
    plateIds, hasPedestal, setHasPedestal, hasFlowerbed, setHasFlowerbed, hasVase, setHasVase,
    onDirty
  } = props;

  const [accExtrasOpen, setAccExtrasOpen] = useState(true);
  const [accPlateOpen, setAccPlateOpen] = useState(!!extraPlate);
  const [accEpOpen, setAccEpOpen] = useState(false);
  const [accGraphicsOpen, setAccGraphicsOpen] = useState(false);

  useEffect(() => { if (!extraPlate) setAccPlateOpen(false); }, [extraPlate]);
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
        onChange={(e) => { setExtraPlate(e.target.checked); markDirty(); }}
        onClick={(e) => e.stopPropagation()}
      />
      <span>Надгробная плита</span>
    </label>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Дополнительно */}
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

      {/* Надгробная плита */}
      <LoudAccordion title={plateTitle} open={accPlateOpen} onToggle={() => setAccPlateOpen(v => !v)}>
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
                      onChange={() => { setPlateSize(v); markDirty(); }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateSize === "Свой вариант" && (
                <input
                  value={plateCustomSize}
                  onChange={(e) => { setPlateCustomSize(e.target.value); markDirty(); }}
                  onBlur={(e) => { if (e.target.value.trim()) markDirty(); }}
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
                      onChange={() => { setPlateThickness(v); markDirty(); }}
                    />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              {plateThickness === "Свой вариант" && (
                <input
                  value={plateCustomThickness}
                  onChange={(e) => { setPlateCustomThickness(e.target.value); markDirty(); }}
                  onBlur={(e) => { if (e.target.value.trim()) markDirty(); }}
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
                      onChange={() => { setPlateOrientation(v); markDirty(); }}
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
                          const joined = next.join("\n\n");
                          setPlateEpitaph(joined);
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

/* ========= PDF/Image compression and generators ========= */
// Консервативный целевой лимит файла (учтён multipart-оверход)
const TARGET_FILE_BYTES = Math.floor(3.1 * 1024 * 1024);

async function generatePdfUnderLimit(opts: {
  draft: any; intro: any; frontNode: HTMLElement | null; backNode: HTMLElement | null; backUrlFallback?: string | null; maxBytes: number;
}): Promise<Blob> {
  const attempts = [
    { scale: 1.0, quality: "high" as const },
    { scale: 0.9, quality: "medium" as const },
    { scale: 0.8, quality: "medium" as const },
    { scale: 0.7, quality: "low" as const },
    { scale: 0.6, quality: "low" as const },
    { scale: 0.55, quality: "low" as const },
    { scale: 0.5, quality: "low" as const }
  ];
  for (const a of attempts) {
    const blob = await generateOrderPdf({
      draft: opts.draft, intro: opts.intro, frontNode: opts.frontNode, backNode: opts.backNode,
      backUrlFallback: opts.backUrlFallback, scale: a.scale, quality: a.quality
    } as any);
    if (blob.size <= opts.maxBytes) return blob;
  }
  return await generateOrderPdf({
    draft: opts.draft, intro: opts.intro, frontNode: opts.frontNode, backNode: opts.backNode,
    backUrlFallback: opts.backUrlFallback, scale: 0.5, quality: "low"
  } as any);
}

function collectPersonPhotosWithCaptions(draft: any): { file: File; caption: string }[] {
  const persons = (((draft || {}).engraving || {}).persons || []).filter(Boolean);
  const out: { file: File; caption: string }[] = [];
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
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const mime = dataUrl.substring(5, dataUrl.indexOf(";")) || "image/jpeg";
    const blob = new Blob([arr], { type: mime });
    const file = new File([blob], `${fio || "photo"}.jpg`, { type: "image/jpeg" });
    out.push({ file, caption });
  }
  return out;
}

function normalizeErrorMessage(err: any): { msg: string; details?: string } {
  const raw = String(err?.message || err?.toString?.() || "Неизвестная ошибка");
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { msg: "Похоже, нет подключения к интернету. Проверьте сеть и попробуйте снова.", details: raw };
  }
  const is413 = /request entity too large|payload too large|function_payload_too_large|http 413|status 413/i.test(raw);
  if (is413) {
    return { msg: "Файл слишком большой для серверной функции. Проверьте, не пришёл ли документ в Telegram, затем попробуйте ещё раз или отправьте PDF вручную.", details: raw };
  }
  return { msg: "Не удалось отправить заказ. Попробуйте ещё раз, либо сохраните PDF и отправьте менеджеру вручную.", details: raw };
}

/* ========= Main component ========= */
export default function ReviewAndSendStep({ onBack }: { onBack?: () => void }) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const [introState, setIntroState] = useState(() => loadIntroState());
  const [isDirtyAfterSend, setIsDirtyAfterSend] = useState(false);
  const orderNo = String(introState.orderNumber || "").trim();
  const customerName = (introState.intro?.customerName || "").trim();
  const afterHintRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refresh = () => { setDraft(loadOrderDraft()); setIntroState(loadIntroState()); };
    const markDirtyOnDraft = () => { if (sentOk) setIsDirtyAfterSend(true); refresh(); };
    window.addEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    refresh();
    return () => window.removeEventListener(DRAFT_UPDATED_EVENT, markDirtyOnDraft as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back side presence
  function getBackSketchUrl(d: any): string | null {
    const raw = String((d?.editorBack?.previewHiUrl || d?.editorBack?.previewUrl || "") ?? "").trim();
    if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
    return raw;
  }
  function hasBackContent(d: any): boolean {
    const eb = (d as any)?.editorBack || {};
    const engr = (d as any)?.engraving || {};
    const arr = (v: any) => (Array.isArray(v) ? v : []);
    const str = (v: any) => (typeof v === "string" ? v : "");
    const nonEmptyText = (v: any) => toParagraphs(v).length > 0;
    const graphics =
      arr((d as any)?.graphicsBack).length > 0 ||
      arr((eb as any)?.graphics).length > 0 ||
      arr((eb as any)?.items).length > 0 ||
      arr((eb as any)?.layers).length > 0 ||
      arr((eb as any)?.objects).length > 0;
    const epitaph =
      nonEmptyText(str((engr as any)?.backEpitaph)) ||
      nonEmptyText(str((engr as any)?.epitaphBack)) ||
      nonEmptyText(arr((engr as any)?.backEpitaphs).join("\n\n"));
    const portraits = arr((d as any)?.portraitsBack).length > 0 || arr((eb as any)?.portraits).length > 0;
    const metrics = !!str((engr as any)?.metricsBack).trim() || !!str((engr as any)?.backMetrics).trim() || arr((engr as any)?.metricsBack).length > 0;
    return !!(graphics || epitaph || portraits || metrics);
  }

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

  // Front
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
    () => frontPersons.map((p: any, i: number) => ({
      id: p.id || `p-${i}`, lines: personLines(p),
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
    })), [frontPersons]
  );

  const allFrontGraphics: any[] = ((draft as any)?.graphics as any[])?.filter(Boolean) || [];
  const isCross = (g: any) => (g?.catName || "").toLowerCase().includes("крест") || (g?.catSlug || "").toLowerCase().includes("cross");
  const selectedCrosses = useMemo(() => allFrontGraphics.filter(isCross), [allFrontGraphics]);
  const selectedOthers = useMemo(() => allFrontGraphics.filter((g) => !isCross(g)), [allFrontGraphics]);

  const frontEpitaphs: string[] = useMemo(() => {
    const engr: any = draft?.engraving || {};
    return toParagraphs(engr.epitaphs ?? engr.epitaphText);
  }, [draft?.engraving]);

  // Plate/extras state
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

  // Catalog state
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

  // Sending state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const lastPdfRef = useRef<Blob | null>(null);

  // Delivery status block
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [pdfDelivered, setPdfDelivered] = useState<boolean | null>(null);
  const [photosDelivered, setPhotosDelivered] = useState(0);
  const [photosTotal, setPhotosTotal] = useState(0);
  const [failedPhotoIdx, setFailedPhotoIdx] = useState<number[]>([]);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);

  // Telegram helpers
  async function sendMessageHeader(headerText: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetch("/api/tg-send-message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: headerText })
      });
      const raw = await resp.text().catch(() => "");
      let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!resp.ok || !json?.ok) return { ok: false, error: (json?.error || raw || resp.statusText) };
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }
  async function sendPdfBlob(pdfBlob: Blob, caption: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const fd = new FormData();
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      const fileName = `order-${orderNoCur || Date.now()}.pdf`;
      fd.append("file", new File([pdfBlob], fileName, { type: "application/pdf" }));
      fd.append("caption", caption);
      const resp = await fetch("/api/tg-send-document", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => "");
      let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!resp.ok || !json?.ok) return { ok: false, error: (json?.error || raw || resp.statusText) };
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }
  async function sendPhotoBlob(photoBlob: Blob, filename: string, caption: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const fd = new FormData();
      fd.append("file", new File([photoBlob], filename.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
      fd.append("caption", caption);
      const resp = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => "");
      let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!resp.ok || !json?.ok) return { ok: false, error: (json?.error || raw || resp.statusText) };
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  }

  // Main send workflow
  const sendOrderDirect = async (showBackInner: boolean, backUrlInner: string | null, pdfOverride?: Blob) => {
    setUploading(true);
    setUploadProgress(0);
    setDeliveryVisible(true);
    setLastWarnings([]);
    setPdfDelivered(null);
    setPhotosDelivered(0);
    setFailedPhotoIdx([]);
    const warnings: string[] = [];

    try {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      const surnames = (((loadOrderDraft() || {}).engraving || {}).persons || [])
        .map((p: any) => (p?.lastName || "").trim()).filter(Boolean);
      const headerText = [
        orderNoCur ? `Заявка №${orderNoCur}` : "Заявка",
        surnames.length ? `Фамилии: ${Array.from(new Set(surnames)).join(", ")}` : ""
      ].filter(Boolean).join("\n");

      // 1) Header message (non-blocking)
      const msgRes = await sendMessageHeader(headerText);
      if (!msgRes.ok && msgRes.error) warnings.push(`Текст не отправлен: ${msgRes.error}`);

      // 2) PDF
      let pdfBlob = pdfOverride || null;
      if (!pdfBlob) {
        pdfBlob = await generatePdfUnderLimit({
          draft: loadOrderDraft(), intro: loadIntroState(),
          frontNode: document.getElementById("pdf-front-sketch"),
          backNode: showBackInner ? document.getElementById("pdf-back-sketch") : null,
          backUrlFallback: showBackInner ? backUrlInner : null,
          maxBytes: TARGET_FILE_BYTES
        });
      }
      lastPdfRef.current = pdfBlob!;
      const pdfRes = await sendPdfBlob(pdfBlob!, orderNoCur ? `Заявка №${orderNoCur}` : "Заявка");
      setPdfDelivered(!!pdfRes.ok);
      if (!pdfRes.ok && pdfRes.error) warnings.push(`PDF не отправлен: ${pdfRes.error}`);

      // 3) Photos
      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      setPhotosTotal(photos.length);
      let delivered = 0;
      const failedIdx: number[] = [];

      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, {
          maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.88, qualityMin: 0.5, qualityStep: 0.08
        });
        const r = await sendPhotoBlob(compressed, ph.file.name || `photo-${i + 1}.jpg`, ph.caption);
        if (r.ok) {
          delivered += 1;
          setPhotosDelivered(delivered);
        } else {
          failedIdx.push(i);
          warnings.push(`Фото не отправлено (${ph.file.name || `photo-${i + 1}.jpg`}): ${r.error || "ошибка"}`);
        }
        setUploadProgress(Math.round(((i + 1) / Math.max(1, photos.length)) * 100));
        await sleep(250);
      }

      setFailedPhotoIdx(failedIdx);
      setLastWarnings(warnings);
    } finally {
      setUploading(false);
      setUploadProgress(100);
    }
  };

  async function retryUndelivered() {
    const orderNoCur = String(loadIntroState().orderNumber || "").trim();
    const newWarnings: string[] = [];
    setUploading(true);

    try {
      // Retry PDF if failed
      if (pdfDelivered === false) {
        const blob = lastPdfRef.current;
        if (blob) {
          const r = await sendPdfBlob(blob, orderNoCur ? `Заявка №${orderNoCur}` : "Заявка");
          setPdfDelivered(!!r.ok);
          if (!r.ok && r.error) newWarnings.push(`PDF снова не отправлен: ${r.error}`);
        }
      }

      // Retry only failed photos
      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      const failed = [...failedPhotoIdx];
      if (failed.length > 0) {
        let delivered = photosDelivered;
        for (const idx of failed) {
          const ph = photos[idx];
          const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, {
            maxWidth: 2000, maxHeight: 2000, mime: "image/jpeg", qualityStart: 0.88, qualityMin: 0.5, qualityStep: 0.08
          });
          const r = await sendPhotoBlob(compressed, ph.file.name || `photo-${idx + 1}.jpg`, ph.caption);
          if (r.ok) {
            delivered += 1;
            setPhotosDelivered(delivered);
            setFailedPhotoIdx((prev) => prev.filter((i) => i !== idx));
          } else {
            newWarnings.push(`Фото всё ещё не отправлено (${ph.file.name || `photo-${idx + 1}.jpg`}): ${r.error || "ошибка"}`);
          }
          await sleep(250);
        }
      }
    } finally {
      if (newWarnings.length) {
        setLastWarnings((prev) => Array.from(new Set([...prev, ...newWarnings])));
      }
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
        backNode: showBack ? document.getElementById("pdf-back-sketch") : null,
        backUrlFallback: showBack ? backCandidateUrl : null
      });
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } catch (e: any) {
      const n = normalizeErrorMessage(e);
      alert(`${n.msg}\n\n${n.details || ""}`);
    } finally {
      setIsSaving(false);
    }
  }
  function handleSaveLastPdf() {
    const blob = lastPdfRef.current;
    if (blob) {
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } else {
      handleSavePdf();
    }
  }

  // UI handlers
  async function handleSendPdf() {
    if (isSending) return;
    try {
      setIsSending(true);
      await sendOrderDirect(showBack, backCandidateUrl);
      setConfirmOpen(false);
      setSentOk(true);
      setSuccessOpen(true);
      setIsDirtyAfterSend(false);
      setTimeout(() => { afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, 150);
    } catch (e: any) {
      const n = normalizeErrorMessage(e);
      alert(`${n.msg}\n\n${n.details || ""}`);
    } finally {
      setIsSending(false);
    }
  }

  async function handleRetrySend() {
    if (isSending) return;
    try {
      setIsSending(true);
      await sendOrderDirect(showBack, backCandidateUrl, lastPdfRef.current || undefined);
      setSentOk(true);
      setSuccessOpen(true);
      setIsDirtyAfterSend(false);
      setTimeout(() => { afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, 150);
    } catch (e: any) {
      const n = normalizeErrorMessage(e);
      alert(`${n.msg}\n\n${n.details || ""}`);
    } finally {
      setIsSending(false);
    }
  }

  // Bottom overlay text
  const overlayText =
    uploading ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%` :
    isSending ? "Отправляем заказ…" :
    isSaving ? "Формируем PDF…" : "";

  return (
    <div style={safeRoot()}>
      <TopHintNotice />
      <TopBarWithIntro title="Memorial" />

      <EditableOrderSummary orderNo={orderNo} onOpenTop={() => {}} onDirty={() => sentOk && setIsDirtyAfterSend(true)} />

      {/* Plate/Extras */}
      <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={(v) => {
            setExtraPlate(v);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, headstonePlate: v }, updatedAt: Date.now() });
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          plateSize={plateSize} setPlateSize={setPlateSize}
          plateCustomSize={plateCustomSize} setPlateCustomSize={setPlateCustomSize}
          plateThickness={plateThickness} setPlateThickness={setPlateThickness}
          plateCustomThickness={plateCustomThickness} setPlateCustomThickness={setPlateCustomThickness}
          plateOrientation={plateOrientation} setPlateOrientation={setPlateOrientation}
          plateEpitaph={plateEpitaph} setPlateEpitaph={setPlateEpitaph}
          catsLoading={catsLoading} catsError={catsError} cats={cats}
          catOpen={catOpen} setCatOpen={setCatOpen}
          addPlateGraphic={(g) => {
            const gid = String(g.id || g.relPath || g.url || g.name);
            const nextIds = [...plateIds, gid];
            const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
            setPlateIds(nextIds); setPlateMeta(nextMeta);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta }, updatedAt: Date.now() });
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          removePlateGraphic={(gid) => {
            const idx = plateIds.findIndex((x) => x === gid);
            if (idx === -1) return;
            const nextIds = plateIds.slice(); nextIds.splice(idx, 1);
            setPlateIds(nextIds);
            const prev = loadOrderDraft();
            saveOrderDraft({ ...prev, extras: { ...(prev as any).extras, plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta }, updatedAt: Date.now() });
            if (sentOk) setIsDirtyAfterSend(true);
          }}
          plateIds={plateIds}
          hasPedestal={hasPedestal} setHasPedestal={setHasPedestal}
          hasFlowerbed={hasFlowerbed} setHasFlowerbed={setHasFlowerbed}
          hasVase={hasVase} setHasVase={setHasVase}
          onDirty={() => sentOk && setIsDirtyAfterSend(true)}
        />
      </section>

      {/* Front sketch */}
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

      {/* Back sketch */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img id="pdf-back-sketch" src={backCandidateUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* Delivery status block */}
      {deliveryVisible && (
        <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Статус доставки</div>

          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <span style={{ opacity: 0.85 }}>Доставлено: PDF — </span>
              <strong style={{ color: pdfDelivered == null ? "#ccc" : pdfDelivered ? "#7dffa0" : "#ffb4b4" }}>
                {pdfDelivered == null ? "—" : pdfDelivered ? "да" : "нет"}
              </strong>
            </div>
            <div>
              <span style={{ opacity: 0.85 }}>Фото — </span>
              <strong style={{ color: photosDelivered === photosTotal ? "#7dffa0" : photosDelivered > 0 ? "#ffd666" : "#ffb4b4" }}>
                {photosDelivered} из {photosTotal}
              </strong>
              {failedPhotoIdx.length > 0 && (
                <span style={{ marginLeft: 8, color: "#ffb4b4" }}>(ошибки: {failedPhotoIdx.length})</span>
              )}
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {(pdfDelivered === false || failedPhotoIdx.length > 0) && (
              <button type="button" onClick={retryUndelivered} disabled={uploading || isSending} style={glassButtonStyle("sm", uploading || isSending)}>
                {uploading ? "Повторяем…" : "Повторить недоставленные"}
              </button>
            )}
            <button type="button" onClick={handleSaveLastPdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)}>
              {isSaving ? "Формируем PDF…" : "Скачать PDF"}
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            Если часть файлов не доставилась, скачайте PDF и отправьте менеджеру вручную (в Telegram или по почте).
            Укажите номер заказа и приложите фотографии, подписав к каждому фото ФИО и даты.
          </div>
        </section>
      )}

      {/* Notes */}
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

      {/* Bottom buttons */}
      {(!sentOk || isDirtyAfterSend) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
          <button type="button" onPointerUp={onBack} onClick={onBack} style={glassButtonStyle("sm")}>
            Назад
          </button>
          <button type="button" onPointerUp={() => setConfirmOpen(true)} onClick={() => setConfirmOpen(true)} style={glassButtonStyle("sm")}>
            Рассчитать стоимость
          </button>
        </div>
      )}

      {/* Confirm sheet */}
      {confirmOpen && (
        <div role="dialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.35)" }} onPointerUp={() => { if (!isSending && !uploading) setConfirmOpen(false); }}>
          <div
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => (e.stopPropagation() as any)}
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", color: "#111",
              borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16,
              boxShadow: "0 -20px 60px rgba(0,0,0,0.45)", transform: "translateY(8px)", opacity: 0,
              animation: "sheetIn 180ms ease forwards"
            }}
          >
            <style>{`@keyframes sheetIn { to { transform: translateY(0); opacity: 1; } } .btn{padding:8px 12px;border-radius:8px;border:1px solid #999;background:#f7f7f7;cursor:pointer}`}</style>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <button onPointerUp={() => setConfirmOpen(false)} onClick={() => setConfirmOpen(false)} title="Закрыть" className="btn" disabled={isSending || uploading}>×</button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Отправить заказ менеджерам для просчёта стоимости?</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onPointerUp={handleSendPdf} onClick={handleSendPdf} disabled={isSending || uploading} style={{ background: "#e5ffe5", borderColor: "#99d199" }}>
                {isSending || uploading ? "Отправляем…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success hint after send */}
      <div ref={afterHintRef}>
        {sentOk && (
          <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
            <div style={{ opacity: 0.92, marginBottom: 10 }}>{`Спасибо${customerName ? `, ${customerName}` : ""}! Сохраните PDF заказа при необходимости.`}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onPointerUp={handleSavePdf} onClick={handleSavePdf} disabled={isSaving} style={glassButtonStyle("sm", isSaving)} title="Сохранить PDF заказ">
                {isSaving ? "Формируем PDF…" : "Сохранить PDF"}
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Примечание: генерация PDF может занять до 5–10 секунд. Пожалуйста, подождите.
            </div>
          </section>
        )}
      </div>

      {(isSending || isSaving || uploading) && <BusyOverlay text={overlayText} />}
    </div>
  );
}
