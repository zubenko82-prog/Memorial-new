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
      try { localStorage.setItem(NAV_UNLOCK_KEY, "1"); } catch {}
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
        try { localStorage.setItem(NAV_UNLOCK_KEY, "1"); } catch {}
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
    const onResetAll = () => {
      try {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(NAV_UNLOCK_KEY);
      } catch {}
      setSelectedItem(null);
      setSizeResult(null);
      setEngraving(null);
      setDecor({});
      setEditorBackState(null);
      setNavUnlocked(false);
      setStep("start");
      try { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); } catch {}
    };
    window.addEventListener("memorial:resetAll", onResetAll as any);
    return () => window.removeEventListener("memorial:resetAll", onResetAll as any);
  }, []);

  // persist progress
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ step, selectedItem, sizeResult, engraving, decor, editorBackState, navUnlocked })
      );
      if (navUnlocked) localStorage.setItem(NAV_UNLOCK_KEY, "1");
    } catch {}
  }, [step, selectedItem, sizeResult, engraving, decor, editorBackState, navUnlocked]);

  // guards
  useEffect(() => {
    if (!selectedItem && step !== "start") { setStep("start"); return; }
    if (step !== "start" && !sizeResult) { setStep("size"); return; }
    if ((step === "graphics" || step === "epitaph" || step === "editorBack" || step === "review") && !engraving) {
      setStep("inscription"); return;
    }
  }, [step, selectedItem, sizeResult, engraving]);

  // scroll top on step change (WINDOW!)
  useLayoutEffect(() => {
    try { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); } catch {}
    const t0 = setTimeout(() => { try { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); } catch {} }, 0);
    const t1 = setTimeout(() => { try { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); } catch {} }, 150);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [step]);

  // hash sync + unlock
  useEffect(() => {
    const id = idFromLocalStep(step);
    const need = `#/wizard/${encodeURIComponent(id)}`;
    if (window.location.hash !== need) setHashForStep(id, true);
    if (step === "review" || step === "done") {
      setNavUnlocked(true);
      try { localStorage.setItem(NAV_UNLOCK_KEY, "1"); } catch {}
    }
  }, [step]);

  const handleNavSelect = (_idx: number, id: string) => {
    if (!isStepId(id)) return;
    setStep(localStepFromId(id as StepId));
    setHashForStep(id as StepId);
  };

  // callbacks
  const onStartConfirm = (item: any) => { setSelectedItem(item); setStep("size"); };

  const onSizeBack = () => setStep("start");
  const onSizeDone = (data: any) => { setSizeResult(data); setStep("inscription"); };

  const onEngravingBack = () => setStep("size");
  const onEngravingSave = (data: any) => setEngraving(data);
  const onEngravingDone = (data: any) => { setEngraving(data); setStep("graphics"); };

  const onGraphicsBack = () => setStep("inscription");
  const onGraphicsSave = (data: any) => setDecor((prev: any) => ({ ...(prev || {}), ...data }));
  const onGraphicsDone = (data: any) => { setDecor((prev: any) => ({ ...(prev || {}), ...data })); setStep("epitaph"); };

  const onEpitaphBack = () => setStep("graphics");
  const onEpitaphSave = (data: any) => setDecor((prev: any) => ({ ...(prev || {}), ...data }));
  const onEpitaphDone = (data: any) => { setDecor((prev: any) => ({ ...(prev || {}), ...data })); setStep("editorBack"); };

  const onBackEditorBack = () => setStep("epitaph");
  const onBackEditorDone = (payload: any) => { setEditorBackState(payload); setStep("review"); };

  const onReviewBack = () => setStep("editorBack");
  const onReviewSend = () => setStep("done");

  const resetAll = () => {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(NAV_UNLOCK_KEY);
    } catch {}
    setSelectedItem(null);
    setSizeResult(null);
    setEngraving(null);
    setDecor({});
    setEditorBackState(null);
    setNavUnlocked(false);
    setStep("start");
    try { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); } catch {}
  };

  const currentWizardId = useMemo<StepId>(() => idFromLocalStep(step), [step]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f0f12",
        color: "#fff",
        // важно: ничего не transform'им на корне, иначе fixed может "ломаться"
        transform: "none",
        filter: "none",
        perspective: "none",
        // помогает scrollIntoView/якорям не прятаться под StepNav
        scrollPaddingTop: "calc(var(--global-stepnav-h, 0px) + 8px + env(safe-area-inset-top, 0px))"
      }}
    >
      {step === "start" && <Start onConfirm={onStartConfirm} />}

      {step === "size" && selectedItem && (
        <SizeStep item={selectedItem} initial={sizeResult || undefined} onBack={onSizeBack} onDone={onSizeDone} />
      )}

      {step === "inscription" && selectedItem && sizeResult && (
        <EngravingStep
          item={selectedItem}
          sizeResult={sizeResult}
          initial={engraving || undefined}
          onBack={onEngravingBack}
          onSaveDraft={onEngravingSave}
          onDone={onEngravingDone}
        />
      )}

      {step === "graphics" && selectedItem && sizeResult && engraving && (
        <GraphicsStep
          item={selectedItem}
          engraving={engraving}
          initial={decor || undefined}
          onBack={onGraphicsBack}
          onSaveDraft={onGraphicsSave}
          onDone={onGraphicsDone}
        />
      )}

      {step === "epitaph" && selectedItem && sizeResult && engraving && (
        <EpitaphStep
          item={selectedItem}
          engraving={engraving}
          initial={decor || undefined}
          onBack={onEpitaphBack}
          onSaveDraft={onEpitaphSave}
          onDone={onEpitaphDone}
        />
      )}

      {step === "editorBack" && (
        <BackEditorStep onBack={onBackEditorBack} onContinue={(payload) => onBackEditorDone(payload)} />
      )}

      {step === "review" && <ReviewAndSendStep onBack={onReviewBack} onSend={onReviewSend} />}

      {step === "done" && (
        <div style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Заявка отправлена менеджерам</h2>
          <div style={{ opacity: 0.9, marginBottom: 12 }}>
            Спасибо! Менеджер свяжется с вами. Вы можете начать заново.
          </div>
          <button style={glassButtonStyle("sm")} onClick={resetAll}>
            Начать заново
          </button>
        </div>
      )}

      {step !== "done" && navUnlocked && (
        <StepNav
          steps={NAV_STEPS}
          currentId={currentWizardId}
          onSelect={handleNavSelect}
          enabled={true}
          mode="fixed"
          topOffset={6}
          heightCssVar="--global-stepnav-h"
        />
      )}
    </div>
  );
}
