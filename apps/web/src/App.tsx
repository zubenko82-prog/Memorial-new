// src/App.tsx
// Изменения:
// - Панель StepNav больше НЕ липкая (sticky={false}).
// - Показываем StepNav ТОЛЬКО на шаге подтверждения (review).
// - За счёт этого не дублируется навигация (её не будет внутри экранов, например ReviewAndSendStep).

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Start from './screens/Start';
import SizeStep from './screens/SizeStep';
import EngravingStep from './screens/EngravingStep';
import GraphicsStep from './screens/GraphicsStep';
import EpitaphStep from './screens/EpitaphStep';
import EditorStep from './screens/EditorStep';
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
  | 'editor'
  | 'editorBack'
  | 'review'
  | 'done';

const LS_KEY = 'memorial.progress.v6';

function glassButtonStyle(size: 'nano' | 'sm' | 'md' = 'sm', disabled = false) {
  const map = { nano: '6px 10px', sm: '10px 14px', md: '12px 18px' } as const;
  return {
    padding: map[size],
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.28)',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)',
    color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)',
    backdropFilter: 'blur(14px) saturate(140%)',
    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
    opacity: disabled ? 0.6 : 1,
    transition: 'transform 320ms ease, opacity 320ms ease, box-shadow 320ms ease',
    willChange: 'transform'
  } as React.CSSProperties;
}

function forceScrollTop() {
  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch {}
  try { (document.scrollingElement as any).scrollTop = 0; } catch {}
  try { (document.documentElement as any).scrollTop = 0; } catch {}
  try { (document.body as any).scrollTop = 0; } catch {}
}

// Используем STEPS (без extras) для панели
const NAV_STEPS = STEPS.filter(s => s.id !== 'extras');
const STEP_IDS = NAV_STEPS.map(s => s.id);
const isStepId = (x: string): x is StepId => STEP_IDS.includes(x as StepId);

