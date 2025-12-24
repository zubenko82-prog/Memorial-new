// src/components/StepNav.tsx
// Компактная навигация по шагам (по умолчанию НЕ липкая).
// Новое:
// - Панель может «включаться» автоматически после перехода на шаг завершения (finish)
//   и затем показываться на всех экранах (даже если перейти назад).
// - Хранит флаг включения в localStorage (persistKey = "memorial.navEnabled").
// - Если enabled не передан — StepNav сам решает показываться, глядя на localStorage
//   и/или текущий URL (активируется на finish).
//
// Использование в App:
//   — Рендерите StepNav на всех шагах (кроме "done"), sticky={false}.
//   — Не нужно больше усложнять экраны — StepNav сам спрячется до «активации».
//   Например:
//     {step !== 'done' && (
//       <StepNav steps={NAV_STEPS} currentId={currentWizardId} onSelect={handleNavSelect} sticky={false} />
//     )}
//
// Поведение:
//   — Пока пользователь не дошёл до шага finish, StepNav будет возвращать null (не рендерится).
//   — Как только пользователь откроет finish — StepNav запишет флаг в localStorage и
//     начнёт всегда показываться на всех шагах.

import React, { useEffect, useMemo, useState } from "react";

export type StepDef = { id: string; title: string; icon?: React.ReactNode };

export type StepNavProps = {
  steps?: StepDef[];
  current?: number;         // 0-based
  currentId?: string;       // id активного шага
  activeId?: string;        // alias
  active?: string;          // alias (совм. со старым кодом)
  onSelect?: (index: number, id: string) => void;
  linkForId?: (id: string) => string;
  hint?: string;

  // Параметры показа/позиционирования
  sticky?: boolean;         // по умолчанию false (панель НЕ липкая)

  // Управление режимом «появится после завершения»
  enabled?: boolean;        // если задан — жёстко управляет показом (true/false)
  activateOnFinish?: boolean; // по умолчанию true: включаемся автоматически на finish
  persistKey?: string;        // ключ LS для флага включения, по умолчанию "memorial.navEnabled"
};

// Без «extras»
const defaultSteps: StepDef[] = [
  { id: "item",    title: "Резная работа" },
  { id: "params",  title: "Размеры стелы" },
  { id: "persons", title: "Усопшие" },
  { id: "graphics",title: "Графика" },
  { id: "epitaph", title: "Эпитафия" },
  { id: "editor",  title: "Редактор" },
  { id: "rear",    title: "Тыльная сторона" },
  { id: "finish",  title: "Завершение" }
];

