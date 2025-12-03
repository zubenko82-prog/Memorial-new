// src/screens/Start.tsx
// Изменение: увеличили высоту всплывающего окна (bottom sheet) — теперь оно занимает до 96svh.
// Это даёт больше места для «Альтернативного способа связи» на телефонах/в Telegram.

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

/* ... остальные помощники/стили и компонент FiligreeSeparator, getDecodedFileName, useCollapse без изменений ... */

// Типы
type ConfirmMeta = { intro: Intro; orderNumber: string };

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
  const initialIntroState = loadIntroState();
  const [showIntro, setShowIntro] = useState<boolean>(false);

  const [customerName, setCustomerName] = useState(initialIntroState.intro?.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(initialIntroState.intro?.customerPhone || "");
  const [customerNotes, setCustomerNotes] = useState(initialIntroState.intro?.customerNotes || "");
  const [orderNumber, setOrderNumber] = useState<string | null>(initialIntroState.orderNumber);

  const [touched, setTouched] = useState<{ name?: boolean; phone?: boolean }>({});
  const introColl = useCollapse(showIntro, 260);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

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

  const handleConfirm = () => {
    const st = loadIntroState();
    if (isIntroValid(st.intro)) {
      const lockedState = st.locked && st.orderNumber ? st : saveIntro(st.intro!, { lock: true });
      return closeWithFade(() => onConfirm({ intro: lockedState.intro!, orderNumber: lockedState.orderNumber! }));
    }
    setShowIntro(true);
  };

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

  const bottomInset = "calc(12px + env(safe-area-inset-bottom, 0px) + var(--tg-viewport-inset-bottom, 0px))";

  const handleIntroBack = () => setShowIntro(false);
  const handleIntroSubmit = () => {
    if (!formValid) return;
    formRef.current?.requestSubmit();
  };

  return createPortal(
    <>
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
          // БЫЛО: clamp(520px, 90svh, 860px)
          // СТАЛО: чуть выше на мобильных, почти на весь экран — влезает «альтернативный способ связи».
          height: "clamp(560px, 96svh, 1000px)",
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

        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            display: "grid",
            gap: 10,
            paddingBottom: 8
          }}
        >
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
                  {/* Кнопки формы вынесены вниз (фиксированная панель) */}
                </form>
              </section>
            )}
          </div>
        </div>

        {/* Нижняя фиксированная панель */}
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
                onClick={() => setShowIntro(false)}
                style={glassButtonStyle("nano")}
                onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
              >
                Назад
              </button>
              <button
                type="button"
                onClick={() => formRef.current?.requestSubmit()}
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
    saveOrderDraft({ item: { name: it.name, url: it.url, relPath: (it as any).relPath } });
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
      <TopBarWithIntro title="Memorial" />

      <div style={{ marginBottom: 6, opacity: 0.9 }}>
        Сначала выберите резную работу — размер вы сможете указать на следующем шаге.
      </div>

      {/* Липкая панель навигации по категориям */}
      {cats && cats.length > 0 && (
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px", overflow: "hidden" }}>
            {cats.map((cat, idx) => {
              const catId = makeCatId(cat, idx);
              return (
                <button
                  key={`nav-${catId}`}
                  onClick={() => scrollToCat(catId)}
                  style={{ ...glassButtonStyle("nano"), padding: "4px 8px", fontSize: 12, lineHeight: 1.15 }}
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
            <section id={catId} key={`cat-${catId}`} style={{ paddingTop: 2, scrollMarginTop: `${navH + 14}px` }}>
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
