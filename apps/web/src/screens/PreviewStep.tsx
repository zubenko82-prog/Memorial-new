// src/screens/PreviewStep.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function AppTitle() {
  return (
    <h1
      style={{
        margin: '0 0 18px 0',
        textAlign: 'left',
        fontSize: 32,
        letterSpacing: 0.5,
        fontWeight: 400,
        color: '#fff',
        fontFamily:
          "var(--font-readable, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Helvetica Neue', sans-serif)"
      }}
    >
      Memorial
    </h1>
  );
}

function glassButtonStyle(size = 'sm', disabled = false) {
  const pad = { nano: '6px 10px', sm: '10px 14px', md: '12px 18px' };
  return {
    padding: pad[size] || pad.sm,
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
    transition: 'transform 420ms ease, opacity 320ms ease, box-shadow 420ms ease',
    willChange: 'transform'
  };
}
function glassPanelStyle() {
  return {
    background: 'rgba(20,20,24,0.55)',
    border: '1px solid rgba(255,255,255,0.14)',
    backdropFilter: 'blur(12px) saturate(140%)',
    WebkitBackdropFilter: 'blur(12px) saturate(140%)',
    borderRadius: 12,
    boxSizing: 'border-box',
    color: '#fff'
  };
}
function bottomUnderlayGradient() {
  return {
    backgroundColor: '#000000',
    backgroundImage:
      'linear-gradient(to bottom, #6e6e6eff 0%, #464545ff 20%, #424242ff 40%, #888888 70%, #ffffff 100%)'
  };
}

function isCrossCategoryName(nameOrSlug: string) {
  const s = (nameOrSlug || '').toLowerCase();
  return s.includes('крест') || s.includes('cross') || s.includes('crosses');
}

// Формирование строк метрики
function linesFromPerson(p: any) {
  const l1 = (p.lastName || '').trim();
  const l2 = [p.firstName, p.middleName].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  const l3 = [p.birthDate, p.deathDate].map((s) => (s || '').trim()).filter(Boolean).join(' — ');
  return [l1, l2, l3].filter(Boolean);
}