const localStepFromId = (id: StepId): Step => {
  switch (id) {
    case 'item':    return 'start';
    case 'params':  return 'size';
    case 'persons': return 'inscription';
    case 'graphics':return 'graphics';
    case 'epitaph': return 'epitaph';
    case 'editor':  return 'editor';
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
    case 'editor':      return 'editor';
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
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [sizeResult, setSizeResult] = useState<any>(null);
  const [engraving, setEngraving] = useState<any>(null);
  const [decor, setDecor] = useState<any>({});
  const [editorState, setEditorState] = useState<any>(null);
  const [editorBackState, setEditorBackState] = useState<any>(null);

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
        setEditorState(p.editorState ?? null);
        setEditorBackState(p.editorBackState ?? null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const id = getStepIdFromLocation();
    const s = localStepFromId(id);
    setStep(s);
  }, []);

  useEffect(() => {
    const onChange = () => {
      const id = getStepIdFromLocation();
      const s = localStepFromId(id);
      setStep(s);
    };
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

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
          editorState,
          editorBackState
        })
      );
    } catch {}
  }, [step, selectedItem, sizeResult, engraving, decor, editorState, editorBackState]);

  useEffect(() => {
    if (!selectedItem && step !== 'start') { setStep('start'); return; }
    if (step !== 'start' && !sizeResult) { setStep('size'); return; }
    if ((step === 'graphics' || step === 'epitaph' || step === 'editor' || step === 'editorBack' || step === 'review') && !engraving) {
      setStep('inscription');
      return;
    }
  }, [step, selectedItem, sizeResult, engraving]);

  useLayoutEffect(() => {
    forceScrollTop();
    const t0 = setTimeout(forceScrollTop, 0);
    const t1 = setTimeout(forceScrollTop, 150);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [step]);

  useEffect(() => {
    const id = idFromLocalStep(step);
    const need = `#/wizard/${encodeURIComponent(id)}`;
    if (window.location.hash !== need) {
      setHashForStep(id, true);
    }
  }, [step]);

  const handleNavSelect = (_idx: number, id: string) => {
    const s = localStepFromId(id as StepId);
    setStep(s);
    setHashForStep(id as StepId);
  };

  // Колбэки шагов
  const onStartConfirm = (item: any) => { setSelectedItem(item); setStep('size'); };

  const onSizeBack = () => setStep('start');
  const onSizeDone = (data: any) => { setSizeResult(data); setStep('inscription'); };

  const onEngravingBack = () => setStep('size');
  const onEngravingSave = (data: any) => setEngraving(data);
  const onEngravingDone = (data: any) => { setEngraving(data); setStep('graphics'); };

  const onGraphicsBack = () => setStep('inscription');
  const onGraphicsSave = (data: any) => setDecor((prev: any) => ({ ...(prev || {}), ...data }));
  const onGraphicsDone = (data: any) => { setDecor((prev: any) => ({ ...(prev || {}), ...data })); setStep('epitaph'); };

  const onEpitaphBack = () => setStep('graphics');
  const onEpitaphSave = (data: any) => setDecor((prev: any) => ({ ...(prev || {}), ...data }));
  const onEpitaphDone = (data: any) => { setDecor((prev: any) => ({ ...(prev || {}), ...data })); setStep('editor'); };

  const onEditorBack = () => setStep('epitaph');
  const onEditorSave = (payload: any) => setEditorState(payload);
  const onSendOrder = (payload: any) => { setEditorState(payload); setStep('editorBack'); };
  const onGenerateSketch = (payload: any) => {
    console.log('Генерация эскиза (заглушка):', payload);
    alert('Генерация эскиза будет подключена позже.');
  };
  const onRearSide = (payload: any) => { setEditorState(payload); setStep('editorBack'); };

  const onBackEditorBack = () => setStep('editor');
  const onBackEditorDone = (payload: any) => { setEditorBackState(payload); setStep('review'); };

  const onReviewBack = () => setStep('editorBack');
  const onReviewSend = () => setStep('done');

  const resetAll = () => {
    try { localStorage.removeItem(LS_KEY); } catch {}
    setSelectedItem(null);
    setSizeResult(null);
    setEngraving(null);
    setDecor({});
    setEditorState(null);
    setEditorBackState(null);
    setStep('start');
  };

  const currentWizardId = useMemo<StepId>(() => idFromLocalStep(step), [step]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f12', color: '#fff', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      {/* ВАЖНО:
         - Панель StepNav НЕ липкая (sticky={false}).
         - Показываем ТОЛЬКО на шаге подтверждения (review). */}
      {step === 'review' && (
        <StepNav
          steps={NAV_STEPS}
          currentId={currentWizardId}
          onSelect={handleNavSelect}
          sticky={false}
        />
      )}

      <div style={{ minHeight: 0, overflow: 'auto' }}>
        {step === 'start' && <Start onConfirm={onStartConfirm} />}

        {step === 'size' && selectedItem && (
          <SizeStep
            item={selectedItem}
            initial={sizeResult || undefined}
            onBack={onSizeBack}
            onDone={onSizeDone}
          />
        )}

        {step === 'inscription' && selectedItem && sizeResult && (
          <EngravingStep
            item={selectedItem}
            sizeResult={sizeResult}
            initial={engraving || undefined}
            onBack={onEngravingBack}
            onSaveDraft={onEngravingSave}
            onDone={onEngravingDone}
          />
        )}

        {step === 'graphics' && selectedItem && sizeResult && engraving && (
          <GraphicsStep
            item={selectedItem}
            engraving={engraving}
            initial={decor || undefined}
            onBack={onGraphicsBack}
            onSaveDraft={onGraphicsSave}
            onDone={onGraphicsDone}
          />
        )}

        {step === 'epitaph' && selectedItem && sizeResult && engraving && (
          <EpitaphStep
            item={selectedItem}
            engraving={engraving}
            initial={decor || undefined}
            onBack={onEpitaphBack}
            onSaveDraft={onEpitaphSave}
            onDone={onEpitaphDone}
          />
        )}

        {step === 'editor' && selectedItem && sizeResult && engraving && (
          <EditorStep
            item={selectedItem}
            engraving={engraving}
            decor={decor || {}}
            onBack={onEditorBack}
            onSendOrder={onSendOrder}
            onGenerateSketch={onGenerateSketch}
            onRearSide={onRearSide}
            onSaveDraft={onEditorSave}
          />
        )}

        {step === 'editorBack' && (
          <BackEditorStep
            onBack={onBackEditorBack}
            onContinue={(payload) => onBackEditorDone(payload)}
          />
        )}

        {step === 'review' && (
          <ReviewAndSendStep
            onBack={onReviewBack}
            onSend={onReviewSend}
          />
        )}

        {step === 'done' && (
          <div style={{ padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>Заявка отправлена менеджерам</h2>
            <div style={{ opacity: 0.9, marginBottom: 12 }}>
              Спасибо! Менеджер свяжется с вами. Вы можете начать заново.
            </div>
            <button style={glassButtonStyle('sm')} onClick={resetAll}>Начать заново</button>
          </div>
        )}

        {!['start','size','inscription','graphics','epitaph','editor','editorBack','review','done'].includes(step) && (
          <div style={{ padding: 16 }}>
            <h3>Неизвестный шаг: {String(step)}</h3>
            <button style={glassButtonStyle('sm')} onClick={() => setStep('start')}>На главную</button>
          </div>
        )}
      </div>
    </div>
  );
}
