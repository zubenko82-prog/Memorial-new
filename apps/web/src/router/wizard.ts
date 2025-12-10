// src/router/wizard.ts
import { useEffect, useState } from "react";
import { STEPS, type StepId } from "../wizard/steps";

const STEP_IDS = STEPS.map(s => s.id);
const isStepId = (x: string): x is StepId => STEP_IDS.includes(x as StepId);

export function hashForStep(id: StepId): string {
  // Простой формат: #/wizard/:id
  return `#/wizard/${encodeURIComponent(id)}`;
}

export function getStepFromLocation(win: Window = window): StepId {
  try {
    // 1) hash: #/wizard/:id или #/:id
    const hash = (win.location.hash || "").replace(/^#/, "");
    const hparts = hash.split(/[/?#]/).filter(Boolean);
    for (let i = hparts.length - 1; i >= 0; i--) {
      const token = decodeURIComponent(hparts[i]);
      if (isStepId(token)) return token as StepId;
    }
    // 2) pathname: /wizard/:id или /:id
    const pparts = (win.location.pathname || "").split("/").filter(Boolean);
    for (let i = pparts.length - 1; i >= 0; i--) {
      const token = decodeURIComponent(pparts[i]);
      if (isStepId(token)) return token as StepId;
    }
    // 3) ?step=id
    const sp = new URLSearchParams(win.location.search);
    const q = sp.get("step");
    if (q && isStepId(q)) return q as StepId;
  } catch {}
  return "item";
}

export function navigateToStep(id: StepId, replace = false) {
  const href = hashForStep(id);
  if (replace) {
    const url = new URL(window.location.href);
    url.hash = href.slice(1); // без #
    window.history.replaceState(null, "", url.toString());
  } else {
    window.location.hash = href;
  }
  // Для SPA‑слушателей
  window.dispatchEvent(new CustomEvent("wizard:step-change", { detail: { id } }));
}

export function useCurrentStep(): StepId {
  const [step, setStep] = useState<StepId>(() => getStepFromLocation());
  useEffect(() => {
    const onChange = () => setStep(getStepFromLocation());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    window.addEventListener("wizard:step-change", onChange as any);
    // init
    onChange();
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("wizard:step-change", onChange as any);
    };
  }, []);
  return step;
}