export default function PreviewStep(props: any) {
  const { item, engraving, decor, onBack, onDone } = props;

  const [outro, setOutro] = useState(false);

  // Люди: сначала persons[], затем legacy
  const peopleBlocks = useMemo(() => {
    if (Array.isArray(engraving?.persons) && engraving.persons.length > 0) {
      return engraving.persons.map((p: any) => {
        const lines = linesFromPerson(p);
        const photo = p.photoDataUrl || p.photoUrl || null;
        return { id: p.id || String(Math.random()), lines, photo };
      });
    }
    const lines = Array.isArray(engraving?.metrics) && engraving.metrics.length
      ? engraving.metrics
      : (() => {
          const out: string[] = [];
          if (engraving?.fullName) out.push(String(engraving.fullName));
          const dates: string[] = [];
          if (engraving?.birthDate) dates.push(String(engraving.birthDate));
          if (engraving?.deathDate) dates.push(String(engraving.deathDate));
          if (dates.length) out.push(dates.join(' — '));
          if (Array.isArray(engraving?.lines) && engraving.lines.length) out.push(...engraving.lines.filter(Boolean));
          return out;
        })();
    const photo = engraving?.photoUrl || engraving?.photo || null;
    if (lines.length || photo) return [{ id: 'legacy-0', lines, photo }];
    return [];
  }, [engraving]);

  // Графика: кресты и остальная
  const selectedGraphics = Array.isArray(decor?.graphics) ? decor.graphics : [];
  const selectedCrosses = useMemo(
    () => selectedGraphics.filter((g: any) => isCrossCategoryName(g.catName) || isCrossCategoryName(g.catSlug)),
    [selectedGraphics]
  );
  const selectedOtherGraphics = useMemo(
    () => selectedGraphics.filter((g: any) => !isCrossCategoryName(g.catName) && !isCrossCategoryName(g.catSlug)),
    [selectedGraphics]
  );

  const selectedEpitaphs = Array.isArray(decor?.epitaphs) ? decor.epitaphs : [];

  // Рефы для авто-высоты
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const crossesRef = useRef<HTMLDivElement | null>(null);
  const onePersonRef = useRef<HTMLDivElement | null>(null);
  const multiPeopleRef = useRef<HTMLDivElement | null>(null);
  const epitaphRef = useRef<HTMLDivElement | null>(null);
  const otherGfxRef = useRef<HTMLDivElement | null>(null);
  const [minSketchHeight, setMinSketchHeight] = useState(520);

  const recomputeMinHeight = useCallback(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const contRect = cont.getBoundingClientRect();

    const relBottom = (el: HTMLElement | null | undefined) => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return r.bottom - contRect.top;
    };

    const bgH = bgImgRef.current ? bgImgRef.current.getBoundingClientRect().height : 0;
    const bCross = relBottom(crossesRef.current!);
    const bOne = relBottom(onePersonRef.current!);
    const bMulti = relBottom(multiPeopleRef.current!);
    const bEpi = relBottom(epitaphRef.current!);
    const bOther = relBottom(otherGfxRef.current!);

    const maxBottom = Math.max(bgH, bCross, bOne, bMulti, bEpi, bOther);
    const desired = Math.max(520, Math.ceil(maxBottom + 16));
    setMinSketchHeight(desired);
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => { recomputeMinHeight(); });
    if (containerRef.current) ro.observe(containerRef.current);
    const onResize = () => recomputeMinHeight();
    window.addEventListener('resize', onResize);
    const raf = requestAnimationFrame(recomputeMinHeight);
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, [recomputeMinHeight]);

  useEffect(() => {
    recomputeMinHeight();
  }, [peopleBlocks, selectedCrosses, selectedOtherGraphics, selectedEpitaphs, recomputeMinHeight]);

  const handleBack = () => { setOutro(true); setTimeout(() => typeof onBack === 'function' && onBack(), 320); };
  const handleContinue = () => { setOutro(true); setTimeout(() => typeof onDone === 'function' && onDone(), 320); };

  return (
    <div style={{ color: '#fff', padding: 12, opacity: outro ? 0 : 1, transition: 'opacity 320ms ease' }}>
      <AppTitle />

      <h4 style={{ margin: '0 0 8px 0', textAlign: 'center', fontWeight: 'normal', fontStyle: 'italic'}}>
        Наличие элементов гравировки на стеле, схематично. <br />Расположение можно будет скорректировать позже или отставить на усмотрение мастера.
      </h4>

      <section style={{ ...glassPanelStyle(), padding: 12, margin: '12px 0' }}>
        <h2 style={{ margin: '0 0 8px 0', textAlign: 'left' }}>Предпросмотр</h2>
        <div
          ref={containerRef}
          style={{
            ...bottomUnderlayGradient(),
            borderRadius: 10,
            position: 'relative',
            width: '100%',
            minHeight: minSketchHeight,
            transition: 'min-height 200ms ease',
            overflow: 'hidden',
            userSelect: 'none',
            padding: 8
          }}
        >
          {/* Базовое изображение — ВПИСАНО ПО ШИРИНЕ */}
          <img
            ref={bgImgRef}
            src={item?.url || ''}
            alt={item?.name || 'Изделие'}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              objectFit: 'contain',
              borderRadius: 8,
              opacity: 0.18,
              filter: 'grayscale(40%)'
            }}
            draggable={false}
            onLoad={recomputeMinHeight}
          />

          {/* Кресты — в верхнем левом углу */}
          {selectedCrosses.length > 0 && (
            <div
              ref={crossesRef}
              style={{
                position: 'absolute',
                left: '4%',
                top: '4%',
                display: 'grid',
                gridAutoFlow: 'row',
                rowGap: 6,
                width: '18%'
              }}
            >
              {selectedCrosses.slice(0, 3).map((g: any) => (
                <img
                  key={'cross-' + g.id}
                  src={g.url}
                  alt={g.name}
                  style={{
                    width: '100%',
                    height: 'auto',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
                  }}
                  draggable={false}
                  onLoad={recomputeMinHeight}
                />
              ))}
            </div>
          )}

          {/* Люди и метрика */}
          {peopleBlocks.length === 1 ? (
            // Один человек — центр
            <div
              ref={onePersonRef}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '92%',
                maxWidth: 720,
                textAlign: 'center',
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)'
              }}
            >
              {peopleBlocks[0].photo && (
                <img
                  src={peopleBlocks[0].photo}
                  alt="Фото"
                  style={{
                    maxWidth: '52%',
                    maxHeight: 260,
                    objectFit: 'contain',
                    display: 'block',
                    margin: '0 auto',
                    transform: 'translateY(-8%)'
                  }}
                  draggable={false}
                  onLoad={recomputeMinHeight}
                />
              )}
              <div style={{ transform: 'translateY(8%)', marginTop: 10 }}>
                {(() => {
                  const lns = peopleBlocks[0].lines || [];
                  const [l1, l2, l3] = [lns[0], lns[1], lns[2]];
                  return (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {l1 && <div style={{ fontSize: 'clamp(20px, 4vw, 32px)', fontWeight: 700, lineHeight: 1.15 }}>{l1}</div>}
                      {l2 && <div style={{ fontSize: 'clamp(18px, 3.4vw, 26px)', fontWeight: 500, lineHeight: 1.15 }}>{l2}</div>}
                      {l3 && <div style={{ fontSize: 'clamp(16px, 3vw, 22px)', fontWeight: 400, opacity: 0.95, lineHeight: 1.15 }}>{l3}</div>}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : peopleBlocks.length > 1 ? (
            // Несколько — два столбца, ниже креста, меньшие отступы
            <div
              ref={multiPeopleRef}
              style={{
                position: 'absolute',
                left: '50%',
                top: selectedCrosses.length > 0 ? '18%' : '12%',
                transform: 'translateX(-50%)',
                width: '92%',
                maxWidth: 920,
                display: 'grid',
                gridAutoRows: 'minmax(110px, auto)',
                rowGap: 12
              }}
            >
              {peopleBlocks.map((mb: any) => {
                const lns = mb.lines || [];
                const [l1, l2, l3] = [lns[0], lns[1], lns[2]];
                return (
                  <div
                    key={mb.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      alignItems: 'center',
                      columnGap: 12
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 120 }}>
                      {mb.photo ? (
                        <img
                          src={mb.photo}
                          alt="Фото"
                          style={{ maxWidth: '78%', maxHeight: 180, objectFit: 'contain', display: 'block' }}
                          draggable={false}
                          onLoad={recomputeMinHeight}
                        />
                      ) : (
                        <div style={{ opacity: 0.5, fontSize: 12 }}>(нет фото)</div>
                      )}
                    </div>
                    <div
                      style={{
                        textAlign: 'center',
                        color: '#fff',
                        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                        display: 'grid',
                        gap: 4,
                        padding: '2px 0'
                      }}
                    >
                      {l1 && <div style={{ fontSize: 'clamp(18px, 3.2vw, 26px)', fontWeight: 700, lineHeight: 1.12 }}>{l1}</div>}
                      {l2 && <div style={{ fontSize: 'clamp(16px, 2.8vw, 22px)', fontWeight: 500, lineHeight: 1.12 }}>{l2}</div>}
                      {l3 && <div style={{ fontSize: 'clamp(14px, 2.4vw, 18px)', fontWeight: 400, opacity: 0.95, lineHeight: 1.12 }}>{l3}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Эпитафии — центр внизу */}
          {selectedEpitaphs.length > 0 && (
            <div
              ref={epitaphRef}
              style={{
                position: 'absolute',
                left: '50%',
                bottom: '18%',
                transform: 'translateX(-50%)',
                width: '88%',
                textAlign: 'center',
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                fontStyle: 'italic',
                fontSize: 'clamp(14px, 3.4vw, 22px)',
                lineHeight: 1.2,
                display: 'grid',
                gap: 8
              }}
            >
              {selectedEpitaphs.slice(0, 8).map((t: string, idx: number) => (
                <div key={'ep-' + idx} style={{ whiteSpace: 'pre-wrap' }}>
                  {t}
                </div>
              ))}
            </div>
          )}

          {/* Прочая графика — по центру под эпитафией */}
          {selectedOtherGraphics.length > 0 && (
            <div
              ref={otherGfxRef}
              style={{
                position: 'absolute',
                left: '50%',
                bottom: '6%',
                transform: 'translateX(-50%)',
                width: '88%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap'
              }}
            >
              {selectedOtherGraphics.slice(0, 6).map((g: any) => (
                <img
                  key={'other-' + g.id}
                  src={g.url}
                  alt={g.name}
                  style={{
                    maxWidth: '22%',
                    height: 'auto',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                    flex: '0 0 auto'
                  }}
                  draggable={false}
                  onLoad={recomputeMinHeight}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Кнопки */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleBack}
          style={glassButtonStyle('sm')}
          onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.98)')}
          onPointerUp={(e) => (e.currentTarget.style.transform = '')}
          onPointerLeave={(e) => (e.currentTarget.style.transform = '')}
        >
          Назад
        </button>
        <button
          type="button"
          onClick={handleContinue}
          style={glassButtonStyle('sm')}
          onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.98)')}
          onPointerUp={(e) => (e.currentTarget.style.transform = '')}
          onPointerLeave={(e) => (e.currentTarget.style.transform = '')}
        >
          Продолжить
        </button>
      </div>
    </div>
  );
}
