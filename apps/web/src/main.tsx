// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/fonts.css";
import { tgSafeInit } from "./lib/tg";

(function prebootStorageSanitizer() {
  const MAX_CHARS = 1_500_000; // чуть ниже, чтобы агрессивнее чистить
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      // чистим только наше
      if (!key.startsWith("memorial.")) continue;
      const v = localStorage.getItem(key);
      if (v && v.length > MAX_CHARS) localStorage.removeItem(key);
    }
  } catch {}
})();

tgSafeInit();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
