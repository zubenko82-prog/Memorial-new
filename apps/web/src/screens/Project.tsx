import React from "react";
import type { CatalogItem } from "../api";

export default function ProjectScreen({ item, onBack }: { item: CatalogItem; onBack: () => void }) {
  return (
    <div>
      <button onClick={onBack}>← К каталогу</button>
      <h2>Проект: {item.name}</h2>

      <div
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 12
        }}
      >
        <div style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: 12 }}>
          <div style={{ marginBottom: 8, opacity: 0.9 }}>Превью резьбы</div>
          <img
            src={item.url}
            alt={item.name}
            style={{ width: "100%", maxWidth: 480, objectFit: "contain", background: "#0e0e0e", borderRadius: 6 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack}>Назад</button>
          <button
            onClick={() => {
              // Заглушка дальнейшего шага: сохранение черновика/переход к компоновке стелы
              alert(`Продолжим компоновку с элементом: ${item.name}`);
            }}
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
