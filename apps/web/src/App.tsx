// src/App.tsx
// Правки:
// - Делаем StepNav НЕ липкой, а фиксированной (position: fixed) вверху.
// - Добавляем отступ контенту под фиксированную панель.
// - Прокидываем CSS‑переменную --fixed-nav-h, чтобы локальные "липкие" панели шагов могли знать отступ сверху.
// - Навигация внутри шагов оставляем/делаем липкой (см. ниже патч для каждой панели).

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Start from './screens/Start';
import SizeStep from './screens/SizeStep';
import EngravingStep from './screens/EngravingStep';
import GraphicsStep from './screens/GraphicsStep';
import EpitaphStep from './screens/EpitaphStep';
// import EditorStep from './screens/EditorStep'; // шаг убран
import BackEditorStep from './screens/BackEditorStep';
import ReviewAndSendStep from './screens/ReviewAndSendStep';

import StepNav from './components/StepNav';
import { STEPS, type StepId } from './wizard/steps';

type Step =
  | 'start'
  | 'size'
  | 'inscription'
  | 'graphics'
  | 'epitaph'
  // | 'editor'
  | 'editorBack'
  | 'review'
  | 'done';

const LS_KEY = 'memorial.progress.v6';

// ... (glassButtonStyle, forceScrollTop без изменений)

// Скрываем из StepNav «extras» и «editor»
const NAV_STEPS = STEPS.filter(s => s.id !== 'extras' && s.id !== 'editor');
const STEP_IDS = NAV_STEPS.map(s => s.id);
const isStepId = (x: string): x is StepId => STEP_IDS.includes(x as StepId);

const localStepFromId = (id: StepId): Step => {
  switch (id) {
    case 'item':    return 'start';
    case 'params':  return 'size';
    case 'persons': return 'inscription';
    case 'graphics':return 'graphics';
    case 'epitaph': return 'epitaph';
    case 'editor':  return 'editorBack'; // редирект старых ссылок
    case 'rear':    return 'editorBack';
    case 'extras':  return 'review';
    case 'finish':  return 'review';
    default:        return 'start';
  }
};
const idFromLocalStep = (s: Step): StepId => {
  switch (s) {
    case 'start':       return 'item';
    case 'size':        return 'params';
    case 'inscription': return 'persons';
    case 'graphics':    return 'graphics';
    case 'epitaph':     return 'epitaph';
    case 'editorBack':  return 'rear';
    case 'review':      return 'finish';
    case 'done':        return 'finish';
    default:            return 'item';
  }
};

