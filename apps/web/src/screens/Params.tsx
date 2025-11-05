// src/screens/Params.tsx
import React, { useState } from "react";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { type Intro } from "../lib/intro";


// Страница «Параметры стелы» — пример интеграции верхнего бара с контактами
export default function Params() {
  const [intro, setIntro] = useState<Intro | null>(null);

  return (
    <div
      style={{
        color: "#fff",
        fontFamily:
          "var(--font-readable, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Helvetica Neue', sans-serif)",
        padding: 12
      }}
    >
      <TopBarWithIntro onIntroChange={(i) => setIntro(i)} />

      {/* Дальше — ваш контент параметров стелы. Ниже просто заглушка макета. */}
      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: "8px 0 0 0", fontSize: 18, fontWeight: 500 }}>Параметры стелы</h2>

        <div
          style={{
            background: "rgba(20,20,24,0.55)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 12,
            padding: 12
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Материал</span>
              <select
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  outline: "none"
                }}
                defaultValue="granite"
              >
                <option value="granite">Гранит</option>
                <option value="marble">Мрамор</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>Размер (мм)</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  placeholder="Высота"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff"
                  }}
                />
                <input
                  type="number"
                  placeholder="Ширина"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff"
                  }}
                />
                <input
                  type="number"
                  placeholder="Толщина"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff"
                  }}
                />
              </div>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>Комментарий к параметрам</span>
              <textarea
                rows={3}
                placeholder="Например: глянец/матовый, фаска, дополнительные пожелания"
                style={{
                  resize: "vertical",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff"
                }}
              />
            </label>

            <div style={{ textAlign: "right", marginTop: 8 }}>
              <button
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.28)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
                  color: "#fff",
                  cursor: "pointer",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)"
                }}
                onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onPointerUp={(e) => (e.currentTarget.style.transform = "")}
                onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
              >
                Далее
              </button>
            </div>
          </div>
        </div>

        {/* Пример: отладочная панель — показывает текущие контакты, которые также видны в шапке справа */}
        {intro && (
          <div style={{ opacity: 0.8, fontSize: 12 }}>
            Контакты (из шапки): {intro.customerName} • {intro.customerPhone}
          </div>
        )}
      </section>
    </div>
  );
}
