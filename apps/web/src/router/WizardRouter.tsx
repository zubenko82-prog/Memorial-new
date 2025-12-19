// src/router/WizardRouter.tsx
import React, { useMemo } from "react";
import StepNav from "../components/StepNav";
import { STEPS, type StepId } from "../wizard/steps";
import { useCurrentStep, navigateToStep } from "./wizard";

// Экран шагов мастера
import Start from "../screens/Start";                       // 'item'
import ParamsStep from "../screens/ParamsStep";             // 'params'
import PersonsStep from "../screens/PersonsStep";           // 'persons'
import GraphicsStep from "../screens/GraphicsStep";         // 'graphics'
import EpitaphStep from "../screens/EpitaphStep";           // 'epitaph'
// УБРАНО: FrontEditorStep (шаг «Редактор»)
import BackEditorStep from "../screens/BackEditorStep";     // 'rear'
import ReviewAndSendStep from "../screens/ReviewAndSendStep"; // 'finish'
import ExtrasStep from "../screens/ExtrasStep";             // 'extras' (если используется)

/**
 * Единая функция выбора экрана по шагу.
 * Шаг «editor» удалён:
 *  - после «epitaph» сразу переходим на «rear»
 *  - из «rear» назад — на «epitaph»
 */
function ScreenByStep({ step }: { step: StepId }) {
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
      // СРАЗУ на «rear» (тыл), без «editor»
      return (
        <EpitaphStep
          onNext={() => navigateToStep("rear")}
          onBack={() => navigateToStep("graphics")}
        />
      );

    case "rear":
      // Если «extras» нужен — идём туда, иначе можно сразу на finish
      return (
        <BackEditorStep
          onContinue={() => navigateToStep("extras")}
          onBack={() => navigateToStep("epitaph")}
        />
      );

    case "extras":
      return (
        <ExtrasStep
          onNext={() => navigateToStep("finish")}
          onBack={() => navigateToStep("rear")}
        />
      );

    case "finish":
      // Панель навигации (StepNav) остаётся всегда сверху (см. ниже).
      // Вернули «липкость» навигаций внутри шагов: убран собственный скролл контейнер у роутера.
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

/**
 * Маршрутизатор мастера.
 *
 * Важно для «липкости» навигаций внутри шагов:
 * - УБРАН overflow: auto с контейнера контента, чтобы sticky внутри экранов
 *   работал относительно окна (viewport), а не внутреннего скролла.
 * - StepNav оставлен вверху всегда (в т.ч. на шаге подтверждения).
 */
export default function WizardRouter() {
  const step = useCurrentStep();

  // Убираем шаг «editor» из визуальной навигации StepNav, не меняя глобальный STEPS
  const stepsForNav = useMemo(
    () => (STEPS as StepId[]).filter((s) => s !== "editor"),
    []
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        gridTemplateRows: "auto 1fr"
      }}
    >
      {/* Панель навигации шагов — всегда видна сверху (в т.ч. на шаге подтверждения) */}
      <StepNav
        steps={stepsForNav}
        currentId={step}
        onSelect={(_, id) => navigateToStep(id as StepId)}
      />

      {/* Текущий шаг (БЕЗ собственного скролла, чтобы sticky внутри шагов работал) */}
      <div style={{ minHeight: 0 /* без overflow: auto */ }}>
        <ScreenByStep step={step} />
      </div>
    </div>
  );
}
