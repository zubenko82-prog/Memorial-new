// src/screens/BackEditorStep.tsx
// ТЫЛЬНАЯ СТОРОНА — отдельный редактор.
// По задаче:
// - Навигация липкая.
// - Подложка (изделие) растягивается на всю область (object-fit: cover).
// - Узлы редактирования: увеличены hit-area/ручки.
// - Первый добавленный элемент — 80% по длинной стороне холста.
// - Последующие — выше предыдущих, по центру; при нехватке места — общий даунскейл группы.
// - Автосохранения и превью сохранены.
// - ВАЖНО: выбранную графику и выбранные эпитафии объединяем в один блок «Выбранное» и размещаем ПОД ЭСКИЗОМ.
//   Старые блоки «Выбранная графика» и «Выбранные эпитафии» внутри аккордеона убраны.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { fetchCatalog } from "../api";
import {
  loadOrderDraft,
  saveOrderDraft,
  DRAFT_UPDATED_EVENT,
  type OrderDraft
} from "../lib/order";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import PhotoField, { type PhotoValue } from "../components/PhotoField";

/* ===== UI ===== */
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false) {
  const pad = { nano: "4px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: pad[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1
  } as React.CSSProperties;
}
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.95)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function bottomUnderlayGradient() {
  return {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  } as React.CSSProperties;
}
function linkLikeButton(): React.CSSProperties {
  return {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "#8ab4ff",
    textDecoration: "underline",
    cursor: "pointer",
    font: "inherit"
  };
}
function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
    boxSizing: "border-box"
  };
}
function iconBtn(): React.CSSProperties {
  return {
    padding: "4px 8px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  };
}

/* ===== Collapsible ===== */
function Collapsible({
  open,
  header,
  children,
  duration = 280
}: {
  open: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  const [mounted, setMounted] = useState(false);
  const measure = useCallback(() => ref.current?.scrollHeight || 0, []);
  useEffect(() => {
    setMounted(true);
    const onResize = () => { if (open) setH(measure()); };
    window.addEventListener("resize", onResize);
    const RO = (window as any).ResizeObserver as typeof ResizeObserver | undefined;
    let ro: ResizeObserver | null = null;
    if (RO && ref.current) {
      ro = new RO(onResize);
      ro.observe(ref.current);
    }
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); };
  }, [open, measure]);
  useEffect(() => {
    const hh = measure();
    if (open) {
      setH(hh);
      const t = setTimeout(() => setH(hh), duration + 16);
      return () => clearTimeout(t);
    } else {
      setH(hh);
      const t = setTimeout(() => setH(0), 16);
      return () => clearTimeout(t);
    }
  }, [open, measure, duration]);
  return (
    <div style={{ ...glassPanelStyle(), borderRadius: 12 }}>
      {header}
      <div
        style={{
          overflow: "hidden",
          height: open ? h : 0,
          transition: mounted ? `height ${duration}ms ease, opacity ${duration}ms ease` : undefined,
          opacity: open ? 1 : 0.6
        }}
      >
        <div ref={ref}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Каталог helpers ===== */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function sortedItems(items: any[]) {
  return items.slice().sort((a, b) => {
    const pa = (a?.relPath || a?.url || a?.name || "").toString();
    const pb = (b?.relPath || b?.url || b?.name || "").toString();
    const cmp = collator.compare(pa, pb);
    if (cmp !== 0) return cmp;
    const na = (a?.name || "").toString();
    const nb = (b?.name || "").toString();
    return collator.compare(na, nb);
  });
}
function normalizeSlashes(s: string) { return (s || "").replace(/\\/g, "/"); }
function stripProtocolHost(s: string) { return s.replace(/^[a-z]+:\/\/[^/]+/i, ""); }
function baseName(path: string) { const p = normalizeSlashes(path).split("/").filter(Boolean); return p[p.length - 1] || path; }
function hasFileExt(name: string) { return /\.[a-z0-9]{2,}$/i.test(name); }
function joinPath(a: string, b: string) { return normalizeSlashes(`${a}/${b}`).replace(/\/{2,}/g, "/"); }
function toSlug(s?: string) { if (!s) return undefined; try { return encodeURIComponent(s.trim().toLowerCase()); } catch { return undefined; } }

function collectFlatEntries(root: any, base = "") {
  const out: any[] = [];
  const pushFile = (node: any, relBase: string) => {
    const url = node?.url || node?.src || node?.image || node?.path || "";
    if (!url) return;
    const urlPath = normalizeSlashes(stripProtocolHost(String(url)));
    const rawRel = normalizeSlashes(node?.relPath || node?.path || "");
    const nameFromUrl = baseName(urlPath);
    const name = node?.name || baseName(rawRel) || nameFromUrl;

    const lower = urlPath.toLowerCase();
    let relFromUrl = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
    const idxG = lower.indexOf("/graphics/");
    if (idxG >= 0) relFromUrl = urlPath.slice(idxG + 1);

    let rel = rawRel && rawRel.includes("/") ? rawRel : relFromUrl;
    if (!hasFileExt(baseName(rel))) rel = joinPath(rel, name);
    if (relBase && rel.split("/").filter(Boolean).length < 2) {
      rel = joinPath(relBase, name);
    }

    out.push({ url: String(url), name: String(name), relPath: rel, preview: node?.preview || node?.thumb || undefined });
  };

  const walk = (node: any, relBase: string) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((child) => walk(child, relBase)); return; }
    if (node?.url || node?.src || node?.image) { pushFile(node, relBase); return; }

    const nodeName = node?.name || node?.title || node?.slug || "";
    const nextBase = nodeName ? joinPath(relBase, String(nodeName)) : relBase;

    const childrenArrays = []
      .concat(node?.items || [])
      .concat(node?.files || [])
      .concat(node?.list || [])
      .concat(node?.children || [])
      .concat(node?.dirs || [])
      .concat(node?.entries || []);
    if (childrenArrays.length) childrenArrays.forEach((child) => walk(child, nextBase));
    if (Array.isArray(node?.categories)) node.categories.forEach((cat: any) => walk(cat, relBase));
    if (Array.isArray(node?.subcategories)) node.subcategories.forEach((sub: any) => walk(sub, nextBase));
  };

  if (root?.categories) {
    (root.categories || []).forEach((cat: any) => {
      const catBase = String(cat?.name || cat?.slug || "");
      (cat?.items || []).forEach((it: any) => pushFile(it, catBase));
      const stack = [...(cat?.children || cat?.subcategories || [])];
      while (stack.length) {
        const dir: any = stack.shift();
        const dirName = String(dir?.name || dir?.slug || "");
        const dirBase = joinPath(catBase, dirName);
        (dir?.items || []).forEach((it: any) => pushFile(it, dirBase));
        const nested = [...(dir?.children || dir?.subcategories || [])];
        nested.forEach((n: any) => stack.push(n));
      }
    });
  } else if (Array.isArray(root)) {
    walk(root, base);
  } else if (root && typeof root === "object") {
    if (Array.isArray(root.items) || Array.isArray(root.files) || Array.isArray(root.list)) {
      const arr = (root.items || root.files || root.list) || [];
      arr.forEach((it: any) => pushFile(it, base));
    } else {
      walk(root, base);
    }
  }

  const seen = new Set();
  return out.filter((e) => {
    const key = `${e.relPath}::${e.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function buildCatsFromFlat(entries: any[]) {
  const catMap = new Map<string, any>();
  for (const e of entries) {
    const rel = normalizeSlashes(stripProtocolHost(e.relPath)).replace(/^\.\/+/, "").replace(/^\/+/, "");
    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    const anchors = ["graphics", "catalogs", "catalog", "images", "img"];
    let startIdx = 0;
    for (const a of anchors) {
      const idx = parts.findIndex((p) => p.toLowerCase() === a);
      if (idx >= 0 && idx < parts.length - 1) { startIdx = idx + 1; break; }
    }
    if (parts.length - startIdx < 2) continue;

    const catName = decodeURIComponent(parts[startIdx]);
    const fileName = parts[parts.length - 1];
    const subSegments = parts.slice(startIdx + 1, parts.length - 1).map((s) => decodeURIComponent(s));
    const subKey = subSegments.join(" / ");

    if (!catMap.has(catName)) {
      catMap.set(catName, { name: catName, slug: toSlug(catName), items: [], subs: new Map<string, any>() });
    }
    const cat = catMap.get(catName);
    const item = {
      id: e.relPath || e.url,
      name: e.name || fileName,
      url: e.url,
      preview: e.preview || e.url,
      relPath: e.relPath,
      catName,
      catSlug: toSlug(catName)
    };

    if (subSegments.length > 0) {
      if (!cat.subs.has(subKey)) cat.subs.set(subKey, { name: subKey, slug: toSlug(subKey), items: [] });
      cat.subs.get(subKey).items.push(item);
    } else {
      cat.items.push(item);
    }
  }

  const ui = Array.from(catMap.values()).map((c, idx) => {
    const _id = `${toSlug(c.name) || "cat"}__${idx}`;
    const children = Array.from(c.subs.values()).map((s: any, j: number) => ({
      _id: `sub__${_id}__${toSlug(s.name) || "sub"}__${j}`,
      name: s.name,
      slug: s.slug,
      items: sortedItems(s.items)
    }));
    return { _id, name: c.name, slug: c.slug, items: sortedItems(c.items), children };
  });

  ui.sort((a, b) => collator.compare(a.name, b.name));
  return ui;
}

/* ===== Types (elements) ===== */
type ElType = "graphic" | "epitaph" | "photo" | "metric";
type EditorEl = {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number; // проценты от контента
  z: number;
  flipH?: boolean; // для graphic
  text?: string;   // для epitaph
  staircase?: boolean; // для epitaph (лесенка)
  personId?: string;   // для photo/metric
  caseRest?: "lower" | "upper"; // для metric — регистр для букв (кроме первой)
};

/* ===== People types ===== */
type Person = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoUrl?: string | null;
  photoDataUrl?: string | null;
};
type NormalizedPerson = {
  id: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  photoPreview: string | null;
};

/* ===== Helpers ===== */
const SKETCH_PAD = 8;

// Сетка для карточек: минимум 2 в строке
const GRID_GAP_PX = 10;
const twoColGrid = (maxPx = 140, minPx = 100) =>
  `repeat(auto-fill, minmax(clamp(${minPx}px, calc((100% - ${GRID_GAP_PX}px)/2), ${maxPx}px), 1fr))`;

function normRemember(t?: string) { return (t || "").toLowerCase().replace(/[.,…!?:;]+/g, "").replace(/\s+/g, " ").trim(); }
function isRememberLoveMourn(t?: string) { return normRemember(t) === "помним любим скорбим"; }
function splitRememberPreserve(text: string) {
  const t = (text || "").trim(); const parts: string[] = []; let buf = "";
  for (let i = 0; i < t.length; i++) { const ch = t[i]; buf += ch; if (ch === ",") { parts.push(buf.trim()); buf = ""; } }
  if (buf.trim()) parts.push(buf.trim());
  const top = parts[0] || "Помним,", mid = parts[1] || "любим,", bot = (parts.length > 2 ? parts.slice(2).join(" ") : "скорбим…").trim();
  return { top, mid, bot };
}
const graphicId = (gid: string, n: number) => `graphic|${gid}|${n}`;
function parseGraphicId(id: string): { gid: string; n: number } | null { const m = /^graphic\|(.+)\|(\d+)$/.exec(id); return m ? { gid: m[1], n: parseInt(m[2], 10) } : null; }
const epitaphId = (key: string) => `epitaph|${key}`;
const photoId = (personId: string) => `photo|${personId}`;
const metricId = (personId: string) => `metric|${personId}`;
function parsePhotoId(id: string): string | null { const m = /^photo\|(.+)$/.exec(id); return m ? m[1] : null; }
function parseMetricId(id: string): string | null { const m = /^metric\|(.+)$/.exec(id); return m ? m[1] : null; }
function textKey(t: string) { try { return btoa(unescape(encodeURIComponent(t))).replace(/=+$/g, "").slice(0, 24); } catch { return String(Math.abs(Array.from(t).reduce((a, c) => (a + c.charCodeAt(0)) | 0, 0))); } }

function isCrossMeta(meta: any): boolean {
  const s1 = String(meta?.catName || "").toLowerCase();
  const s2 = String(meta?.catSlug || "").toLowerCase();
  return s1.includes("крест") || s2.includes("cross");
}

/* ===== Canvas-fit ===== */
const fitCanvas = (() => {
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = c ? c.getContext("2d")! : null;
  const family = `"Century Schoolbook","Times New Roman",serif`;
  const LINE_H = 1.15;

  function width(px: number, text: string, italic = false) {
    if (!ctx) return text.length * px * 0.6;
    ctx.font = `${italic ? "italic " : ""}${Math.max(1, Math.floor(px))}px ${family}`;
    return ctx.measureText(text).width;
  }
  function fitOneLine(text: string, maxW: number, maxH: number, italic = false) {
    let hi = Math.max(8, Math.floor(maxH * 0.9));
    let lo = 8;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const w = width(mid, text, italic);
      if (w <= maxW) lo = mid; else hi = mid - 1;
    }
    return Math.max(8, lo);
  }
  function wrapLines(text: string, px: number, maxW: number, italic = false): string[] {
    if (!ctx || !text) return [text];
    ctx.font = `${italic ? "italic " : ""}${Math.max(1, Math.floor(px))}px ${family}`;
    const paras = String(text).split(/\r?\n/);
    const out: string[] = [];
    for (const para of paras) {
      const words = para.split(/\s+/);
      let line = "";
      const pushLine = (s: string) => out.push(s.replace(/\s+$/g, ""));
      for (const w of words) {
        if (!w) continue;
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width <= maxW) {
          line = test;
        } else {
          if (line) pushLine(line);
          let chunk = "";
          for (const ch of w) {
            const t2 = chunk + ch;
            if (ctx.measureText(t2).width <= maxW || chunk.length === 0) {
              chunk = t2;
            } else {
              pushLine(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        }
      }
      pushLine(line);
    }
    return out.length ? out : [""];
  }
  function fitBlock(text: string, maxW: number, maxH: number, italic = false) {
    let lo = 8;
    let hi = Math.max(8, Math.floor(maxH));
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const lines = wrapLines(text, mid, Math.max(0, maxW), italic);
      const totalH = Math.ceil(lines.length * mid * LINE_H);
      const ok = totalH <= maxH;
      if (ok) lo = mid; else hi = mid - 1;
    }
    return Math.max(8, lo);
  }
  function fitStair(top: string, mid: string, bot: string, maxW: number, maxH: number, italic = false) {
    const perLineH = Math.max(8, Math.floor(maxH / 3));
    const fTop = fitOneLine(top, Math.max(0, maxW - 8), perLineH, italic);
    const fMid = fitOneLine(mid, Math.max(0, maxW - 8), perLineH, italic);
    const fBot = fitOneLine(bot, Math.max(0, maxW - 8), perLineH, italic);
    return Math.min(perLineH, fTop, fMid, fBot);
  }

  return { fitOneLine, fitStair, fitBlock, wrapLines, width, family, LINE_H };
})();

/* ===== Case helpers for METRIC ===== */
function transformCaseExceptFirstPerWord(text: string, mode: "lower" | "upper"): string {
  return text.replace(/([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё]*)/g, (m) => {
    const first = m[0];
    const rest = m.slice(1);
    return first + (mode === "upper" ? rest.toUpperCase() : rest.toLowerCase());
  });
}

/* ===== Component ===== */
type Props = { onBack?: () => void; onContinue?: (payload?: any) => void; };

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

  const item = draft?.item || null;

  /* ===== Sticky навигация ===== */
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(56);
  useLayoutEffect(() => {
    const measure = () => setNavH(navRef.current?.getBoundingClientRect().height || 0);
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, []);

  // Якоря секций
  const secGraphicsId = "sec-graphics";
  const secEpitaphsId = "sec-epitaphs";
  const secPeopleId = "sec-people";
  const chosenSectionId = "rear-chosen";   // объединённый блок — ТЕПЕРЬ ПОД ЭСКИЗОМ
  const previewSectionId = "rear-preview";

  const scrollToById = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - (navH + 12)), behavior: "smooth" });
  };

  /* ===== Аккордеоны верхнего уровня — по одному открыт ===== */
  const [openSecGraphics, setOpenSecGraphics] = useState(false);
  const [openSecEpitaphs, setOpenSecEpitaphs] = useState(false);
  const [openSecPeople, setOpenSecPeople] = useState(false);
  const openOnly = (which: "graphics" | "epitaphs" | "people") => {
    if (which === "graphics") { setOpenSecGraphics((v) => { const next = !v; setOpenSecEpitaphs(false); setOpenSecPeople(false); return next; }); }
    else if (which === "epitaphs") { setOpenSecEpitaphs((v) => { const next = !v; setOpenSecGraphics(false); setOpenSecPeople(false); return next; }); }
    else { setOpenSecPeople((v) => { const next = !v; setOpenSecGraphics(false); setOpenSecEpitaphs(false); return next; }); }
  };

  /* ===== Каталог графики (rear) ===== */
  const [gLoading, setGLoading] = useState(false);
  const [gError, setGError] = useState("");
  const [gCats, setGCats] = useState<any[]>([]);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    async function loadGraphics() {
      setGLoading(true); setGError("");
      try {
        const data = await fetchCatalog("graphics");
        const flat = collectFlatEntries(data, "");
        const cats = flat.length ? buildCatsFromFlat(flat) : [];
        if (!alive) return;
        if (!cats.length) {
          setGCats([]); setGError("Каталог графики пуст или структура не распознана.");
          setOpenCats({}); setOpenSubs({});
        } else {
          setGCats(cats);
          const oc: Record<string, boolean> = {};
          const os: Record<string, boolean> = {};
          for (const c of cats) {
            oc[c._id] = false;
            for (const s of c.children) os[s._id] = false;
          }
          setOpenCats(oc); setOpenSubs(os);
        }
      } catch (e) {
        if (!alive) return;
        console.error(e);
        setGError("Не удалось загрузить каталог графики.");
      } finally {
        if (alive) setGLoading(false);
      }
    }
    loadGraphics();
    return () => { alive = false; };
  }, []);

  const toggleCat = useCallback((catId: string) => setOpenCats((s) => ({ ...s, [catId]: !s[catId] })), []);
  const toggleSub = useCallback((subId: string) => setOpenSubs((s) => ({ ...s, [subId]: !s[subId] })), []);

  /* ===== REAR-STORE ===== */
  const [selGraphicIds, setSelGraphicIds] = useState<string[]>(
    () => (draft as any)?.editorBack?.selectedGraphicsIds || []
  );
  const [rearMeta, setRearMeta] = useState<Record<string, any>>(
    () => (draft as any)?.editorBack?.graphicsMeta || {}
  );
  const [selEpitaphTexts, setSelEpitaphTexts] = useState<string[]>(
    () => (draft as any)?.editorBack?.epitaphTexts || []
  );
  const [wishes, setWishes] = useState<string>(() => (draft as any)?.editorBack?.wishes || "");
  const [carvingOpacity, setCarvingOpacity] = useState<number>(() => (draft as any)?.editorBack?.carvingOpacity ?? 0.85);

// === People helpers (локальные) ===
function normalizePersonsForSave(persons: Person[]): NormalizedPerson[] {
  return persons.map((p) => ({
    id: p.id,
    lastName: p.lastName?.trim() || undefined,
    firstName: p.firstName?.trim() || undefined,
    middleName: p.middleName?.trim() || undefined,
    birthDate: p.birthDate?.trim() || undefined,
    deathDate: p.deathDate?.trim() || undefined,
    photoPreview: p.photoDataUrl ?? p.photoUrl ?? null
  }));
}

function draftPersonsToLocal(list?: NormalizedPerson[] | null): Person[] {
  if (!Array.isArray(list)) return [];
  return list.map((d, i) => ({
    id: d.id || `p-${i}`,
    lastName: d.lastName || "",
    firstName: d.firstName || "",
    middleName: d.middleName || "",
    birthDate: d.birthDate || "",
    deathDate: d.deathDate || "",
    photoUrl: d.photoPreview ?? null,
    photoDataUrl: d.photoPreview ?? null
  }));
}

function makeBlankPerson(id?: string): Person {
  return {
    id: id ?? `p-${Date.now()}`,
    lastName: "",
    firstName: "",
    middleName: "",
    birthDate: "",
    deathDate: "",
    photoUrl: null,
    photoDataUrl: null
  };
}


  // Люди
  const peopleFromDraft = draftPersonsToLocal(((draft as any)?.editorBack?.people as NormalizedPerson[]) || []);
  const [people, setPeople] = useState<Person[]>(
    peopleFromDraft.length ? peopleFromDraft : [makeBlankPerson("p-0")]
  );

  // Сохранение editorBack (debounce)
  const saveTimerRef = useRef<number | null>(null);
  const saveEditorBack = (payload: Partial<any>) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const prev = loadOrderDraft();
      const normalizedPeople = normalizePersonsForSave(people);
      saveOrderDraft({
        ...prev,
        editorBack: {
          ...(prev as any).editorBack,
          selectedGraphicsIds: selGraphicIds,
          graphicsMeta: rearMeta,
          epitaphTexts: selEpitaphTexts,
          people: normalizedPeople,
          wishes,
          carvingOpacity,
          ...(payload || {}),
          updatedAt: Date.now()
        }
      });
    }, 200) as unknown as number;
  };
  useEffect(() => () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current); }, []);

  // Временные blob-URL для фото
  const [transientPhotoUrlById, setTransientPhotoUrlById] = useState<Record<string, string | null>>({});
  const photoSeqByIdRef = useRef<Record<string, number>>({});

  const setTransientFor = useCallback((id: string, url: string | null) => {
    setTransientPhotoUrlById((prev) => {
      const prevUrl = prev[id];
      if (prevUrl && prevUrl.startsWith("blob:") && prevUrl !== url) {
        try { URL.revokeObjectURL(prevUrl); } catch {}
      }
      return { ...prev, [id]: url ?? null };
    });
  }, []);
  useEffect(() => {
    return () => {
      Object.values(transientPhotoUrlById).forEach((u) => {
        if (u && u.startsWith("blob:")) { try { URL.revokeObjectURL(u); } catch {} }
      });
    };
  }, [transientPhotoUrlById]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result ?? ""));
      rd.onerror = () => reject(new Error("read error"));
      rd.readAsDataURL(file);
    });
  const isBlobUrl = (url?: string | null) => !!url && url.startsWith("blob:");

  const setPersonPhotoById = (personId: string, pv: PhotoValue | null) => {
    const nextSeq = (photoSeqByIdRef.current[personId] || 0) + 1;
    photoSeqByIdRef.current[personId] = nextSeq;
    const isCurrentSeq = () => photoSeqByIdRef.current[personId] === nextSeq;

    const commitLocal = (patch: Partial<Person>) => {
      if (!isCurrentSeq()) return;
      setTransientFor(personId, null);
      setPeople((prev) => {
        const next = prev.map((p) => (p.id === personId ? { ...p, ...patch } : p));
        saveEditorBack({ people: normalizePersonsForSave(next) });
        return next;
      });
    };

    if (!pv) {
      setTransientFor(personId, null);
      commitLocal({ photoUrl: null, photoDataUrl: null });
      return;
    }
    if ((pv as any).dataUrl) {
      const dv = (pv as any).dataUrl as string;
      setTransientFor(personId, null);
      commitLocal({ photoDataUrl: dv, photoUrl: (pv as any).url ?? dv });
      return;
    }
    const maybeFile: File | undefined = (pv as any)?.file;
    if (maybeFile instanceof File) {
      const tempUrl = URL.createObjectURL(maybeFile);
      setTransientFor(personId, tempUrl);
      fileToDataUrl(maybeFile)
        .then((d) => {
          if (!isCurrentSeq()) return;
          try { URL.revokeObjectURL(tempUrl); } catch {}
          commitLocal({ photoDataUrl: d, photoUrl: d });
        })
        .catch(() => {
          if (!isCurrentSeq()) return;
          try { URL.revokeObjectURL(tempUrl); } catch {}
        });
      return;
    }
    if ((pv as any).url) {
      const u = (pv as any).url as string;
      if (isBlobUrl(u)) {
        setTransientFor(personId, u);
        fetch(u)
          .then((res) => res.blob())
          .then((blob) => fileToDataUrl(new File([blob], "photo", { type: blob.type || "image/*" })))
          .then((d) => { if (isCurrentSeq()) commitLocal({ photoDataUrl: d, photoUrl: d }); })
          .catch(() => { if (isCurrentSeq()) commitLocal({ photoUrl: u, photoDataUrl: null }); });
      } else {
        setTransientFor(personId, null);
        commitLocal({ photoUrl: u, photoDataUrl: null });
      }
    }
  };

  const countsById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const gid of selGraphicIds) m[gid] = (m[gid] || 0) + 1;
    return m;
  }, [selGraphicIds]);

  const findGraphic = useCallback((gid: string): any | undefined => {
    for (const c of gCats) {
      const a = c.items.find((x: any) => String(x.id) === gid);
      if (a) return a;
      for (const s of c.children) {
        const b = s.items.find((x: any) => String(x.id) === gid);
        if (b) return b;
      }
    }
    return rearMeta[gid];
  }, [gCats, rearMeta]);

  const ensureRearMeta = (g: any) => {
    const gid = String(g.id);
    if (rearMeta[gid]) return;
    const next = {
      id: gid,
      name: g.name || "",
      url: g.url || "",
      preview: g.preview || g.url || "",
      catName: g.catName || "",
      catSlug: g.catSlug || "",
      subCatName: g.subCatName || "",
      subCatSlug: g.subCatSlug || ""
    };
    setRearMeta((prev) => ({ ...prev, [gid]: next }));
    saveEditorBack({ graphicsMeta: { ...(rearMeta || {}), [gid]: next } });
  };

  const addGraphicRear = (g: any) => {
    const gid = String(g.id);
    const cur = countsById[gid] || 0;
    if (cur >= 3) { window.alert("Нельзя добавить более трёх одинаковых изображений"); return; }
    ensureRearMeta(g);
    const next = [...selGraphicIds, gid];
    setSelGraphicIds(next);
    saveEditorBack({ selectedGraphicsIds: next });
  };

  const removeOneGraphicRear = (gid: string) => {
    const idx = selGraphicIds.findIndex((x) => x === gid);
    if (idx === -1) return;
    const next = selGraphicIds.slice();
    next.splice(idx, 1);
    setSelGraphicIds(next);
    saveEditorBack({ selectedGraphicsIds: next });
  };

  const clearRearGraphics = () => {
    setSelGraphicIds([]);
    saveEditorBack({ selectedGraphicsIds: [] });
  };

  // Эпитафии
  const toggleEpitaphText = (text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    const next = selEpitaphTexts.includes(t) ? selEpitaphTexts.filter((x) => x !== t) : selEpitaphTexts.concat(t);
    setSelEpitaphTexts(next);
    saveEditorBack({ epitaphTexts: next });
  };
  const addCustomEpitaph = (t: string) => {
    const text = (t || "").trim(); if (!text) return;
    if (!selEpitaphTexts.includes(text)) {
      const next = selEpitaphTexts.concat(text);
      setSelEpitaphTexts(next);
      saveEditorBack({ epitaphTexts: next });
    }
  };
  const removeEpitaphText = (t: string) => {
    const next = selEpitaphTexts.filter((x) => x !== t);
    setSelEpitaphTexts(next);
    saveEditorBack({ epitaphTexts: next });
  };
  const clearEpitaphs = () => { setSelEpitaphTexts([]); saveEditorBack({ epitaphTexts: [] }); };

  /* ===== Холст и элементы ===== */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [imgWH, setImgWH] = useState<{ w: number; h: number } | null>(null);
  const aspect = imgWH ? `${imgWH.w} / ${imgWH.h}` : undefined;

  const [elements, setElements] = useState<EditorEl[]>(
    () => ((draft as any)?.editorBack?.elements as EditorEl[]) || []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customEpi, setCustomEpi] = useState<string>("");

  // Ориентация холста
  const isPortraitCanvas = useMemo(() => {
    if (imgWH && imgWH.w > 0 && imgWH.h > 0) return imgWH.h >= imgWH.w;
    const w = wrapperRef.current?.clientWidth || 1;
    const h = wrapperRef.current?.clientHeight || 1;
    return h >= w;
  }, [imgWH]);

  /* ------ Авто‑позиции и раскладка без наложений ------ */
  type Rect = { x: number; y: number; w: number; h: number };
  const clampPct = (r: Rect): Rect => ({
    x: Math.max(0, Math.min(100 - r.w, r.x)),
    y: Math.max(0, Math.min(100 - r.h, r.y)),
    w: Math.max(1, Math.min(100, r.w)),
    h: Math.max(1, Math.min(100, r.h))
  });
  const firstBox = (base: Rect): Rect => {
    if (isPortraitCanvas) {
      const h = 80;
      const w = Math.min(90, Math.max(20, base.w));
      return clampPct({ x: 50 - w / 2, y: 50 - h / 2, w, h });
    } else {
      const w = 80;
      const h = Math.min(40, Math.max(16, base.h));
      return clampPct({ x: 50 - w / 2, y: 50 - h / 2, w, h });
    }
  };
  const contentRects = (arr: EditorEl[]): Rect[] =>
    arr
      .filter((e) => e.type === "graphic" || e.type === "epitaph" || e.type === "photo" || e.type === "metric")
      .map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
  const placeAboveGroupCenter = (group: Rect[], candidate: Rect, margin = 2): Rect | null => {
    if (group.length === 0) return clampPct(candidate);
    const top = group.reduce((m, r) => Math.min(m, r.y), 100);
    const newR = clampPct({ x: 50 - candidate.w / 2, y: top - margin - candidate.h, w: candidate.w, h: candidate.h });
    if (newR.y < 0) return null;
    return newR;
  };
  const scaleGroupToFit = (group: Rect[], newRect: Rect, margin = 2): { group: Rect[]; newest: Rect } => {
    let factor = 0.95;
    let scaledNew = { ...newRect };
    let scaledGroup = group.map((r) => ({ ...r }));
    for (let i = 0; i < 20; i++) {
      const gTop = scaledGroup.reduce((m, r) => Math.min(m, r.y), 100);
      let tryNew = { ...scaledNew, x: 50 - scaledNew.w / 2, y: gTop - margin - scaledNew.h };
      if (tryNew.y >= 0) return { group: scaledGroup, newest: tryNew };
      scaledGroup = scaledGroup.map((r) => ({
        w: Math.max(6, r.w * factor),
        h: Math.max(6, r.h * factor),
        x: 50 - Math.max(6, r.w * factor) / 2,
        y: r.y * factor
      }));
      scaledNew = {
        w: Math.max(6, scaledNew.w * factor),
        h: Math.max(6, scaledNew.h * factor),
        x: 50 - Math.max(6, scaledNew.w * factor) / 2,
        y: scaledNew.y * factor
      };
      factor *= 0.95;
    }
    return { group: scaledGroup, newest: { ...scaledNew, x: 50 - scaledNew.w / 2, y: 0 } };
  };

  // Синхронизация графики/эпитафий с выбором + раскладка
  useEffect(() => {
    setElements((prev) => {
      const wantIds: string[] = [];
      const seen: Record<string, number> = {};
      for (const gid of selGraphicIds) {
        const n = (seen[gid] || 0) + 1;
        seen[gid] = n;
        wantIds.push(graphicId(gid, n));
      }
      for (const t of selEpitaphTexts) wantIds.push(epitaphId(textKey(t)));

      const wantSet = new Set(wantIds);
      let out: EditorEl[] = [];
      let changed = false;

      for (const el of prev) {
        if (el.type === "graphic" || el.type === "epitaph") {
          if (wantSet.has(el.id)) {
            if (el.type === "epitaph") {
              const t = selEpitaphTexts.find((tx) => epitaphId(textKey(tx)) === el.id) || el.text || "";
              out.push({ ...el, text: t, staircase: isRememberLoveMourn(t) });
            } else out.push(el);
          } else {
            changed = true;
            if (selectedId === el.id) setSelectedId(null);
          }
        } else {
          out.push(el);
        }
      }

      const currentIds = new Set(out.map((e) => e.id));
      let maxZ = out.reduce((m, e) => Math.max(m, e.z), 0);

      for (const id of wantIds) {
        if (currentIds.has(id)) continue;

        const isGraphic = id.startsWith("graphic|");
        const isEpi = id.startsWith("epitaph|");
        let rect: Rect = { x: 50 - 20, y: 30, w: 40, h: 20 };
        if (out.filter((e) => e.type !== undefined).length === 0) rect = firstBox(rect);

        const group = contentRects(out);
        if (group.length === 0) {
          rect = clampPct({ ...rect });
        } else {
          const placed = placeAboveGroupCenter(group, rect, 2);
          if (placed) rect = placed;
          else {
            const { group: scaled, newest } = scaleGroupToFit(group, rect, 2);
            const contentIds = out.filter((e) => e.type === "graphic" || e.type === "epitaph" || e.type === "photo" || e.type === "metric").map((e) => e.id);
            let idx = 0;
            out = out.map((e) => {
              if (contentIds.includes(e.id)) {
                const r = scaled[idx++];
                return { ...e, x: r.x, y: r.y, w: r.w, h: r.h };
              }
              return e;
            });
            rect = newest;
          }
        }

        if (isGraphic) {
          out.push({ id, type: "graphic", x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: ++maxZ, flipH: false, title: "Графика" });
          changed = true;
        } else if (isEpi) {
          const t = selEpitaphTexts.find((tx) => epitaphId(textKey(tx)) === id) || "";
          out.push({ id, type: "epitaph", text: t, staircase: isRememberLoveMourn(t), x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: ++maxZ, title: "Эпитафия" });
          changed = true;
        }
      }

      if (changed) saveEditorBack({ elements: out });
      return changed ? out : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selGraphicIds, selEpitaphTexts, isPortraitCanvas, gCats, rearMeta]);

  // Фото/метрика
  useEffect(() => {
    setElements((prev) => {
      let changed = false;
      const personIndex = new Map<string, number>(people.map((p, i) => [p.id, i]));
      const filtered = prev.filter((el) => {
        if (el.type === "photo" || el.type === "metric") {
          if (!el.personId || !personIndex.has(el.personId)) {
            changed = true;
            if (selectedId === el.id) setSelectedId(null);
            return false;
          }
        }
        return true;
      });

      let maxZ = filtered.reduce((m, e) => Math.max(m, e.z), 0);
      const existing = new Set(filtered.map((e) => e.id));
      const cols = Math.max(1, people.length);
      const cw = 100 / cols;

      people.forEach((p, i) => {
        const pid = p.id;
        const pidPhoto = photoId(pid);
        if (!existing.has(pidPhoto)) {
          const w = Math.min(80, cw * 0.8);
          const h = 35;
          const x = i * cw + (cw - w) / 2;
          const y = 15;
          filtered.push({ id: pidPhoto, type: "photo", personId: pid, x, y, w, h, z: ++maxZ });
          changed = true;
        }
        const pidMetric = metricId(pid);
        if (!existing.has(pidMetric)) {
          const w = Math.min(90, cw * 0.9);
          const h = 20;
          const x = i * cw + (cw - w) / 2;
          const y = 15 + 35 + 4;
          filtered.push({ id: pidMetric, type: "metric", personId: pid, x, y, w, h, z: ++maxZ, caseRest: "lower" });
          changed = true;
        }
      });

      if (changed) saveEditorBack({ elements: filtered });
      return changed ? filtered : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  const removeElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (id.startsWith("graphic|")) {
      const p = parseGraphicId(id);
      if (p) removeOneGraphicRear(p.gid);
    } else if (id.startsWith("epitaph|")) {
      const found = elements.find((e) => e.id === id);
      if (found?.text) removeEpitaphText(found.text);
    }
    saveEditorBack({ elements: elements.filter((el) => el.id !== id) });
  };

  /* ===== Превью (mini/hi) ===== */
  const previewWrapperRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  async function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
  }
  const renderPreview = async (W: number, H: number): Promise<string | null> => {
    if (W <= 0 || H <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e"); grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242"); grad.addColorStop(0.7, "#888888"); grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    const CX = 0, CY = 0, CW = W, CH = H;
    const els = elements.slice().sort((a, b) => a.z - b.z);

    for (const el of els) {
      const r = { x: CX + (el.x / 100) * CW, y: CY + (el.y / 100) * CH, w: (el.w / 100) * CW, h: (el.h / 100) * CH };

      if (el.type === "graphic") {
        const parsed = parseGraphicId(el.id);
        if (parsed) {
          const g = findGraphic(parsed.gid);
          if (g?.url) {
            const im = await loadImageSafe(g.preview || g.url);
            if (im) {
              const sr = im.width / im.height;
              const dr = r.w / r.h;
              let dw = r.w, dh = r.h, dx = r.x, dy = r.y;
              if (sr > dr) { dh = Math.round(r.w / sr); dy = r.y + Math.round((r.h - dh) / 2); }
              else { dw = Math.round(r.h * sr); dx = r.x + Math.round((r.w - dw) / 2); }
              ctx.save();
              if (el.flipH) {
                ctx.translate(dx + dw / 2, dy + dh / 2);
                ctx.scale(-1, 1);
                ctx.translate(-(dx + dw / 2), -(dy + dh / 2));
              }
              ctx.drawImage(im, dx, dy, dw, dh);
              ctx.restore();
            }
          }
        }
        continue;
      }

      if (el.type === "epitaph") {
        const text = el.text || "";
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "alphabetic";
        if (el.staircase && isRememberLoveMourn(text)) {
          const { top, mid, bot } = splitRememberPreserve(text);
          const f = fitCanvas.fitStair(top, mid, bot, r.w - 8, r.h - 8, false);
          ctx.font = `${f}px ${fitCanvas.family}`;
          ctx.textAlign = "left";   ctx.fillText(top, r.x + 4, r.y + f * 0.95, r.w - 8);
          ctx.textAlign = "center"; ctx.fillText(mid, r.x + r.w / 2, r.y + r.h / 2 + f * 0.35, r.w - 8);
          ctx.textAlign = "right";  ctx.fillText(bot, r.x + r.w - 4, r.y + r.h - f * 0.2, r.w - 8);
        } else {
          const maxW = r.w - 8, maxH = r.h - 8;
          const f = fitCanvas.fitBlock(text, maxW, maxH, false);
          const lines = fitCanvas.wrapLines(text, f, maxW, false);
          const lh = Math.round(f * fitCanvas.LINE_H);
          let y = r.y + Math.max(0, (r.h - lines.length * lh) / 2) + f;
          ctx.font = `${f}px ${fitCanvas.family}`;
          ctx.textAlign = "center";
          for (const line of lines) { ctx.fillText(line, r.x + r.w / 2, y); y += lh; }
        }
        ctx.restore();
        continue;
      }

      if (el.type === "photo") {
        const pid = parsePhotoId(el.id) || el.personId;
        const p = people.find((x) => x.id === pid);
        const photo = p ? (transientPhotoUrlById[p.id] ?? p.photoUrl ?? p.photoDataUrl ?? null) : null;
        if (photo) {
          const im = await loadImageSafe(photo);
          if (im) {
            const sr = im.width / im.height;
            const dr = r.w / r.h;
            let dw = r.w, dh = r.h, dx = r.x, dy = r.y;
            if (sr > dr) { dh = Math.round(r.w / sr); dy = r.y + Math.round((r.h - dh) / 2); }
            else { dw = Math.round(r.h * sr); dx = r.x + Math.round((r.w - dw) / 2); }
            ctx.drawImage(im, dx, dy, dw, dh);
          }
        }
        continue;
      }

      if (el.type === "metric") {
        const pid = parseMetricId(el.id) || el.personId;
        const p = people.find((x) => x.id === pid);
        const l1raw = p ? (p.lastName || "").trim() : "";
        const l2raw = p ? [p.firstName, p.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ") : "";
        const l3 = p ? [p.birthDate, p.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" - ") : "";
        if (!l1raw && !l2raw && !l3) continue;

        const mode = "lower";
        const L1 = transformCaseExceptFirstPerWord(l1raw, mode);
        const L2 = transformCaseExceptFirstPerWord(l2raw, mode);

        const maxW = r.w - 8;
        const maxH = r.h - 8;
        const perLineH = Math.max(8, Math.floor(maxH / 3));
        const f1 = fitCanvas.fitOneLine(L1, maxW, perLineH);
        const f2 = fitCanvas.fitOneLine(L2, maxW, perLineH);
        const f3 = fitCanvas.fitOneLine(l3, maxW, perLineH);
        const f = Math.max(8, Math.min(perLineH, f1, f2, f3));

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const cy1 = r.y + (r.h / 6);
        const cy2 = r.y + (r.h / 2);
        const cy3 = r.y + (r.h * 5 / 6);
        if (L1) { ctx.font = `bold ${f}px "Times New Roman", ${fitCanvas.family}`; ctx.fillText(L1, r.x + r.w / 2, cy1, maxW); }
        if (L2) { ctx.font = `bold ${f}px "Times New Roman", ${fitCanvas.family}`; ctx.fillText(L2, r.x + r.w / 2, cy2, maxW); }
        if (l3) { ctx.font = `${Math.round(f * 0.9)}px "Times New Roman", ${fitCanvas.family}`; ctx.fillText(l3, r.x + r.w / 2, cy3, maxW); }
        ctx.restore();
        continue;
      }
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  };

  useEffect(() => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(async () => {
      const wrap = previewWrapperRef.current; if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const miniW = Math.max(320, Math.floor(rect.width));
      const miniH = Math.max(320, Math.floor(rect.height));
      const mini = await renderPreview(miniW, miniH);

      const maxSide = 1600;
      const ratio = rect.width / Math.max(1, rect.height);
      const bigW = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
      const bigH = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
      const big = await renderPreview(bigW, bigH);

      const prev = loadOrderDraft();
      const needSave =
        (!!mini && mini !== (prev as any).editorBack?.previewUrl) ||
        (!!big && big !== (prev as any).editorBack?.previewHiUrl);
      if (needSave) {
        saveOrderDraft({
          ...prev,
          editorBack: {
            ...(prev as any).editorBack,
            previewUrl: mini || (prev as any).editorBack?.previewUrl,
            previewHiUrl: big || (prev as any).editorBack?.previewHiUrl,
            previewUpdatedAt: Date.now(),
            elements,
            selectedGraphicsIds: selGraphicIds,
            graphicsMeta: rearMeta,
            epitaphTexts: selEpitaphTexts,
            people: normalizePersonsForSave(people),
            wishes,
            carvingOpacity
          }
        });
      }
    }, 260) as unknown as number;

    return () => { if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current); };
  }, [elements, selGraphicIds, selEpitaphTexts, rearMeta, item?.url, gCats, carvingOpacity, people, transientPhotoUrlById]);

  /* ===== WYSIWYG: слой «резной работы» (оверлей) ===== */
  const [carveUrl, setCarveUrl] = useState<string | null>(null);
  const buildCarveOverlay = useCallback(async (W: number, H: number) => {
    if (!item?.url || W <= 2 || H <= 2) { setCarveUrl(null); return; }
    const baseImg = await loadImageSafe(item.url);
    if (!baseImg) { setCarveUrl(null); return; }

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) { setCarveUrl(null); return; }

    const sr = baseImg.width / baseImg.height;
    const dr = W / H;
    let rw: number, rh: number, rx: number, ry: number;
    if (sr > dr) { rw = W; rh = Math.round(W / sr); rx = 0; ry = Math.round((H - rh) / 2); }
    else { rh = H; rw = Math.round(H * sr); ry = 0; rx = Math.round((W - rw) / 2); }

    const off = document.createElement("canvas");
    off.width = rw; off.height = rh;
    const octx = off.getContext("2d")!;
    octx.clearRect(0, 0, rw, rh);
    octx.drawImage(baseImg, 0, 0, rw, rh);

    try {
      const id = octx.getImageData(0, 0, rw, rh);
      const d = id.data;
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = rw; maskCanvas.height = rh;
      const mctx = maskCanvas.getContext("2d")!;
      const mask = mctx.createImageData(rw, rh);
      const md = mask.data;
      for (let i = 0; i < d.length; i += 4) {
        const A = d[i + 3];
        const alpha = A < 10 ? 255 : 0;
        md[i + 0] = 0; md[i + 1] = 0; md[i + 2] = 0; md[i + 3] = alpha;
      }
      mctx.putImageData(mask, 0, 0);
      octx.clearRect(0, 0, rw, rh);
      octx.fillStyle = "#2e2e2e";
      octx.fillRect(0, 0, rw, rh);
      octx.globalCompositeOperation = "destination-out";
      octx.drawImage(maskCanvas, 0, 0);
      octx.globalCompositeOperation = "source-over";
    } catch { /* no-op */ }

    ctx2.drawImage(off, rx, ry);
    setCarveUrl(canvas.toDataURL("image/png"));
  }, [item?.url]);

  useEffect(() => {
    const wrap = previewWrapperRef.current;
    if (!wrap) return;
    const make = () => {
      const r = wrap.getBoundingClientRect();
      buildCarveOverlay(Math.max(2, Math.floor(r.width)), Math.max(2, Math.floor(r.height)));
    };
    make();
    const ro = new ResizeObserver(make);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [buildCarveOverlay]);

  /* ===== DnD ===== */
  const dragRef = useRef<{
    id: string;
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    startX: number;
    startY: number;
    start: EditorEl;
  } | null>(null);

  const contentWH = () => {
    const r = previewWrapperRef.current?.getBoundingClientRect();
    if (!r) return { w: 1, h: 1 };
    const w = Math.max(1, r.width - SKETCH_PAD * 2);
    const h = Math.max(1, r.height - SKETCH_PAD * 2);
    return { w, h };
  };
  const clampPct2 = (x: number, y: number, w: number, h: number) => ({
    x: Math.max(0, Math.min(100 - w, x)),
    y: Math.max(0, Math.min(100 - h, y)),
    w: Math.max(1, Math.min(100, w)),
    h: Math.max(1, Math.min(100, h))
  });
  const snap2 = (v: number, step = 1) => Math.round(v / step) * step;

  const onPointerDownBox = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" = "move"
  ) => {
    e.stopPropagation();
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    setSelectedId(id);
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { id, mode, startX: e.clientX, startY: e.clientY, start: { ...el } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    e.preventDefault();
    const { w: cw, h: ch } = contentWH();
    const dx = ((e.clientX - d.startX) / cw) * 100;
    const dy = ((e.clientY - d.startY) / ch) * 100;
    const withSnap = !e.altKey;
    const step = e.shiftKey ? 1.5 : 1;

    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        let { x, y, w, h } = d.start;

        if (d.mode === "move") {
          let nx = x + dx, ny = y + dy;
          if (withSnap) { nx = snap2(nx, step); ny = snap2(ny, step); }
          return { ...el, ...clampPct2(nx, ny, w, h) };
        }

        let nx = x, ny = y, nw = w, nh = h;
        if (d.mode.includes("e")) nw = w + dx;
        if (d.mode.includes("s")) nh = h + dy;
        if (d.mode.includes("w")) { nx = x + dx; nw = w - dx; }
        if (d.mode.includes("n")) { ny = y + dy; nh = h - dy; }
        if (withSnap) { nx = snap2(nx, step); ny = snap2(ny, step); nw = snap2(nw, step); nh = snap2(nh, step); }
        return { ...el, ...clampPct2(nx, ny, nw, nh) };
      })
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragRef.current = null;
  };

  /* ===== Mini-toolbar ===== */
  const MiniToolbar = ({ el }: { el: EditorEl }) => {
    const btn: React.CSSProperties = { ...glassButtonStyle("nano"), padding: "4px 8px", fontSize: 13 };
    const isEpitaph = el.type === "epitaph";
    const isGraphic = el.type === "graphic";
    const isMetric = el.type === "metric";
    const canStair = isEpitaph && isRememberLoveMourn(el.text || "");
    const caseMode = el.caseRest || "lower";
    return (
      <div
        onPointerDown={(ev) => ev.stopPropagation()}
        style={{
          position: "absolute",
          left: 0,
          top: -38,
          display: "flex",
          gap: 8,
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 8,
          padding: "4px 8px",
          alignItems: "center",
          pointerEvents: "auto",
          zIndex: 3000
        }}
      >
        {isEpitaph && canStair && (
          <button
            type="button"
            style={btn}
            title={el.staircase ? "Показать в одну строку" : "Показать лесенкой"}
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, staircase: !e.staircase } : e)))}
          >
            {el.staircase ? "В строку" : "Лесенкой"}
          </button>
        )}
        {isGraphic && (
          <button
            type="button"
            style={btn}
            title="Отразить по горизонтали"
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, flipH: !e.flipH } : e)))}
          >
            Отразить ⇄
          </button>
        )}
        {isMetric && (
          <button
            type="button"
            style={btn}
            title="Строчные/ПРОПИСНЫЕ (меняет регистр букв, кроме первых)"
            onClick={() => setElements((prev) => prev.map((e) => (e.id === el.id ? { ...e, caseRest: (e.caseRest || "lower") === "lower" ? "upper" : "lower" } : e)))}
          >
            {caseMode === "upper" ? "строчные" : "ПРОПИСНЫЕ"}
          </button>
        )}
        <button type="button" style={btn} title="Удалить элемент" onClick={() => removeElement(el.id)}>
          Удалить
        </button>
      </div>
    );
  };

  /* ===== Overlay (элементы) ===== */
  const ContentOverlay = () => {
    return (
      <>
        {elements.slice().sort((a, b) => a.z - b.z).map((el) => {
          if (el.type === "graphic") {
            const parsed = parseGraphicId(el.id);
            const gid = parsed?.gid || "";
            const g = gid ? findGraphic(gid) : undefined;
            const tr = el.flipH ? "scaleX(-1)" : "none";
            return (
              <div key={el.id} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, pointerEvents: "none" }}>
                {g?.url ? (
                  <img
                    src={g.preview || g.url}
                    alt={g.name || "Графика"}
                    style={{ width: "100%", height: "100%", objectFit: "contain", transform: tr, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))", userSelect: "none", pointerEvents: "none", willChange: "transform", transformOrigin: "center" }}
                    draggable={false}
                  />
                ) : null}
              </div>
            );
          }

          if (el.type === "photo") {
            const pid = parsePhotoId(el.id) || el.personId;
            const p = people.find((x) => x.id === pid);
            const photoUrl = p ? (transientPhotoUrlById[p.id] ?? p.photoUrl ?? p.photoDataUrl ?? undefined) : undefined;
            if (!photoUrl) return null;
            return (
              <div key={el.id} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, pointerEvents: "none" }}>
                <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", userSelect: "none", pointerEvents: "none", willChange: "transform", transform: "translateZ(0)" }} draggable={false} />
              </div>
            );
          }

          if (el.type === "metric") {
            const pid = parseMetricId(el.id) || el.personId;
            const p = people.find((x) => x.id === pid);
            const lastName = p ? (p.lastName || "").trim() : "";
            const firstPatro = p ? [p.firstName, p.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ") : "";
            const dates = p ? [p.birthDate, p.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" - ") : "";
            if (!lastName && !firstPatro && !dates) return null;
            const mode = el.caseRest || "lower";
            const L1 = transformCaseExceptFirstPerWord(lastName, mode);
            const L2 = transformCaseExceptFirstPerWord(firstPatro, mode);
            const L3 = dates;
            return (
              <div key={el.id} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, color: "#fff", textAlign: "center", pointerEvents: "none", display: "grid", placeItems: "center" }}>
                <div style={{ width: "100%", padding: "0 4px", fontFamily: `"Century Schoolbook","Times New Roman",serif`, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  {L1 && <div style={{ fontWeight: 700 }}>{L1}</div>}
                  {L2 && <div style={{ fontWeight: 700 }}>{L2}</div>}
                  {L3 && <div style={{ marginTop: 2 }}>{L3}</div>}
                </div>
              </div>
            );
          }

          const text = el.text || "";
          if (el.staircase && isRememberLoveMourn(text)) {
            const { top, mid, bot } = splitRememberPreserve(text);
            return (
              <div key={el.id} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, color: "#fff", fontFamily: `"Century Schoolbook","Times New Roman",serif`, textShadow: "0 1px 2px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
                <div style={{ position: "absolute", top: 0, left: 4, fontWeight: 600 }}>{top}</div>
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", fontWeight: 600 }}>{mid}</div>
                <div style={{ position: "absolute", right: 4, bottom: 0, fontWeight: 600 }}>{bot}</div>
              </div>
            );
          } else {
            return (
              <div key={el.id} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                <div style={{ width: "100%", padding: "0 4px", textAlign: "center", color: "#fff", fontFamily: `"Century Schoolbook","Times New Roman",serif`, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  <div style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{text}</div>
                </div>
              </div>
            );
          }
        })}
      </>
    );
  };

  /* ===== Сброс выделения при пустых данных ===== */
  useEffect(() => {
    if (!selectedId) return;
    const sel = elements.find((e) => e.id === selectedId);
    if (!sel) return;
    if (sel.type === "photo") {
      const pid = parsePhotoId(sel.id) || sel.personId;
      const p = people.find((x) => x.id === pid);
      const photoUrl = p ? (transientPhotoUrlById[p.id] ?? p.photoUrl ?? p.photoDataUrl ?? undefined) : undefined;
      if (!photoUrl) setSelectedId(null);
    } else if (sel.type === "metric") {
      const pid = parseMetricId(sel.id) || sel.personId;
      const p = people.find((x) => x.id === pid);
      const hasL1 = !!p?.lastName?.trim();
      const hasL2 = !!([p?.firstName, p?.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" "));
      const hasL3 = !!([p?.birthDate, p?.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" - "));
      if (!hasL1 && !hasL2 && !hasL3) setSelectedId(null);
    }
  }, [selectedId, elements, people, transientPhotoUrlById]);

  /* ===== Навигация ===== */
  const handleBack = () => { setOutro(true); setTimeout(() => onBack?.(), 320); };
  const handleContinue = () => {
    const prev = loadOrderDraft();
    const next = saveOrderDraft({
      ...prev,
      editorBack: {
        ...(prev as any).editorBack,
        elements,
        selectedGraphicsIds: selGraphicIds,
        graphicsMeta: rearMeta,
        epitaphTexts: selEpitaphTexts,
        people: normalizePersonsForSave(people),
        wishes,
        carvingOpacity,
        updatedAt: Date.now()
      }
    });
    setOutro(true);
    setTimeout(() => onContinue?.({ editorBack: next.editorBack }), 320);
  };

  // Добавить человека
  const addPerson = () => {
    const next = people.concat([makeBlankPerson()]);
    setPeople(next);
    saveEditorBack({ people: normalizePersonsForSave(next) });
  };

  /* ===== Render ===== */
  return (
    <div style={{ color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease", maxWidth: 600, margin: "0 auto" }}>
      <TopBarWithIntro title="Тыл" />

      {/* Липкая навигация */}
      <div
        ref={navRef}
        style={{
          position: "sticky",
          top: 2,
          zIndex: 50,
          paddingTop: "env(safe-area-inset-top)",
          background: "rgba(0,0,0,0.96)",
          borderRadius: 12,
          border: "1px dashed rgba(255, 255, 255, 1)",
          marginBottom: 10
        }}
      >
        <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
          <button onClick={() => { openOnly("graphics"); scrollToById(secGraphicsId); }} style={glassButtonStyle("nano")}>
            Графика {openSecGraphics ? "▾" : "▸"}
          </button>
          <button onClick={() => { openOnly("epitaphs"); scrollToById(secEpitaphsId); }} style={glassButtonStyle("nano")}>
            Эпитафии {openSecEpitaphs ? "▾" : "▸"}
          </button>
          <button onClick={() => { openOnly("people"); scrollToById(secPeopleId); }} style={glassButtonStyle("nano")}>
            Усопшие {openSecPeople ? "▾" : "▸"}
          </button>

          <button onClick={() => scrollToById(previewSectionId)} style={glassButtonStyle("nano")}>Эскиз</button>
          <button onClick={() => scrollToById(chosenSectionId)} style={glassButtonStyle("nano")}>Выбранное</button>
        </div>
      </div>

      {/* Подсказка */}
      <section style={{ ...glassPanelStyle(), padding: "10px 12px", margin: "8px 0", fontSize: 13, lineHeight: 1.4 }}>
        Если оформление тыльной стороны не нужно — оставьте пустым и нажмите{" "}
        <button type="button" onClick={handleContinue} style={linkLikeButton()}>
           «Продолжить»
        </button>.
      </section>

      {/* ГРАФИКА (каталог) */}
      <section id={secGraphicsId} style={{ margin: "10px 0" }}>
        <Collapsible
          open={openSecGraphics}
          header={
            <button type="button" onClick={() => openOnly("graphics")} style={{ ...glassPanelStyle(), width: "100%", padding: "12px 14px", borderRadius: 12, cursor: "pointer" }}>
              <strong>Графика</strong> {openSecGraphics ? "▾" : "▸"}
            </button>
          }
        >
          <div style={{ ...glassPanelStyle(), padding: 12, marginTop: 8 }}>
            {gLoading && <div>Загрузка каталога…</div>}
            {gError && <div style={{ color: "#ffb4b4" }}>{gError}</div>}
            {!gLoading && !gCats.length && <div>Каталог пуст.</div>}

            {!gLoading && gCats.length > 0 && (
              <div style={{ display: "grid", gap: 12 }}>
                {gCats.map((cat) => {
                  const opened = !!openCats[cat._id];
                  const total = cat.items.length + cat.children.reduce((acc: number, s: any) => acc + s.items.length, 0);
                  return (
                    <section key={cat._id}>
                      <Collapsible
                        open={opened}
                        header={
                          <button
                            type="button"
                            onClick={() => toggleCat(cat._id)}
                            aria-expanded={opened}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              width: "100%",
                              padding: "12px 14px",
                              background: opened ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.16)",
                              borderRadius: 12,
                              cursor: "pointer",
                              color: "#fff"
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ display: "inline-block", transition: "transform 240ms ease", transform: opened ? "rotate(90deg)" : "rotate(0deg)" }} aria-hidden>▶</span>
                              <span style={{ fontSize: 16, fontWeight: 600 }}>{cat.name}</span>
                            </div>
                            <span style={{ opacity: 0.9, fontSize: 12 }}>{total} элементов</span>
                          </button>
                        }
                      >
                        <div style={{ padding: 10, display: "grid", gap: 12 }}>
                          {cat.items.length > 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: twoColGrid(140, 100), gap: GRID_GAP_PX }}>
                              {cat.items.map((g: any) => {
                                const gid = String(g.id);
                                const qty = countsById[gid] || 0;
                                return (
                                  <div key={gid} style={{ ...glassPanelStyle(), borderRadius: 12, padding: 6, textAlign: "center", outline: qty > 0 ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)" }}>
                                    <button
                                      type="button"
                                      onClick={() => addGraphicRear(g)}
                                      title="Добавить на тыльную сторону"
                                      style={{ ...bottomUnderlayGradient(), borderRadius: 10, aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", padding: 6, width: "100%", border: "none", cursor: "pointer", background: "transparent" }}
                                    >
                                      <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }} />
                                    </button>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                      <button type="button" onClick={() => removeOneGraphicRear(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                                      <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                                      <button type="button" onClick={() => addGraphicRear(g)} disabled={qty >= 3} style={{ ...glassButtonStyle("nano", qty >= 3) }}>+</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {cat.children.length > 0 && cat.children.map((sub: any) => {
                            const subOpen = !!openSubs[sub._id];
                            return (
                              <section key={sub._id}>
                                <Collapsible
                                  open={subOpen}
                                  header={
                                    <button
                                      type="button"
                                      onClick={() => toggleSub(sub._id)}
                                      aria-expanded={subOpen}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        width: "100%",
                                        padding: "10px 12px",
                                        background: subOpen ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.14)",
                                        borderRadius: 10,
                                        cursor: "pointer",
                                        color: "#fff"
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ display: "inline-block", transition: "transform 220ms ease", transform: subOpen ? "rotate(90deg)" : "rotate(0deg)" }} aria-hidden>▶</span>
                                        <span style={{ fontSize: 14, fontWeight: 600 }}>{sub.name}</span>
                                      </div>
                                      <span style={{ opacity: 0.9, fontSize: 12 }}>{sub.items.length} элементов</span>
                                    </button>
                                  }
                                >
                                  <div style={{ padding: 10 }}>
                                    <div style={{ display: "grid", gridTemplateColumns: twoColGrid(140, 100), gap: GRID_GAP_PX }}>
                                      {sub.items.map((g: any) => {
                                        const gid = String(g.id);
                                        const qty = countsById[gid] || 0;
                                        return (
                                          <div key={gid} style={{ ...glassPanelStyle(), borderRadius: 12, padding: 6, textAlign: "center", outline: qty > 0 ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)" }}>
                                            <button
                                              type="button"
                                              onClick={() => addGraphicRear(g)}
                                              title="Добавить на тыльную сторону"
                                              style={{ ...bottomUnderlayGradient(), borderRadius: 10, aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", padding: 6, width: "100%", border: "none", cursor: "pointer", background: "transparent" }}
                                            >
                                              <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }} />
                                            </button>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                              <button type="button" onClick={() => removeOneGraphicRear(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                                              <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                                              <button type="button" onClick={() => addGraphicRear(g)} disabled={qty >= 3} style={{ ...glassButtonStyle("nano", qty >= 3) }}>+</button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </Collapsible>
                              </section>
                            );
                          })}
                        </div>
                      </Collapsible>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </Collapsible>
      </section>

      {/* ЭПИТАФИИ (панель выбора, без отдельного списка выбранных — см. блок «Выбранное» ниже) */}
      <section id={secEpitaphsId} style={{ margin: "10px 0" }}>
        <Collapsible
          open={openSecEpitaphs}
          header={
            <button type="button" onClick={() => openOnly("epitaphs")} style={{ ...glassPanelStyle(), width: "100%", padding: "12px 14px", borderRadius: 12, cursor: "pointer" }}>
              <strong>Эпитафии</strong> {openSecEpitaphs ? "▾" : "▸"}
            </button>
          }
        >
          <div style={{ ...glassPanelStyle(), padding: 12, marginTop: 8 }}>
            <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {QUICK_EPITAPHS.map((t) => {
                const active = selEpitaphTexts.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleEpitaphText(t)} style={{ ...glassButtonStyle("nano"), border: active ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.28)" }} title={t}>
                    {t}
                  </button>
                );
              })}
            </div>

            {/* Еще варианты */}
            <MoreEpitaphsAccordion items={MORE_EPITAPHS} selEpitaphTexts={selEpitaphTexts} onToggle={(t) => toggleEpitaphText(t)} />

            <div style={{ marginTop: 10, marginBottom: 6, textAlign: "left" }}>Свой вариант:</div>
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                rows={3}
                value={customEpi}
                onChange={(e) => setCustomEpi(e.target.value)}
                placeholder='  Введите текст и нажмите «Добавить»'
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    const v = customEpi.trim();
                    if (v) { addCustomEpitaph(v); setCustomEpi(""); }
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  outline: "none",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
                  resize: "vertical"
                }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={glassButtonStyle("nano")} onClick={() => { const v = customEpi.trim(); if (v) { addCustomEpitaph(v); setCustomEpi(""); } }}>
                  Добавить
                </button>
                <button type="button" style={glassButtonStyle("nano")} onClick={clearEpitaphs}>
                  Очистить выбранные
                </button>
                {selEpitaphTexts.length > 0 && <div style={{ alignSelf: "center" }}>Выбрано: {selEpitaphTexts.length}</div>}
              </div>
            </div>
          </div>
        </Collapsible>
      </section>

      {/* УСОПШИЕ */}
      <section id={secPeopleId} style={{ margin: "10px 0" }}>
        <Collapsible
          open={openSecPeople}
          header={
            <button type="button" onClick={() => openOnly("people")} style={{ ...glassPanelStyle(), width: "100%", padding: "12px 14px", borderRadius: 12, cursor: "pointer" }}>
              <strong>Усопшие</strong> {openSecPeople ? "▾" : "▸"}
            </button>
          }
        >
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            {people.map((p, idx) => {
              const err = validateDates(p.birthDate, p.deathDate);
              const nameShort = [p.firstName, p.middleName].filter(Boolean).join(" ") || "Без имени";
              return (
                <div key={p.id} id={`person-${p.id}`} style={{ ...glassPanelStyle(), padding: 0, scrollMarginTop: navH + 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(0,0,0,0.66)", borderRadius: "12px 12px 0 0" }}>
                    <span style={{ opacity: 0.9 }}>{idx + 1} -</span>
                    <div style={{ fontSize: 16, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameShort}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => {
                        if (idx === 0) return;
                        const copy = people.slice();
                        [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                        setPeople(copy);
                        saveEditorBack({ people: normalizePersonsForSave(copy) });
                      }} disabled={idx === 0} style={{ ...iconBtn(), opacity: idx === 0 ? 0.4 : 1 }} title="Выше">
                        ▲
                      </button>
                      <button type="button" onClick={() => {
                        if (idx === people.length - 1) return;
                        const copy = people.slice();
                        [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                        setPeople(copy);
                        saveEditorBack({ people: normalizePersonsForSave(copy) });
                      }} disabled={idx === people.length - 1} style={{ ...iconBtn(), opacity: idx === people.length - 1 ? 0.4 : 1 }} title="Ниже">
                        ▼
                      </button>
                      <button type="button" onClick={() => {
                        const next = people.filter((x) => x.id !== p.id);
                        const safe = next.length ? next : [makeBlankPerson("p-0")];
                        setPeople(safe);
                        saveEditorBack({ people: normalizePersonsForSave(safe) });
                      }} style={iconBtn()} title="Удалить">
                        ✖
                      </button>
                    </div>
                  </div>

                  <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
                    <div style={{ display: "grid", gap: 10 }}>
                      <Field label="Фамилия"><input value={p.lastName ?? ""} onChange={(e) => setPeople((prev) => prev.map((x) => x.id === p.id ? { ...x, lastName: e.target.value } : x))} style={inputStyle()} placeholder="Иванов" /></Field>
                      <Field label="Имя"><input value={p.firstName ?? ""} onChange={(e) => setPeople((prev) => prev.map((x) => x.id === p.id ? { ...x, firstName: e.target.value } : x))} style={inputStyle()} placeholder="Иван" /></Field>
                      <Field label="Отчество"><input value={p.middleName ?? ""} onChange={(e) => setPeople((prev) => prev.map((x) => x.id === p.id ? { ...x, middleName: e.target.value } : x))} style={inputStyle()} placeholder="Иванович" /></Field>

                      <Field label="Дата рождения">
                        <input value={p.birthDate ?? ""} onChange={(e) => setPeople((prev) => prev.map((x) => x.id === p.id ? { ...x, birthDate: e.target.value } : x))} style={{ ...inputStyle(), borderColor: err && err.includes("рождения") ? "salmon" : "rgba(255,255,255,0.18)" }} placeholder="01.01.1950" />
                      </Field>
                      <Field label="Дата смерти">
                        <input value={p.deathDate ?? ""} onChange={(e) => setPeople((prev) => prev.map((x) => x.id === p.id ? { ...x, deathDate: e.target.value } : x))} style={{ ...inputStyle(), borderColor: err && (err.includes("смерти") || err.includes("раньше")) ? "salmon" : "rgba(255,255,255,0.18)" }} placeholder="01.01.2024" />
                      </Field>
                      {!!err && <div style={{ color: "salmon", fontSize: 12, marginTop: -4 }}>{err}</div>}

                      <PhotoField
                        label="Фотография"
                        value={{
                          url: transientPhotoUrlById[p.id] ?? p.photoUrl ?? undefined,
                          dataUrl: p.photoDataUrl ?? undefined
                        }}
                        onChange={(pv) => setPersonPhotoById(p.id, pv)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            <div>
              <button type="button" onClick={() => addPerson()} style={glassButtonStyle("sm")}>Добавить</button>
            </div>
          </div>
        </Collapsible>
      </section>

      {/* ЭСКИЗ (редактор) */}
      <section id={previewSectionId} style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
        <div
          ref={previewWrapperRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={() => setSelectedId(null)}
          style={{
            position: "relative",
            width: "100%",
            borderRadius: 10,
            overflow: "hidden",
            userSelect: "none",
            ...bottomUnderlayGradient(),
            aspectRatio: aspect,
            minHeight: aspect ? undefined : 540
          }}
        >
          {/* БАЗА — зеркалим и РАСТЯГИВАЕМ НА ВСЮ ОБЛАСТЬ */}
          <img
            src={item?.url || ""}
            alt={item?.name || "Изделие"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
              opacity: 0.25,
              userSelect: "none",
              pointerEvents: "none"
            }}
            draggable={false}
            onLoad={(e) => {
              const im = e.currentTarget;
              if (im.naturalWidth && im.naturalHeight) setImgWH({ w: im.naturalWidth, h: im.naturalHeight });
            }}
            onError={() => { if (!imgWH) setImgWH({ w: 4, h: 3 }); }}
          />

          {/* Слой «резной работы» */}
          {carveUrl && (
            <img
              src={carveUrl}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
                userSelect: "none",
                pointerEvents: "none",
                opacity: 0.9
              }}
              draggable={false}
            />
          )}

          {/* Контент */}
          <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, overflow: "hidden" }}>
            <ContentOverlay />
          </div>

          {/* Рамки/ручки */}
          <div style={{ position: "absolute", left: SKETCH_PAD, top: SKETCH_PAD, right: SKETCH_PAD, bottom: SKETCH_PAD, zIndex: 1000, pointerEvents: "none" }}>
            {elements.slice().sort((a, b) => a.z - b.z).map((el) => {
              // Скрываем рамки для пустых фото/метрик
              if (el.type === "photo") {
                const p = people.find((x) => x.id === (parsePhotoId(el.id) || el.personId));
                const photoUrl = p ? (transientPhotoUrlById[p.id] ?? p.photoUrl ?? p.photoDataUrl ?? undefined) : undefined;
                if (!photoUrl) return null;
              } else if (el.type === "metric") {
                const p = people.find((x) => x.id === (parseMetricId(el.id) || el.personId));
                const hasL1 = !!p?.lastName?.trim();
                const hasL2 = !!([p?.firstName, p?.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" "));
                const hasL3 = !!([p?.birthDate, p?.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" - "));
                if (!hasL1 && !hasL2 && !hasL3) return null;
              }

              const selected = el.id === selectedId;
              const HIT = 36, DOT = 20;
              const handleDot = (left: number | string, top: number | string, cursor: string): React.CSSProperties => ({
                position: "absolute", left, top, width: HIT, height: HIT, transform: "translate(-50%, -50%)", cursor, pointerEvents: "auto", display: "grid", placeItems: "center"
              });
              const dotInner: React.CSSProperties = { width: DOT, height: DOT, background: "#fff", border: "1px solid #000", borderRadius: 4, boxShadow: "0 1px 2px rgba(0,0,0,0.35)" };

              return (
                <div
                  key={el.id}
                  onPointerDown={(ev) => onPointerDownBox(ev, el.id, "move")}
                  style={{
                    position: "absolute",
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.w}%`,
                    height: `${el.h}%`,
                    border: selected ? "2px solid #8ab4ff" : "1px dashed rgba(255,255,255,0.85)",
                    borderRadius: 6,
                    background: "transparent",
                    pointerEvents: "auto",
                    cursor: "move",
                    touchAction: "none"
                  }}
                  title={el.id}
                >
                  {selected && <MiniToolbar el={el} />}
                  {selected && (
                    <>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "nw")} style={handleDot(0, 0, "nwse-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "n")}  style={handleDot("50%", 0, "ns-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "ne")} style={handleDot("100%", 0, "nesw-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "e")}  style={handleDot("100%", "50%", "ew-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "se")} style={handleDot("100%", "100%", "nwse-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "s")}  style={handleDot("50%", "100%", "ns-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "sw")} style={handleDot(0, "100%", "nesw-resize")}><div style={dotInner} /></div>
                      <div onPointerDown={(ev) => onPointerDownBox(ev as any, el.id, "w")}  style={handleDot(0, "50%", "ew-resize")}><div style={dotInner} /></div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ВЫБРАННОЕ (графика + эпитафии) — ПОД ЭСКИЗОМ */}
      <section id={chosenSectionId} style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0", scrollMarginTop: navH + 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <strong>Выбранное</strong>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <button type="button" onClick={clearRearGraphics} style={glassButtonStyle("nano")} title="Очистить выбранную графику">
              Очистить графику
            </button>
            <button type="button" onClick={clearEpitaphs} style={glassButtonStyle("nano")} title="Очистить выбранные эпитафии">
              Очистить эпитафии
            </button>
          </div>
        </div>

        {(() => {
          const uniqueIds = Array.from(new Set(selGraphicIds));
          const hasGraphics = uniqueIds.length > 0;
          const hasEpitaphs = selEpitaphTexts.length > 0;

          if (!hasGraphics && !hasEpitaphs) {
            return <div style={{ opacity: 0.8 }}>Пусто — выберите графику и/или эпитафии выше.</div>;
          }

          return (
            <div style={{ display: "grid", gap: 12 }}>
              {hasGraphics && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Графика</div>
                  <div style={{ display: "grid", gridTemplateColumns: twoColGrid(140, 100), gap: GRID_GAP_PX }}>
                    {uniqueIds.map((gid) => {
                      const meta = findGraphic(gid) || rearMeta[gid];
                      const qty = countsById[gid] || 0;
                      return (
                        <div key={"chosen-" + gid} style={{ ...glassPanelStyle(), borderRadius: 12, padding: 8, textAlign: "center", outline: "2px solid #8ab4ff" }} title={meta?.name || gid}>
                          <div style={{ ...bottomUnderlayGradient(), borderRadius: 10, aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", padding: 6 }}>
                            {meta?.url ? <img src={meta.preview || meta.url} alt={meta.name || gid} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <div style={{ opacity: 0.7, fontSize: 12 }}>нет данных</div>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
                            <button type="button" aria-label="Удалить один" onClick={() => removeOneGraphicRear(gid)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0) }}>−</button>
                            <span style={{ minWidth: 28, textAlign: "center", fontWeight: 700 }}>{qty}</span>
                            <button type="button" aria-label="Добавить один" onClick={() => meta && addGraphicRear(meta)} disabled={qty >= 3} style={{ ...glassButtonStyle("nano", qty >= 3) }}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasEpitaphs && (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Эпитафии</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {selEpitaphTexts.map((t) => (
                      <div key={t} style={{ ...glassPanelStyle(), borderRadius: 10, padding: 10, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>{t}</div>
                        <button type="button" style={glassButtonStyle("nano")} onClick={() => removeEpitaphText(t)}>
                          Удалить
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </section>

      {/* Пожелания и кнопки */}
      <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
        <label htmlFor="wishes-back" style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>
          Пожелания по эскизу (тыльная)
        </label>
        <textarea
          id="wishes-back"
          value={wishes}
          onChange={(e) => { setWishes(e.target.value); saveEditorBack({ wishes: e.target.value }); }}
          rows={4}
          placeholder="Например: эпитафию внизу по центру, графику — отразить вправо…"
          style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.35)", color: "#fff", padding: 10, resize: "vertical", outline: "none", boxSizing: "border-box" }}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" onClick={() => { setOutro(true); setTimeout(() => onBack?.(), 320); }} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
      </div>
    </div>
  );
}

/* ===== Эпитафии: «Еще варианты» ===== */
function MoreEpitaphsAccordion({
  items,
  selEpitaphTexts,
  onToggle
}: {
  items: string[];
  selEpitaphTexts: string[];
  onToggle: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      header={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ ...glassPanelStyle(), width: "100%", padding: "10px 12px", borderRadius: 10, cursor: "pointer" }}
        >
          <strong>Еще варианты</strong> {open ? "▾" : "▸"}
        </button>
      }
    >
      <div style={{ padding: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {items.map((t, idx) => {
            const active = selEpitaphTexts.includes(t);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onToggle(t)}
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
      </div>
    </Collapsible>
  );
}

/* ===== Form helpers ===== */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, width: "100%", boxSizing: "border-box" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </label>
  );
}
