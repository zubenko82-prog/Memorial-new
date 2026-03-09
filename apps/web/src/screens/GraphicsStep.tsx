// src/screens/GraphicsStep.tsx
// Поддержка подпапок ЛЮБОЙ глубины из путей relPath/path/url.
// Навигация и горизонтальный/вертикальный шаблон эскиза — как в EngravingStep.
// Теперь предпросмотр построен на общем компоненте SketchTemplate, а ЭПИТАФИИ тоже отображаются.
//
// Что делает экран:
// - Каталог с аккордеонами (категории и подкатегории), выбор графики с подсветкой и управляющими +/-.
// - Клик по миниатюре добавляет элемент (не более 2 одинаковых — предупреждаем).
// - Предпросмотр эскиза: на изображение изделия накладываем людей (портрет+метрика), выбранные оверлеи и эпитафии.
// - Горизонтальный/вертикальный шаблон и метрика — внутри SketchTemplate.
// - Кресты и прочая графика — передаём в SketchTemplate как оверлеи.
// - Кнопка «Эскиз» и скролл к категории/подкатегории учитывают высоту навигации и анимации раскрытия.
//
// Изменение: галерея сеткой — минимум 2 в ряд (минимум две колонки) даже на узком экране.
// Реализовано через minmax(clamp(..., (100% - gap)/2, ...), 1fr), чтобы ячейки сжимались до половины ширины контейнера.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchCatalog } from "../api";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { loadOrderDraft, saveOrderDraft, DRAFT_UPDATED_EVENT } from "../lib/order";

