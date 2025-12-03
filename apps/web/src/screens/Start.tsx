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

/* ==== Экран Start (каталог) — без изменений ниже ==== */
export default function Start({ onConfirm }: { onConfirm: (item: CatalogItem, meta?: ConfirmMeta) => void; }) {
  // ... остальной код компонента Start без изменений ...
}
