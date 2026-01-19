// src/components/StepNav.tsx
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
  topOffset?: number; // px
  mode?: "sticky" | "fixed"; // NEW: fixed для глобальной навигации

  // Показ
  enabled?: boolean;
  triggerId?: string | string[];
  persistKey?: string | null;

  // CSS var с высотой панели (для внутренних sticky в шагах)
  heightCssVar?: string; // default: --global-stepnav-h
};

const defaultSteps: StepDef[] = [
  { id: "item", title: "Резная работа" },
  { id: "params", title: "Размеры стелы" },
  { id: "persons", title: "Усопшие" },
  { id: "graphics", title: "Графика" },
  { id: "epitaph", title: "Эпитафия" },
  { id: "editor", title: "Редактор" },
  { id: "rear", title: "Тыльная сторона" },
  { id: "review-and-send", title: "Обзор и отправка" },
  { id: "finish", title: "Завершение" }
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
  return null;
}

function normId(id?: string | null): string {
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Важно: в App для review используется StepId="finish"
function isReviewReached(currentId: string, trigger?: string | string[]): boolean {
  const cur = normId(currentId);
  const defaults = ["finish", "review", "review-and-send", "reviewandsend", "reviewandsendstep"];
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
  topOffset = 6,
  mode = "fixed",
  enabled: enabledProp,
  triggerId,
  persistKey = "memorial.navEnabled.reviewOnly",
  heightCssVar = "--global-stepnav-h"
}: StepNavProps) {
  const ids = useMemo(() => steps.map((s) => s.id), [steps]);

  const curIdComputed = useMemo(() => {
    if (currentId || activeId || active) return (currentId || activeId || active)!;
    const fromLoc = detectIdFromLocation(ids);
    if (fromLoc) return fromLoc;
    if (Number.isInteger(current as number)) return steps[clamp(Number(current), 0, steps.length - 1)].id;
    return "";
  }, [current, currentId, activeId, active, ids, steps]);

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return !!enabledProp;
    if (typeof enabledProp === "boolean") return enabledProp;
    try { return (persistKey ? window.localStorage.getItem(persistKey) === "1" : false); } catch { return false; }
  });

  useEffect(() => {
    if (typeof enabledProp === "boolean") return;
    if (!curIdComputed) return;
    if (enabled) return;
    if (isReviewReached(curIdComputed, triggerId)) {
      setEnabled(true);
      if (persistKey) {
        try { window.localStorage.setItem(persistKey, "1"); } catch {}
      }
    }
  }, [curIdComputed, triggerId, enabled, enabledProp, persistKey]);

  useEffect(() => {
    if (typeof enabledProp === "boolean") setEnabled(enabledProp);
  }, [enabledProp]);

  const curIndex = useMemo(() => {
    const idxById = ids.indexOf(curIdComputed);
    if (idxById >= 0) return idxById;
    if (Number.isInteger(current as number)) return clamp(Number(current), 0, steps.length - 1);
    return 0;
  }, [curIdComputed, ids, current, steps.length]);

  const hrefOf = (id: string) => (linkForId ? linkForId(id) : `#/${encodeURIComponent(id)}`);

  const topValue = `calc(${Number(topOffset) || 0}px + env(safe-area-inset-top, 0px))`;

  // измеряем высоту nav -> CSS var (чтобы внутренние sticky могли сдвигаться)
  const navRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    if (!enabled) {
      try { document.documentElement.style.setProperty(heightCssVar, "0px"); } catch {}
      return;
    }

    const el = navRef.current;
    if (!el) return;

    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height || 0);
      try { document.documentElement.style.setProperty(heightCssVar, `${h}px`); } catch {}
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [enabled, steps.length, heightCssVar]);

  const containerStyle: React.CSSProperties =
    mode === "fixed"
      ? {
          position: "fixed",
          top: topValue,
          left: 0,
          right: 0,
          zIndex: 30000,
          display: "grid",
          gap: 6,
          pointerEvents: "none" // не перекрываем клики под собой
        }
      : {
          position: "sticky",
          top: topValue,
          zIndex: 1000,
          display: "grid",
          gap: 6,
          pointerEvents: "none"
        };

  if (!enabled) return null;

  return (
    <div style={containerStyle}>
      <nav
        ref={navRef as any}
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
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.20)",
          width: "100%",
          boxSizing: "border-box",
          pointerEvents: "auto" // кликаем только по самой панели
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
            >
              {s.icon ?? <Icon id={s.id} />}
            </a>
          );
        })}
      </nav>

      {hint && <div style={{ textAlign: "center", fontSize: 12, opacity: 0.9, pointerEvents: "auto" }}>{hint}</div>}
    </div>
  );
}
