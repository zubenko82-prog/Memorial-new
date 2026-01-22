import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts.css";
import { tgSafeInit } from "./lib/tg";

tgSafeInit();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 16, color: "#fff", background: "#111", minHeight: "100vh" }}>
    boot ok + tg
  </div>
);
