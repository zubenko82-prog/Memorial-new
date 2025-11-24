// src/screens/ReviewAndSendStep.tsx
// Шаг «Обзор и подтверждение» с отправкой на email + Telegram-уведомлением через /api/send-order-email

import React, { useEffect, useMemo, useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft } from "../lib/order";
import { sendOrderEmailAndNotifyTg, type Extras } from "../lib/send";

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

type Props = {
  onBack?: () => void;
  onSend?: (payload?: any) => void; // вызываем по успешной отправке
};

export default function ReviewAndSendStep({ onBack, onSend }: Props) {
  const draft = useMemo(() => loadOrderDraft(), []);
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

  // При изменении чекбоксов — сохраняем в draft.extras (чтобы не потерялось при перезагрузке)
  useEffect(() => {
    try {
      const { saveOrderDraft } = require("../lib/order");
      const prev = loadOrderDraft();
      const extras = { base: extraBase, headstonePlate: extraPlate, flowerbed: extraFlowerbed };
      saveOrderDraft({ ...prev, extras, updatedAt: Date.now() });
    } catch {}
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
    <div style={{ color: "#fff", padding: 12, maxWidth: 820, margin: "0 auto" }}>
      <TopBarWithIntro title="Обзор и подтверждение" />

      <section style={{ ...glassPanelStyle(), padding: 12, margin: "10px 0" }}>
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ marginBottom: 6 }}>
            Подсказка: Проверьте данные заказа в шапке (нажмите на заголовок, чтобы раскрыть — там можно отредактировать контактные данные,
            размеры, людей, списки графики и эпитафий, а также посмотреть эскизы).
          </div>
          <div>Когда всё верно — нажмите «Отправить заказ».</div>
        </div>
      </section>

      <section style={{ ...glassPanelStyle(), padding: 12, margin: "10px 0" }}>
        <h3 style={{ margin: "0 0 8px 0" }}>Эскизы</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ ...glassPanelStyle(), padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Лицевая</div>
            {frontMini ? (
              <img src={frontMini} alt="Эскиз лицевой" style={{ width: "100%", height: "auto", borderRadius: 8 }} />
            ) : (
              <div style={{ opacity: 0.7 }}>Эскиз отсутствует</div>
            )}
          </div>
          <div style={{ ...glassPanelStyle(), padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Тыльная</div>
            {backMini ? (
              <img src={backMini} alt="Эскиз тыльной" style={{ width: "100%", height: "auto", borderRadius: 8 }} />
            ) : (
              <div style={{ opacity: 0.7 }}>Эскиз отсутствует</div>
            )}
          </div>
        </div>
      </section>

      {/* Дополнительно */}
      <section style={{ margin: "10px 0" }}>
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

      {/* Сообщение об ошибке */}
      {err && (
        <div style={{ ...glassPanelStyle(), padding: 12, margin: "10px 0", color: "#ffb4b4" }}>
          {err}
        </div>
      )}

      {/* Подсказка над кнопками */}
      <section style={{ ...glassPanelStyle(), padding: 12, margin: "10px 0" }}>
        Если нужного пункта или изображения нет, ничего страшного: детали подтвердим по телефону или при личной встрече.
      </section>

      {/* Кнопки */}
      <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "12px 0", flexWrap: "wrap" }}>
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
