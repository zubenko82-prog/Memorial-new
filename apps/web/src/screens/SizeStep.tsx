// src/screens/SizeStep.tsx
// Автоориентация:
// 1) По изображению (naturalWidth/Height) с таймаутом.
// 2) Если не удалось — по выбранным размерам (Ш×В).
// 3) Сохраняется в драфт и отображается на экране.

import React, { useMemo, useState, useEffect } from "react";
import type { CatalogItem } from "../api";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft } from "../lib/order";

const PRESET_SIZES = ["40×60", "40×80", "50×100", "60×120"] as const; // см (Ш×В)
const PRESET_THICKNESS = ["5", "8", "10"] as const; // см

type SizeMode = "preset" | "custom";
type ThickMode = "preset" | "custom";
export type Orientation = "vertical" | "horizontal";
export type SizeStepResult = { size: string; thickness: string; orientation: Orientation };

function useAnimationsOnce(): void {
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      @keyframes fade-slide-in-slow {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);
}

type BtnSize = "nano" | "sm" | "md";
function glassButtonStyle(size: BtnSize = "sm", disabled = false): React.CSSProperties {
  const paddings: Record<BtnSize, string> = { nano: "4px 8px", sm: "8px 12px", md: "12px 18px" };
  return {
    padding: paddings[size],
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.28)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.12)",
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    opacity: disabled ? 0.6 : 1,
    transition: "transform 420ms ease, opacity 420ms ease, box-shadow 420ms ease",
    willChange: "transform"
  };
}
function glassPanelStyle(): React.CSSProperties {
  return {
    background: "rgba(20,20,24,0.55)",
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(12px) saturate(140%)",
    WebkitBackdropFilter: "blur(12px) saturate(140%)",
    borderRadius: 12
  };
}

const optionWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };
const optionLabelStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", marginRight: 4 };

function parsePresetWHcm(s: string): [number, number] {
  const parts = String(s).split(/[×xX]/);
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  return [w, h];
}
function mmToCm(mm?: number | null): number | undefined {
  if (typeof mm !== "number" || !isFinite(mm)) return undefined;
  return mm / 10;
}
function cmToMm(cm?: number): number | undefined {
  if (typeof cm !== "number" || !isFinite(cm)) return undefined;
  return Math.round(cm * 10);
}
function findPresetFor(widthCm?: number, heightCm?: number): (typeof PRESET_SIZES)[number] | undefined {
  if (typeof widthCm !== "number" || typeof heightCm !== "number") return undefined;
  const cand = `${widthCm}×${heightCm}`;
  return (PRESET_SIZES as readonly string[]).includes(cand as any) ? (cand as any) : undefined;
}
function orientFromSize(widthCm?: number, heightCm?: number): Orientation {
  if (typeof widthCm === "number" && typeof heightCm === "number" && isFinite(widthCm) && isFinite(heightCm) && widthCm > 0 && heightCm > 0) {
    return widthCm > heightCm ? "horizontal" : "vertical";
  }
  return "vertical";
}

interface SizeStepProps {
  item: CatalogItem;
  onBack?: () => void;
  onDone?: (data: SizeStepResult) => void;
  onConfirm?: (data: SizeStepResult) => void;
}

