// src/components/StepNav.tsx
// Компактная навигация по шагам.
//
// Требование: панель навигации должна появляться ТОЛЬКО после достижения шага ReviewAndSendStep,
// а не сразу. После первого достижения — может оставаться видимой на остальных шагах.
//
// Что сделано:
// - По умолчанию панель скрыта. Она активируется автоматически, когда текущий шаг соответствует
//   ReviewAndSendStep (по умолчанию ожидаем id шага "review-and-send" или "ReviewAndSendStep").
// - Для гибкости добавлен props triggerId (string | string[]), чтобы указать точный id шага,
//   после достижения которого панель станет видимой. По умолчанию учтены синонимы:
//   ["review", "review-and-send", "reviewandsend", "reviewandsendstep", "ReviewAndSendStep"].
// - Состояние видимости запоминается в localStorage (persistKey = "memorial.navEnabled.reviewOnly").
//   Если не нужно запоминать между сессиями — передайте persistKey={null}.
// - По умолчанию панель липкая (sticky = true). Есть topOffset (px) и авто-спейсер над панелью,
//   чтобы избежать «мгновенного прилипания» в начале скролл-контейнера.
// - Если хотите полностью управлять показом извне — передайте enabled={true|false}.
//
// Пример использования:
// <StepNav
//   steps={NAV_STEPS}
//   currentId={currentStepId}           // текущий id шага от вашего роутера/мастера
//   onSelect={(i, id) => goToStep(id)}  // по клику на иконку шага
//   triggerId="ReviewAndSendStep"       // (опционально) если ваш id отличается от дефолтных синонимов
//   topOffset={6}                       // (опционально) отступ сверху
// />
//
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type StepDef = { id: string; title: string; icon?: React.ReactNode };

export type StepNavProps = {
  steps?: StepDef[];
  current?: number;           // 0-based индекс активного шага (альтернатива currentId)
  currentId?: string;         // id активного шага (предпочтительно)
  activeId?: string;          // alias для совместимости
  active?: string;            // alias для совместимости
  onSelect?: (index: number, id: string) => void;
  linkForId?: (id: string) => string;
  hint?: string;

  // Параметры показа/позиционирования
  sticky?: boolean;           // по умолчанию: true (панель липкая)
  topOffset?: number;         // доп. отступ сверху (px), по умолчанию 0
  spacerPx?: number;          // спейсер над панелью (px). Если не задан — авто (8px при необходимости)

  // Управление показом
  enabled?: boolean;          // если задан — жёстко управляет показом (true/false)
  triggerId?: string | string[]; // шаг(и), после достижения которого панель активируется (дефолт: ReviewAndSendStep и синонимы)
  persistKey?: string | null; // ключ LS для флага включения (по умолчанию "memorial.navEnabled.reviewOnly"); null — не сохранять
};

const defaultSteps: StepDef[] = [
  { id: "item",    title: "Резная работа" },
  { id: "params",  title: "Размеры стелы" },
  { id: "persons", title: "Усопшие" },
  { id: "graphics",title: "Графика" },
  { id: "epitaph", title: "Эпитафия" },
  { id: "editor",  title: "Редактор" },
  { id: "rear",    title: "Тыльная сторона" },
  { id: "review-and-send", title: "Обзор и отправка" } // не обязательно, просто пример
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
    default:
      return (<svg {...p} aria-hidden><circle cx="12" cy="12" r="8" /></svg>);
  }
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

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

function normalizeId(id?: string | null): string {
  return String(id || "")
    .toLowerCase()
    .replace(/[\s_]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function isTriggerReached(currentId: string, trigger: string | string[] | undefined): boolean {
  const cur = normalizeId(currentId);
  const defaults = ["review", "review-and-send", "reviewandsend", "reviewandsendstep", "reviewandsendstep".toLowerCase()];
  const trgList = Array.isArray(trigger) ? trigger : (trigger ? [trigger] : defaults);
  const trgNorm = trgList.map(normalizeId);
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
  spacerPx, // если не задан — используем авто-спейсер
  enabled: enabledProp,
  triggerId, // при достижении этого шага панель активируется
  persistKey = "memorial.navEnabled.reviewOnly" // новый ключ, чтобы не подхватывать старые значения
}: StepNavProps) {
  const ids = useMemo(() => steps.map(s => s.id), [steps]);

  // Определяем текущий id шага из пропсов/локации
  const curIdComputed = useMemo(() => {
    if (currentId || activeId || active) return (currentId || activeId || active)!;
    const loc = detectIdFromLocation(ids);
    if (loc) return loc;
    if (Number.isInteger(current as number)) return steps[clamp(Number(current), 0, steps.length - 1)].id;
    return "";
  }, [current, currentId, activeId, active, ids, steps]);

  // Показ панели: по умолчанию скрыта до достижения триггер-шагa
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return !!enabledProp;
    if (typeof enabledProp === "boolean") return enabledProp;
    try { return window.localStorage.getItem(persistKey || "") === "1"; } catch { return false; }
  });

  // При достижении триггер-шагa — активировать и (опционально) запомнить
  useEffect(() => {
    if (typeof enabledProp === "boolean") return; // внешнее управление имеет приоритет
    const nowId = curIdComputed;
    if (!nowId) return;
    if (enabled) return; // уже включено
    if (isTriggerReached(nowId, triggerId)) {
      setEnabled(true);
      if (persistKey) {
        try { window.localStorage.setItem(persistKey, "1"); } catch {}
      }
    }
  }, [curIdComputed, triggerId, enabled, enabledProp, persistKey]);

  // Сброс/установка enabled извне
  useEffect(() => {
    if (typeof enabledProp === "boolean") setEnabled(enabledProp);
  }, [enabledProp]);

  // Sticky: авто-спейсер (если над панелью нет контента)
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [autoSpacer, setAutoSpacer] = useState<number>(0);
  useLayoutEffect(() => {
    if (!sticky) { setAutoSpacer(0); return; }
    const el = rootRef.current;
    if (!el) return;
    const prev = el.previousElementSibling as HTMLElement | null;
    const prevH = prev ? (prev.getBoundingClientRect().height || 0) : 0;
    setAutoSpacer(prevH <= 1 ? 8 : 0);
  }, [sticky]);

  const hrefOf = (id: string) => (linkForId ? linkForId(id) : `#/${encodeURIComponent(id)}`);
  const stickyTopValue = `calc(${Number(topOffset) || 0}px + env(safe-area-inset-top, 0px))`;
  const finalSpacer = typeof spacerPx === "number" ? spacerPx : autoSpacer;

  // Если панель ещё не активирована — не рендерим вовсе
  if (!enabled) return null;

  // Текущий индекс (только для выделения активной «таблетки»)
  const curIndex = useMemo(() => {
    const idxById = ids.indexOf(curIdComputed);
    if (idxById >= 0) return idxById;
    if (Number.isInteger(current as number)) return clamp(Number(current), 0, steps.length - 1);
    return 0;
  }, [curIdComputed, ids, current, steps.length]);

  return (
    <div ref={rootRef} style={{ width: "100%" }}>
      {sticky && finalSpacer > 0 && (
        <div aria-hidden style={{ height: finalSpacer }} />
      )}

      <nav
        aria-label="Навигация по шагам"
        style={{
          position: sticky ? "sticky" as const : "static" as const,
          top: sticky ? stickyTopValue : undefined,
          zIndex: sticky ? 1000 : undefined,
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
        <div style={{ textAlign: "center", fontSize: 12, opacity: 0.9, marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}