/* ===== UI ===== */
function glassButtonStyle(size = "sm", disabled = false) {
  const pad = { nano: "2px 6px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: (pad as any)[size] || pad.sm,
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

// Общая формула колонок: минимум 2 в ряд
// gap = 10px => на 2 колонки ширина колонки ≈ (100% - 10px) / 2.
// min 100px, целевая половина контейнера, max 140px (или 120px где нужно).
const GAP_PX = 10;
const twoColGrid = (maxPx = 140, minPx = 100) =>
  `repeat(auto-fill, minmax(clamp(${minPx}px, calc((100% - ${GAP_PX}px)/2), ${maxPx}px), 1fr))`;

function Collapsible({
  open,
  header,
  children,
  duration = 300
}: {
  open: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
  duration?: number;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const [mounted, setMounted] = useState(false);
  const measure = useCallback(() => contentRef.current?.scrollHeight || 0, []);
  useEffect(() => {
    setMounted(true);
    const onResize = () => open && setHeight(measure());
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [open, measure]);
  useEffect(() => {
    const h = measure();
    if (open) {
      setHeight(h);
      const t = setTimeout(() => setHeight(h), duration + 16);
      return () => clearTimeout(t);
    } else {
      setHeight(h);
      const t = setTimeout(() => setHeight(0), 16);
      return () => clearTimeout(t);
    }
  }, [open, measure, duration]);
  return (
    <div style={{ ...glassPanelStyle(), borderRadius: 12 }}>
      {header}
      <div
        style={{
          overflow: "hidden",
          height: open ? height : 0,
          transition: mounted ? `height ${duration}ms ease, opacity ${duration}ms ease` : undefined,
          opacity: open ? 1 : 0.6
        }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}

/* ===== Catalog helpers ===== */
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
function normalizeSlashes(s: string) {
  return (s || "").replace(/\\/g, "/");
}
function stripProtocolHost(s: string) {
  return s.replace(/^[a-z]+:\/\/[^/]+/i, "");
}
function baseName(path: string) {
  const p = normalizeSlashes(path).split("/").filter(Boolean);
  return p[p.length - 1] || path;
}
function hasFileExt(name: string) {
  return /\.[a-z0-9]{2,}$/i.test(name);
}
function joinPath(a: string, b: string) {
  return normalizeSlashes(`${a}/${b}`).replace(/\/{2,}/g, "/");
}
function toSlug(s?: string) {
  if (!s) return undefined;
  try {
    return encodeURIComponent(s.trim().toLowerCase());
  } catch {
    return undefined;
  }
}

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

    out.push({
      url: String(url),
      name: String(name),
      relPath: rel,
      preview: node?.preview || node?.thumb || undefined
    });
  };

  const walk = (node: any, relBase: string) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, relBase));
      return;
    }

    if (node?.url || node?.src || node?.image) {
      pushFile(node, relBase);
      return;
    }

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
      if (idx >= 0 && idx < parts.length - 1) {
        startIdx = idx + 1;
        break;
      }
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

/* ===== Screen ===== */
export default function GraphicsStep(props: any) {
  const { item, engraving: engravingProp, initial, onBack, onDone } = props;

  const [outro, setOutro] = useState(false);

  // Навигация (sticky + dashed)
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(56);
  useLayoutEffect(() => {
    const measure = () => {
      const h = navRef.current?.getBoundingClientRect().height ?? 0;
      if (h && h !== navH) setNavH(h);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [navH]);

  // Унифицированный скролл с учётом высоты навигации
  const scrollToElWithOffset = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const extra = 14;
    const rect = el.getBoundingClientRect();
    const target = Math.max(0, window.scrollY + rect.top - (navH + extra));
    window.scrollTo({ top: target, behavior: "smooth" });
  }, [navH]);

  const previewSectionRef = useRef<HTMLElement | null>(null);
  const scrollToPreview = useCallback(() => {
    scrollToElWithOffset(previewSectionRef.current);
  }, [scrollToElWithOffset]);

  const scrollToCat = useCallback((id: string) => {
    scrollToElWithOffset(document.getElementById(id));
  }, [scrollToElWithOffset]);

  // Каталог
  const [gLoading, setGLoading] = useState(false);
  const [gError, setGError] = useState("");
  const [gCats, setGCats] = useState<any[]>([]);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    async function loadGraphics() {
      setGLoading(true);
      setGError("");
      try {
        const data = await fetchCatalog("graphics");
        const flat = collectFlatEntries(data, "");
        const cats = flat.length ? buildCatsFromFlat(flat) : [];
        if (!alive) return;

        if (!cats.length) {
          setGCats([]);
          setGError("Каталог графики пуст или структура не распознана.");
          setOpenCats({});
          setOpenSubs({});
        } else {
          setGCats(cats);
          const oc: Record<string, boolean> = {};
          const os: Record<string, boolean> = {};
          for (const c of cats) {
            oc[c._id] = false;
            for (const s of c.children) os[s._id] = false;
          }
          setOpenCats(oc);
          setOpenSubs(os);
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

  // Открыть только указанную категорию и прокрутить к началу ПОСЛЕ анимации
  const COLLAPSE_MS = 300;
  const openOnlyCatAndScroll = useCallback((catId: string) => {
    setOpenCats(() => {
      const next: Record<string, boolean> = {};
      gCats.forEach((c) => (next[c._id] = c._id === catId));
      return next;
    });
    setOpenSubs(() => {
      const next: Record<string, boolean> = {};
      gCats.forEach((c) => c.children.forEach((s: any) => (next[s._id] = false)));
      return next;
    });
    const el = document.getElementById(`cat-${catId}`);
    if (!el) return;
    const tryScroll = (delay: number) => setTimeout(() => scrollToElWithOffset(el), delay);
    tryScroll(COLLAPSE_MS + 20);
    tryScroll(COLLAPSE_MS + 180);
    tryScroll(COLLAPSE_MS + 360);
  }, [gCats, scrollToElWithOffset]);

  // Заголовки аккордеонов
  const toggleCat = useCallback((catId: string) => setOpenCats((s) => ({ ...s, [catId]: !s[catId] })), []);
  const toggleSub = useCallback((subId: string) => setOpenSubs((s) => ({ ...s, [subId]: !s[subId] })), []);

  // Драфт и выбор (дубликаты через instanceId)
  const draft0 = loadOrderDraft();
  const [selectedGraphics, setSelectedGraphics] = useState<any[]>(
    (draft0.graphics || []).map((g: any, i: number) => ({ ...g, instanceId: g.instanceId || `inst-${i}-${Date.now()}` }))
  );

  const countsById = useMemo(() => {
    const map: Record<string, number> = {};
    selectedGraphics.forEach((g) => { map[g.id] = (map[g.id] || 0) + 1; });
    return map;
  }, [selectedGraphics]);

  useEffect(() => {
    const prev = loadOrderDraft();
    const toSave = selectedGraphics.map(({ instanceId, ...rest }) => rest);
    saveOrderDraft({ ...prev, graphics: toSave });
  }, [selectedGraphics]);

  useEffect(() => {
    const syncFromDraft = () => {
      const cur = loadOrderDraft();
      const next = (cur.graphics || []).map((g: any, i: number) => ({ ...g, instanceId: `sync-${i}-${Date.now()}` }));
      setSelectedGraphics(next);
    };
    window.addEventListener(DRAFT_UPDATED_EVENT, syncFromDraft);
    window.addEventListener("storage", syncFromDraft);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, syncFromDraft);
      window.removeEventListener("storage", syncFromDraft);
    };
  }, []);

  const addGraphic = useCallback((g: any) => {
    setSelectedGraphics((prev) =>
      prev.concat([
        {
          id: g.id,
          name: g.name,
          url: g.url,
          preview: g.preview,
          catName: g.catName || "",
          catSlug: g.catSlug || "",
          subCatName: g.subCatName || "",
          subCatSlug: g.subCatSlug || "",
          instanceId: `inst-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }
      ])
    );
  }, []);

  // Добавление с лимитом: не более 4 одинаковых изображений
  const addGraphicWithLimit = useCallback((g: any) => {
    const qty = countsById[g.id] || 0;
    if (qty >= 4) {
      window.alert("Нельзя добавить более 4 одинаковых изображений");
      return;
    }
    addGraphic(g);
  }, [addGraphic, countsById]);

  const removeOneById = useCallback((id: string) => {
    setSelectedGraphics((prev) => {
      const i = prev.findIndex((x) => x.id === id);
      if (i === -1) return prev;
      const copy = prev.slice();
      copy.splice(i, 1);
      return copy;
    });
  }, []);
  const clearGraphics = useCallback(() => setSelectedGraphics([]), []);

  // Навигация по шагам
  const handleBack = () => { setOutro(true); setTimeout(() => onBack && onBack(), 320); };
  const handleContinue = () => {
    setOutro(true);
    setTimeout(() => onDone && onDone({
      graphics: selectedGraphics.map(({ instanceId, ...rest }) => rest),
      graphic: selectedGraphics[0] || null
    }), 320);
  };

  // Люди из драфта для эскиза
  const engravingFromDraft = draft0.engraving;
  const engraving = engravingFromDraft || engravingProp || {};
  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engraving?.persons) && engraving.persons.length > 0) {
      return engraving.persons.map((p: any, idx: number) => {
        const l1 = (p.lastName || "").trim();
        const l2 = [p.firstName, p.middleName].map((s: string) => (s || "").trim()).filter(Boolean).join(" ");
        const l3 = [p.birthDate, p.deathDate].map((s: string) => (s || "").trim()).filter(Boolean).join(" — ");
        const lines = [l1, l2, l3].filter(Boolean);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
    return [];
  }, [engraving]);

  // Эпитафии из драфта — для отображения в эскизе
  const epitaphsForPreview: string[] = useMemo(() => {
    const arr = Array.isArray(engraving?.epitaphs) ? engraving.epitaphs.filter(Boolean) : [];
    if (arr.length) return arr as string[];
    if (typeof engraving?.epitaphText === "string" && engraving.epitaphText.trim()) {
      return engraving.epitaphText.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
    }
    return [];
  }, [engraving]);

  // Группировка выбранной графики для оверлеев
  const selectedCrosses = useMemo(
    () => selectedGraphics.filter((g) => (g.catName || "").toLowerCase().includes("крест") || (g.catSlug || "").toLowerCase().includes("cross")),
    [selectedGraphics]
  );
  const selectedOtherGraphics = useMemo(
    () => selectedGraphics.filter((g) => !((g.catName || "").toLowerCase().includes("крест") || (g.catSlug || "").toLowerCase().includes("cross"))),
    [selectedGraphics]
  );

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", color: "#fff", padding: 12, opacity: outro ? 0 : 1, transition: "opacity 320ms ease" }}>
      <TopBarWithIntro title="Графика" />

      {/* Навигация — стиль EngravingStep */}
      <div
        ref={navRef}
        style={{
          position: "sticky",
          top: "calc(var(--global-stepnav-h, 0px) + 4px + env(safe-area-inset-top, 0px))",
          zIndex: 50,
          paddingTop: "env(safe-area-inset-top)",
          background: "rgba(0,0,0,0.96)",
          borderRadius: 12,
          border: "1px dashed rgba(255, 255, 255)",
          marginBottom: 10
        }}
      >
        <div style={{ display: "flex", gap: 6, padding: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
          {gCats.map((cat) => (
            <button
              key={"nav-" + cat._id}
              title={"Перейти к: " + cat.name}
              onClick={() => openOnlyCatAndScroll(cat._id)}
              style={glassButtonStyle("nano")}
            >
              {cat.name}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={scrollToPreview} style={glassButtonStyle("nano")}>
            Эскиз
          </button>
        </div>
      </div>

      {/* Каталог с управлением количеством и подсветкой выбранных */}
      <section>
        <h2 style={{ margin: "0 0 8px 0", textAlign: "left" }}>Графика</h2>
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          {gLoading && <div>Загрузка каталога…</div>}
          {gError && <div style={{ color: "#ffb4b4" }}>{gError}</div>}
          {!gLoading && !gError && gCats.length === 0 && <div>Нет элементов. Проверьте источники данных.</div>}

          {!gLoading && !gError && gCats.length > 0 && (
            <div style={{ display: "grid", gap: 12 }}>
              {gCats.map((cat) => {
                const opened = !!openCats[cat._id];
                const total = cat.items.length + cat.children.reduce((acc: number, s: any) => acc + s.items.length, 0);
                return (
                  <section key={cat._id} id={"cat-" + cat._id} style={{ scrollMarginTop: navH + 24 + "px" }}>
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
                            <span style={{ display: "inline-block", transition: "transform 240ms ease", transform: opened ? "rotate(90deg)" : "rotate(0deg)" }} aria-hidden>
                              ▶
                            </span>
                            <span style={{ fontSize: 16, fontWeight: 600 }}>{cat.name}</span>
                          </div>
                          <span style={{ opacity: 0.9, fontSize: 12 }}>{total} элементов</span>
                        </button>
                      }
                    >
                      <div style={{ padding: 10, display: "grid", gap: 12 }}>
                        {cat.items.length > 0 && (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: twoColGrid(140, 100),
                              gap: GAP_PX
                            }}
                          >
                            {cat.items.map((g: any) => {
                              const qty = countsById[g.id] || 0;
                              return (
                                <div
                                  key={g.id}
                                  style={{
                                    ...glassPanelStyle(),
                                    borderRadius: 12,
                                    padding: 6,
                                    textAlign: "center",
                                    outline: qty > 0 ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)"
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => addGraphicWithLimit(g)}
                                    title="Добавить в эскиз"
                                    style={{
                                      ...bottomUnderlayGradient(),
                                      borderRadius: 10,
                                      aspectRatio: "1/1",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      padding: 6,
                                      width: "100%",
                                      border: "none",
                                      cursor: "pointer",
                                      background: "transparent"
                                    }}
                                  >
                                    <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }} />
                                  </button>

                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                    <button type="button" aria-label="Удалить один" onClick={() => removeOneById(g.id)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0), padding: "2px 8px", fontSize: 14 }}>
                                      −
                                    </button>
                                    <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                                    <button type="button" aria-label="Добавить один" onClick={() => addGraphicWithLimit(g)} style={{ ...glassButtonStyle("nano"), padding: "2px 8px", fontSize: 14 }}>
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {cat.children.length > 0 &&
                          cat.children.map((sub: any) => {
                            const subOpen = !!openSubs[sub._id];
                            return (
                              <section key={sub._id} id={"sub-" + sub._id} style={{ scrollMarginTop: navH + 24 + "px" }}>
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
                                        <span style={{ display: "inline-block", transition: "transform 220ms ease", transform: subOpen ? "rotate(90deg)" : "rotate(0deg)" }} aria-hidden>
                                          ▶
                                        </span>
                                        <span style={{ fontSize: 14, fontWeight: 600 }}>{sub.name}</span>
                                      </div>
                                      <span style={{ opacity: 0.9, fontSize: 12 }}>{sub.items.length} элементов</span>
                                    </button>
                                  }
                                >
                                  <div style={{ padding: 10 }}>
                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: twoColGrid(140, 100),
                                        gap: GAP_PX
                                      }}
                                    >
                                      {sub.items.map((g: any) => {
                                        const qty = countsById[g.id] || 0;
                                        return (
                                          <div
                                            key={g.id}
                                            style={{
                                              ...glassPanelStyle(),
                                              borderRadius: 12,
                                              padding: 6,
                                              textAlign: "center",
                                              outline: qty > 0 ? "2px solid #8ab4ff" : "1px solid rgba(255,255,255,0.14)"
                                            }}
                                          >
                                            <button
                                              type="button"
                                              onClick={() => addGraphicWithLimit(g)}
                                              title="Добавить в эскиз"
                                              style={{
                                                ...bottomUnderlayGradient(),
                                                borderRadius: 10,
                                                aspectRatio: "1/1",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                padding: 6,
                                                width: "100%",
                                                border: "none",
                                                cursor: "pointer",
                                                background: "transparent"
                                              }}
                                            >
                                              <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", pointerEvents: "none" }} />
                                            </button>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                              <button type="button" aria-label="Удалить один" onClick={() => removeOneById(g.id)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0), padding: "2px 8px", fontSize: 14 }}>
                                                −
                                              </button>
                                              <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                                              <button type="button" aria-label="Добавить один" onClick={() => addGraphicWithLimit(g)} style={{ ...glassButtonStyle("nano"), padding: "2px 8px", fontSize: 14 }}>
                                                +
                                              </button>
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
      </section>

      {/* Блок выбранной графики — НИЖНЯЯ ПАНЕЛЬ */}
      <section style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <strong>Выбрано: {selectedGraphics.length}</strong>
          <button type="button" onClick={clearGraphics} style={glassButtonStyle("nano")}>Очистить всё</button>
        </div>
        {(() => {
          const firstById: Record<string, any> = {};
          selectedGraphics.forEach((g) => { if (!firstById[g.id]) firstById[g.id] = g; });
          const unique = Object.values(firstById);
          if (unique.length === 0) return <div style={{ opacity: 0.8 }}>Не выбрано ни одного элемента</div>;
          return (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: twoColGrid(140, 100),
                gap: GAP_PX
              }}
            >
              {unique.map((g: any) => {
                const qty = countsById[g.id] || 0;
                return (
                  <div key={"chosen-" + g.id} style={{ ...glassPanelStyle(), borderRadius: 12, padding: 8, textAlign: "center", outline: "2px solid #8ab4ff" }}>
                    <div style={{ ...bottomUnderlayGradient(), borderRadius: 10, aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", padding: 6 }}>
                      <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
                      <button type="button" aria-label="Удалить один" onClick={() => removeOneById(g.id)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0), padding: "4px 10px", fontSize: 14 }}>−</button>
                      <span style={{ minWidth: 28, textAlign: "center", fontWeight: 700 }}>{qty}</span>
                      <button type="button" aria-label="Добавить один" onClick={() => addGraphicWithLimit(g)} style={{ ...glassButtonStyle("nano"), padding: "4px 10px", fontSize: 14 }}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      {/* Предпросмотр — общий SketchTemplate с гориз./верт. шаблоном, оверлеями и ЭПИТАФИЯМИ */}
      <div
        style={{
          color: "#fff",
          opacity: 0.9,
          fontSize: 15,
          lineHeight: 1.25,
          margin: "6px 0 8px",
          textAlign: "center",
          fontWeight: 400,
        }}
      >
        Перед вами визуализация заказа, а не готовый макет для гравировки. Итоговый макет выполнит специалист.
      </div>
      <section ref={previewSectionRef} style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0", scrollMarginTop: navH + 24 }}>
        <SketchTemplate
          item={item}
          peopleBlocks={peopleBlocks}
          crosses={selectedCrosses}
          others={selectedOtherGraphics}
          epitaphs={epitaphsForPreview}
          carvingOpacity={0.4}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
      </div>
    </div>
  );
}