function Icon({ id }: { id: string }) {
  const p = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "currentColor" };
  switch (id) {
    case "item":
      return (<svg {...p} aria-hidden><path d="M4 6a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm10-1v4h4" /></svg>);
    case "params":
      return (<svg {...p} aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case "persons":
      return (<svg {...p} aria-hidden><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 20a8 8 0 1 1 16 0" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case "graphics":
      return (<svg {...p} aria-hidden><path d="M4 5h16v14H4zM6 15l4-5 3 4 2-3 3 4" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case "epitaph":
      return (<svg {...p} aria-hidden><path d="M6 7h12M6 12h10M6 17h8" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    case "editor":
      return (<svg {...p} aria-hidden><path d="M4 5h16v14H4z" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M9 9h6v6H9z" /></svg>);
    case "rear":
      return (<svg {...p} aria-hidden><path d="M5 6h9v12H5z" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M10 6h9v12h-9z" /></svg>);
    case "finish":
      return (<svg {...p} aria-hidden><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    default:
      return (<svg {...p} aria-hidden><circle cx="12" cy="12" r="8" /></svg>);
  }
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function detectIdFromLocation(stepIds: string[]): string | null {
  if (typeof window === "undefined") return null;

  const hash = (window.location.hash || "").replace(/^#/, "");
  const hashParts = hash.split(/[/?#]/).filter(Boolean);
  for (let i = hashParts.length - 1; i >= 0; i--) {
    const token = decodeURIComponent(hashParts[i]);
    if (stepIds.includes(token)) return token;
  }

  const pathParts = (window.location.pathname || "").split("/").filter(Boolean);
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const token = decodeURIComponent(pathParts[i]);
    if (stepIds.includes(token)) return token;
  }

  const sp = new URLSearchParams(window.location.search);
  const qp = sp.get("step");
  if (qp && stepIds.includes(qp)) return qp;

  return null;
}

export default function StepNav({
  steps = defaultSteps,
  current,
  currentId,
  activeId,
  active,
  onSelect,
  hint,
  linkForId,
  sticky = false,                 // по умолчанию НЕ липкая
  enabled: enabledProp,           // внешний контроль показа (опционально)
  activateOnFinish = true,        // авто-включение после finish
  persistKey = "memorial.navEnabled"
}: StepNavProps) {
  const ids = useMemo(() => steps.map(s => s.id), [steps]);

  // Определяем, активирован ли показ панели
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return !!enabledProp;
    if (typeof enabledProp === "boolean") return enabledProp;
    try {
      return window.localStorage.getItem(persistKey) === "1";
    } catch {
      return false;
    }
  });

  // Активируем панель, когда попадаем на finish
  useEffect(() => {
    if (!activateOnFinish || typeof window === "undefined") return;
    const idNow = (currentId || activeId || active || detectIdFromLocation(ids)) || "";
    if (idNow === "finish") {
      try {
        window.localStorage.setItem(persistKey, "1");
      } catch {}
      setEnabled(true);
    }
    const onChange = () => {
      const idLoc = detectIdFromLocation(ids);
      if (idLoc === "finish") {
        try {
          window.localStorage.setItem(persistKey, "1");
        } catch {}
        setEnabled(true);
      }
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, [activateOnFinish, persistKey, ids, currentId, activeId, active]);

  // Если внешний проп задан — он имеет приоритет
  useEffect(() => {
    if (typeof enabledProp === "boolean") setEnabled(enabledProp);
  }, [enabledProp]);

  // первичное определение активного индекса
  const initIndex = (() => {
    if (Number.isInteger(current as number)) {
      return clamp(Number(current), 0, steps.length - 1);
    }
    const idProp = currentId || activeId || active;
    if (idProp && ids.includes(idProp)) return ids.indexOf(idProp);
    const fromLoc = detectIdFromLocation(ids);
    if (fromLoc) return ids.indexOf(fromLoc);
    return 0;
  })();

  const [curIndex, setCurIndex] = useState<number>(initIndex);

  useEffect(() => {
    if (Number.isInteger(current as number)) {
      setCurIndex(clamp(Number(current), 0, steps.length - 1));
      return;
    }
    const idProp = currentId || activeId || active;
    if (idProp && ids.includes(idProp)) {
      setCurIndex(ids.indexOf(idProp));
      return;
    }
    const fromLoc = detectIdFromLocation(ids);
    if (fromLoc) setCurIndex(ids.indexOf(fromLoc));
  }, [current, currentId, activeId, active, ids, steps.length]);

  useEffect(() => {
    const onChange = () => {
      const fromLoc = detectIdFromLocation(ids);
      if (fromLoc) setCurIndex(ids.indexOf(fromLoc));
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, [ids]);

  const hrefOf = (id: string) => (linkForId ? linkForId(id) : `#/wizard/${encodeURIComponent(id)}`);

 const containerStyle: React.CSSProperties = sticky
  ? {
      position: "sticky",
      top: "calc(env(safe-area-inset-top, 0px))",
      zIndex: 1000,
      display: "grid",
      gap: 6
    }
  : { display: "grid", gap: 6 };

  // До «активации» панель не отображаем вовсе
  if (!enabled) return null;

  return (
    <div style={containerStyle}>
      <nav
        aria-label="Навигация по шагам"
        style={{
          maxWidth: 600,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
          alignItems: "center",
          gap: 4,
          padding: "6px 8px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.14)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%), rgba(20,20,24,0.55)",
          width: "100%",
          boxSizing: "border-box"
        }}
      >
        {steps.map((s, idx) => {
          const isActive = idx === curIndex;
          return (
            <a
              key={s.id}
              href={hrefOf(s.id)}
              title={s.title}
              aria-current={isActive ? "step" : undefined}
              onClick={(e) => {
                if (onSelect) {
                  e.preventDefault();
                  onSelect(idx, s.id);
                } else {
                  setCurIndex(idx);
                }
              }}
              style={{
                display: "inline-flex",
                justifyContent: "center",
                alignItems: "center",
                height: 14,
                borderRadius: 999,
                color: isActive ? "#cfe0ff" : "#ffffff",
                background: isActive ? "rgba(138,180,255,0.18)" : "transparent",
                border: isActive ? "1px solid #8ab4ff" : "1px solid transparent",
                textDecoration: "none",
                transition: "transform 160ms ease, background 160ms ease, border-color 160ms ease",
                willChange: "transform",
                padding: 2
              }}
              onPointerDown={(el) => ((el.currentTarget as HTMLAnchorElement).style.transform = "scale(0.96)")}
              onPointerUp={(el) => ((el.currentTarget as HTMLAnchorElement).style.transform = "")}
              onPointerLeave={(el) => ((el.currentTarget as HTMLAnchorElement).style.transform = "")}
            >
              {s.icon ?? <Icon id={s.id} />}
            </a>
          );
        })}
      </nav>

      {hint && (
        <div style={{ textAlign: "center", fontSize: 12, opacity: 0.9 }}>{hint}</div>
      )}
    </div>
  );
}
