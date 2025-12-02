// src/screens/EpitaphStep.tsx
// Эпитафии + предпросмотр с общим SketchTemplate (как на шагах графики/гравировки).
// - TopBarWithIntro (не липкий) вверху;
// - Чтение данных из драфта (persons, graphics, уже сохранённые эпитафии);
// - Сохранение выбранных эпитафий в драфт (saveOrderDraft) с защитой от зацикливания;
// - Live-обновление предпросмотра при внешних изменениях (подписка на DRAFT_UPDATED_EVENT).
// - Предпросмотр использует общий компонент SketchTemplate (горизонтальный/вертикальный шаблон) + слой эпитафий;
// - Прозрачность резной работы настраивается через carvingOpacity (по умолчанию 0.4).
//
// ВАЖНО (исправлено):
// - Многострочная эпитафия — это ОДНА эпитафия. Мы НЕ делим её по переводам строки ни при инициализации,
//   ни при сохранении. Внутренние проверки на наличие эпитафии выполняются по нормализованному тексту
//   (сведены \r\n к \n, обрезаны пробелы).

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import SketchTemplate from "../components/SketchTemplate";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs";
import {
  loadOrderDraft,
  saveOrderDraft,
  DRAFT_UPDATED_EVENT,
  type OrderDraft
} from "../lib/order";

/* ===== UI helpers ===== */
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm") {
  const pad = { nano: "2px 6px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: pad[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)"
  } as React.CSSProperties;
}
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}

