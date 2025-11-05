// src/screens/EpitaphStep.tsx
// БАЗА из вашего сообщения + добавлен TopBarWithIntro со всем функционалом.
// Интеграция:
// - TopBarWithIntro (не липкий) вверху;
// - Чтение данных из драфта (loadOrderDraft): persons, graphics, уже сохранённые эпитафии;
// - Сохранение выбранных эпитафий в драфт (saveOrderDraft) с защитой от зацикливания;
// - Live-обновление предпросмотра при внешних изменениях (подписка на DRAFT_UPDATED_EVENT).
// Важно: предпросмотр НЕ прозрачный — базовое изображение без opacity/filters.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { QUICK_EPITAPHS, MORE_EPITAPHS } from "../data/epitaphs.js";
import TopBarWithIntro from "../components/TopBarWithIntro";
import {
  loadOrderDraft,
  saveOrderDraft,
  DRAFT_UPDATED_EVENT,
  type OrderDraft
} from "../lib/order";

/* ===== UI helpers (как в базе) ===== */
function glassButtonStyle(size = "sm") {
  const pad = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: pad[size] || pad.sm,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)"
  } as React.CSSProperties;
}
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff"
  } as React.CSSProperties;
}
function bottomUnderlayGradient() {
  return {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
  } as React.CSSProperties;
}
function Collapsible({ open, header, children, duration = 280 }: any) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  const [mounted, setMounted] = useState(false);
  const measure = () => ref.current?.scrollHeight || 0;
  useEffect(() => {
    setMounted(true);
    const onResize = () => {
      if (open) setH(measure());
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    if (ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [open]);
  useEffect(() => {
    if (open) {
      const hh = measure();
      setH(hh);
      const t = setTimeout(() => setH(hh), duration + 16);
      return () => clearTimeout(t);
    } else {
      const hh = measure();
      setH(hh);
      const t = setTimeout(() => setH(0), 16);
      return () => clearTimeout(t);
    }
  }, [open, duration]);
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

/* ===== Вспомогательные ===== */
function isCrossCategoryName(nameOrSlug: string) {
  const s = (nameOrSlug || "").toLowerCase();
  return s.includes("крест") || s.includes("cross") || s.includes("crosses");
}
function linesFromPerson(p: any) {
  const l1 = (p.lastName || "").trim();
  const l2 = [p.firstName, p.middleName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  const l3 = [p.birthDate, p.deathDate]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" — ");
  return [l1, l2, l3].filter(Boolean);
}

export default function EpitaphStep(props: any) {
  const { item, engraving, initial, onBack, onDone, onSaveDraft } = props;
  const [outro, setOutro] = useState(false);

  // TopBar интеграция: локальный снимок драфта и подписка на обновления
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

  // Липкая навигация
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(56);
  useLayoutEffect(() => {
    const measure = () =>
      setNavH(navRef.current?.getBoundingClientRect().height || 0);
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
      top: Math.max(0, window.scrollY + rect.top - (navH + 12)),
      behavior: "smooth"
    });
  };

  // Инициализация выбора эпитафий: сперва из драфта, затем из initial
  const draftEpitaphs: string[] =
    (Array.isArray(draft.engraving?.epitaphs) && draft.engraving!.epitaphs!) ||
    (typeof draft.engraving?.epitaphText === "string" &&
    draft.engraving!.epitaphText!.trim()
      ? draft.engraving!.epitaphText!.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : []);
  const initialEpitaphsFromProps: string[] =
    Array.isArray(initial?.epitaphs)
      ? initial!.epitaphs!
      : typeof initial?.epitaphText === "string" && initial!.epitaphText!.trim()
      ? initial!.epitaphText!.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];
  const [showMore, setShowMore] = useState(false);
  const [customText, setCustomText] = useState("");
  const [selectedEpitaphs, setSelectedEpitaphs] = useState<string[]>(
    draftEpitaphs.length ? draftEpitaphs : initialEpitaphsFromProps
  );

  const toggleEpitaph = (text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    setSelectedEpitaphs((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : prev.concat([t])
    );
  };
  const addCustom = () => {
    const t = (customText || "").trim();
    if (!t) return;
    setSelectedEpitaphs((p) => (p.includes(t) ? p : p.concat([t])));
    setCustomText("");
  };
  const removeEpitaph = (t: string) =>
    setSelectedEpitaphs((p) => p.filter((x) => x !== t));
  const clearEpitaphs = () => setSelectedEpitaphs([]);

  // Сохранение в драфт + проброс onSaveDraft (с защитой от зацикливания)
  const prevJsonRef = useRef<string>("");
  useEffect(() => {
    const payloadEngr = {
      ...(loadOrderDraft().engraving || {}),
      // Если строк > 1 — пишем в массив; если одна строка — в epitaphText
      epitaphs:
        selectedEpitaphs.length > 1 ? selectedEpitaphs.slice() : undefined,
      epitaphText:
        selectedEpitaphs.length === 1 ? selectedEpitaphs[0] : undefined
    };
    const snapshot = JSON.stringify({ engraving: payloadEngr });
    if (snapshot !== prevJsonRef.current) {
      prevJsonRef.current = snapshot;
      saveOrderDraft({ engraving: payloadEngr });
      onSaveDraft?.({
        epitaphs: selectedEpitaphs,
        epitaphText: selectedEpitaphs.join("\n")
      });
    }
  }, [selectedEpitaphs, onSaveDraft]);

  // Данные предпросмотра — из драфта (приоритет), иначе из props.engraving
  const engravingForPreview = useMemo(
    () => draft.engraving || engraving || {},
    [draft, engraving]
  );

  const peopleBlocks = useMemo(() => {
    if (
      Array.isArray(engravingForPreview?.persons) &&
      engravingForPreview.persons.length > 0
    ) {
      return engravingForPreview.persons.map((p: any, idx: number) => {
        const lines = linesFromPerson(p);
        const photo =
          p.photoPreview || p.photoDataUrl || p.photoUrl || null; // приоритет preview
        return { id: p.id || `person-${idx}`, lines, photo };
      });
    }
    // Legacy
    const lines =
      Array.isArray(engravingForPreview?.metrics) &&
      engravingForPreview.metrics.length
        ? engravingForPreview.metrics
        : (() => {
            const out: string[] = [];
            if (engravingForPreview?.fullName)
              out.push(String(engravingForPreview.fullName));
            const dates: string[] = [];
            if (engravingForPreview?.birthDate)
              dates.push(String(engravingForPreview.birthDate));
            if (engravingForPreview?.deathDate)
              dates.push(String(engravingForPreview.deathDate));
            if (dates.length) out.push(dates.join(" — "));
            if (
              Array.isArray(engravingForPreview?.lines) &&
              engravingForPreview.lines.length
            )
              out.push(...engravingForPreview.lines.filter(Boolean));
            return out;
          })();
    const photo =
      engravingForPreview?.photoPreview ||
      engravingForPreview?.photoUrl ||
      engravingForPreview?.photo ||
      null;
    return lines.length || photo ? [{ id: "legacy-0", lines, photo }] : [];
  }, [engravingForPreview]);

  // Графика — также из драфта (если есть), иначе из initial
  const graphics = Array.isArray(draft.graphics)
    ? draft.graphics
    : Array.isArray(initial?.graphics)
    ? initial!.graphics
    : [];
  const selectedCrosses = useMemo(
    () =>
      graphics.filter(
        (g: any) =>
          isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)
      ),
    [graphics]
  );
  const selectedOtherGraphics = useMemo(
    () =>
      graphics.filter(
        (g: any) =>
          !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)
      ),
    [graphics]
  );

  // Автовысота предпросмотра
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const crossesRef = useRef<HTMLDivElement | null>(null);
  const onePersonRef = useRef<HTMLDivElement | null>(null);
  const multiPeopleRef = useRef<HTMLDivElement | null>(null);
  const epitaphRef = useRef<HTMLDivElement | null>(null);
  const otherGfxRef = useRef<HTMLDivElement | null>(null);
  const [minSketchHeight, setMinSketchHeight] = useState(520);
  const recomputeMinHeight = useCallback(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const rect = cont.getBoundingClientRect();
    const bottomOf = (el: HTMLElement | null | undefined) =>
      el ? el.getBoundingClientRect().bottom - rect.top : 0;
    const bgH = bgImgRef.current
      ? bgImgRef.current.getBoundingClientRect().height
      : 0;
    const maxBottom = Math.max(
      bgH,
      bottomOf(crossesRef.current),
      bottomOf(onePersonRef.current),
      bottomOf(multiPeopleRef.current),
      bottomOf(epitaphRef.current),
      bottomOf(otherGfxRef.current)
    );
    setMinSketchHeight(Math.max(520, Math.ceil(maxBottom + 16)));
  }, []);
  useEffect(() => {
    const ro = new ResizeObserver(() => recomputeMinHeight());
    if (containerRef.current) ro.observe(containerRef.current);
    const onR = () => recomputeMinHeight();
    window.addEventListener("resize", onR);
    const raf = requestAnimationFrame(recomputeMinHeight);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onR);
      cancelAnimationFrame(raf);
    };
  }, [recomputeMinHeight]);
  useEffect(() => {
    recomputeMinHeight();
  }, [
    peopleBlocks,
    selectedCrosses,
    selectedOtherGraphics,
    selectedEpitaphs,
    recomputeMinHeight
  ]);

  // Переходы
  const handleBack = () => {
    setOutro(true);
    setTimeout(() => onBack && onBack(), 320);
  };
  const handleContinue = () => {
    const data = {
      epitaphs: selectedEpitaphs,
      epitaphText: selectedEpitaphs.join("\n")
    };
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
      <TopBarWithIntro title="Memorial" />

      <div style={{ margin: "0 0 8px 0" }}>
        Сейчас можно выбрать эпитафию. Несколько надписей допустимы, но умеренность
        поможет сохранить красоту памятника.
      </div>

      {/* Навигация шага (липкая) */}
      <div
        ref={navRef}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          paddingTop: "env(safe-area-inset-top)",
          ...glassPanelStyle(),
          borderRadius: 0,
          borderLeft: "none",
          borderRight: "none",
          marginBottom: 10
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "6px 8px",
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <button
            onClick={() => scrollToById(listSectionId)}
            style={{ ...glassButtonStyle("nano"), padding: "4px 8px", fontSize: 12 }}
          >
            К списку эпитафий
          </button>
          <button
            onClick={() => scrollToById(previewSectionId)}
            style={{ ...glassButtonStyle("nano"), padding: "4px 8px", fontSize: 12 }}
          >
            Посмотреть эскиз
          </button>
        </div>
      </div>

      {/* Список эпитафий */}
      <section id={listSectionId}>
        <h2 style={{ margin: "0 0 8px 0", textAlign: "left" }}>Эпитафии</h2>
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ marginBottom: 8, textAlign: "left" }}>Быстрый выбор:</div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10
            }}
          >
            {QUICK_EPITAPHS.map((t) => {
              const active = selectedEpitaphs.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleEpitaph(t)}
                  style={{
                    ...glassButtonStyle("nano"),
                    border: active
                      ? "2px solid #8ab4ff"
                      : "1px solid rgba(255,255,255,0.28)"
                  }}
                  title={t}
                >
                  {t}
                </button>
              );
            })}
          </div>

          <div style={{ marginBottom: 8, textAlign: "left" }}>Еще варианты:</div>
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setShowMore(!showMore)}
              style={glassButtonStyle("nano")}
            >
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
                  const active = selectedEpitaphs.includes(t);
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
                        outline: active
                          ? "2px solid #8ab4ff"
                          : "1px solid rgba(255,255,255,0.14)",
                        fontSize: 13,
                        lineHeight: 1.25,
                        whiteSpace: "pre-wrap"
                      }}
                    >
                      {t}
                      <div style={{ marginTop: 6, fontSize: 12 }}>
                        {active
                          ? "Удалить из выбранных"
                          : "Добавить к выбранным"}
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
                <button
                  type="button"
                  style={glassButtonStyle("nano")}
                  onClick={addCustom}
                >
                  Добавить
                </button>
                <button
                  type="button"
                  style={glassButtonStyle("nano")}
                  onClick={clearEpitaphs}
                >
                  Очистить выбранные
                </button>
                {selectedEpitaphs.length > 0 && (
                  <div style={{ alignSelf: "center" }}>
                    Выбрано: {selectedEpitaphs.length}
                  </div>
                )}
              </div>
            </div>
          </div>

          {selectedEpitaphs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 6, textAlign: "left" }}>
                Выбранные эпитафии:
              </div>
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
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.25 }}>
                      {t}
                    </div>
                    <button
                      type="button"
                      style={glassButtonStyle("nano")}
                      onClick={() => removeEpitaph(t)}
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Предпросмотр (НЕ прозрачный фон изделия) */}
      <section
        id={previewSectionId}
        style={{ ...glassPanelStyle(), padding: 12, margin: "12px 0" }}
      >
        <h4
          style={{
            margin: "0 0 8px 0",
            textAlign: "center",
            fontWeight: "normal",
            fontStyle: "italic"
          }}
        >
          Набросок расположения элементов гравировки. <br />
            Изменить можно позже. <br />
            Финальную раскладку определит специалист.
        </h4>

        <div
          ref={containerRef}
          style={{
            ...bottomUnderlayGradient(),
            borderRadius: 10,
            position: "relative",
            left: "-8px",
            width: "100%",
            minHeight: minSketchHeight,
            transition: "min-height 200ms ease",
            overflow: "hidden",
            userSelect: "none",
            padding: 8
          }}
        >
          <img
            ref={bgImgRef}
            src={item?.url || ""}
            alt={item?.name || "Изделие"}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              objectFit: "contain",
              borderRadius: 8
            }}
            draggable={false}
            onLoad={recomputeMinHeight}
          />

          {selectedCrosses.length > 0 && (
            <div
              ref={crossesRef}
              style={{
                position: "absolute",
                left: "4%",
                top: "4%",
                display: "grid",
                gridAutoFlow: "row",
                rowGap: 6,
                width: "18%"
              }}
            >
              {selectedCrosses.slice(0, 3).map((g: any) => (
                <img
                  key={"cross-" + g.id}
                  src={g.url}
                  alt={g.name}
                  style={{
                    width: "100%",
                    height: "auto",
                    objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))"
                  }}
                  draggable={false}
                  onLoad={recomputeMinHeight}
                />
              ))}
            </div>
          )}

          {peopleBlocks.length === 1 ? (
            <div
              ref={onePersonRef}
              style={{
                position: "absolute",
                left: "50%",
                top: "35%",
                transform: "translate(-50%, -50%)",
                width: "92%",
                maxWidth: 720,
                textAlign: "center",
                color: "#fff",
                textShadow: "0 1px 2px rgba(0,0,0,0.6)"
              }}
            >
              {peopleBlocks[0].photo && (
                <img
                  src={peopleBlocks[0].photo}
                  alt="Фото"
                  style={{
                    maxWidth: "52%",
                    maxHeight: 260,
                    objectFit: "contain",
                    display: "block",
                    margin: "0 auto",
                    transform: "translateY(-8%)"
                  }}
                  draggable={false}
                  onLoad={recomputeMinHeight}
                />
              )}
              <div style={{ transform: "translateY(8%)", marginTop: 10 }}>
                {(() => {
                  const lns = peopleBlocks[0].lines || [];
                  const [l1, l2, l3] = [lns[0], lns[1], lns[2]];
                  return (
                    <div style={{ display: "grid", gap: 6 }}>
                      {l1 && (
                        <div
                          style={{
                            fontSize: "clamp(34px, 4vw, 32px)",
                            fontWeight: 700,
                            lineHeight: 1.15
                          }}
                        >
                          {l1}
                        </div>
                      )}
                      {l2 && (
                        <div
                          style={{
                            fontSize: "clamp(28px, 3.4vw, 26px)",
                            fontWeight: 500,
                            lineHeight: 1.15
                          }}
                        >
                          {l2}
                        </div>
                      )}
                      {l3 && (
                        <div
                          style={{
                            fontSize: "clamp(22px, 3vw, 22px)",
                            fontWeight: 400,
                            lineHeight: 1.15
                          }}
                        >
                          {l3}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : peopleBlocks.length > 1 ? (
            <div
              ref={multiPeopleRef}
              style={{
                position: "absolute",
                left: "50%",
                top: selectedCrosses.length > 0 ? "18%" : "12%",
                transform: "translateX(-50%)",
                width: "92%",
                maxWidth: 920,
                display: "grid",
                gridAutoRows: "minmax(110px, auto)",
                rowGap: 12
              }}
            >
              {peopleBlocks.map((mb: any) => {
                const lns = mb.lines || [];
                const [l1, l2, l3] = [lns[0], lns[1], lns[2]];
                return (
                  <div
                    key={mb.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      alignItems: "center",
                      columnGap: 12
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        minHeight: 120
                      }}
                    >
                      {mb.photo ? (
                        <img
                          src={mb.photo}
                          alt="Фото"
                          style={{
                            maxWidth: "78%",
                            maxHeight: 180,
                            objectFit: "contain",
                            display: "block"
                          }}
                          draggable={false}
                          onLoad={recomputeMinHeight}
                        />
                      ) : (
                        <div style={{ opacity: 0.9, fontSize: 12, color: "#fff" }}>
                          (нет фото)
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        textAlign: "center",
                        color: "#fff",
                        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                        display: "grid",
                        gap: 4,
                        padding: "2px 0"
                      }}
                    >
                      {l1 && (
                        <div
                          style={{
                            fontSize: "clamp(18px, 3.2vw, 26px)",
                            fontWeight: 700,
                            lineHeight: 1.12
                          }}
                        >
                          {l1}
                        </div>
                      )}
                      {l2 && (
                        <div
                          style={{
                            fontSize: "clamp(16px, 2.8vw, 22px)",
                            fontWeight: 500,
                            lineHeight: 1.12
                          }}
                        >
                          {l2}
                        </div>
                      )}
                      {l3 && (
                        <div
                          style={{
                            fontSize: "clamp(14px, 2.4vw, 18px)",
                            fontWeight: 400,
                            lineHeight: 1.12
                          }}
                        >
                          {l3}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {selectedEpitaphs.length > 0 && (
            <div
              ref={epitaphRef}
              style={{
                position: "absolute",
                left: "50%",
                bottom: "22%",
                transform: "translateX(-50%)",
                width: "88%",
                textAlign: "center",
                color: "#fff",
                textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                fontStyle: "italic",
                fontSize: "clamp(18px, 3.4vw, 22px)",
                lineHeight: 1.2,
                display: "grid",
                gap: 8
              }}
            >
              {selectedEpitaphs.slice(0, 8).map((t, idx) => (
                <div key={"ep-" + idx} style={{ whiteSpace: "pre-wrap" }}>
                  {t}
                </div>
              ))}
            </div>
          )}

          {selectedOtherGraphics.length > 0 && (
            <div
              ref={otherGfxRef}
              style={{
                position: "absolute",
                left: "50%",
                bottom: "4%",
                transform: "translateX(-50%)",
                width: "88%",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap"
              }}
            >
              {selectedOtherGraphics.slice(0, 6).map((g: any) => (
                <img
                  key={"other-" + g.id}
                  src={g.url}
                  alt={g.name}
                  style={{
                    maxWidth: "50%",
                    height: "auto",
                    objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
                    flex: "0 0 auto"
                  }}
                  draggable={false}
                  onLoad={recomputeMinHeight}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Кнопки */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 10,
          margin: "12px 0",
          flexWrap: "wrap"
        }}
      >
        <button type="button" onClick={handleBack} style={glassButtonStyle("sm")}>
          Назад
        </button>
        <button
          type="button"
          onClick={handleContinue}
          style={glassButtonStyle("sm")}
        >
          Продолжить
        </button>
      </div>
    </div>
  );
}
