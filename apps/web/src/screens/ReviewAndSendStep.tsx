// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение без TopBar.
//
// Требования:
// - Если мини‑эскиз редактора ПУСТОЙ — в лицевой карточке превью показываем «мини‑эскиз»,
//   сгенерированный по шаблону из SketchTemplate.tsx (данные из шага эпитафии).
// - В блоке «Надгробная плита», после выбора размеров — ДВА аккордеона:
//   1) «Эпитафия на надгробной плите» (как на шаге эпитафии: быстрый выбор + разворачиваемый список, добавление своего текста).
//   2) «Графика на надгробной плите» (без изменений).
// - Блок «Выбрано для плиты» перенесён ПОД эскизы, в секцию «Дополнительно» (сразу под заголовком).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";
import { loadIntroState, saveIntro, type Intro } from "../lib/intro";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";
import { fetchCatalog } from "../api";
import SketchTemplate from "../components/SketchTemplate";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";

/* ===== UI ===== */
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
  const map = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: map[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
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
function smallText(): React.CSSProperties {
  return { opacity: 0.8, fontSize: 12 };
}
const sectionBox: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 10,
  padding: 10
};
const dividerLine: React.CSSProperties = {
  borderTop: "1px solid rgba(255,255,255,0.12)",
  margin: "10px 0"
};
function chip(txt: string) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 12, background: "rgba(138,180,255,0.18)", color: "#dbe7ff", whiteSpace: "nowrap" }}>
      {txt}
    </span>
  );
}
function AccentBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,242,201,0.15)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 10, padding: 8 }}>
      {children}
    </div>
  );
}

/* ===== Utils ===== */
function orientationLabelShort(o?: string) {
  if (!o) return "";
  const k = String(o).toLowerCase();
  if (k.startsWith("h")) return "горизонтально";
  if (k.startsWith("v")) return "вертикально";
  return "";
}
const isCrossCategoryName = (s?: string) =>
  (s || "").toLowerCase().includes("крест") || (s || "").toLowerCase().includes("cross");
const personLines = (p: any): string[] => {
  const l1 = (p?.lastName || "").trim();
  const l2 = [p?.firstName, p?.middleName].map((x) => (x || "").trim()).filter(Boolean).join(" ");
  const l3 = [p?.birthDate, p?.deathDate].map((x) => (x || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
};

/* ===== Аккордеон (выразительный) — до PlateBlock ===== */
function LoudAccordion({
  title,
  open,
  onToggle,
  children
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const m = () => setH(ref.current?.scrollHeight || 0);
    m();
    const ro = new ResizeObserver(m);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div style={{ ...glassPanelStyle(), padding: 0, borderWidth: 2, borderColor: "rgba(138,180,255,0.35)", boxShadow: open ? "0 6px 24px rgba(0,0,0,0.35)" : "none" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "14px 16px",
          background: open ? "linear-gradient(180deg, rgba(138,180,255,0.25) 0%, rgba(138,180,255,0.12) 100%)" : "rgba(255,255,255,0.06)",
          border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 16, fontWeight: 700, letterSpacing: 0.2
        }}
      >
        <span>{title}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      <div style={{ overflow: "hidden", height: open ? h : 0, transition: "height 260ms ease" }}>
        <div ref={ref} style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Подложка для превью ===== */
function supportsMask(): boolean {
  try {
    // @ts-ignore
    if (typeof CSS !== "undefined" && CSS.supports) {
      // @ts-ignore
      return CSS.supports("mask-image", 'url("")') || CSS.supports("-webkit-mask-image", 'url("")');
    }
  } catch {}
  return false;
}
function Underlay({ itemUrl, mirror = false, showSilhouette = true }: { itemUrl?: string; mirror?: boolean; showSilhouette?: boolean; }) {
  const isPng = !!itemUrl && /\.png(\?|#|$)/i.test(itemUrl);
  const canMask = supportsMask();
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)", zIndex: 0 }} />
      {showSilhouette && itemUrl && (isPng && canMask ? (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(25,25,25,0.9)",
          WebkitMaskImage: `url(${itemUrl})`, WebkitMaskRepeat: "no-repeat", WebkitMaskPosition: "center", WebkitMaskSize: "contain",
          maskImage: `url(${itemUrl})`, maskRepeat: "no-repeat", maskPosition: "center", maskSize: "contain",
          transform: mirror ? "scaleX(-1)" : "none", transformOrigin: "center", zIndex: 1, pointerEvents: "none"
        }} />
      ) : (
        itemUrl && (
          <img src={itemUrl} alt="" style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
            filter: "grayscale(1) brightness(0) opacity(0.9)", mixBlendMode: "multiply",
            transform: mirror ? "scaleX(-1)" : "none", transformOrigin: "center", zIndex: 1, pointerEvents: "none"
          }} draggable={false} />
        )
      ))}
    </div>
  );
}

