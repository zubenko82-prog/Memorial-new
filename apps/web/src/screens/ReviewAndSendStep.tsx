// src/screens/ReviewAndSendStep.tsx
// Обзор и подтверждение (без TopBar заголовка, редактирование — прямо над эскизами).
// Изменения:
// - Слово «эскиз» убрано (и из заголовков, и из alt).
// - Топбар не показываем; вместо этого отображаем его содержимое всегда раскрытым над эскизами
//   (хак: программно раскрываем TopBarWithIntro и скрываем его «шапку»-кнопку).
// - Фон тыльной стороны исправлен: под мини‑превью рисуем такой же подложенный фон (градиент + изделие),
//   при этом изделие для тыльной стороны зеркалится по X, как в редакторе.
// - Сохранили возможность редактировать (через раскрытую панель TopBarWithIntro).

import React, { useEffect, useMemo, useRef, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft } from "../lib/order";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";

/* ===== UI ===== */
function glassPanelStyle() {
  return {
    background: "rgba(20,20,24,0.95)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    color: "#fff",
    boxSizing: "border-box"
  } as React.CSSProperties;
}
function glassButtonStyle(size: "nano" | "sm" | "md" = "sm", disabled = false) {
  const map = { nano: "6px 10px", sm: "10px 14px", md: "12px 18px" } as const;
  return {
    padding: map[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    opacity: disabled ? 0.6 : 1,
    transition: "opacity 220ms ease"
  } as React.CSSProperties;
}

/* ===== Подложка под превью (градиент + изделие) ===== */
function Underlay({
  itemUrl,
  mirror = false
}: {
  itemUrl?: string;
  mirror?: boolean;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 8,
        overflow: "hidden",
        background:
          "linear-gradient(to bottom, #6e6e6e 0%, #464545 20%, #424242 40%, #888 70%, #ffffff 100%)"
      }}
    >
      {!!itemUrl && (
        <img
          src={itemUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 8,
            width: "calc(100% - 16px)",
            height: "calc(100% - 16px)",
            objectFit: "contain",
            opacity: 0.35,
            transform: mirror ? "scaleX(-1)" : "none",
            filter: "saturate(100%)"
          }}
          draggable={false}
        />
      )}
    </div>
  );
}

