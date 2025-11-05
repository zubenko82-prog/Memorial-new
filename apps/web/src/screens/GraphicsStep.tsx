// src/screens/GraphicsStep.tsx
// Поддержка подпапок ЛЮБОЙ глубины из путей relPath/path/url.
// Навигация и горизонтальный/вертикальный шаблон эскиза — как в EngravingStep.
//
// Что делает экран:
// - Каталог с аккордеонами (категории и подкатегории), выбор графики с подсветкой и управляющими +/-.
// - Предпросмотр эскиза: на изображение изделия накладываем людей (портрет+метрика) и выбранные оверлеи.
// - Горизонтальный шаблон: делим на N равных долей, метрика растрированная.
// - Вертикальный шаблон: табличная раскладка (>1 человек) — слева портрет (теперь меньше), справа «живая» метрика; при 1 человеке — центрированный портрет и текст.
// - Кресты в вертикали: крупнее; 1 — верхний левый угол; 2 — по верхним углам; >2 — дополнительные в колонке слева ниже.
// - Прочую графику в вертикали делаем крупнее.
// - Кнопка «Эскиз» и скролл к категории/подкатегории учитывают высоту навигации и анимации раскрытия.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchCatalog } from "../api";
import TopBarWithIntro from "../components/TopBarWithIntro";
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