/* ===== Thumb ===== */
const Thumb = ({ url, alt = "", size = 60 }: { url?: string; alt?: string; size?: number }) => (
  <div style={{
    width: size, height: size, borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.04)",
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxSizing: "border-box"
  }}>
    {url ? <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} /> : <div style={{ ...smallText() }}>нет</div>}
  </div>
);

/* ===== SidePreview с fallback SketchTemplate (лицевая) ===== */
type TemplateFallback = {
  item: any;
  peopleBlocks: { id: string; lines: string[]; photo?: string | null }[];
  crosses: any[];
  others: any[];
  epitaphs: string[];
  carvingOpacity?: number;
};
function SidePreview({
  title, miniUrl, itemUrl, mirror = false, aspect, showSilhouette = true, fallbackTemplate
}: {
  title: string; miniUrl?: string | null; itemUrl?: string; mirror?: boolean; aspect?: string; showSilhouette?: boolean;
  fallbackTemplate?: TemplateFallback;
}) {
  const hasPreview = typeof miniUrl === "string" && miniUrl.length > 0;
  const useFallback = !hasPreview && !!fallbackTemplate;
  return (
    <div style={{ ...glassPanelStyle(), padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: aspect || undefined, minHeight: aspect ? undefined : 240 }}>
        {!useFallback && <Underlay itemUrl={itemUrl} mirror={mirror} showSilhouette={showSilhouette} />}
        {hasPreview ? (
          <img src={miniUrl!} alt="" style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain", zIndex: 2, display: "block" }} draggable={false} />
        ) : useFallback ? (
          <div style={{ position: "relative", zIndex: 2 }}>
            <SketchTemplate
              item={fallbackTemplate!.item}
              peopleBlocks={fallbackTemplate!.peopleBlocks}
              crosses={fallbackTemplate!.crosses}
              others={fallbackTemplate!.others}
              epitaphs={fallbackTemplate!.epitaphs}
              carvingOpacity={fallbackTemplate!.carvingOpacity ?? 0.4}
            />
          </div>
        ) : (
          <div style={{ position: "relative", zIndex: 2, width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.9 }}>Нет</div>
        )}
      </div>
    </div>
  );
}