export default function SizeStep(props: SizeStepProps) {
  const { item, onBack = () => {}, onDone, onConfirm } = props;

  useAnimationsOnce();

  const draft = loadOrderDraft();
  const draftWcm = mmToCm(draft.size?.width);
  const draftHcm = mmToCm(draft.size?.height);
  const draftTcm = mmToCm(draft.size?.thickness);
  const draftOrientation = (draft.size?.orientation as Orientation | undefined) || (draft.orientation as Orientation | undefined) || "vertical";

  const draftPreset = findPresetFor(draftWcm, draftHcm);

  const [sizeMode, setSizeMode] = useState<SizeMode>(() => (draftWcm && draftHcm ? (draftPreset ? "preset" : "custom") : "preset"));
  const [sizePreset, setSizePreset] = useState<(typeof PRESET_SIZES)[number]>(() => draftPreset || "50×100");
  const [w, setW] = useState<string>(() => (draftWcm ? String(draftWcm) : "50"));
  const [h, setH] = useState<string>(() => (draftHcm ? String(draftHcm) : "100"));

  const [thickMode, setThickMode] = useState<ThickMode>(() => {
    if (typeof draftTcm === "number") {
      const s = String(draftTcm);
      return (PRESET_THICKNESS as readonly string[]).includes(s) ? "preset" : "custom";
    }
    return "preset";
  });
  const [thickPreset, setThickPreset] = useState<(typeof PRESET_THICKNESS)[number]>(() => {
    if (typeof draftTcm === "number") {
      const s = String(draftTcm);
      return (PRESET_THICKNESS as readonly string[]).includes(s) ? (s as any) : "8";
    }
    return "8";
  });
  const [thickCustom, setThickCustom] = useState<string>(() => (typeof draftTcm === "number" ? String(draftTcm) : "8"));

  const [orientation, setOrientation] = useState<Orientation>(draftOrientation);
  const [orientationSource, setOrientationSource] = useState<"image" | "size" | "default">(draftOrientation ? "default" : "default");

  const currentWHcm = useMemo((): [number | undefined, number | undefined] => {
    if (sizeMode === "preset") {
      const [wcm, hcm] = parsePresetWHcm(sizePreset);
      return [wcm, hcm];
    }
    const wcm = Number(w);
    const hcm = Number(h);
    return [
      Number.isFinite(wcm) && wcm > 0 ? wcm : undefined,
      Number.isFinite(hcm) && hcm > 0 ? hcm : undefined
    ];
  }, [sizeMode, sizePreset, w, h]);

  function persistDraft(currentOrientation: Orientation) {
    let widthCm: number | undefined;
    let heightCm: number | undefined;

    if (sizeMode === "preset") {
      const [wcm, hcm] = parsePresetWHcm(sizePreset);
      widthCm = wcm;
      heightCm = hcm;
    } else {
      const wcm = Number(w);
      const hcm = Number(h);
      if (Number.isFinite(wcm) && wcm > 0) widthCm = wcm;
      if (Number.isFinite(hcm) && hcm > 0) heightCm = hcm;
    }

    let thickCm: number | undefined;
    if (thickMode === "preset") {
      const t = Number(thickPreset);
      if (Number.isFinite(t) && t > 0) thickCm = t;
    } else {
      const t = Number(thickCustom);
      if (Number.isFinite(t) && t > 0) thickCm = t;
    }

    const toMm = (cm?: number) => (typeof cm === "number" ? Math.round(cm * 10) : undefined);
    const sizePatch: any = { orientation: currentOrientation };
    const wmm = toMm(widthCm);
    const hmm = toMm(heightCm);
    const tmm = toMm(thickCm);
    if (typeof wmm === "number") sizePatch.width = wmm;
    if (typeof hmm === "number") sizePatch.height = hmm;
    if (typeof tmm === "number") sizePatch.thickness = tmm;

    saveOrderDraft({ size: sizePatch, orientation: currentOrientation });
  }

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function detect() {
      const url = item?.url;
      const [wcm, hcm] = currentWHcm;

      if (!url) {
        const next = orientFromSize(wcm, hcm);
        console.log("[SizeStep] No image URL, fallback to size:", { wcm, hcm, next });
        if (!cancelled) {
          setOrientation(next);
          setOrientationSource("size");
          persistDraft(next);
        }
        return;
      }

      timer = window.setTimeout(() => {
        if (cancelled) return;
        const next = orientFromSize(wcm, hcm);
        console.warn("[SizeStep] Image load timeout, fallback to size:", { url, wcm, hcm, next });
        setOrientation(next);
        setOrientationSource("size");
        persistDraft(next);
      }, 1500);

      try {
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          if (timer) window.clearTimeout(timer);
          const next: Orientation = img.naturalWidth > img.naturalHeight ? "horizontal" : "vertical";
          console.log("[SizeStep] Image loaded:", { url, w: img.naturalWidth, h: img.naturalHeight, next });
          setOrientation(next);
          setOrientationSource("image");
          persistDraft(next);
        };
        img.onerror = () => {
          if (cancelled) return;
          if (timer) window.clearTimeout(timer);
          const next = orientFromSize(wcm, hcm);
          console.warn("[SizeStep] Image error, fallback to size:", { url, wcm, hcm, next });
          setOrientation(next);
          setOrientationSource("size");
          persistDraft(next);
        };
        img.src = url;
      } catch (e) {
        if (cancelled) return;
        if (timer) window.clearTimeout(timer);
        const next = orientFromSize(wcm, hcm);
        console.warn("[SizeStep] Exception on image load, fallback to size:", e);
        setOrientation(next);
        setOrientationSource("size");
        persistDraft(next);
      }
    }

    detect();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [item?.url, currentWHcm[0], currentWHcm[1]]);

  useEffect(() => {
    if (orientationSource === "image") return;
    const [wcm, hcm] = currentWHcm;
    const next = orientFromSize(wcm, hcm);
    setOrientation(next);
    if (orientationSource !== "image") setOrientationSource("size");
    persistDraft(next);
  }, [orientationSource, currentWHcm[0], currentWHcm[1]]);

  const sizeValid = useMemo(() => {
    if (sizeMode === "preset") return true;
    const wn = Number(w);
    const hn = Number(h);
    return Number.isFinite(wn) && Number.isFinite(hn) && wn > 0 && hn > 0 && wn <= 300 && hn <= 300;
  }, [sizeMode, w, h]);
  const thickValid = useMemo(() => {
    if (thickMode === "preset") return true;
    const tn = Number(thickCustom);
    return Number.isFinite(tn) && tn > 0 && tn <= 50;
  }, [thickMode, thickCustom]);
  const canContinue = sizeValid && thickValid;

  const finalSize = sizeMode === "preset" ? sizePreset : `${Number(w)}×${Number(h)}`;
  const finalThick = thickMode === "preset" ? thickPreset : `${Number(thickCustom)}`;
  const payload: SizeStepResult = { size: finalSize, thickness: finalThick, orientation };

  useEffect(() => {
    let widthCm: number | undefined;
    let heightCm: number | undefined;

    if (sizeMode === "preset") {
      const [wcm, hcm] = parsePresetWHcm(sizePreset);
      widthCm = wcm;
      heightCm = hcm;
    } else {
      const wcm = Number(w);
      const hcm = Number(h);
      if (Number.isFinite(wcm) && wcm > 0) widthCm = wcm;
      if (Number.isFinite(hcm) && hcm > 0) heightCm = hcm;
    }

    let thickCm: number | undefined;
    if (thickMode === "preset") {
      const t = Number(thickPreset);
      if (Number.isFinite(t) && t > 0) thickCm = t;
    } else {
      const t = Number(thickCustom);
      if (Number.isFinite(t) && t > 0) thickCm = t;
    }

    const sizePatch: any = { orientation };
    const wmm = cmToMm(widthCm);
    const hmm = cmToMm(heightCm);
    const tmm = cmToMm(thickCm);
    if (typeof wmm === "number") sizePatch.width = wmm;
    if (typeof hmm === "number") sizePatch.height = hmm;
    if (typeof tmm === "number") sizePatch.thickness = tmm;

    saveOrderDraft({
      size: sizePatch,
      orientation
    });
  }, [sizeMode, sizePreset, w, h, thickMode, thickPreset, thickCustom, orientation]);

  const handleContinue = () => {
    persistDraft(orientation);
    const fn = (typeof onDone === "function" ? onDone : typeof onConfirm === "function" ? onConfirm : undefined);
    if (fn) fn(payload);
    else console.error("SizeStep: ни onDone, ни onConfirm не переданы в props");
  };

  return (
    <div
      style={{
        color: "#fff",
        maxWidth: 600,
        margin: "0 auto",
        fontFamily: "var(--font-readable, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Helvetica Neue', sans-serif)",
        animation: "fade-slide-in-slow 480ms ease both",
        padding: 16
      }}
    >
      <TopBarWithIntro title="Memorial - стела" />

      <h2 style={{ margin: "8px 0 8px 0", textAlign: "center" }}>Параметры стелы</h2>
      <div style={{ marginBottom: 8, opacity: 0.9, textAlign: "center" }}>
        Ориентация: <b>{orientation === "horizontal" ? "горизонтальная" : "вертикальная"}</b> {orientationSource === "image" ? "(по изображению)" : "(по размеру)"}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        {/* Размер */}
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Размер</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="radio" name="sizeMode" checked={sizeMode === "preset"} onChange={() => setSizeMode("preset")} />
                <span>Стандартный</span>
              </label>
              {sizeMode === "preset" && (
                <div style={{ marginTop: 6, ...optionWrapStyle }}>
                  {PRESET_SIZES.map((s) => (
                    <label key={s} style={optionLabelStyle}>
                      <input type="radio" name="sizePreset" checked={sizePreset === s} onChange={() => setSizePreset(s)} />
                      <span>{s} см</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="radio" name="sizeMode" checked={sizeMode === "custom"} onChange={() => setSizeMode("custom")} />
                <span>Свой вариант</span>
              </label>

              {sizeMode === "custom" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span>Ширина, см</span>
                    <input type="number" min={1} max={300} value={w} onChange={(e) => setW(e.target.value)} style={{ width: 90 }} />
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span>Высота, см</span>
                    <input type="number" min={1} max={300} value={h} onChange={(e) => setH(e.target.value)} style={{ width: 90 }} />
                  </label>
                  {!(Number.isFinite(Number(w)) && Number.isFinite(Number(h)) && Number(w) > 0 && Number(h) > 0) && (
                    <div style={{ color: "salmon", fontSize: 12 }}>Укажите положительные значения до 300 см.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Толщина */}
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Толщина</div>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="thickMode" checked={thickMode === "preset"} onChange={() => setThickMode("preset")} />
              <span>Стандартная</span>
            </label>
            {thickMode === "preset" && (
              <div style={optionWrapStyle}>
                {PRESET_THICKNESS.map((t) => (
                  <label key={t} style={optionLabelStyle}>
                    <input type="radio" name="thickPreset" checked={thickPreset === t} onChange={() => setThickPreset(t)} />
                    <span>{t} см</span>
                  </label>
                ))}
              </div>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="thickMode" checked={thickMode === "custom"} onChange={() => setThickMode("custom")} />
              <span>Свой вариант</span>
            </label>
            {thickMode === "custom" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span>Толщина, см</span>
                  <input type="number" min={1} max={50} value={thickCustom} onChange={(e) => setThickCustom(e.target.value)} style={{ width: 90 }} />
                </label>
                {!(Number.isFinite(Number(thickCustom)) && Number(thickCustom) > 0 && Number(thickCustom) <= 50) && (
                  <div style={{ color: "salmon", fontSize: 12 }}>Укажите положительное значение до 50 см.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Выбранная работа (превью) */}
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ marginBottom: 6, opacity: 0.9 }}>Выбранная резная работа</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                backgroundColor: "#000000",
                backgroundImage:
                  "linear-gradient(to bottom, #6e6e6eff 0%, #464545ff 20%, #424242ff 40%, #888888 70%, #ffffff 100%)",
                borderRadius: 10,
                padding: 12,
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <img
                src={item.url}
                alt={item.name}
                style={{ width: "100%", maxWidth: 640, maxHeight: "55vh", objectFit: "contain", borderRadius: 8, display: "block" }}
              />
            </div>
            <div
              style={{ fontWeight: 600, fontSize: 18, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={item.name}
            >
              {item.name}
            </div>
          </div>
        </div>

        {/* Действия */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={onBack}
            style={glassButtonStyle("sm")}
            onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
            onPointerUp={(e) => (e.currentTarget.style.transform = "")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
          >
            Назад
          </button>
          <button
            disabled={!canContinue}
            onClick={handleContinue}
            style={glassButtonStyle("sm", !canContinue)}
            onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
            onPointerUp={(e) => (e.currentTarget.style.transform = "")}
            onPointerLeave={(e) => (e.currentTarget.style.transform = "")}
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
