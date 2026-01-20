// src/App.tsx
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import Start from "./screens/Start";
import SizeStep from "./screens/SizeStep";
import EngravingStep from "./screens/EngravingStep";
import GraphicsStep from "./screens/GraphicsStep";
import EpitaphStep from "./screens/EpitaphStep";
import BackEditorStep from "./screens/BackEditorStep";
import ReviewAndSendStep from "./screens/ReviewAndSendStep";

import StepNav from "./components/StepNav";
import { STEPS, type StepId } from "./wizard/steps";

type Step =
  | "start"
  | "size"
  | "inscription"
  | "graphics"
  | "epitaph"
  | "editorBack"
  | "review"
  | "done";

const LS_KEY = "memorial.progress.v6";
const NAV_UNLOCK_KEY = "memorial.navEnabled.reviewOnly";

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
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    opacity: disabled ? 0.6 : 1,
    transition: "transform 320ms ease, opacity 320ms ease, box-shadow 320ms ease",
    willChange: "transform"
  } as React.CSSProperties;
}

const NAV_STEPS = STEPS.filter((s) => s.id !== "extras" && s.id !== "editor");
const STEP_IDS = NAV_STEPS.map((s) => s.id);
const isStepId = (x: string): x is StepId => STEP_IDS.includes(x as StepId);

const localStepFromId = (id: StepId): Step => {
  switch (id) {
    case "item":
      return "start";
    case "params":
      return "size";
    case "persons":
      return "inscription";
    case "graphics":
      return "graphics";
    case "epitaph":
      return "epitaph";
    case "editor":
      return "editorBack";
    case "rear":
      return "editorBack";
    case "extras":
      return "review";
    case "finish":
      return "review";
    default:
      return "start";
  }
};

const idFromLocalStep = (s: Step): StepId => {
  switch (s) {
    case "start":
      return "item";
    case "size":
      return "params";
    case "inscription":
      return "persons";
    case "graphics":
      return "graphics";
    case "epitaph":
      return "epitaph";
    case "editorBack":
      return "rear";
    case "review":
      return "finish";
    case "done":
      return "finish";
    default:
      return "item";
  }
};

function getStepIdFromLocation(win: Window = window): StepId {
  try {
    const hash = (win.location.hash || "").replace(/^#/, "");
    const hparts = hash.split(/[/?#]/).filter(Boolean);
    for (let i = hparts.length - 1; i >= 0; i--) {
      const token = decodeURIComponent(hparts[i]);
      if (isStepId(token)) return token as StepId;
    }
    const sp = new URLSearchParams(win.location.search);
    const q = sp.get("step");
    if (q && isStepId(q)) return q as StepId;
  } catch {}
  return "item";
}

function setHashForStep(id: StepId, replace = false) {
  const hash = `#/wizard/${encodeURIComponent(id)}`;
  if (replace) {
    const url = new URL(window.location.href);
    url.hash = hash.slice(1);
    window.history.replaceState(null, "", url.toString());
  } else {
    window.location.hash = hash;
  }
}

export default function App() {
  const [step, setStep] = useState<Step>("start");
  const [navUnlocked, setNavUnlocked] = useState<boolean>(() => {
    try {
      const a = localStorage.getItem(LS_KEY);
      const b = localStorage.getItem(NAV_UNLOCK_KEY);
      if (b === "1") return true;
      if (a) {
        const p = JSON.parse(a);
        if (p?.navUnlocked || p?.step === "review" || p?.step === "done") return true;
      }
    } catch {}
    return false;
  });

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [sizeResult, setSizeResult] = useState<any>(null);
  const [engraving, setEngraving] = useState<any>(null);
  const [decor, setDecor] = useState<any>({});
  const [editorBackState, setEditorBackState] = useState<any>(null);

  // restore progress
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === "object") {
        setStep((p.step as Step) || "start");
        setSelectedItem(p.selectedItem ?? null);
        setSizeResult(p.sizeResult ?? null);
        setEngraving(p.engraving ?? null);
        setDecor(p.decor ?? {});
        setEditorBackState(p.editorBackState ?? null);
      }
    } catch {}
  }, []);

  // url sync at mount
  useEffect(() => {
    const id = getStepIdFromLocation();
    const s = localStepFromId(id);
    setStep(s);
    if (s === "review" || s === "done") {
      setNavUnlocked(true);
      try {
        localStorage.setItem(NAV_UNLOCK_KEY, "1");
      } catch {}
    }
  }, []);

  // back/forward
  useEffect(() => {
    const onChange = () => {
      const id = getStepIdFromLocation();
      const s = localStepFromId(id);
      setStep(s);
      if (s === "review" || s === "done") {
        setNavUnlocked(true);
        try {
          localStorage.setItem(NAV_UNLOCK_KEY, "1");
        } catch {}
      }
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  // reset from TopBar
  useEffect(() => {
   