/* ===== Grid для каталога графики плиты (до PlateBlock) ===== */
function CatGrid({
  items, plateIds, addGraphic, removeGraphic
}: {
  items: any[]; plateIds: string[]; addGraphic: (g: any) => void; removeGraphic: (gid: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 12 }}>
      {items.map((g: any, idx: number) => {
        const gid = String(g.id || g.relPath || g.url || g.name || idx);
        const qty = plateIds.filter((x) => x === gid).length;
        const thumbUrl = g.preview || g.url || "";
        const name = g.name || gid;
        return (
          <div key={gid} style={{ ...glassPanelStyle(), padding: 8, borderRadius: 12 }}>
            <div
              role="button"
              title={name}
              onClick={() => addGraphic(g)}
              style={{
                borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.04)",
                aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer"
              }}
            >
              {thumbUrl ? (
                <img src={thumbUrl} alt={name} style={{ maxWidth: "90%", maxHeight: "90%", width: "auto", height: "auto", display: "block" }} />
              ) : (
                <div style={{ ...smallText() }}>нет</div>
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

/* ===== Editable summary (контакты + резная работа) ===== */
function EditableOrderSummary() {
  const [draft, setDraft] = useState(() => loadOrderDraft());
  const introState = loadIntroState();
  const [name, setName] = useState<string>(introState.intro?.customerName || "");
  const [phone, setPhone] = useState<string>(introState.intro?.customerPhone || "");
  const [contactNotes, setContactNotes] = useState<string>(introState.intro?.customerNotes || "");
  const [sizeNotes, setSizeNotes] = useState<string>(draft?.size?.notes || "");

  useEffect(() => {
    const onUpd = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
      window.removeEventListener("storage", onUpd);
    };
  }, []);

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
    `${(draft?.size?.width && Math.round(draft.size.width / 10)) || "—"}×` +
    `${(draft?.size?.height && Math.round(draft.size.height / 10)) || "—"}×` +
    `${(draft?.size?.thickness && Math.round(draft.size.thickness / 10)) || "—"} см`;
  const orient = orientationLabelShort(draft?.size?.orientation || (draft as any)?.orientation);

  return (
    <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 700 }}>Данные заказа</div>

      <div style={{ ...sectionBox, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Контакты</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input value={name} onChange={(e) => { setName(e.target.value); scheduleSave(); }} placeholder="Имя" style={inputStyle()} />
          <input value={phone} onChange={(e) => { setPhone(e.target.value); scheduleSave(); }} placeholder="+7..." inputMode="tel" style={inputStyle()} />
        </div>
        <input value={contactNotes} onChange={(e) => { setContactNotes(e.target.value); scheduleSave(); }} placeholder="Примечание (удобное время, мессенджер…)" style={inputStyle()} />
      </div>

      <div style={{ ...sectionBox, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Резная работа</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
          <div style={{
            borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)",
            width: 96, height: 96, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box"
          }}>
            {draft?.item?.url ? (<img src={draft.item.url} alt="" style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} draggable={false} />) : null}
          </div>
          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
            {(draft?.item?.name || draft?.item?.url) && (
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {draft?.item?.name || decodeURIComponent((draft?.item?.url || "").split("/").pop() || "")}
              </div>
            )}
            <div style={{ opacity: 0.9 }}>Размеры: {dims} {orient ? ` · ${orient}` : ""}</div>
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

/* ===== Main ===== */
type Props = { onBack?: () => void; onSend?: (payload?: any) => void };
export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const [draft, setDraft] = useState(loadOrderDraft());
  const intro = loadIntroState();

  useEffect(() => {
    const onUpd = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
      window.removeEventListener("storage", onUpd);
    };
  }, []);

  const itemUrl = (draft as any)?.item?.url as string | undefined;
  const [aspect, setAspect] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!itemUrl) return;
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth || 0;
      const h = im.naturalHeight || 0;
      if (w && h) setAspect(`${w} / ${h}`);
    };
    im.src = itemUrl;
  }, [itemUrl]);

  const frontMini = ((draft as any)?.editor?.previewHiUrl as string | undefined) || ((draft as any)?.editor?.previewUrl as string | undefined) || null;
  const backMini = ((draft as any)?.editorBack?.previewHiUrl as string | undefined) || ((draft as any)?.editorBack?.previewUrl as string | undefined) || null;

  /* ——— Лицевая сторона ——— */
  const frontPersons = ((draft.engraving?.persons as any[]) || []).filter(Boolean);
  const frontGraphicsRaw: any[] = (draft.graphics as any[])?.filter(Boolean) || [];

  const frontUnique = useMemo(() => {
    const first: Record<string, any> = {};
    frontGraphicsRaw.forEach((g) => { const id = g?.id || g?.url || g?.name; if (id && !first[id]) first[id] = g; });
    return Object.values(first);
  }, [frontGraphicsRaw]);

  const frontCounts: Record<string, number> = useMemo(() => {
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

  // Данные для fallback SketchTemplate (лицевая)
  const frontPeopleBlocks = useMemo(
    () => frontPersons.map((p: any, idx: number) => ({
      id: p.id || `person-${idx}`,
      lines: personLines(p),
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null
    })),
    [frontPersons]
  );
  const frontCrosses = useMemo(
    () => frontUnique.filter((g: any) => isCrossCategoryName(g?.catName) || isCrossCategoryName(g?.catSlug)),
    [frontUnique]
  );
  const frontOthers = useMemo(
    () => frontUnique.filter((g: any) => !(isCrossCategoryName(g?.catName) || isCrossCategoryName(g?.catSlug))),
    [frontUnique]
  );

  /* ——— Тыльная сторона ——— */
  const rearPeople = ((((draft as any)?.editorBack?.people as any[]) || []).filter(Boolean)) as Array<{
    id?: string; lastName?: string; firstName?: string; middleName?: string; birthDate?: string; deathDate?: string; photoPreview?: string | null;
  }>;
  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCounts: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {}; (rearIds || []).forEach((id) => (m[id] = (m[id] || 0) + 1)); return m;
  }, [rearIds]);
  const rearUnique = useMemo(() => {
    const ids = Array.from(new Set(rearIds || [])); return ids.map((id) => rearMeta?.[id] || { id, name: id, url: "" });
  }, [rearIds, rearMeta]);
  const rearEpitaphs: string[] = useMemo(() => ((((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean)), [draft]);
  const backWishes = (((draft as any)?.editorBack?.wishes || "").trim());

  /* ——— Дополнительно ——— */
  const initialExtras = (draft as any)?.extras || {};
  const initialBase = (initialExtras.base === undefined || initialExtras.base === null) ? true : !!initialExtras.base;
  const [extraBase, setExtraBase] = useState<boolean>(initialBase);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(!!initialExtras.flowerbed);
  const [extraPlate, setExtraPlate] = useState<boolean>(!!initialExtras.headstonePlate);

  const defaultPlateOrientation = ((draft?.size?.orientation || (draft as any)?.orientation || "vertical").toLowerCase().startsWith("h")) ? "horizontal" : "vertical";
  const sizeOptions = ["100×50 см", "120×60 см", "140×70 см"];
  const thicknessOptions = ["5 см", "8 см", "10 см"];
  const [plateSize, setPlateSize] = useState<string>((initialExtras as any)?.plateSize && sizeOptions.includes((initialExtras as any)?.plateSize) ? (initialExtras as any)?.plateSize : sizeOptions[0]);
  const [plateThickness, setPlateThickness] = useState<string>((initialExtras as any)?.plateThickness && thicknessOptions.includes((initialExtras as any)?.plateThickness) ? (initialExtras as any)?.plateThickness : thicknessOptions[0]);
  const [plateOrientation, setPlateOrientation] = useState<string>((initialExtras as any)?.plateOrientation || defaultPlateOrientation);

  // Эпитафия для плиты — теперь с выбором (как в EpitaphStep), храним в одном поле (join с \n\n)
  const [plateEpitaph, setPlateEpitaph] = useState<string>((initialExtras as any)?.plateEpitaph || "");
  // Выбранные графики на плите
  const [plateIds, setPlateIds] = useState<string[]>(((draft as any)?.extras?.plateGraphicsIds as string[]) || []);
  const [plateMeta, setPlateMeta] = useState<Record<string, any>>(((draft as any)?.extras?.plateGraphicsMeta as Record<string, any>) || {});

  // Каталог графики
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

  const isFlowersCat = (name?: string) => {
    const s = (name || "").toLowerCase();
    return s.includes("цвет") || s.includes("flower");
  };

  const addPlateGraphic = (g: any) => {
    const gid = String(g.id || g.relPath || g.url || g.name);
    const next = plateIds.concat(gid);
    setPlateIds(next);
    setPlateMeta((m) => ({ ...m, [gid]: { id: gid, name: g.name || gid, url: g.preview || g.url || "" } }));
  };
  const removePlateGraphic = (gid: string) => {
    const idx = plateIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const next = plateIds.slice(); next.splice(idx, 1);
    setPlateIds(next);
  };

  // Список выбранных для вывода (под эскизами)
  const chosenPlateList = useMemo(() => {
    // Соберём индекс по cats для восстановления meta, если отсутствует
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
    return uniq.map((gid) => {
      const meta = plateMeta[gid] || index[gid] || { id: gid, name: gid, url: "" };
      return { id: gid, name: meta.name || gid, url: meta.url || "" };
    });
  }, [plateIds, plateMeta, cats]);

  // Сохранение extras в драфт
  useEffect(() => {
    const prev = loadOrderDraft();
    const extras: any = {
      ...(prev as any).extras,
      base: extraBase, flowerbed: extraFlowerbed, headstonePlate: extraPlate,
      plateSize: extraPlate ? plateSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph?.trim() || undefined) : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined,
      plateGraphicsMeta: extraPlate ? plateMeta : undefined
    };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
    setDraft(loadOrderDraft());
  }, [extraBase, extraFlowerbed, extraPlate, plateSize, plateThickness, plateOrientation, plateEpitaph, plateIds, plateMeta]);

  /* ===== Отправка ===== */
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const handleSend = async () => {
    setBusy(true);
    setErr("");
    const name = (intro.intro?.customerName || "").trim();

    const attachments: any = {
      frontPreview: (draft as any)?.editor?.previewHiUrl || (draft as any)?.editor?.previewUrl || null,
      backPreview: (draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl || null,
      itemUrl: itemUrl || null,
      plateGraphics: chosenPlateList
    };

    const extras: Extras & {
      base?: boolean; flowerbed?: boolean; headstonePlate?: boolean; plateSize?: string;
      plateThickness?: string; plateOrientation?: string; plateEpitaph?: string;
      plateGraphicsIds?: string[]; attachments?: any;
    } = {
      base: extraBase, flowerbed: extraFlowerbed, headstonePlate: extraPlate,
      plateSize: extraPlate ? plateSize : undefined,
      plateThickness: extraPlate ? plateThickness : undefined,
      plateOrientation: extraPlate ? plateOrientation : undefined,
      plateEpitaph: extraPlate ? (plateEpitaph?.trim() || undefined) : undefined,
      plateGraphicsIds: extraPlate ? plateIds : undefined,
      attachments
    };

    try {
      await sendOrderEmailAndNotifyTg(extras);
      const nm = name || "Заказчик";
      window.alert(`${nm}, Ваш заказ принят. В ближайшее время менеджер свяжется с Вами по указанному номеру для уточнения деталей и подтверждения заказа.`);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Подсказка */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <p style={{ margin: 0, opacity: 0.95, lineHeight: 1.45 }}>
          Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные. Для редактирования элементов
          гравировки перейдите на соответствующий шаг (используйте навигацию вверху). Когда всё верно — нажмите «Отправить заказ».
        </p>
      </section>

      {/* Контакты + Резная работа */}
      <EditableOrderSummary />

      {/* Подробности лицевой стороны */}
      {frontPersons.length || frontUnique.length || frontEpitaphs.length || frontWishes ? (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Лицевая")}</div>

          {/* Усопшие */}
          {frontPersons.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Усопшие</div>
              <div style={{ display: "grid", gap: 8 }}>
                {frontPersons.map((p: any, idx: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
                  const dates = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                  return (
                    <div key={p.id || `fp-${idx}`} style={{ display: "grid", gridTemplateColumns: (p.photoPreview ? "60px 1fr" : "1fr"), gap: 8, alignItems: "center" }}>
                      {p.photoPreview && <Thumb url={p.photoPreview} />}
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                        {fio2 && <div>{fio2}</div>}
                        {dates && <div style={{ opacity: 0.9 }}>{dates}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Графика */}
          {frontUnique.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
              <div style={{ display: "grid", gap: 8 }}>
                {frontUnique.map((g: any) => {
                  const id = g?.id || g?.url || g?.name;
                  const qty = id ? (frontCounts[id] || 0) : 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : id);
                  return (
                    <div key={`fg-${id}`} style={{ display: "grid", gridTemplateColumns: (g.url ? "60px 1fr auto" : "1fr auto"), gap: 8, alignItems: "center" }}>
                      {g.url && <Thumb url={g.url} />}
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      {qty > 1 && <div style={{ ...smallText() }}>×{qty}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Эпитафии */}
          {frontEpitaphs.length > 0 && (
            <AccentBox>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {frontEpitaphs.map((t, i) => (
                  <div key={`fe-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                ))}
              </div>
            </AccentBox>
          )}

          {/* Пожелания */}
          {frontWishes && (
            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{frontWishes}</div>
            </div>
          )}
        </section>
      ) : null}

      {/* Подробности тыльной стороны */}
      {rearPeople.length || rearUnique.length || rearEpitaphs.length || backWishes ? (
        <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>{chip("Тыльная")}</div>

          {rearPeople.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Усопшие</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rearPeople.map((p: any, idx: number) => {
                  const fio1 = (p.lastName || "").trim();
                  const fio2 = [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
                  const dates = [p.birthDate?.trim(), p.deathDate?.trim()].filter(Boolean).join(" — ");
                  return (
                    <div key={p.id || `rp-${idx}`} style={{ display: "grid", gridTemplateColumns: (p.photoPreview ? "60px 1fr" : "1fr"), gap: 8, alignItems: "center" }}>
                      {p.photoPreview && <Thumb url={p.photoPreview} />}
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        {fio1 && <div style={{ fontWeight: 700 }}>{fio1}</div>}
                        {fio2 && <div>{fio2}</div>}
                        {dates && <div style={{ opacity: 0.9 }}>{dates}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rearUnique.length > 0 && (
            <div style={sectionBox}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
              <div style={{ display: "grid", gap: 8 }}>
                {rearUnique.map((g: any) => {
                  const gid = g?.id || g?.relPath || g?.url || g?.name;
                  const qty = rearCounts[gid] || 0;
                  const name = g?.name || (g?.url ? decodeURIComponent(g.url.split("/").pop() || "") : gid);
                  return (
                    <div key={`rg-${gid}`} style={{ display: "grid", gridTemplateColumns: (g.url ? "60px 1fr auto" : "1fr auto"), gap: 8, alignItems: "center" }}>
                      {g.url && <Thumb url={g.url} />}
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      {qty > 1 && <div style={{ ...smallText() }}>×{qty}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rearEpitaphs.length > 0 && (
            <AccentBox>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
              <div style={{ display: "grid", gap: 6 }}>
                {rearEpitaphs.map((t, i) => (
                  <div key={`re-${i}`} style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>
                    {t}
                  </div>
                ))}
              </div>
            </AccentBox>
          )}

          {backWishes && (
            <div style={{ ...sectionBox }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Пожелания</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{backWishes}</div>
            </div>
          )}
        </section>
      ) : null}

      {/* Эскизы — один раз (2 столбца) */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "stretch" }}>
          <SidePreview
            title="Лицевая"
            miniUrl={frontMini}
            itemUrl={itemUrl}
            mirror={false}
            aspect={aspect}
            showSilhouette={false}
            fallbackTemplate={{
              item: (draft as any)?.item || null,
              peopleBlocks: frontPeopleBlocks,
              crosses: frontCrosses,
              others: frontOthers,
              epitaphs: frontEpitaphs,
              carvingOpacity: 0.4
            }}
          />
          <SidePreview
            title="Тыльная"
            miniUrl={backMini}
            itemUrl={itemUrl}
            mirror
            aspect={aspect}
            showSilhouette
          />
        </div>
      </section>

      {/* Дополнительно — тумба/цветник/плита + ВЫБРАНО ДЛЯ ПЛИТЫ (перенесено под эскизы) */}
      <section style={{ ...glassPanelStyle(), padding: 12, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Дополнительно</div>

        {/* Выбрано для плиты — теперь под эскизами, в этом разделе */}
        {(chosenPlateList.length > 0 || (plateEpitaph || "").trim()) && (
          <div style={{ ...sectionBox }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Выбрано для плиты</div>
            {chosenPlateList.length > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: (plateEpitaph || "").trim() ? 8 : 0 }}>
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
            {(plateEpitaph || "").trim() && (
              <AccentBox>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафия</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{(plateEpitaph || "").trim()}</div>
              </AccentBox>
            )}
          </div>
        )}

        {/* Тумба/Цветник */}
        <div style={{ ...sectionBox }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={extraBase} onChange={(e) => setExtraBase(e.target.checked)} />
              <span>Тумба</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={extraFlowerbed} onChange={(e) => setExtraFlowerbed(e.target.checked)} />
              <span>Цветник</span>
            </label>
          </div>
        </div>

        {/* ПЛИТА: размеры + 2 аккордеона (Эпитафия / Графика) */}
        <PlateBlock
          extraPlate={extraPlate}
          setExtraPlate={setExtraPlate}
          plateSize={plateSize}
          setPlateSize={setPlateSize}
          plateThickness={plateThickness}
          setPlateThickness={setPlateThickness}
          plateOrientation={plateOrientation}
          setPlateOrientation={setPlateOrientation}
          plateEpitaph={plateEpitaph}
          setPlateEpitaph={setPlateEpitaph}
          catsLoading={catsLoading}
          catsError={catsError}
          cats={cats}
          catOpen={catOpen}
          setCatOpen={setCatOpen}
          addPlateGraphic={addPlateGraphic}
          removePlateGraphic={removePlateGraphic}
          plateIds={plateIds}
        />
      </section>

      {err && <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>Назад</button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>
          {busy ? "Отправляем…" : "Отправить заказ"}
        </button>
      </div>
    </>
  );
}

/* ===== Блок плиты ===== */
function PlateBlock(props: {
  extraPlate: boolean;
  setExtraPlate: (v: boolean) => void;
  plateSize: string;
  setPlateSize: (v: string) => void;
  plateThickness: string;
  setPlateThickness: (v: string) => void;
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
}) {
  const {
    extraPlate, setExtraPlate,
    plateSize, setPlateSize,
    plateThickness, setPlateThickness,
    plateOrientation, setPlateOrientation,
    plateEpitaph, setPlateEpitaph,
    catsLoading, catsError, cats, catOpen, setCatOpen,
    addPlateGraphic, removePlateGraphic,
    plateIds
  } = props;

  // Локальное состояние аккордеонов
  const [epitaphOpen, setEpitaphOpen] = useState(true);
  const [graphicsOpen, setGraphicsOpen] = useState(false);
  const [showMoreEpitaphs, setShowMoreEpitaphs] = useState(false);

  // Выбранные эпитафии на плите (внутренне — как список); наружу сохраняем объединённой строкой
  const [plateEpitaphs, setPlateEpitaphs] = useState<string[]>(
    (plateEpitaph || "").trim() ? (plateEpitaph as string).split(/\n{2,}/g) : []
  );
  useEffect(() => {
    // При изменении списка — складываем одиночной строкой с двойным переносом
    const joined = plateEpitaphs.map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
    setPlateEpitaph(joined);
  }, [plateEpitaphs, setPlateEpitaph]);

  const norm = (t: string) => (t || "").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  const hasByNorm = (list: string[], t: string) => list.some((x) => norm(x) === norm(t));
  const toggleEpitaph = (t: string) =>
    setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev.filter((x) => norm(x) !== norm(t)) : prev.concat([t])));
  const [customText, setCustomText] = useState("");
  const addCustom = () => {
    const t = (customText || "").trim();
    if (!t) return;
    setPlateEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([t])));
    setCustomText("");
  };
  const clearEpitaphs = () => setPlateEpitaphs([]);

  const isFlowersCat = (name?: string) => {
    const s = (name || "").toLowerCase();
    return s.includes("цвет") || s.includes("flower");
  };

  return (
    <div style={{ ...sectionBox, display: "grid", gap: 12 }}>
      {/* Вкл/выкл плиты */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
          <span style={{ fontWeight: 700 }}>Надгробная плита</span>
        </label>
      </div>

      {extraPlate && (
        <>
          {/* Размеры / Толщина / Ориентация */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Размер</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["100×50 см", "120×60 см", "140×70 см"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-size" checked={plateSize === v} onChange={() => setPlateSize(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Толщина</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["5 см", "8 см", "10 см"].map((v) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-thickness" checked={plateThickness === v} onChange={() => setPlateThickness(v)} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Ориентация</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[{ v: "vertical", t: "вертикально" }, { v: "horizontal", t: "горизонтально" }].map(({ v, t }) => (
                <label key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="radio" name="plate-orient" checked={plateOrientation === v} onChange={() => setPlateOrientation(v)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Разделитель */}
          <div style={dividerLine} />

          {/* Аккордеон: Эпитафия на надгробной плите (как на шаге эпитафии) */}
          <LoudAccordion title="Эпитафия на надгробной плите" open={epitaphOpen} onToggle={() => setEpitaphOpen(!epitaphOpen)}>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ marginBottom: 8 }}>Быстрый выбор:</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_EPITAPHS.map((t) => {
                    const active = hasByNorm(plateEpitaphs, t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleEpitaph(t)}
                        style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }}
                        title={t}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <button type="button" onClick={() => setShowMoreEpitaphs((v) => !v)} style={glassButtonStyle("nano")}>
                  {showMoreEpitaphs ? "Скрыть список" : "Все эпитафии"}
                </button>
                {showMoreEpitaphs && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                    {MORE_EPITAPHS.map((t, idx) => {
                      const active = hasByNorm(plateEpitaphs, t);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => toggleEpitaph(t)}
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

              <div>
                <div style={{ marginBottom: 6 }}>Свой вариант:</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <textarea
                    rows={3}
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Введите текст и нажмите «Добавить»"
                    style={{ ...inputStyle(), resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" style={glassButtonStyle("nano")} onClick={addCustom}>Добавить</button>
                    <button type="button" style={glassButtonStyle("nano")} onClick={clearEpitaphs}>Очистить выбранные</button>
                    {plateEpitaphs.length > 0 && <div style={{ ...smallText() }}>Выбрано: {plateEpitaphs.length}</div>}
                  </div>
                </div>
              </div>
            </div>
          </LoudAccordion>

          {/* Аккордеон: Графика на плите — без изменений */}
          <LoudAccordion title="Графика на надгробной плите" open={graphicsOpen} onToggle={() => setGraphicsOpen(!graphicsOpen)}>
            {catsLoading && <div>Загрузка каталога…</div>}
            {catsError && <div style={{ color: "#ffb4b4" }}>{catsError}</div>}
            {!catsLoading && cats.length === 0 && !catsError && <div>Каталог пуст.</div>}
            {!catsLoading && cats.length > 0 && (
              <div style={{ display: "grid", gap: 12 }}>
                {cats.map((cat: any, idx: number) => {
                  const catKey = String(cat._id || cat.name || idx);
                  const open = !!catOpen[catKey];
                  const showSubs = isFlowersCat(cat?.name) && Array.isArray(cat?.children) && cat.children.length > 0;
                  return (
                    <LoudAccordion
                      key={catKey}
                      title={cat.name || `Категория ${idx + 1}`}
                      open={open}
                      onToggle={() => setCatOpen({ ...catOpen, [catKey]: !open })}
                    >
                      {showSubs ? (
                        <div style={{ display: "grid", gap: 12 }}>
                          {(cat.items || []).length > 0 && (
                            <div>
                              <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.9 }}>Общее</div>
                              <CatGrid items={cat.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removeGraphic={removePlateGraphic} />
                            </div>
                          )}
                          {(cat.children || []).map((sub: any, j: number) => (
                            <div key={sub._id || `${catKey}-sub-${j}`}>
                              <div style={{ fontWeight: 600, marginBottom: 6 }}>{sub.name}</div>
                              <CatGrid items={sub.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removeGraphic={removePlateGraphic} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <CatGrid items={cat.items || []} plateIds={plateIds} addGraphic={addPlateGraphic} removeGraphic={removePlateGraphic} />
                      )}
                    </LoudAccordion>
                  );
                })}
              </div>
            )}
          </LoudAccordion>
        </>
      )}
    </div>
  );
}