/* ===== Collapsible (c безопасным ResizeObserver) ===== */
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
    const onResize = () => {
      if (open) setH(measure());
    };
    window.addEventListener("resize", onResize);

    const RO = (window as any).ResizeObserver as typeof ResizeObserver | undefined;
    let ro: ResizeObserver | null = null;
    if (RO && ref.current) {
      ro = new RO(onResize);
      ro.observe(ref.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
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

/* ===== Вспомогательные по людям/категориям ===== */
function isCrossCategoryName(nameOrSlug: string) {
  const s = (nameOrSlug || "").toLowerCase();
  return s.includes("крест") || s.includes("cross") || s.includes("crosses");
}
function linesFromPerson(p: any) {
  const l1 = (p.lastName || "").trim();
  const l2 = [p.firstName, p.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
  const l3 = [p.birthDate, p.deathDate].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
  return [l1, l2, l3].filter(Boolean);
}

/* ===== Нормализация эпитафий (для сравнения/уникальности) ===== */
const normEpitaph = (t: string) =>
  (t || "")
    .replace(/\r\n?/g, "\n")       // Windows -> \n
    .replace(/[ \t]+$/gm, "")      // хвостовые пробелы по строкам
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
  for (const t of list) {
    if (!hasByNorm(out, t)) out.push(t);
  }
  return out;
}

/* ===== Компонент ===== */
export default function EpitaphStep(props: any) {
  const { item, engraving, initial, onBack, onDone, onSaveDraft } = props;
  const [outro, setOutro] = useState(false);

  // Драфт + подписки
  const [draft, setDraft] = useState<OrderDraft>(() => loadOrderDraft());
  useEffect(() => {
    const onUpd = () => setDraft(loadOrderDraft());
    window.addEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
    window.addEventListener("storage", onUpd);
    return () => {
      window.removeEventListener(DRAFT_UPDATED_EVENT, onUpd as any);
      window.removeEventListener("storage", onUpd);
    };
  }, []);

  // Липкая панель навигации — как в GraphicsStep (пунктирная рамка)
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(56);
  useLayoutEffect(() => {
    const measure = () => setNavH(navRef.current?.getBoundingClientRect().height || 0);
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);
  const previewSectionId = "epitaph-preview-section";
  const listSectionId = "epitaph-list-section";
  const scrollToById = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + rect.top - (navH + 14)),
      behavior: "smooth"
    });
  };
  const scrollToPreview = () => scrollToById(previewSectionId);

  // Инициализация выбранных эпитафий (НЕ делим многострочные на строки)
  const draftEpitaphsArray: string[] | undefined = Array.isArray(draft.engraving?.epitaphs)
    ? (draft.engraving!.epitaphs as string[])
    : undefined;
  const draftEpitaphText: string | undefined =
    typeof draft.engraving?.epitaphText === "string" && draft.engraving!.epitaphText!.trim()
      ? draft.engraving!.epitaphText!.trim()
      : undefined;

  const initialEpitaphsArray: string[] | undefined = Array.isArray(initial?.epitaphs)
    ? (initial!.epitaphs as string[])
    : undefined;
  const initialEpitaphText: string | undefined =
    typeof initial?.epitaphText === "string" && initial!.epitaphText!.trim()
      ? initial!.epitaphText!.trim()
      : undefined;

  // Приоритет: массив -> одиночный текст -> пусто
  const initialSelected = uniqueByNorm(
    (draftEpitaphsArray && draftEpitaphsArray.length
      ? draftEpitaphsArray
      : draftEpitaphText
      ? [draftEpitaphText]
      : initialEpitaphsArray && initialEpitaphsArray.length
      ? initialEpitaphsArray
      : initialEpitaphText
      ? [initialEpitaphText]
      : []) as string[]
  );

  const [showMore, setShowMore] = useState(false);
  const [customText, setCustomText] = useState("");
  const [selectedEpitaphs, setSelectedEpitaphs] = useState<string[]>(initialSelected);

  // Тогглер с нормализацией: одна и та же (по норме) эпитафия не добавляется дважды
  const toggleEpitaph = (text: string) => {
    const t = normEpitaph(text);
    if (!t) return;
    setSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, t);
      if (idx !== -1) return prev.filter((_, i) => i !== idx);
      return prev.concat([text]); // сохраняем исходную форму (с переносами), но сравниваем по норме
    });
  };

  const addCustom = () => {
    const tRaw = (customText || "").trim();
    const t = normEpitaph(tRaw);
    if (!t) return;
    setSelectedEpitaphs((prev) => (hasByNorm(prev, t) ? prev : prev.concat([tRaw])));
    setCustomText("");
  };

  const removeEpitaph = (text: string) =>
    setSelectedEpitaphs((prev) => {
      const idx = indexOfByNorm(prev, text);
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
    });

  const clearEpitaphs = () => setSelectedEpitaphs([]);

  // Сохранение эпитафий в драфт (+ onSaveDraft) с защитой от зацикливания.
  // Если выбрана 1 — пишем в epitaphText (как одна многострочная строка).
  // Если >1 — пишем массив epitaphs (каждый элемент — целиком, даже если многострочный).
  const prevJsonRef = useRef<string>("");
  useEffect(() => {
    const list = uniqueByNorm(selectedEpitaphs);
    const payloadEngr = {
      ...(loadOrderDraft().engraving || {}),
      epitaphs: list.length > 1 ? list.slice() : undefined,
      epitaphText: list.length === 1 ? list[0] : undefined
    };
    const prevAll = loadOrderDraft();
    const snapshot = JSON.stringify({ engraving: payloadEngr });

    if (snapshot !== prevJsonRef.current) {
      prevJsonRef.current = snapshot;
      saveOrderDraft({ ...prevAll, engraving: payloadEngr });
      onSaveDraft?.({ epitaphs: list, epitaphText: list.length === 1 ? list[0] : list.join("\n\n") });
    }
  }, [selectedEpitaphs, onSaveDraft]);

  // Данные предпросмотра
  const engravingForPreview = useMemo(() => draft.engraving || engraving || {}, [draft, engraving]);

  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engravingForPreview?.persons) && engravingForPreview.persons.length > 0) {
      return engravingForPreview.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo = p.photoPreview || p.photoDataUrl || p.photoUrl || null;
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
    // Legacy
    const out: string[] = [];
    if (engravingForPreview?.fullName) out.push(String(engravingForPreview.fullName));
    const dates: string[] = [];
    if (engravingForPreview?.birthDate) dates.push(String(engravingForPreview.birthDate));
    if (engravingForPreview?.deathDate) dates.push(String(engravingForPreview.deathDate));
    if (dates.length) out.push(dates.join(" — "));
    if (Array.isArray(engravingForPreview?.lines) && engravingForPreview.lines.length)
      out.push(...engravingForPreview.lines.filter(Boolean));
    const photo =
      engravingForPreview?.photoPreview || engravingForPreview?.photoUrl || engravingForPreview?.photo || null;
    return out.length || photo ? [{ id: "legacy-0", lines: out, photo }] : [];
  }, [engravingForPreview]);

  const graphicsFromDraft = Array.isArray(draft.graphics)
    ? draft.graphics
    : Array.isArray(initial?.graphics)
    ? initial!.graphics
    : [];
  const selectedCrosses = useMemo(
    () => graphicsFromDraft.filter((g: any) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)),
    [graphicsFromDraft]
  );
  const selectedOtherGraphics = useMemo(
    () => graphicsFromDraft.filter((g: any) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)),
    [graphicsFromDraft]
  );

  // Переходы
  const handleBack = () => {
    setOutro(true);
    setTimeout(() => onBack && onBack(), 320);
  };
  const handleContinue = () => {
    const list = uniqueByNorm(selectedEpitaphs);
    const data = { epitaphs: list, epitaphText: list.length === 1 ? list[0] : undefined };
    setOutro(true);
    setTimeout(() => onDone && onDone(data), 320);
  };

  return (
    <div
      style={{
        color: "#fff",
        padding: 12,
        opacity: outro ? 0 : 1,
        transition: "opacity 320ms ease",
        maxWidth: 600,
        margin: "0 auto"
      }}
    >
      {/* TopBar — НЕ липкий */}
      <TopBarWithIntro title="Memorial - эпитафия" />

      <div style={{ margin: "0 0 8px 0" }}>
        Сейчас можно выбрать эпитафию. Несколько надписей допустимы, но умеренность поможет сохранить красоту памятника.
      </div>

      {/* Навигация — стиль GraphicsStep */}
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
          <button onClick={() => scrollToById(listSectionId)} style={glassButtonStyle("nano")}>
            К списку
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={scrollToPreview} style={glassButtonStyle("nano")}>
            Эскиз
          </button>
        </div>
      </div>

      {/* Список эпитафий */}
      <section id={listSectionId}>
        <h2 style={{ margin: "0 0 8px 0", textAlign: "left" }}>Эпитафии</h2>
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {QUICK_EPITAPHS.map((t) => {
              const active = hasByNorm(selectedEpitaphs, t);
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

          <div style={{ marginBottom: 8, textAlign: "left" }}>Еще варианты:</div>
          <div style={{ marginBottom: 10 }}>
            <button type="button" onClick={() => setShowMore(!showMore)} style={glassButtonStyle("nano")}>
              {showMore ? "Свернуть список" : "Развернуть список"}
            </button>
            <Collapsible open={showMore} header={null}>
              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 8,
                  padding: 2
                }}
              >
                {MORE_EPITAPHS.map((t, idx) => {
                  const active = hasByNorm(selectedEpitaphs, t);
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
            </Collapsible>
          </div>

          <div style={{ marginTop: 6 }}>
            <div style={{ marginBottom: 6, textAlign: "left" }}>Свой вариант:</div>
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                rows={3}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder='  Введите текст и нажмите «Добавить»'
                style={{
                  width: "100%",
                  padding: "0 0 10px 0",
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
                <button type="button" style={glassButtonStyle("nano")} onClick={addCustom}>
                  Добавить
                </button>
                <button type="button" style={glassButtonStyle("nano")} onClick={clearEpitaphs}>
                  Очистить выбранные
                </button>
                {selectedEpitaphs.length > 0 && <div style={{ alignSelf: "center" }}>Выбрано: {selectedEpitaphs.length}</div>}
              </div>
            </div>
          </div>

          {selectedEpitaphs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 6, textAlign: "left" }}>Выбранные эпитафии:</div>
              <div style={{ display: "grid", gap: 6 }}>
                {selectedEpitaphs.map((t) => (
                  <div
                    key={t}
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
                    <button type="button" style={glassButtonStyle("nano")} onClick={() => removeEpitaph(t)}>
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Предпросмотр — общий SketchTemplate с эпитафиями */}
      <section id={previewSectionId} style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}>
        <SketchTemplate
          item={item}
          peopleBlocks={peopleBlocks}
          crosses={selectedCrosses}
          others={selectedOtherGraphics}
          epitaphs={selectedEpitaphs}
          carvingOpacity={0.4}
        />
      </section>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>
          Назад
        </button>
        <button type="button" onClick={handleContinue} style={glassButtonStyle("sm")}>
          Продолжить
        </button>
      </div>
    </div>
  );
}
