// src/screens/Start.tsx
// Стартовый экран каталога «Резьба».
// ВАЖНО: Глобальную StepNav больше не рендерим здесь (она рендерится в App.tsx).
// Внутренняя навигация по категориям — липкая (sticky) как раньше.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchCatalog, type CatalogCategory, type CatalogItem } from "../api";
import TopBarWithIntro from "../components/TopBarWithIntro";
import {
  loadIntroState,
  isIntroValid,
  isPhoneValid,
  saveIntro,
  type Intro
} from "../lib/intro";
import { saveOrderDraft } from "../lib/order";

/* ============== Стили и утилиты ============== */

type BtnSize = "nano" | "sm" | "md";
function glassButtonStyle(size: BtnSize = "sm", disabled = false): React.CSSProperties {
  const pad: Record<BtnSize, string> = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" };
  return {
    padding: pad[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    opacity: disabled ? 0.6 : 1,
    transition: "transform 280ms ease, opacity 280ms ease",
    willChange: "transform",
    fontFamily:
      "var(--font-readable, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Helvetica Neue', sans-serif)"
  };
}
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(12px) saturate(140%)",
    WebkitBackdropFilter: "blur(12px) saturate(140%)",
    borderRadius: 12,
    transition: "background 280ms ease, box-shadow 280ms ease",
    boxSizing: "border-box",
    color: "#fff"
  };
}
function bottomUnderlayGradient(): React.CSSProperties {
  return {
    backgroundColor: "#000000",
    backgroundImage:
      "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
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
function errorTextStyle(): React.CSSProperties {
  return { color: "#ffb4b4", fontSize: 12 };
}

// Вензель‑разделитель (локально)
function FiligreeSeparator({
  top = 10,
  bottom = 10,
  widthPct = 60
}: {
  top?: number;
  bottom?: number;
  widthPct?: number;
}) {
  return (
    <div style={{ margin: `${top}px 0 ${bottom}px` }}>
      <svg
        viewBox="0 0 600 80"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", margin: "0 auto", width: `${widthPct}%`, opacity: 0.55 }}
      >
        <path d="M10,40 C60,5 120,5 160,40 C200,75 260,75 300,40 C340,5 400,5 440,40 C480,75 540,75 590,40" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.7" />
        <path d="M20,42 C70,10 130,10 170,42 C210,74 270,74 310,42 C350,10 410,10 450,42 C490,74 550,74 580,42" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.6" />
        <path d="M30,38 C80,15 140,15 180,38 C220,61 280,61 320,38 C360,15 420,15 460,38 C500,61 560,61 570,38" fill="none" stroke="white" strokeWidth="0.6" strokeOpacity="0.5" />
      </svg>
    </div>
  );
}

function getDecodedFileName(item: CatalogItem): string {
  const src = (item as any).relPath || item.url || item.name || "";
  const noQuery = String(src).split(/[?#]/)[0];
  const last = (noQuery.split("/").pop() || noQuery).split("\\").pop() || noQuery;
  let decodedName;
  try {
    decodedName = decodeURIComponent(last.replace(/\+/g, " "));
  } catch {
    decodedName = last;
  }
  // Удаляем расширение файла, если оно есть
  const dotIndex = decodedName.lastIndexOf(".");
  if (dotIndex !== -1) {
    return decodedName.substring(0, dotIndex);
  }
  return decodedName;
}

/* Плавное раскрытие/сворачивание секции */
function useCollapse(open: boolean, duration = 260) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    overflow: "hidden",
    maxHeight: 0,
    opacity: 0,
    transform: "translateY(-6px)"
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.scrollHeight;
    if (open) {
      setStyle({
        overflow: "hidden",
        maxHeight: h,
        opacity: 1,
        transform: "translateY(0)",
        transition: `max-height ${duration}ms ease, opacity ${duration}ms ease, transform ${duration}ms ease`
      });
      const t = setTimeout(() => {
        if (ref.current) {
          setStyle((s) => ({ ...s, maxHeight: ref.current!.scrollHeight }));
        }
      }, duration + 20);
      return () => clearTimeout(t);
    } else {
      setStyle({
        overflow: "hidden",
        maxHeight: 0,
        opacity: 0,
        transform: "translateY(-6px)",
        transition: `max-height ${duration}ms ease, opacity ${duration}ms ease, transform ${duration}ms ease`
      });
    }
  }, [open, duration]);

  return { ref, style };
}

/* ============== Типы мета-данных ============== */
type ConfirmMeta = { intro: Intro; orderNumber: string };

/* ============== Нижний лист — предпросмотр + «знакомство» ============== */

function PreviewBottomSheet({
  item,
  onClose,
  onConfirm
}: {
  item: CatalogItem;
  onClose: () => void;
  onConfirm: (meta: ConfirmMeta) => void;
}) {
  const [visible, setVisible] = useState(false);

  // «Знакомство» показываем только после клика «Подтвердить»
  const initialIntroState = loadIntroState();
  const [showIntro, setShowIntro] = useState<boolean>(false);

  // Поля «знакомства»
  const [customerName, setCustomerName] = useState(initialIntroState.intro?.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(initialIntroState.intro?.customerPhone || "");
  const [customerNotes, setCustomerNotes] = useState(initialIntroState.intro?.customerNotes || "");
  const [orderNumber, setOrderNumber] = useState<string | null>(initialIntroState.orderNumber);

  const [touched, setTouched] = useState<{ name?: boolean; phone?: boolean }>({});

  // Плавное раскрытие секции «знакомства»
  const introColl = useCollapse(showIntro, 260);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Автосохранение промежуточных значений (без фиксации)
  useEffect(() => {
    saveIntro(
      {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerNotes: customerNotes.trim() || undefined
      },
      { lock: false }
    );
  }, [customerName, customerPhone, customerNotes]);

  const isNameValid = customerName.trim().length > 1;
  const isPhoneOk = isPhoneValid(customerPhone);
  const formValid = isNameValid && isPhoneOk;

  const closeWithFade = (cb: () => void) => {
    setVisible(false);
    setTimeout(cb, 220);
  };

  // Подтверждение:
  const handleConfirm = () => {
    const st = loadIntroState();
    if (isIntroValid(st.intro)) {
      const lockedState = st.locked && st.orderNumber ? st : saveIntro(st.intro!, { lock: true });
      return closeWithFade(() => onConfirm({ intro: lockedState.intro!, orderNumber: lockedState.orderNumber! }));
    }
    setShowIntro(true);
  };

  // Сабмит «знакомства»: фиксируем один раз (назначаем номер) и продолжаем
  const submitIntro = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, phone: true });
    if (!formValid) return;

    const lockedState = saveIntro(
      {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerNotes: customerNotes.trim() || undefined
      },
      { lock: true }
    );
    setOrderNumber(lockedState.orderNumber || null);

    if (lockedState.intro && lockedState.orderNumber) {
      return closeWithFade(() => onConfirm({ intro: lockedState.intro!, orderNumber: lockedState.orderNumber! }));
    }
  };

  // Общая вставка под нижние панели (Telegram/Safe Area)
  const bottomInset = "calc(12px + env(safe-area-inset-bottom, 0px) + var(--tg-viewport-inset-bottom, 0px))";

  // Обработчики для нижней панели при открытом «знакомстве»
  const handleIntroBack = () => setShowIntro(false);
  const handleIntroSubmit = () => {
    if (!formValid) return;
    formRef.current?.requestSubmit();
  };

  return createPortal(
    <>
      {/* Подложка */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483600,
          background: "rgba(12, 8, 8, 0.45)",
          opacity: visible ? 1 : 0,
          transition: "opacity 220ms ease",
          pointerEvents: "none"
        }}
      />
      {/* Фиксированный нижний лист */}
      <div
        role="dialog"
        aria-modal="false"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2147483601,
          width: "100%",
          height: "clamp(560px, 98svh, 1000px)",
          padding: 12,
          paddingBottom: bottomInset,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          ...glassPanelStyle(),
          boxShadow: "0 -12px 30px rgba(0,0,0,0.45)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 10,
          opacity: visible ? 1 : 0,
          transition: "opacity 220ms ease",
          boxSizing: "border-box",
          overflow: "hidden"
        }}
      >
        {/* Заголовок (имя файла) */}
        <div
          style={{
            textAlign: "center",
            fontSize: 16,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
          title={getDecodedFileName(item)}
        >
          {getDecodedFileName(item)}
        </div>

        {/* Прокручиваемая середина: картинка + (опционально) «знакомство» */}
        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            display: "grid",
            gap: 10,
            paddingBottom: 8
          }}
        >
          {/* Картинка — всегда видима */}
          <div
            style={{
              ...bottomUnderlayGradient(),
              borderRadius: 12,
              padding: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              maxHeight: showIntro ? "18vh" : "48vh",
              transition: "max-height 260ms ease, padding 260ms ease"
            }}
          >
            <img
              src={item.url}
              alt={item.name}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                borderRadius: 8,
                display: "block",
                margin: 0,
                userSelect: "none",
                pointerEvents: "none"
              }}
              draggable={false}
            />
          </div>

          {/* «Знакомство» — плавное раскрытие */}
          <div ref={introColl.ref} style={{ ...introColl.style, willChange: "max-height, opacity, transform" }}>
            {showIntro && (
              <section
                style={{
                  ...glassPanelStyle(),
                  padding: 12,
                  transform: "translateY(0)",
                  transition: "transform 260ms ease",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.08)"
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0, fontWeight: 500 }}>Давайте познакомимся</h3>
                  {orderNumber && <div style={{ opacity: 0.9, fontSize: 14 }}>№ {orderNumber}</div>}
                </div>
                <p style={{ margin: "6px 0 10px 0", opacity: 0.9 }}>
                  Укажите ваши контакты — мы свяжемся для уточнения деталей заказа.
                </p>

                <form ref={formRef} onSubmit={submitIntro} style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Представьтесь, пожалуйста</span>
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                      placeholder="Иванов Иван Иванович"
                      style={inputStyle()}
                    />
                    {touched.name && customerName.trim().length <= 1 && (
                      <div style={errorTextStyle()}>Пожалуйста, укажите имя и фамилию.</div>
                    )}
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Контактный телефон</span>
                    <input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                      placeholder="+7 (___) ___-__-__"
                      style={inputStyle()}
                      inputMode="tel"
                    />
                    {touched.phone && !isPhoneOk && (
                      <div style={errorTextStyle()}>
                        Введите корректный телефон: 10 цифр или 11 цифр, начинающийся с 7 или 8.
                      </div>
                    )}
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Альтернативный способ связи (необязательно)</span>
                    <textarea
                      value={customerNotes}
                      onChange={(e) => setCustomerNotes(e.target.value)}
                      placeholder="Доп. телефон, email или мессенджер"
                      rows={3}
                      style={{ ...inputStyle(), resize: "vertical" }}
                    />
                  </label>
                </form>
              </section>
            )}
          </div>
        </div>

        {/* Нижние кнопки */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            flexWrap: "wrap",
            paddingBottom: bottomInset
          }}
        >
          {!showIntro ? (
            <>
              <button
                onClick={() => closeWithFade(onClose)}
                style={glassButtonStyle("nano")}
                onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
              >
                Выбрать другую
              </button>
              <button
                onClick={handleConfirm}
                style={glassButtonStyle("nano")}
                title="Подтвердить"
                onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
              >
                Подтвердить
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleIntroBack}
                style={glassButtonStyle("nano")}
                onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
              >
                Назад
              </button>
              <button
                type="button"
                onClick={handleIntroSubmit}
                disabled={!formValid}
                style={glassButtonStyle("nano", !formValid)}
                onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
              >
                Продолжить
              </button>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

/* ============== Экран Start (каталог) ============== */

export default function Start({
  onConfirm
}: {
  onConfirm: (item: CatalogItem, meta?: ConfirmMeta) => void;
}) {
  const [cats, setCats] = useState<CatalogCategory[] | null>(null);
  const [err, setErr] = useState<string>("");
  const [previewItem, setPreviewItem] = useState<CatalogItem | null>(null);
  const [outro, setOutro] = useState(false);

  // Липкая навигация по категориям (внутри шага)
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState<number>(56);

  useEffect(() => {
    fetchCatalog("carvings")
      .then((d) => setCats(d.categories))
      .catch((e) => setErr(String(e)));
  }, []);

  useLayoutEffect(() => {
    const measure = () => setNavH(navRef.current?.getBoundingClientRect().height ?? 0);
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, []);

  const makeCatId = (cat: CatalogCategory, idx: number) => {
    const base = (cat.slug?.trim() || cat.name || `cat-${idx}`).toString();
    return `${encodeURIComponent(base)}__${idx}`;
  };

  const scrollToCat = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = window.scrollY + rect.top - (navH + 12);
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  };

  // Сортировка как в каталоге
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }), []);
  function sortedItems(items: CatalogItem[]) {
    const keyOf = (it: CatalogItem) =>
      (it as any).order ?? (it as any).index ?? (it as any).idx ?? (it as any).position ?? (it as any).sort;
    return items.slice().sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      const na = Number.isFinite(ka) ? Number(ka) : null;
      const nb = Number.isFinite(kb) ? Number(kb) : null;
      if (na !== null && nb !== null) return na - nb;
      const pa = ((a as any).relPath as string) || a.url || a.name || "";
      const pb = ((b as any).relPath as string) || b.url || b.name || "";
      const cmp = collator.compare(pa, pb);
      if (cmp !== 0) return cmp;
      const na1 = a.name || "";
      const nb1 = b.name || "";
      return collator.compare(na1, nb1);
    });
  }

  const confirmAndGo = (it: CatalogItem, meta?: ConfirmMeta) => {
    // Сохраняем выбранный элемент в драфт заказа (для TopBar и следующих шагов)
    saveOrderDraft({
      item: { name: it.name, url: it.url, relPath: (it as any).relPath }
    });

    setPreviewItem(null);
    setOutro(true);
    window.setTimeout(() => onConfirm(it, meta), 220);
  };

  return (
    <div
      style={{
        color: "#fff",
        fontFamily:
          "var(--font-readable, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Helvetica Neue', sans-serif)",
        padding: 12,
        opacity: outro ? 0 : 1,
        transition: "opacity 220ms ease",
        maxWidth: 600,
        margin: "0 auto"
      }}
    >
      {/* TopBar НЕ липкий — прокручивается вместе со страницей */}
      <TopBarWithIntro title="Стела" />

      <div style={{ marginBottom: 6, opacity: 0.9 }}>
        Сначала выберите резную работу — размер вы сможете указать на следующем шаге.
      </div>

      {/* Липкая панель навигации по категориям (sticky как раньше) */}
      {cats && cats.length > 0 && (
        <div
          ref={navRef}
          style={{
            position: "sticky",
            top: "calc(var(--global-stepnav-h, 0px) + 4px + env(safe-area-inset-top, 0px))", // липко относительно скролл-контейнера App
            zIndex: 50,
            paddingTop: "env(safe-area-inset-top)",
            ...glassPanelStyle(),
            borderRadius: 0,
            borderLeft: "none",
            borderRight: "none",
            marginBottom: 10,
            transform: "translateZ(0)" // iOS/Safari fix внутри overflow контейнера
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px", overflow: "hidden" }}>
            {cats.map((cat, idx) => {
              const catId = makeCatId(cat, idx);
              return (
                <button
                  key={`nav-${catId}`}
                  onClick={() => scrollToCat(catId)}
                  style={{
                    ...glassButtonStyle("nano"),
                    padding: "4px 8px",
                    fontSize: 12,
                    lineHeight: 1.15
                  }}
                  title={`Перейти к: ${cat.name}`}
                  onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                  onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                  onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {err && <div style={{ color: "salmon" }}>{err}</div>}
      {!cats && <div>Загрузка...</div>}
      {cats && cats.length === 0 && <div>Пока пусто. Добавьте папки и изображения в data/catalogs/carvings.</div>}

      <div style={{ display: "grid", gap: 14, scrollBehavior: "smooth" }}>
        {cats?.map((cat, idx) => {
          const catId = makeCatId(cat, idx);
          const items = sortedItems(cat.items);
          return (
            <section
              id={catId}
              key={`cat-${catId}`}
              style={{
                paddingTop: 2,
                // Учитываем высоту липкой панели при переходе к секции
                scrollMarginTop: `${navH + 14}px`
              }}
            >
              <FiligreeSeparator top={2} bottom={6} widthPct={60} />
              <h3 style={{ margin: "0 0 6px 0" }}>{cat.name}</h3>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                  gap: 10
                }}
              >
                {items.map((it, i) => (
                  <button
                    key={it.relPath || `${catId}-${i}`}
                    onClick={() => setPreviewItem(it)}
                    title="Открыть предпросмотр"
                    style={{
                      ...glassPanelStyle(),
                      borderRadius: 12,
                      padding: 6,
                      cursor: "pointer",
                      textAlign: "center",
                      transform: "translateZ(0)"
                    }}
                    onPointerEnter={(e) => (e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)")}
                    onPointerLeave={(e) => (e.currentTarget.style.boxShadow = "")}
                    onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.995)")}
                    onPointerUp={(e) => (e.currentTarget.style.transform = "")}
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
                      <img
                        src={it.url}
                        alt={it.name}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          width: "auto",
                          height: "auto",
                          objectFit: "contain",
                          display: "block",
                          borderRadius: 8
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Предпросмотр. «Знакомство» откроется ТОЛЬКО после клика «Подтвердить» */}
      {previewItem && (
        <PreviewBottomSheet
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onConfirm={(meta) => confirmAndGo(previewItem, meta)}
        />
      )}
    </div>
  );
}
