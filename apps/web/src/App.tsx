// src/App.tsx
import React, { useEffect, useLayoutEffect, useState } from 'react';
import Start from './screens/Start';
import SizeStep from './screens/SizeStep';
import EngravingStep from './screens/EngravingStep';
import GraphicsStep from './screens/GraphicsStep';
import EpitaphStep from './screens/EpitaphStep';
import EditorStep from './screens/EditorStep';


type Step = 'start' | 'size' | 'inscription' | 'graphics' | 'epitaph' | 'editor' | 'done';
const LS_KEY = 'memorial.progress.v6';

function glassButtonStyle(size: 'nano' | 'sm' | 'md' = 'sm', disabled = false) {
  const map = { nano: '6px 10px', sm: '10px 14px', md: '12px 18px' } as const;
  return {
    padding: map[size],
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.28)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)',
    color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)',
    backdropFilter: 'blur(14px) saturate(140%)',
    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
    opacity: disabled ? 0.6 : 1,
    transition: 'transform 320ms ease, opacity 320ms ease, box-shadow 320ms ease',
    willChange: 'transform'
  } as React.CSSProperties;
}

// Прокрутка к верху при каждой смене шага
function forceScrollTop() {
  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch {}
  try { (document.scrollingElement as any).scrollTop = 0; } catch {}
  try { (document.documentElement as any).scrollTop = 0; } catch {}
  try { (document.body as any).scrollTop = 0; } catch {}
}

export default function App() {
  const [step, setStep] = useState<Step>('start');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [sizeResult, setSizeResult] = useState<any>(null);
  const [engraving, setEngraving] = useState<any>(null);
  const [decor, setDecor] = useState<any>({});       // { graphics:[], epitaphs:[] }
  const [editorState, setEditorState] = useState<any>(null);

  // Восстановление/сохранение
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
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ step, selectedItem, sizeResult, engraving, decor, editorState }));
    } catch {}
  }, [step, selectedItem, sizeResult, engraving, decor, editorState]);

  // Контроль последовательности
  useEffect(() => {
    if (!selectedItem && step !== 'start') { setStep('start'); return; }
    if (step !== 'start' && !sizeResult) { setStep('size'); return; }
    if ((step === 'graphics' || step === 'epitaph' || step === 'editor') && !engraving) {
      setStep('inscription');
      return;
    }
  }, [step, selectedItem, sizeResult, engraving]);

  // Скролл к верху
  useLayoutEffect(() => {
    forceScrollTop();
    const t0 = setTimeout(forceScrollTop, 0);
    const t1 = setTimeout(forceScrollTop, 150);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [step]);

  // Навигация и коллбеки
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

  // Редактор
  const onEditorBack = () => setStep('epitaph');
  const onEditorSave = (payload: any) => setEditorState(payload);
  const onSendOrder = (payload: any) => {
    // TODO: подключить чат менеджеров
    console.log('Отправка заказа менеджерам:', payload);
    setStep('done');
  };
  const onGenerateSketch = (payload: any) => {
    // TODO: интеграция нейросети
    console.log('Генерация эскиза (заглушка):', payload);
    alert('Генерация эскиза будет подключена позже.');
  };
  const onRearSide = (payload: any) => {
    console.log('Тыльная сторона (шаг будет добавлен позже):', payload);
    alert('Шаг тыльной стороны скоро появится.');
  };

  const resetAll = () => {
    try { localStorage.removeItem(LS_KEY); } catch {}
    setSelectedItem(null);
    setSizeResult(null);
    setEngraving(null);
    setDecor({});
    setEditorState(null);
    setStep('start');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f12', color: '#fff' }}>
      {step === 'start' && <Start onConfirm={onStartConfirm} />}

      {step === 'size' && selectedItem && (
        <SizeStep item={selectedItem} initial={sizeResult || undefined} onBack={onSizeBack} onDone={onSizeDone} />
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

      {step === 'done' && (
        <div style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Заявка отправлена менеджерам</h2>
          <div style={{ opacity: 0.9, marginBottom: 12 }}>
            Спасибо! Менеджер свяжется с вами. Вы можете начать заново.
          </div>
          <button style={glassButtonStyle('sm')} onClick={resetAll}>Начать заново</button>
        </div>
      )}
    </div>
  );
}
