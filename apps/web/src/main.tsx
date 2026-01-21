import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/fonts.css";
import { tgSafeInit } from "./lib/tg";

(function hardResetOnce() {
  try {
    // ВРЕМЕННО: сбросить всё memorial.* чтобы убрать старые раздутые данные
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("memorial.")) localStorage.removeItem(k);
    }
  } catch {}
})();


tgSafeInit();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