/* ===== Карточка превью стороны ===== */
function SidePreview({
  title,
  miniUrl,
  itemUrl,
  mirror = false
}: {
  title: string;
  miniUrl?: string;
  itemUrl?: string;
  mirror?: boolean;
}) {
  return (
    <div style={{ ...glassPanelStyle(), padding: 8 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
        {/* Подложка с фоном/изделием (для тыльной — зеркалим) */}
        <Underlay itemUrl={itemUrl} mirror={mirror} />
        {miniUrl ? (
          <img
            src={miniUrl}
            alt=""
            style={{
              position: "relative",
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 8
            }}
          />
        ) : (
          <div
            style={{
              position: "relative",
              minHeight: 200,
              display: "grid",
              placeItems: "center",
              opacity: 0.8
            }}
          >
            Превью отсутствует
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== Инлайновое отображение TopBarWithIntro (содержимое, без «шапки») ===== */
/* Хак: рендерим TopBarWithIntro, программно раскрываем и скрываем его заголовок-кнопку. */
function InlineOrderPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // Найти кнопку‑шапку и кликнуть один раз, чтобы раскрыть панель
    const headerBtn = root.querySelector("button[aria-controls]") as HTMLButtonElement | null;
    if (headerBtn && headerBtn.getAttribute("aria-expanded") !== "true") {
      headerBtn.click();
    }

    // Скрыть шапку визуально (оставить только содержимое)
    if (headerBtn) {
      (headerBtn as HTMLElement).style.display = "none";
    }

    // Чуть сжать внешние отступы панели
    const panel = root.querySelector("[id]") as HTMLElement | null;
    if (panel) {
      panel.style.marginTop = "0px";
    }
  }, []);

  return (
    <div ref={containerRef}>
      <TopBarWithIntro title="Memorial" />
    </div>
  );
}

/* ===== Компонент шага ===== */
type Props = {
  onBack?: () => void;
  onSend?: (payload?: any) => void;
};

export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const draft = useMemo(() => loadOrderDraft(), []);
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  // Превью сторон (мини‑версии)
  const frontMini = (draft as any)?.editor?.previewUrl as string | undefined;
  const backMini = (draft as any)?.editorBack?.previewUrl as string | undefined;

  // Дополнительно (по умолчанию Тумба включена)
  const initialExtras = (draft as any)?.extras || {};
  const [extraBase, setExtraBase] = useState<boolean>(initialExtras.base ?? true);
  const [extraPlate, setExtraPlate] = useState<boolean>(initialExtras.headstonePlate ?? false);
  const [extraFlowerbed, setExtraFlowerbed] = useState<boolean>(initialExtras.flowerbed ?? false);
  const [extraOpen, setExtraOpen] = useState<boolean>(true);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    const prev = loadOrderDraft();
    const extras = { base: extraBase, headstonePlate: extraPlate, flowerbed: extraFlowerbed };
    saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
  }, [extraBase, extraPlate, extraFlowerbed]);

  const handleSend = async () => {
    setBusy(true);
    setErr("");
    const extras: Extras = { base: extraBase, headstonePlate: extraPlate, flowerbed: extraFlowerbed };
    try {
      await sendOrderEmailAndNotifyTg(extras);
      onSend?.({ extras });
    } catch (e: any) {
      setErr(e?.message || "Ошибка отправки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ color: "#fff", padding: 12, maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
      {/* Блок редактирования заказа (контакты/размеры/люди/элементы) — без «шапки» */}
      <section style={{ ...glassPanelStyle(), padding: 10 }}>
        <InlineOrderPanel />
      </section>

      {/* Подсказка */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div style={{ lineHeight: 1.4 }}>
          Проверьте данные заказа и превью сторон. При необходимости отредактируйте данные выше.
          Когда всё верно — нажмите «Отправить заказ».
        </div>
      </section>

      {/* Две стороны: Лицевая / Тыльная (без слова «эскиз»), с подложкой и зеркалом для тыльной */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12
          }}
        >
          <SidePreview title="Лицевая" miniUrl={frontMini} itemUrl={itemUrl} />
          <SidePreview title="Тыльная" miniUrl={backMini} itemUrl={itemUrl} mirror />
        </div>
      </section>

      {/* Дополнительно */}
      <section>
        <div style={{ ...glassPanelStyle(), padding: 0 }}>
          <button
            type="button"
            onClick={() => setExtraOpen((v) => !v)}
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
              justifyContent: "space-between"
            }}
          >
            <strong>Дополнительно</strong>
            <span aria-hidden>{extraOpen ? "▾" : "▸"}</span>
          </button>

          {extraOpen && (
            <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={extraBase} onChange={(e) => setExtraBase(e.target.checked)} />
                  <span>Тумба</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={extraPlate} onChange={(e) => setExtraPlate(e.target.checked)} />
                  <span>Надгробная плита</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={extraFlowerbed} onChange={(e) => setExtraFlowerbed(e.target.checked)} />
                  <span>Цветник</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Ошибка */}
      {err && (
        <div style={{ ...glassPanelStyle(), padding: 12, color: "#ffb4b4" }}>
          {err}
        </div>
      )}

      {/* Подсказка над кнопками */}
      <section style={{ ...glassPanelStyle(), padding: 12 }}>
        Если нужного пункта или изображения нет, ничего страшного: детали подтвердим по телефону или при встрече.
      </section>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={glassButtonStyle("sm", busy)} disabled={busy}>
          Назад
        </button>
        <button type="button" onClick={handleSend} style={glassButtonStyle("sm", busy)} disabled={busy}>
          {busy ? "Отправляем…" : "Отправить заказ"}
        </button>
      </div>
    </div>
  );
}
