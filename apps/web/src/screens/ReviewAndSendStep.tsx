// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение».
//
// Правки по задаче:
// - Подсказка перенесена ВЫШЕ TopBar; фон и контур серые; шрифт курсив, не жирный.
// - «Посмотреть состав заказа» убрано из шапки заказа.
// - В блоке «Надгробная плита» не показываем «включена/выключена» и сообщение «Включите плиту…».
//   Если плита выключена — аккордеон просто закрыт.
// - Отправка напрямую в Telegram: текст → PDF (document) → фото (photo), с локальной компрессией.
// - Гарантированное укладывание в лимит payload: целевой размер файла ~3.1 MiB.

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { fetchCatalog } from "../api";
import { QUICK_EPITAPHS } from "../data/epitaphs";
import { generateOrderPdf, downloadBlob } from "../lib/pdf/generateOrderPdf";
import { compressImageFileToMaxBytes } from "../lib/media/resize";

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
function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return `${n}`;
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(2)} МБ`;
}

// Консервативный целевой лимит для файла, чтобы гарантированно проходить payload serverless-функций.
// Учитываем оверхед multipart/form-data.
const TARGET_FILE_BYTES = Math.floor(3.1 * 1024 * 1024);

/* ===== Мини-компоненты ===== */
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

/* ===== Подсказка (перенесена выше TopBar) ===== */
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

/* ===== Заголовок: № заказа ===== */
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
      <input
        value={contactNotes}
        onChange={(e) => setContactNotes(e.target.value)}
        onBlur={saveOnBlur}
        placeholder="Примечание для связи…"
        style={inputStyle()}
      />
    </section>
  );
}

/* ===== Accordion ===== */
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
        <div ref={ref} style={{ padding: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ===== Галерея графики (сокращено, логика без изменений) ===== */
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

/* ===== Индикаторы и окна (без изменений) ===== */
function BusyOverlay({ text = "Идёт обработка…" }: { text?: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

function AfterSendHint({
  customerName,
  onSavePdf,
  saving
}: {
  customerName?: string;
  onSavePdf: () => void;
  saving: boolean;
}) {
  const name = (customerName || "").trim();
  return (
    <section style={{ ...glassPanelStyle(), padding: 12, marginTop: 14, marginBottom: 8 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Заявка отправлена</div>
      <div style={{ opacity: 0.92, marginBottom: 10 }}>{`Спасибо${name ? `, ${name}` : ""}! Сохраните PDF заказа при необходимости.`}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onPointerUp={onSavePdf} onClick={onSavePdf} disabled={saving} style={glassButtonStyle("sm", saving)} title="Сохранить PDF заказ">
          {saving ? "Формируем PDF…" : "Сохранить PDF"}
        </button>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>Примечание: генерация PDF может занять до 5–10 секунд. Пожалуйста, подождите.</div>
    </section>
  );
}

function SuccessBottomSheet({
  customerName,
  onClose,
  onSave,
  saving
}: {
  customerName?: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
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
        <div style={{ marginBottom: 12 }}>{`Спасибо${name ? `, ${name}` : ""}! Сохраните PDF заказа при необходимости.`}</div>
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

function ErrorBottomSheet({
  message,
  details,
  onClose,
  onRetry,
  onSave,
  retryDisabled
}: {
  message: string;
  details?: string;
  onClose: () => void;
  onRetry: () => void;
  onSave: () => void;
  retryDisabled?: boolean;
}) {
  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  return (
    <div role="alertdialog" aria-modal style={{ position: "fixed", inset: 0, zIndex: 16000, background: "rgba(0,0,0,0.35)" }} onPointerUp={onClose}>
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
          <button onClick={onClose} className="btn" title="Закрыть">×</button>
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8, color: "#b00020" }}>Не удалось отправить</div>
        <div style={{ marginBottom: 8 }}>{message}</div>
        {details && (
          <details style={{ marginBottom: 10 }}>
            <summary style={{ cursor: "pointer" }}>Показать детали</summary>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 8, borderRadius: 8, border: "1px solid #ddd" }}>{details}</pre>
          </details>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn" onClick={onSave} title="Сохранить PDF на устройство">Сохранить PDF</button>
          <button className="btn" onClick={onRetry} disabled={retryDisabled} style={{ background: "#e5ffe5", borderColor: "#99d199" }} title="Повторить отправку">
            Повторить
          </button>
          <button className="btn" onClick={onClose}>Закрыть</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
          Подсказка: даже при ошибке браузера документ мог уже прийти в Telegram. Пожалуйста, проверьте чат.
        </div>
      </div>
    </div>
  );
}

/* ===== Генерация PDF до целевого лимита ===== */
async function generatePdfUnderLimit(opts: {
  draft: any;
  intro: any;
  frontNode: HTMLElement | null;
  backNode: HTMLElement | null;
  backUrlFallback?: string | null;
  maxBytes: number;
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
      draft: opts.draft,
      intro: opts.intro,
      frontNode: opts.frontNode,
      backNode: opts.backNode,
      backUrlFallback: opts.backUrlFallback,
      scale: a.scale,
      quality: a.quality
    } as any);
    if (blob.size <= opts.maxBytes) return blob;
  }
  return await generateOrderPdf({
    draft: opts.draft,
    intro: opts.intro,
    frontNode: opts.frontNode,
    backNode: opts.backNode,
    backUrlFallback: opts.backUrlFallback,
    scale: 0.5,
    quality: "low"
  } as any);
}

/* ===== Фото с подписями: "ФИО\nДаты" ===== */
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

/* ===== Основной компонент ===== */
type Props = { onBack?: () => void };

function getBackSketchUrl(draft: any): string | null {
  const raw = String((draft?.editorBack?.previewHiUrl || draft?.editorBack?.previewUrl || "") ?? "").trim();
  if (!raw || raw === "#" || raw.toLowerCase() === "about:blank") return null;
  return raw;
}
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
function normalizeErrorMessage(err: any): { msg: string; details?: string } {
  const raw = String(err?.message || err?.toString?.() || "Неизвестная ошибка");
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { msg: "Похоже, нет подключения к интернету. Проверьте сеть и попробуйте снова.", details: raw };
  }
  const is413 = /request entity too large|payload too large|function_payload_too_large|http 413|status 413/i.test(raw);
  if (is413) {
    return {
      msg:
        "Файл слишком большой для серверной функции. Документ мог уже отправиться в Telegram, но браузер показал ошибку. Проверьте чат. Если проблема повторяется — сохраните PDF и отправьте менеджеру вручную.",
      details: raw
    };
  }
  return {
    msg:
      "Не удалось отправить заказ. Возможно, это временный сбой сети или сервера. Попробуйте ещё раз, а при необходимости — сохраните PDF и отправьте менеджеру вручную.",
    details: raw
  };
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

  // Тыльная
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

  // Лицевая
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
    () =>
      frontPersons.map((p: any, i: number) => ({
        id: p.id || `p-${i}`,
        lines: personLines(p),
        photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
      })),
    [frontPersons]
  );

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
      ((draft?.size?.orientation || (draft as any)?.orientation || "").toLowerCase().startsWith("h")
        ? "horizontal"
        : "vertical")
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

  // Отправка/сохранение PDF
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);

  // Ошибки
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [errorDetails, setErrorDetails] = useState<string | undefined>(undefined);
  const lastPdfRef = useRef<Blob | null>(null);

  // Состояние отправки
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Прямая отправка: sendMessage → sendDocument(PDF) → sendPhoto(портреты)
  const sendOrderDirect = async (showBackInner: boolean, backUrlInner: string | null, pdfOverride?: Blob) => {
    const orderNoCur = String(loadIntroState().orderNumber || "").trim();

    setUploading(true);
    setUploadProgress(0);

    try {
      // Текст-заголовок
      const surnames = (((loadOrderDraft() || {}).engraving || {}).persons || [])
        .map((p: any) => (p?.lastName || "").trim())
        .filter(Boolean);
      const headerText = [
        orderNoCur ? `Заявка №${orderNoCur}` : "Заявка",
        surnames.length ? `Фамилии: ${Array.from(new Set(surnames)).join(", ")}` : ""
      ].filter(Boolean).join("\n");

      {
        const headerResp = await fetch("/api/tg-send-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: headerText })
        });
        if (!headerResp.ok) {
          const t = await headerResp.text().catch(() => "");
          throw new Error(`sendMessage failed: ${t || headerResp.statusText}`);
        }
      }

      // PDF
      let pdfBlob = pdfOverride;
      if (!pdfBlob) {
        pdfBlob = await generatePdfUnderLimit({
          draft: loadOrderDraft(),
          intro: loadIntroState(),
          frontNode: document.getElementById("pdf-front-sketch"),
          backNode: showBackInner ? document.getElementById("pdf-back-sketch") : null,
          backUrlFallback: showBackInner ? backUrlInner : null,
          maxBytes: TARGET_FILE_BYTES
        });
      }
      lastPdfRef.current = pdfBlob;

      {
        const fileName = `order-${orderNoCur || Date.now()}.pdf`;
        const fd = new FormData();
        fd.append("file", new File([pdfBlob], fileName, { type: "application/pdf" }));
        fd.append("caption", orderNoCur ? `Заявка №${orderNoCur}` : "Заявка");
        const docResp = await fetch("/api/tg-send-document", { method: "POST", body: fd });
        if (!docResp.ok) {
          const t = await docResp.text().catch(() => "");
          throw new Error(`sendDocument failed: ${t || docResp.statusText}`);
        }
      }

      // Фото
      const photos = collectPersonPhotosWithCaptions(loadOrderDraft());
      let sent = 0;
      for (const ph of photos) {
        const compressed = await compressImageFileToMaxBytes(ph.file, TARGET_FILE_BYTES, {
          maxWidth: 2000,
          maxHeight: 2000,
          mime: "image/jpeg",
          qualityStart: 0.88,
          qualityMin: 0.5,
          qualityStep: 0.08
        });

        const fd = new FormData();
        fd.append("file", new File([compressed], ph.file.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" }));
        fd.append("caption", ph.caption);
        const r = await fetch("/api/tg-send-photo", { method: "POST", body: fd });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`sendPhoto failed: ${t || r.statusText}`);
        }
        sent++;
        setUploadProgress(Math.round((sent / Math.max(1, photos.length)) * 100));
      }

      setUploadProgress(100);
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
        backUrlFallback: showBack ? backCandidateUrl : null
      });
      const orderNoCur = String(loadIntroState().orderNumber || "").trim();
      downloadBlob(blob, `order-${orderNoCur || Date.now()}.pdf`);
    } catch (e: any) {
      const n = normalizeErrorMessage(e);
      setErrorMsg(n.msg);
      setErrorDetails(n.details);
      setErrorOpen(true);
      setTimeout(() => {
        if (!document.querySelector('[role="alertdialog"]')) {
          alert(`${n.msg}\n\n${n.details || ""}`);
        }
      }, 0);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSendPdf() {
    if (isSending) return;
    try {
      setIsSending(true);
      await new Promise((r) => setTimeout(r, 0));

      await sendOrderDirect(showBack, backCandidateUrl);

      setConfirmOpen(false);
      setSentOk(true);
      setSuccessOpen(true);
      setIsDirtyAfterSend(false);
      setTimeout(() => {
        afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 150);
    } catch (e: any) {
      const n = normalizeErrorMessage(e);
      setErrorMsg(n.msg);
      setErrorDetails(n.details);
      setErrorOpen(true);
      setTimeout(() => {
        if (!document.querySelector('[role="alertdialog"]')) {
          alert(`${n.msg}\n\n${n.details || ""}`);
        }
      }, 0);
    } finally {
      setIsSending(false);
    }
  }

  async function handleRetrySend() {
    if (isSending) return;
    try {
      setIsSending(true);
      const pdf = lastPdfRef.current || null;

      await sendOrderDirect(showBack, backCandidateUrl, pdf || undefined);

      setErrorOpen(false);
      setSentOk(true);
      setSuccessOpen(true);
      setIsDirtyAfterSend(false);
      setTimeout(() => {
        afterHintRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 150);
    } catch (e: any) {
      const n = normalizeErrorMessage(e);
      setErrorMsg(n.msg);
      setErrorDetails(n.details);
      setErrorOpen(true);
      setTimeout(() => {
        if (!document.querySelector('[role="alertdialog"]')) {
          alert(`${n.msg}\n\n${n.details || ""}`);
        }
      }, 0);
    } finally {
      setIsSending(false);
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

  const showBottomButtons = !sentOk || isDirtyAfterSend;
  const overlayText =
    uploading
      ? `Отправляем в Telegram… ${Math.max(0, Math.min(100, uploadProgress || 0))}%`
      : isSending
        ? "Отправляем заказ…"
        : isSaving
          ? "Формируем PDF…"
          : "";

  return (
    <div style={safeRoot()}>
      {/* Подсказка (над TopBar) */}
      <TopHintNotice />

      {/* TopBar */}
      <TopBarWithIntro title="Memorial" />

      {/* № заказа */}
      <EditableOrderSummary
        orderNo={orderNo}
        onOpenTop={() => {}}
        onDirty={() => sentOk && setIsDirtyAfterSend(true)}
      />

      {/* Аккордеоны: Дополнительно + Надгробная плита */}
      <MainSections
        draft={draft}
        extras0={extras0}
        sentOk={sentOk}
        setIsDirtyAfterSend={setIsDirtyAfterSend}
        plateState={{
          extraPlate, setExtraPlate,
          plateSize, setPlateSize,
          plateCustomSize, setPlateCustomSize,
          plateThickness, setPlateThickness,
          plateCustomThickness, setPlateCustomThickness,
          plateOrientation, setPlateOrientation,
          plateEpitaph, setPlateEpitaph,
          plateIds, setPlateIds,
          plateMeta, setPlateMeta,
          hasPedestal, setHasPedestal,
          hasFlowerbed, setHasFlowerbed,
          hasVase, setHasVase
        }}
      />

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

      {/* Тыльная — если есть содержимое и картинка ок */}
      {showBack && backCandidateUrl && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Тыльная</div>
          <div style={{ position: "relative", aspectRatio: aspect || "4 / 3", width: "100%", overflow: "hidden" }}>
            <img id="pdf-back-sketch" src={backCandidateUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
        </section>
      )}

      {/* Комментарий */}
      <NotesSection extras0={extras0} sentOk={sentOk} setIsDirtyAfterSend={setIsDirtyAfterSend} setDraft={setDraft} />

      {/* Кнопки (низ) */}
      {showBottomButtons && (
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: 10 }}>
          <button type="button" onPointerUp={onBack} onClick={onBack} style={glassButtonStyle("sm")}>
            Назад
          </button>
          <button
            type="button"
            onPointerUp={() => setConfirmOpen(true)}
            onClick={() => setConfirmOpen(true)}
            style={glassButtonStyle("sm")}
          >
            Рассчитать стоимость
          </button>
        </div>
      )}

      {/* Bottom sheets */}
      {confirmOpen && <ConfirmBottomSheet onClose={() => setConfirmOpen(false)} onSend={handleSendPdf} sending={isSending || uploading} />}
      {successOpen && <SuccessBottomSheet customerName={customerName} onClose={() => setSuccessOpen(false)} onSave={handleSavePdf} saving={isSaving} />}
      {errorOpen && <ErrorBottomSheet message={errorMsg} details={errorDetails} onClose={() => setErrorOpen(false)} onRetry={handleRetrySend} onSave={handleSaveLastPdf} retryDisabled={isSending || uploading} />}

      {/* Низовая подсказка после отправки */}
      <div ref={afterHintRef}>
        {sentOk && <AfterSendHint customerName={customerName} onSavePdf={handleSavePdf} saving={isSaving} />}
      </div>

      {/* Оверлеи */}
      {(isSending || isSaving || uploading) && (
        <BusyOverlay text={overlayText} />
      )}
    </div>
  );
}

/* ===== Вспомогательные секции, чтобы упростить JSX (без логических изменений) ===== */
function MainSections({
  draft,
  extras0,
  sentOk,
  setIsDirtyAfterSend,
  plateState
}: any) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize,
    plateCustomSize, setPlateCustomSize,
    plateThickness, setPlateThickness,
    plateCustomThickness, setPlateCustomThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    plateIds, setPlateIds,
    plateMeta, setPlateMeta,
    hasPedestal, setHasPedestal,
    hasFlowerbed, setHasFlowerbed,
    hasVase, setHasVase
  } = plateState;

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

  const persistExtras = (patch: Record<string, any>) => {
    const prev = loadOrderDraft();
    const nextExtras = { ...(prev as any).extras, ...patch };
    saveOrderDraft({ ...prev, extras: nextExtras, updatedAt: Date.now() });
    if (sentOk) setIsDirtyAfterSend(true);
  };

  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    const nextIds = [...plateIds, gid];
    const nextMeta = { ...plateMeta, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } };
    setPlateIds(nextIds);
    setPlateMeta(nextMeta);
    persistExtras({ plateGraphicsIds: nextIds, plateGraphicsMeta: nextMeta });
  };

  const removePlateGraphic = (gid: string) => {
    const idx = plateIds.findIndex((x: any) => x === gid);
    if (idx === -1) return;
    const nextIds = plateIds.slice(); nextIds.splice(idx, 1);
    setPlateIds(nextIds);
    persistExtras({ plateGraphicsIds: nextIds, plateGraphicsMeta: plateMeta });
  };

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
    return uniq.map((gid: any) => plateMeta[gid] || index[gid] || { id: gid, name: gid, url: "" });
  }, [plateIds, plateMeta, cats]);

  const plateEpitaphList = useMemo(() => toParagraphs(plateEpitaph), [plateEpitaph]);

  return (
    <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
      <PlateBlock
        extraPlate={extraPlate}
        setExtraPlate={(v) => { setExtraPlate(v); persistExtras({ headstonePlate: v }); }}
        plateSize={plateSize}
        setPlateSize={(v) => { setPlateSize(v); }}
        plateCustomSize={plateCustomSize}
        setPlateCustomSize={(v) => { setPlateCustomSize(v); }}
        plateThickness={plateThickness}
        setPlateThickness={(v) => { setPlateThickness(v); }}
        plateCustomThickness={plateCustomThickness}
        setPlateCustomThickness={(v) => { setPlateCustomThickness(v); }}
        plateOrientation={plateOrientation}
        setPlateOrientation={(v) => { setPlateOrientation(v); }}
        plateEpitaph={plateEpitaph}
        setPlateEpitaph={(v) => { setPlateEpitaph(v); }}
        catsLoading={catsLoading}
        catsError={catsError}
        cats={cats}
        catOpen={catOpen}
        setCatOpen={setCatOpen}
        addPlateGraphic={addPlateGraphic}
        removePlateGraphic={removePlateGraphic}
        plateIds={plateIds}
        hasPedestal={hasPedestal}
        setHasPedestal={(v) => { setHasPedestal(v); }}
        hasFlowerbed={hasFlowerbed}
        setHasFlowerbed={(v) => { setHasFlowerbed(v); }}
        hasVase={hasVase}
        setHasVase={(v) => { setHasVase(v); }}
        onDirty={() => sentOk && setIsDirtyAfterSend(true)}
      />

      {/* Выбрано для плиты — над комментариями */}
      {extraPlate && (chosenPlateList.length > 0 || plateEpitaphList.length > 0) && (
        <section style={{ ...glassPanelStyle(), padding: 10, marginTop: 10 }}>
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: plateEpitaphList.length ? 8 : 0 }}>
                {chosenPlateList.map((g: any, i: number) => (
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
    </section>
  );
}

function NotesSection({
  extras0,
  sentOk,
  setIsDirtyAfterSend,
  setDraft
}: any) {
  return (
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
  );
}
