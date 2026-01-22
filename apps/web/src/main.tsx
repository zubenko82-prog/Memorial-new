// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts.css";
import { tgSafeInit } from "./lib/tg";
tgSafeInit();
import App from "./App";
ReactDOM.createRoot(...).render(<App />);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 16, color: "#fff", background: "#111", minHeight: "100vh" }}>
    boot ok
  </div>
);
