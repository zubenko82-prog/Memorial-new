import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts.css";
import { tgSafeInit } from "./lib/tg";
import App from "./App";

tgSafeInit();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
