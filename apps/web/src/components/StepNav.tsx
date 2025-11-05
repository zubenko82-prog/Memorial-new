// src/components/StepNav.tsx
// Компактная навигация по шагам, одна строка, равномерно по ширине.
// Переходы работают в 3 режимах:
// 1) Если передан onSelect(index, id) — вызываем его (управление навигацией у родителя).
// 2) Иначе, если передан linkForId — используем <a href={linkForId(id)}> (браузер/роутер сам перейдёт).
// 3) Иначе — по умолчанию <a href={`#/wizard/${id}`}> (hash-route).
import React from 'react';

export type StepDef = { id: string; title: string; icon?: React.ReactNode };

export type StepNavProps = {
  steps?: StepDef[];
  current: number; // 0-based
  onSelect?: (index: number, id: string) => void;
  hint?: string;
  linkForId?: (id: string) => string; // например: (id)=>`/wizard/${id}` или `#/${id}`
};

const defaultSteps: StepDef[] = [
  { id: 'item',    title: 'Резная работа' },
  { id: 'params',  title: 'Размеры стелы' },
  { id: 'persons', title: 'Усопшие' },
  { id: 'graphics',title: 'Графика' },
  { id: 'epitaph', title: 'Эпитафия' },
  { id: 'editor',  title: 'Редактор' },
  { id: 'rear',    title: 'Тыльная сторона' },
  { id: 'extras',  title: 'Доп. элементы' },
  { id: 'finish',  title: 'Завершение' }
];

function Icon({ id }: { id: string }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor' };
  switch (id) {
    case 'item':
      return (<svg {...p} aria-hidden><path d="M4 6a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm10-1v4h4" /></svg>);
    case 'params':
      return (<svg {...p} aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case 'persons':
      return (<svg {...p} aria-hidden><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 20a8 8 0 1 1 16 0" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case 'graphics':
      return (<svg {...p} aria-hidden><path d="M4 5h16v14H4zM6 15l4-5 3 4 2-3 3 4" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case 'epitaph':
      return (<svg {...p} aria-hidden><path d="M6 7h12M6 12h10M6 17h8" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case 'editor':
      return (<svg {...p} aria-hidden><path d="M4 5h16v14H4z" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M9 9h6v6H9z" /></svg>);
    case 'rear':
      return (<svg {...p} aria-hidden><path d="M5 6h9v12H5z" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M10 6h9v12h-9z" /></svg>);
    case 'extras':
      return (<svg {...p} aria-hidden><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case 'finish':
      return (<svg {...p} aria-hidden><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    default:
      return (<svg {...p} aria-hidden><circle cx="12" cy="12" r="8" /></svg>);
  }
}

export default function StepNav({ steps = defaultSteps, current, onSelect, hint, linkForId }: StepNavProps) {
  const hrefOf = (id: string) => (linkForId ? linkForId(id) : `#/wizard/${id}`);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <nav
        aria-label="Навигация по шагам"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.14)',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%), rgba(20,20,24,0.55)',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        {steps.map((s, idx) => {
          const active = idx === current;
          return (
            <a
              key={s.id}
              href={hrefOf(s.id)}
              title={s.title}
              aria-current={active ? 'step' : undefined}
              onClick={(e) => {
                if (onSelect) {
                  e.preventDefault();
                  onSelect(idx, s.id);
                }
              }}
              style={{
                display: 'inline-flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: 10,
                borderRadius: 999,
                color: active ? '#cfe0ff' : '#ffffff',
                background: active ? 'rgba(138,180,255,0.18)' : 'transparent',
                border: active ? '1px solid #8ab4ff' : '1px solid transparent',
                textDecoration: 'none',
                transition: 'transform 160ms ease, background 160ms ease, border-color 160ms ease',
                willChange: 'transform',
                padding: 2
              }}
              onPointerDown={(e) => ((e.currentTarget as HTMLAnchorElement).style.transform = 'scale(0.96)')}
              onPointerUp={(e) => ((e.currentTarget as HTMLAnchorElement).style.transform = '')}
              onPointerLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.transform = '')}
            >
              {s.icon ?? <Icon id={s.id} />}
            </a>
          );
        })}
      </nav>

      {hint && (
        <div style={{ textAlign: 'center', fontSize: 12, opacity: 0.9 }}>{hint}</div>
      )}
    </div>
  );
}
