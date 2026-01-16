// src/components/StepNav.tsx
// Компактная навигация по шагам.
//
// Требование: панель должна появляться ТОЛЬКО после достижения шага ReviewAndSendStep,
// а не сразу. После первого достижения — можно показывать на остальных шагах.
//
// Что сделано:
// - По умолчанию панель скрыта (enabled=false).
// - Авто-включение при достижении шага ReviewAndSendStep (учтены синонимы id).
// - Сохраняем флаг только в новом ключе LS: "memorial.navEnabled.reviewOnly" (старый
//   "memorial.navEnabled" игнорируем, чтобы не подсасывать старые включения).
// - Поддержка sticky/topOffset как прежде.
// - Можно передать enabled={true|false} и/или triggerId (string|string[]) для полного контроля.
//
// Пример:
// <StepNav
//   steps={NAV_STEPS}
//   currentId={currentStepId}
//   onSelect={(i, id) => goTo(id)}
//   topOffset={6}
// />
//
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type StepDef = { id: string; title: string; icon?: React.ReactNode };

export type StepNavProps = {
  steps?: StepDef[];
  current?: number;
  currentId?: string;
  activeId?: string;
  active?: string;
  onSelect?: (index: number, id: string) => void;
  linkForId?: (id: string) => string;
  hint?: string;

  // Позиционирование
  sticky?: boolean;           // по умолчанию true
  topOffset?: number;         // px

  // Показ
  enabled?: boolean;          // жёсткое управление показом
  triggerId?: string | string[]; // по умолчанию: ReviewAndSendStep-синонимы
  persistKey?: string | null; // ключ LS для запоминания; по умолчанию "memorial.navEnabled.reviewOnly"
};

const defaultSteps: StepDef[] = [
  { id: "item",    title: "Резная работа" },
  { id: "params",  title: "Размеры стелы" },
  { id: "persons", title: "Усопшие" },
  { id: "graphics",title: "Графика" },
  { id: "epitaph", title: "Эпитафия" },
  { id: "editor",  title: "Редактор" },
  { id: "rear",    title: "Тыльная сторона" },
  { id: "review-and-send", title: "Обзор и отправка" },
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
    case "review-and-send":
      return (<svg {...p} aria-hidden><path d="M6 6h12v12H6z" stroke="currentColor" strokeWidth="2" fill="none" /><path d="M8 10h8M8 14h8" stroke="currentColor" strokeWidth="2" /></svg>);
    case "finish":
      return (<svg {...p} aria-hidden><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>);
    default:
      return (<svg {...p} aria-hidden><circle cx="12" cy="12" r="8" /></svg>);
  }
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

function detectIdFromLocation(stepIds: string[]): string | null {
  if (typeof window === "undefined") return null;
  const hash = (window.location.hash || "").replace(/^#/, "");
  const parts = hash.split(/[/?#]/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = decodeURIComponent(parts[i]);
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

function normId(id?: string | null): string {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function isReviewReached(currentId: string, trigger?: string | string[]): boolean {
  const cur = normId(currentId);
  const defaults = ["review", "review-and-send", "reviewandsend", "reviewandsendstep", "reviewandsendstep".toLowerCase()];
  const trg = Array.isArray(trigger) ? trigger : (trigger ? [trigger] : defaults);
  const trgNorm = trg.map(normId);
  return trgNorm.includes(cur);
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
  sticky = true,
  topOffset = 0,
  enabled: enabledProp,
  triggerId, // если не указан — используем дефолтные синонимы ReviewAndSendStep
  persistKey = "memorial.navEnabled.reviewOnly"
}: StepNavProps) {
  const ids = useMemo(() => steps.map(s => s.id), [steps]);

  // Текущий id шага
  const curIdComputed = useMemo(() => {
    if (currentId || activeId || active) return (currentId || activeId || active)!;
    const fromLoc = detectIdFromLocation(ids);
    if (fromLoc) return fromLoc;
    if (Number.isInteger(current as number)) return steps[clamp(Number(current), 0, steps.length - 1)].id;
    return "";
  }, [current, currentId, activeId, active, ids, steps]);

  // Показ панели: по умолчанию false. Используем только НОВЫЙ ключ LS.
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return !!enabledProp;
    if (typeof enabledProp === "boolean") return enabledProp;
    // читаем ТОЛЬКО новый ключ (старый игнорируем)
    try { return (persistKey ? window.localStorage.getItem(persistKey) === "1" : false); } catch { return false; }
  });

  // Включаем, когда достигнут «review»
  useEffect(() => {
    if (typeof enabledProp === "boolean") return; // внешнее управление
    const idNow = curIdComputed;
    if (!idNow) return;
    if (enabled) return;
    if (isReviewReached(idNow, triggerId)) {
      setEnabled(true);
      if (persistKey) {
        try { window.localStorage.setItem(persistKey, "1"); } catch {}
      }
    }
  }, [curIdComputed, triggerId, enabled, enabledProp, persistKey]);

  // Слушаем изменения навигации (hash/popstate), чтобы отреагировать на достижение review
  useEffect(() => {
    if (typeof enabledProp === "boolean") return;
    const onChange = () => {
      const idLoc = detectIdFromLocation(ids) || "";
      if (!enabled && isReviewReached(idLoc, triggerId)) {
        setEnabled(true);
        if (persistKey) {
          try { window.localStorage.setItem(persistKey, "1"); } catch {}
        }
      }
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, [enabled, enabledProp, triggerId, ids, persistKey]);

  // Внешнее управление enabled имеет приоритет
  useEffect(() => {
    if (typeof enabledProp === "boolean") setEnabled(enabledProp);
  }, [enabledProp]);

  // Индекс для подсветки текущей «таблетки»
  const curIndex = useMemo(() => {
    const idxById = ids.indexOf(curIdComputed);
    if (idxById >= 0) return idxById;
    if (Number.isInteger(current as number)) return clamp(Number(current), 0, steps.length - 1);
    return 0;
  }, [curIdComputed, ids, current, steps.length]);

  // Стили
  const stickyTopValue = `calc(${Number(topOffset) || 0}px + env(safe-area-inset-top, 0px))`;
  const containerStyle: React.CSSProperties = sticky
    ? { position: "sticky", top: stickyTopValue, zIndex: 1000, display: "grid", gap: 6 }
    : { display: "grid", gap: 6 };

  const hrefOf = (id: string) => (linkForId ? linkForId(id) : `#/${encodeURIComponent(id)}`);

  // Если панель ещё не активирована — не рендерим вовсе
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
          backdropFilter: sticky ? "blur(6px)" : undefined,
          WebkitBackdropFilter: sticky ? "blur(6px)" : undefined,
          boxShadow: sticky ? "0 4px 20px rgba(0,0,0,0.20)" : undefined,
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