/* ===== Растровая метрика (горизонтальный шаблон) ===== */
function rasterizeMetric(lines: string[], targetWidth: number) {
  const DPR = Math.min(2, (window.devicePixelRatio || 1.5));
  const W = Math.max(220, Math.round(targetWidth * DPR));
  const base1 = Math.round(W * 0.09);
  const base2 = Math.round(W * 0.08);
  const base3 = Math.round(W * 0.07);
  const pad = Math.round(W * 0.06);
  const lh = (px: number) => Math.round(px * 1.1);
  const H =
    pad +
    lh(base1) +
    Math.round(W * 0.02) +
    lh(base2) +
    Math.round(W * 0.02) +
    lh(base3) +
    pad;

  const cvs = document.createElement("canvas");
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext("2d");
  if (!ctx) return { url: "", w: 0, h: 0 };

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const cx = Math.round(W / 2);

  const [l1, l2, l3] = [
    (lines[0] || "").toUpperCase(),
    (lines[1] || "").toUpperCase(),
    (lines[2] || "").toUpperCase()
  ];

  let y = pad;
  if (l1) { ctx.font = `700 ${base1}px "Century Schoolbook","Times New Roman",serif`; ctx.fillText(l1, cx, y); y += lh(base1) + Math.round(W * 0.02); }
  if (l2) { ctx.font = `700 ${base2}px "Century Schoolbook","Times New Roman",serif`; ctx.fillText(l2, cx, y); y += lh(base2) + Math.round(W * 0.02); }
  if (l3) { ctx.font = `700 ${base3}px "Century Schoolbook","Times New Roman",serif`; ctx.fillText(l3, cx, y); }

  const url = cvs.toDataURL("image/png");
  return { url, w: W, h: H };
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
  const handleBack = () => { setOutro(true); setTimeout(() => props.onBack && props.onBack(), 320); };
  const handleContinue = () => {
    setOutro(true);
    setTimeout(() => props.onDone && props.onDone({
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
        const l2 = [p.firstName, p.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
        const l3 = [p.birthDate, p.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
        const lines = [l1, l2, l3].filter(Boolean);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
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
      <TopBarWithIntro title="Memorial" />

      {/* Навигация — стиль EngravingStep */}
      <div
        ref={navRef}
        style={{
          position: "sticky",
          top: 2,
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
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
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
                                  <div
                                    style={{
                                      ...bottomUnderlayGradient(),
                                      borderRadius: 10,
                                      aspectRatio: "1/1",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      padding: 6
                                    }}
                                  >
                                    <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                    <button type="button" aria-label="Удалить один" onClick={() => removeOneById(g.id)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0), padding: "2px 8px", fontSize: 14 }}>
                                      −
                                    </button>
                                    <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                                    <button type="button" aria-label="Добавить один" onClick={() => addGraphic(g)} style={{ ...glassButtonStyle("nano"), padding: "2px 8px", fontSize: 14 }}>
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
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
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
                                            <div
                                              style={{
                                                ...bottomUnderlayGradient(),
                                                borderRadius: 10,
                                                aspectRatio: "1/1",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                padding: 6
                                              }}
                                            >
                                              <img src={g.preview || g.url} alt={g.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                                              <button type="button" aria-label="Удалить один" onClick={() => removeOneById(g.id)} disabled={qty === 0} style={{ ...glassButtonStyle("nano", qty === 0), padding: "2px 8px", fontSize: 14 }}>
                                                −
                                              </button>
                                              <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                                              <button type="button" aria-label="Добавить один" onClick={() => addGraphic(g)} style={{ ...glassButtonStyle("nano"), padding: "2px 8px", fontSize: 14 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
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
                      <button type="button" aria-label="Добавить один" onClick={() => addGraphic(g)} style={{ ...glassButtonStyle("nano"), padding: "4px 10px", fontSize: 14 }}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      {/* Предпросмотр — горизонтальный/вертикальный шаблон + ОВЕРЛЕИ */}
      <PreviewWithOverlays
        sectionRef={previewSectionRef}
        item={item}
        peopleBlocks={peopleBlocks}
        crosses={selectedCrosses}
        others={selectedOtherGraphics}
        navH={navH}
      />

      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>Назад</button>
        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>Продолжить</button>
      </div>
    </div>
  );
}

/* ===== Предпросмотр с ориентацией ===== */
function PreviewWithOverlays({ sectionRef, item, peopleBlocks, crosses, others, navH }: any) {
  return (
    <section ref={sectionRef} style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0", scrollMarginTop: navH + 24 }}>
      <h4 style={{ margin: "0 0 8px 0", textAlign: "center", fontWeight: "normal", fontStyle: "italic" }}>
        Набросок расположения элементов гравировки. <br />
        Изменить можно позже. Финальную раскладку определит специалист.
      </h4>
      <SketchWithOrientation item={item} peopleBlocks={peopleBlocks} crosses={crosses} others={others} />
    </section>
  );
}

/* ===== Эскиз с ориентацией: горизонтальный / вертикальный ===== */
function SketchWithOrientation({ item, peopleBlocks, crosses = [], others = [] }: any) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const columnsLayerRef = useRef<HTMLDivElement | null>(null);
  const verticalLayerRef = useRef<HTMLDivElement | null>(null);

  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const isVertical = imgNatural.h > imgNatural.w;

  const [sketchH, setSketchH] = useState(540);
  const recalcSketchHeight = useCallback(() => {
    const cont = containerRef.current;
    if (!cont || !imgNatural.w || !imgNatural.h) return;
    const pad = 16;
    const cw = cont.clientWidth;
    const contentW = Math.max(0, cw - pad);
    const imgHeight = contentW > 0 ? (contentW * imgNatural.h) / imgNatural.w : 0;
    setSketchH(Math.max(200, Math.round(imgHeight + pad)));
  }, [imgNatural]);

  useEffect(() => {
    const onResize = () => recalcSketchHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recalcSketchHeight]);

  // Горизонтальный — колонки + растр-метрика
  const [colWpx, setColWpx] = useState(200);
  const [colHpx, setColHpx] = useState(200);
  const GAP = 12;
  const recomputeCols = useCallback(() => {
    const el = columnsLayerRef.current;
    if (!el) return;
    const totalW = el.clientWidth;
    const totalH = el.clientHeight;
    const n = peopleBlocks.length || 1;
    const usedCols = n;
    const totalGaps = (usedCols - 1) * GAP;
    const cw = Math.floor((totalW - totalGaps) / usedCols);
    setColWpx(Math.max(120, cw));
    setColHpx(Math.max(120, totalH));
  }, [peopleBlocks.length]);

  // Вертикальный — строки
  const [rowHpx, setRowHpx] = useState(120);
  const recomputeVerticalRows = useCallback(() => {
    const el = verticalLayerRef.current;
    if (!el) return;
    const innerH = el.clientHeight;
    const n = Math.max(1, peopleBlocks.length);
    const rowH = Math.max(100, Math.floor(innerH / n));
    setRowHpx(rowH);
  }, [peopleBlocks.length]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (isVertical) recomputeVerticalRows();
      else recomputeCols();
      recalcSketchHeight();
    });
    if (columnsLayerRef.current) ro.observe(columnsLayerRef.current);
    if (verticalLayerRef.current) ro.observe(verticalLayerRef.current);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isVertical, recomputeCols, recomputeVerticalRows, recalcSketchHeight]);

  useEffect(() => {
    const t = setTimeout(() => {
      recalcSketchHeight();
      if (isVertical) recomputeVerticalRows();
      else recomputeCols();
    }, 0);
    return () => clearTimeout(t);
  }, [isVertical, recomputeCols, recomputeVerticalRows, recalcSketchHeight, peopleBlocks.length]);

  const [metricImgs, setMetricImgs] = useState<Record<string, any>>({});
  useEffect(() => {
    if (isVertical) {
      setMetricImgs({});
      return;
    }
    const target = Math.round(colWpx * 0.9);
    const next: Record<string, any> = {};
    peopleBlocks.forEach((p: any) => {
      next[p.id] = rasterizeMetric(p.lines, Math.max(140, target));
    });
    setMetricImgs(next);
  }, [peopleBlocks, colWpx, isVertical]);

  const computedScale = useMemo(() => {
    if (isVertical) return {};
    const portraitBaseW = colWpx * 0.8;
    const portraitBaseH = portraitBaseW * (4 / 3);
    const gap = 6;
    const scales: Record<string, number> = {};
    peopleBlocks.forEach((p: any) => {
      const mi = metricImgs[p.id];
      const metricBaseW = colWpx * 0.9;
      const metricH = mi?.h && mi?.w ? (mi.h * (metricBaseW / mi.w)) : portraitBaseW * 0.4;
      const total = portraitBaseH + gap + metricH;
      const avail = colHpx - 8;
      const s = total > 0 ? Math.min(1, avail / total) : 1;
      scales[p.id] = Math.max(0.35, s);
    });
    return scales;
  }, [colWpx, colHpx, metricImgs, peopleBlocks, isVertical]);

  const gridTemplateColumns = useMemo(() => {
    const n = peopleBlocks.length || 1;
    return `repeat(${n}, ${colWpx}px)`;
  }, [peopleBlocks.length, colWpx]);

  const placementStyleFor = () => ({ justifySelf: "center" });

  // Параметры оверлеев в зависимости от ориентации
  const crossWidthPerc = isVertical ? "14%" : "8%";     // кресты крупнее в вертикали
  const crossTopPerc = isVertical ? "4%" : "6%";
  const crossSidePerc = "4%";
  const othersWidthPerc = isVertical ? "36%" : "30%";   // прочая графика больше в вертикали

  return (
    <div
      ref={containerRef}
      style={{
        ...bottomUnderlayGradient(),
        borderRadius: 10,
        position: "relative",
        width: "100%",
        height: sketchH,
        overflow: "hidden",
        userSelect: "none",
        padding: 8,
        boxSizing: "border-box",
        color: "#fff"
      }}
    >
      <img
        ref={imgRef}
        src={item?.url || ""}
        alt={item?.name || "Изделие"}
        style={{ display: "block", width: "100%", height: "auto", objectFit: "contain", borderRadius: 8 }}
        draggable={false}
        onLoad={(e) => {
          const im = e.currentTarget;
          setImgNatural({ w: im.naturalWidth || 0, h: im.naturalHeight || 0 });
          setTimeout(() => {
            recalcSketchHeight();
            if (isVertical) recomputeVerticalRows();
            else recomputeCols();
          }, 0);
        }}
      />

      {/* Горизонтальный шаблон */}
      {!isVertical && peopleBlocks.length > 0 && (
        <div
          ref={columnsLayerRef}
          style={{
            position: "absolute",
            inset: 8,
            display: "grid",
            gridTemplateColumns,
            justifyContent: "center",
            alignItems: "center",
            gap: GAP,
            height: `calc(100% - 16px)`,
            pointerEvents: "none"
          }}
        >
          {peopleBlocks.map((mb: any, idx: number) => {
            const scale = (computedScale as any)[mb.id] ?? 1;
            const pW = Math.round(colWpx * 0.8 * scale);
            const metric = metricImgs[mb.id];
            const mW = Math.round(colWpx * 0.9 * scale);
            const mH = metric?.w && metric?.h ? Math.round(metric.h * (mW / metric.w)) : undefined;
            return (
              <div
                key={`${mb.id}-${idx}`}
                style={{
                  ...placementStyleFor(),
                  width: colWpx,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8
                }}
              >
                <div style={{ width: pW, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.35)", background: "rgba(255,255,255,0.04)" }}>
                  {mb.photo ? (
                    <img src={mb.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                  )}
                </div>
                <div style={{ width: mW, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {metric?.url ? (
                    <img src={metric.url} alt="Метрика" style={{ width: mW, height: mH, objectFit: "contain", display: "block" }} draggable={false} />
                  ) : (
                    <div style={{ width: mW, aspectRatio: "5/1", display: "grid", placeItems: "center", opacity: 0.6 }}>...</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Вертикальный шаблон */}
      {isVertical && peopleBlocks.length > 0 && (
        <>
          {peopleBlocks.length === 1 ? (
            <div
              style={{
                position: "absolute",
                inset: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none"
              }}
            >
              <div style={{ position: "relative", top: "-6%", width: "80%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                {/* Портрет меньше: 60% вместо 70% */}
                <div style={{ width: "60%", maxWidth: 400, aspectRatio: "3 / 4", borderRadius: 4, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.35)", background: "rgba(255,255,255,0.04)" }}>
                  {peopleBlocks[0].photo ? (
                    <img src={peopleBlocks[0].photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                  )}
                </div>
                <div style={{ width: "100%", display: "grid", gap: 6, textAlign: "center", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                  {peopleBlocks[0].lines[0] && <div style={{ fontSize: "clamp(20px, 4vw, 32px)", fontWeight: 700, lineHeight: 1.15 }}>{peopleBlocks[0].lines[0]}</div>}
                  {peopleBlocks[0].lines[1] && <div style={{ fontSize: "clamp(18px, 3.4vw, 26px)", fontWeight: 500, lineHeight: 1.15 }}>{peopleBlocks[0].lines[1]}</div>}
                  {peopleBlocks[0].lines[2] && <div style={{ fontSize: "clamp(16px, 3vw, 22px)", fontWeight: 400, opacity: 0.95, lineHeight: 1.15 }}>{peopleBlocks[0].lines[2]}</div>}
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={verticalLayerRef}
              style={{
                position: "absolute",
                inset: 16,
                display: "grid",
                gridTemplateRows: `repeat(${peopleBlocks.length}, ${rowHpx}px)`,
                rowGap: 10,
                height: `calc(85% - 32px)`,
                alignContent: "center",
                pointerEvents: "none"
              }}
            >
              {peopleBlocks.map((mb: any, i: number) => (
                <div
                  key={`${mb.id}-${i}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    columnGap: 12,
                    padding: "6px 8px",
                    boxSizing: "border-box",
                    alignItems: "center"
                  }}
                >
                  {/* Портрет меньше: 55% вместо 70% высоты строки */}
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div
                      style={{
                        height: "55%",
                        aspectRatio: "3 / 4",
                        borderRadius: 4,
                        overflow: "hidden",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
                        background: "rgba(255,255,255,0.04)"
                      }}
                    >
                      {mb.photo ? (
                        <img src={mb.photo} alt="Фото" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} draggable={false} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.7 }}>(нет фото)</div>
                      )}
                    </div>
                  </div>

                  {/* Правая ячейка — текст метрики (90% ширины ячейки) */}
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div
                      style={{
                        width: "90%",
                        maxWidth: "90%",
                        textAlign: "center",
                        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                        display: "grid",
                        gap: 6
                      }}
                    >
                      {mb.lines[0] && <div style={{ fontSize: "clamp(18px, 3.2vw, 26px)", fontWeight: 700, lineHeight: 1.12 }}>{mb.lines[0]}</div>}
                      {mb.lines[1] && <div style={{ fontSize: "clamp(16px, 2.8vw, 22px)", fontWeight: 500, lineHeight: 1.12 }}>{mb.lines[1]}</div>}
                      {mb.lines[2] && <div style={{ fontSize: "clamp(14px, 2.4vw, 18px)", fontWeight: 400, opacity: 0.95, lineHeight: 1.12 }}>{mb.lines[2]}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Оверлеи: кресты и прочая графика */}
      {(() => {
        const nPeople = peopleBlocks.length;
        const nCross = crosses.length;

        // Кресты: вертикальная ориентация — крупнее и по углам
        if (isVertical) {
          if (nCross === 1) {
            const g = crosses[0];
            return (
              <img
                key={"v-cross-tl"}
                src={g.url}
                alt={g.name || "Крест"}
                style={{
                  position: "absolute",
                  left: "4%",
                  top: "4%",
                  width: "14%",
                  height: "auto",
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                  zIndex: 3
                }}
                draggable={false}
              />
            );
          }
          if (nCross >= 2) {
            const gL = crosses[0];
            const gR = crosses[1];
            return (
              <>
                <img
                  key={"v-cross-left"}
                  src={gL.url}
                  alt={gL.name || "Крест"}
                  style={{
                    position: "absolute",
                    left: "4%",
                    top: "4%",
                    width: "14%",
                    height: "auto",
                    objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                    zIndex: 3
                  }}
                  draggable={false}
                />
                <img
                  key={"v-cross-right"}
                  src={gR.url}
                  alt={gR.name || "Крест"}
                  style={{
                    position: "absolute",
                    right: "4%",
                    top: "4%",
                    width: "14%",
                    height: "auto",
                    objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                    zIndex: 3
                  }}
                  draggable={false}
                />
                {nCross > 2 && (
                  <div
                    style={{
                      position: "absolute",
                      left: "4%",
                      top: "calc(4% + 1.3 * 14%)",
                      display: "grid",
                      gridAutoFlow: "row",
                      rowGap: 6,
                      width: "14%",
                      zIndex: 3
                    }}
                  >
                    {crosses.slice(2).map((g, i) => (
                      <img
                        key={"v-cross-extra-" + i}
                        src={g.url}
                        alt={g.name || "Крест"}
                        style={{ width: "100%", height: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                        draggable={false}
                      />
                    ))}
                  </div>
                )}
              </>
            );
          }
          return null;
        }

        // Горизонтальная логика — прежняя (8% по шаблону)
        const imgWidth = "8%";
        if (nCross === 1 && nPeople === 2) {
          const g = crosses[0];
          return (
            <img
              key={"cross-center"}
              src={g.url}
              alt={g.name || "Крест"}
              style={{
                position: "absolute",
                left: "50%",
                top: "6%",
                transform: "translateX(-50%)",
                width: imgWidth,
                height: "auto",
                objectFit: "contain",
                filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                zIndex: 3
              }}
              draggable={false}
            />
          );
        }
        if (nCross >= 2) {
          const gL = crosses[0];
          const gR = crosses[1];
          return (
            <>
              <img
                key={"cross-left"}
                src={gL.url}
                alt={gL.name || "Крест"}
                style={{
                  position: "absolute",
                  left: "4%",
                  top: "6%",
                  width: imgWidth,
                  height: "auto",
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                  zIndex: 3
                }}
                draggable={false}
              />
              <img
                key={"cross-right"}
                src={gR.url}
                alt={gR.name || "Крест"}
                style={{
                  position: "absolute",
                  right: "4%",
                  top: "6%",
                  width: imgWidth,
                  height: "auto",
                  objectFit: "contain",
                  filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                  zIndex: 3
                }}
                draggable={false}
              />
            </>
          );
        }
        if (nCross > 0) {
          return (
            <div
              style={{
                position: "absolute",
                left: "4%",
                top: "6%",
                display: "grid",
                gridAutoFlow: "row",
                rowGap: 6,
                width: imgWidth,
                zIndex: 3
              }}
            >
              {crosses.map((g, i) => (
                <img
                  key={"cross-" + i}
                  src={g.url}
                  alt={g.name || "Крест"}
                  style={{ width: "100%", height: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                  draggable={false}
                />
              ))}
            </div>
          );
        }
        return null;
      })()}

      {/* Прочая графика — шире в вертикальной ориентации */}
      {others.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "6%",
            transform: "translateX(-50%)",
            width: "80%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            zIndex: 3
          }}
        >
          {others.map((g: any, i: number) => (
            <img
              key={"other-" + i}
              src={g.url}
              alt={g.name || "Графика"}
              style={{ width: isVertical ? "36%" : "30%", height: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))", flex: "0 0 auto" }}
              draggable={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
