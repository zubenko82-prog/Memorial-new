// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/fonts.css";
import { tgSafeInit } from "./lib/tg";

// Anti-OOM: если в localStorage оказались гигантские JSON/base64 (старые превью),
// браузер может падать ещё ДО первого рендера (например, из-за JSON.parse в App).
// Здесь мы чистим подозрительно большие ключи заранее.
(function prebootStorageSanitizer() {
  const MAX_CHARS = 2_000_000; // ~2MB текста
  const KEYS = [
    "memorial.progress.v6",
    "memorial.order.draft.v1",
    "memorial.navEnabled.reviewOnly"
  ];

  for (const k of KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v && v.length > MAX_CHARS) {
        localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
  }
})();

tgSafeInit();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