function getStepIdFromLocation(win: Window = window): StepId {
  try {
    const hash = (win.location.hash || '').replace(/^#/, '');
    const hparts = hash.split(/[/?#]/).filter(Boolean);
    for (let i = hparts.length - 1; i >= 0; i--) {
      const token = decodeURIComponent(hparts[i]);
      if (isStepId(token)) return token as StepId;
    }
    const pparts = (win.location.pathname || '').split('/').filter(Boolean);
    for (let i = pparts.length - 1; i >= 0; i--) {
      const token = decodeURIComponent(pparts[i]);
      if (isStepId(token)) return token as StepId;
    }
    const sp = new URLSearchParams(win.location.search);
    const q = sp.get('step');
    if (q && isStepId(q)) return q as StepId;
  } catch {}
  return 'item';
}

function setHashForStep(id: StepId, replace = false) {
  const hash = `#/wizard/${encodeURIComponent(id)}`;
  if (replace) {
    const url = new URL(window.location.href);
    url.hash = hash.slice(1);
    window.history.replaceState(null, '', url.toString());
  } else {
    window.location.hash = hash;
  }
}

export default function App() {
  const [step, setStep] = useState<Step>('start');
  const [navUnlocked, setNavUnlocked] = useState<boolean>(false);

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [sizeResult, setSizeResult] = useState<any>(null);
  const [engraving, setEngraving] = useState<any>(null);
  const [decor, setDecor] = useState<any>({});
  const [editorBackState, setEditorBackState] = useState<any>(null);

  // Восстановление прогресса
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        setStep((p.step as Step) || 'start');
        setSelectedItem(p.selectedItem ?? null);
        setSizeResult(p.sizeResult ?? null);
        setEngraving(p.engraving ?? null);
        setDecor(p.decor ?? {});
        setEditorBackState(p.editorBackState ?? null);
        setNavUnlocked(Boolean(p.navUnlocked) || p.step === 'review' || p.step === 'done');
      }
    } catch {}
  }, []);

  // Синхронизация c URL при входе
  useEffect(() => {
    const id = getStepIdFromLocation();
    const s = localStepFromId(id);
    setStep(s);
    if (s === 'review' || s === 'done') setNavUnlocked(true);
  }, []);

  // Слушаем back/forward
  useEffect(() => {
    const onChange = () => {
      const id = getStepIdFromLocation();
      const s = localStepFromId(id);
      setStep(s);
      if (s === 'review' || s === 'done') setNavUnlocked(true);
    };
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  // Сохранение прогресса
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          step,
          selectedItem,
          sizeResult,
          engraving,
          decor,
          editorBackState,
          navUnlocked
        })
      );
    } catch {}
  }, [step, selectedItem, sizeResult, engraving, decor, editorBackState, navUnlocked]);

  // Guards
  useEffect(() => {
    if (!selectedItem && step !== 'start') { setStep('start'); return; }
    if (step !== 'start' && !sizeResult) { setStep('size'); return; }
    if ((step === 'graphics' || step === 'epitaph' || step === 'editorBack' || step === 'review') && !engraving) {
      setStep('inscription');
      return;
    }
  }, [step, selectedItem, sizeResult, engraving]);

  // Прокрутка вверх
  useLayoutEffect(() => {
    forceScrollTop();
    const t0 = setTimeout(forceScrollTop, 0);
    const t1 = setTimeout(forceScrollTop, 150);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
    };
  }, [step]);

  // Синхронизация hash + разблокировка навигации
  useEffect(() => {
    const id = idFromLocalStep(step);
    const need = `#/wizard/${encodeURIComponent(id)}`;
    if (window.location.hash !== need) setHashForStep(id, true);
    if (step === 'review' || step === 'done') setNavUnlocked(true);
  }, [step]);

  // Переход из StepNav
  const handleNavSelect = (_idx: number, id: string) => {
    if (!isStepId(id)) return;
    const s = localStepFromId(id as StepId);
    setStep(s);
    setHashForStep(id as StepId);
  };

  // Колбэки шагов (сокращено до изменённых):
  const onGraphicsDone = (data: any) => { setDecor((prev: any) => ({ ...(prev || {}), ...data })); setStep('epitaph'); };
  const onEpitaphDone = (data: any) => { setDecor((prev: any) =>ЛЯ "ЛИПКИХ" ПАНЕЛЕЙ ВНУТРИ ШАГОВ
// На каждом шаге (SizeStep / EngravingStep / GraphicsStep / EpitaphStep / BackEditorStep / ReviewAndSendStep)
// у верхней панели навигации задайте position: sticky и top = высоте фиксированной StepNav.
// Мы пробрасываем CSS‑переменную --fixed-nav-h из App, поэтому достаточно так:

// Пример: в верхней панели внутри шага замените контейнер стилей на:
<div
  style={{
    position: 'sticky',
    top: 'var(--fixed-nav-h, 0px)', // отступ под фиксированный StepNav
    zIndex: 1000,
    background: 'rgba(0,0,0,0.92)',
    backdropFilter: 'saturate(120%) blur(8px)',
    WebkitBackdropFilter: 'saturate(120%) blur(8px)',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 12,
    padding: '8px 10px',
    margin: '10px 0'
  }}
>
  {/* элементы локальной навигации шага */}
</div>

// В ReviewAndSendStep у вас уже есть StickyNav. Просто убедитесь, что top использует переменную:
const StickyNav = ({ ...props }) => (
  <div
    style={{
      position: 'sticky',
      top: 'var(--fixed-nav-h, 0px)',
      zIndex: 1000,
      background: 'rgba(0,0,0,0.92)',
      backdropFilter: 'saturate(120%) blur(8px)',
      WebkitBackdropFilter: 'saturate(120%) blur(8px)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 12,
      padding: '8px 10px',
      margin: '10px 0'
    }}
  >
    {/* ... */}
  </div>
);

// Аналогично обновите локальные "липкие" панели остальных шагов.
// Так локальные панели снова станут липкими, а StepNav будет фиксированной наверху страницы.
