// src/router/WizardRouter.tsx
import React from "react";
import StepNav from "../components/StepNav";
import { STEPS, type StepId } from "../wizard/steps";
import { useCurrentStep, navigateToStep } from "./wizard";

// Экраны мастера
import Start from "../screens/Start";                       // 'item'
import ParamsStep from "../screens/ParamsStep";             // 'params'
import PersonsStep from "../screens/PersonsStep";           // 'persons'
import GraphicsStep from "../screens/GraphicsStep";         // 'graphics'
import EpitaphStep from "../screens/EpitaphStep";           // 'epitaph'
// import FrontEditorStep from "../screens/FrontEditorStep"; // 'editor' — УБРАНО/ЗАКОММЕНТИРОВАНО
import BackEditorStep from "../screens/BackEditorStep";     // 'rear'
import ReviewAndSendStep from "../screens/ReviewAndSendStep"; // 'finish'
import ExtrasStep from "../screens/ExtrasStep";             // 'extras' (опционально)

// ВАЖНО: рекомендуется убрать 'editor' из STEPS в ../wizard/steps.
// На случай, если 'editor' всё ещё есть в STEPS/URL — добавлен редирект на 'rear' ниже.

function ScreenByStep({ step }: { step: StepId }) {
  // Редирект: если по инерции попадём на step = 'editor' — сразу ведём на 'rear'
  if (step === "editor") {
    navigateToStep("rear");
    return null;
  }

  switch (step) {
    case "item":
      return <Start onConfirm={() => navigateToStep("params")} />;

    case "params":
      return (
        <ParamsStep
          onNext={() => navigateToStep("persons")}
          onBack={() => navigateToStep("item")}
        />
      );

    case "persons":
      return (
        <PersonsStep
          onNext={() => navigateToStep("graphics")}
          onBack={() => navigateToStep("params")}
        />
      );

    case "graphics":
      return (
        <GraphicsStep
          onNext={() => navigateToStep("epitaph")}
          onBack={() => navigateToStep("persons")}
        />
      );

    case "epitaph":
      // После «Эпитафии» сразу на «Тыл» (rear), шага «editor» больше нет
      return (
        <EpitaphStep
          onNext={() => navigateToStep("rear")}
          onBack={() => navigateToStep("graphics")}
        />
      );

    // case "editor":
    //   // УБРАНО
    //   return <FrontEditorStep onContinue={() => navigateToStep("rear")} onBack={() => navigateToStep("epitaph")} />;

    case "rear":
      // Если «extras» нужен — ведём туда; иначе можно сразу finish
      return (
        <BackEditorStep
          onContinue={() => navigateToStep("extras")}
          onBack={() => navigateToStep("epitaph")}
        />
      );

    case "extras":
      // Если экран Extras отсутствует — можно временно сменить на navigateToStep("finish")
      return (
        <ExtrasStep
          onNext={() => navigateToStep("finish")}
          onBack={() => navigateToStep("rear")}
        />
      );

    case "finish":
      return (
        <ReviewAndSendStep
          onBack={() => navigateToStep("rear")}
          onSend={() => navigateToStep("finish")}
        />
      );

    default:
      return <Start onConfirm={() => navigateToStep("params")} />;
  }
}

export default function WizardRouter() {
  const step = useCurrentStep();

  return (
    <div style={{ minHeight: "100dvh", display: "grid", gridTemplateRows: "auto 1fr" }}>
      {/* Навигация по шагам.
         РЕКОМЕНДУЕТСЯ удалить 'editor' из STEPS в ../wizard/steps,
         чтобы индикатор шагов не показывал удалённый шаг. */}
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
