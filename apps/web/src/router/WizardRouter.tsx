// src/router/WizardRouter.tsx
import React from "react";
import StepNav from "../components/StepNav";
import { STEPS, type StepId } from "../wizard/steps";
import { useCurrentStep, navigateToStep } from "./wizard";

// Импортируйте реальные экраны вашего мастера
import Start from "../screens/Start";                     // 'item'
import ParamsStep from "../screens/ParamsStep";           // 'params'
import PersonsStep from "../screens/PersonsStep";         // 'persons'
import GraphicsStep from "../screens/GraphicsStep";       // 'graphics'
import EpitaphStep from "../screens/EpitaphStep";         // 'epitaph'
//import FrontEditorStep from "../screens/FrontEditorStep"; // 'editor'
import BackEditorStep from "../screens/BackEditorStep";   // 'rear'
import ReviewAndSendStep from "../screens/ReviewAndSendStep"; // 'finish'
// Если есть свой экран «Доп. элементы», импортируйте его
import ExtrasStep from "../screens/ExtrasStep";           // 'extras' (если нет — можно временно пропустить шаг)

function ScreenByStep({ step }: { step: StepId }) {
  switch (step) {
    case "item":
      return <Start onConfirm={() => navigateToStep("params")} />;
    case "params":
      return <ParamsStep onNext={() => navigateToStep("persons")} onBack={() => navigateToStep("item")} />;
    case "persons":
      return <PersonsStep onNext={() => navigateToStep("graphics")} onBack={() => navigateToStep("params")} />;
    case "graphics":
      return <GraphicsStep onNext={() => navigateToStep("epitaph")} onBack={() => navigateToStep("persons")} />;
    case "epitaph":
      return <EpitaphStep onNext={() => navigateToStep("editor")} onBack={() => navigateToStep("graphics")} />;
    //case "editor":
      //return <FrontEditorStep onContinue={() => navigateToStep("rear")} onBack={() => navigateToStep("epitaph")} />;
    case "rear":
      // Если «extras» реально нужен — ведём туда, иначе сразу finish
      return <BackEditorStep onContinue={() => navigateToStep("extras")} onBack={() => navigateToStep("editor")} />;
    case "extras":
      // Если экран отсутствует, временно используйте navigateToStep("finish")
      return <ExtrasStep onNext={() => navigateToStep("finish")} onBack={() => navigateToStep("rear")} />;
    case "finish":
      return <ReviewAndSendStep onBack={() => navigateToStep("rear")} onSend={() => navigateToStep("finish")} />;
    default:
      return <Start onConfirm={() => navigateToStep("params")} />;
  }
}

export default function WizardRouter() {
  const step = useCurrentStep();

  return (
    <div style={{ minHeight: "100dvh", display: "grid", gridTemplateRows: "auto 1fr" }}>
      {/* StepNav всегда в самом верху. Передаём ваши STEPS (с «extras», если нужен). */}
      <StepNav
        steps={STEPS}
        currentId={step}
        onSelect={(_, id) => navigateToStep(id as StepId)}
      />
      {/* Текущий шаг */}
      <div style={{ minHeight: 0, overflow: "auto" }}>
        <ScreenByStep step={step} />
      </div>
    </div>
  );
}
