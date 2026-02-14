// src/screens/SizeStep.tsx
// Автоориентация (исправлено: переопределяется при каждом выборе другой работы):
// 1) При КАЖДОЙ смене item (id/url) сбрасываем состояние ориентации и снова пытаемся определить по изображению.
// 2) Если не удалось (ошибка/таймаут) — берём по выбранным размерам (Ш×В).
// 3) Сохраняем в драфт только после того, как ориентация реально определена.
// 4) Если после определения источник = "size", то при изменении размеров ориентир обновляется динамически.
// 5) Начальное значение берём из драфта, но оно будет переопределено при загрузке новой картинки.

import React, { useMemo, useState, useEffect, useRef } from "react";
import type { CatalogItem } from "../api";
import TopBarWithIntro from "../components/TopBarWithIntro";
import { loadOrderDraft, saveOrderDraft } from "../lib/order";

const PRESET_SIZES = ["60×40", "80×40", "100×50", "100×60", "120×50", "120×60"] as const; // см (Ш×В)
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

// Визуальное отделение радио-групп (и "Стандартный", и "Стандартная")
function radioGroupBoxStyle(): React.CSSProperties {
  return {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.04)"
  };
}

const optionWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 10 };
const optionLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  marginRight: 4
};
const optionGrid2Style: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, max-content)",
  gap: "10px 14px",
  alignItems: "center"
};

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
  if (
    typeof widthCm === "number" &&
    typeof heightCm === "number" &&
    isFinite(widthCm) &&
    isFinite(heightCm) &&
    widthCm > 0 &&
    heightCm > 0
  ) {
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

  const draftOrientation =
    (draft.size?.orientation as Orientation | undefined) || (draft.orientation as Orientation | undefined) || "vertical";

  const draftPreset = findPresetFor(draftWcm, draftHcm);

  // По умолчанию: Стандартный + 100×50, но если в драфте были "свои" размеры — открываем custom
  const [sizeMode, setSizeMode] = useState<SizeMode>(() => {
    if (draftWcm && draftHcm) return draftPreset ? "preset" : "custom";
    return "preset";
  });
  const [sizePreset, setSizePreset] = useState<(typeof PRESET_SIZES)[number]>(() => draftPreset || "100×50");

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

  // Состояние ориентации: из драфта как старт, далее будет переопределено после загрузки новой картинки
  const [orientation, setOrientation] = useState<Orientation>(draftOrientation);
  const [orientationSource, setOrientationSource] = useState<"image" | "size" | "default">("default");
  const [orientationReady, setOrientationReady] = useState<boolean>(false);

  // Флаги детекта
  const detectionDoneRef = useRef<boolean>(false);
  const detectingRef = useRef<boolean>(false);

  const currentWHcm = useMemo((): [number | undefined, number | undefined] => {
    if (sizeMode === "preset") {
      const [wcm, hcm] = parsePresetWHcm(sizePreset);
      return [wcm, hcm];
    }
    const wcm = Number(w);
    const hcm = Number(h);
    return [Number.isFinite(wcm) && wcm > 0 ? wcm : undefined, Number.isFinite(hcm) && hcm > 0 ? hcm : undefined];
  }, [sizeMode, sizePreset, w, h]);

  function persistDraft(currentOrientation: Orientation) {
    // вычислим см из UI
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
    const wmm = toMm(widthCm),
      hmm = toMm(heightCm),
      tmm = toMm(thickCm);
    if (typeof wmm === "number") sizePatch.width = wmm;
    if (typeof hmm === "number") sizePatch.height = hmm;
    if (typeof tmm === "number") sizePatch.thickness = tmm;

    saveOrderDraft({ size: sizePatch, orientation: currentOrientation });
  }

  // Переопределяем ориентацию КАЖДЫЙ раз при смене резной работы (id/url)
  useEffect(() => {
    const url = item?.url;
    const id = (item as any)?.id || "";

    // Сброс состояния детекта
    detectionDoneRef.current = false;
    detectingRef.current = false;
    setOrientationReady(false);
    setOrientationSource("default");

    // Быстрый предварительный ориентир по размерам (визуально до загрузки)
    const [wcm, hcm] = currentWHcm;
    const initialBySize = orientFromSize(wcm, hcm);
    setOrientation(initialBySize);

    let cancelled = false;
    let timer: number | undefined;
    detectingRef.current = true;

    const fallbackToSize = () => {
      if (cancelled || detectionDoneRef.current) return;
      const [cw, ch] = currentWHcm;
      const next = orientFromSize(cw, ch);
      detectionDoneRef.current = true;
      detectingRef.current = false;
      setOrientation(next);
      setOrientationSource("size");
      setOrientationReady(true);
      persistDraft(next);
    };

    if (!url) {
      fallbackToSize();
      return () => {};
    }

    // Таймаут ожидания загрузки картинки
    timer = window.setTimeout(() => {
      if (cancelled) return;
      fallbackToSize();
    }, 1500);

    // Детект по изображению — добавляем «бастёр» к URL, чтобы гарантировать срабатывание onload при смене работы
    try {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled || detectionDoneRef.current) return;
        if (timer) window.clearTimeout(timer);
        const next: Orientation = img.naturalWidth > img.naturalHeight ? "horizontal" : "vertical";
        detectionDoneRef.current = true;
        detectingRef.current = false;
        setOrientation(next);
        setOrientationSource("image");
        setOrientationReady(true);
        persistDraft(next);
      };
      img.onerror = () => {
        if (cancelled || detectionDoneRef.current) return;
        if (timer) window.clearTimeout(timer);
        fallbackToSize();
      };
      const sig = encodeURIComponent(`${id}|${url}`);
      const bust = url.includes("?") ? `${url}&__o=${sig}` : `${url}?__o=${sig}`;
      img.src = bust;
    } catch {
      if (!cancelled) {
        if (timer) window.clearTimeout(timer);
        fallbackToSize();
      }
    }

    return () => {
      cancelled = true;
      detectingRef.current = false;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.url]);

  // Если источник ориентации = "size" — поддерживаем актуальность при изменении размеров
  useEffect(() => {
    if (!detectionDoneRef.current) return; // детект ещё идёт
    if (orientationSource !== "size") return; // если по картинке — размеры не влияют
    const [wcm, hcm] = currentWHcm;
    const next = orientFromSize(wcm, hcm);
    if (next !== orientation) {
      setOrientation(next);
      setOrientationReady(true);
      persistDraft(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeMode, sizePreset, w, h, orientationSource]);

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

  // Страхующий авто-сейв: когда ориентация определена — фиксируем текущие параметры
  useEffect(() => {
    if (!orientationReady) return;

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
    const wmm = cmToMm(widthCm),
      hmm = cmToMm(heightCm),
      tmm = cmToMm(thickCm);
    if (typeof wmm === "number") sizePatch.width = wmm;
    if (typeof hmm === "number") sizePatch.height = hmm;
    if (typeof tmm === "number") sizePatch.thickness = tmm;

    saveOrderDraft({ size: sizePatch, orientation });
  }, [sizeMode, sizePreset, w, h, thickMode, thickPreset, thickCustom, orientation, orientationReady]);

  const handleContinue = () => {
    // если по какой-то причине детект ещё не завершён — зафиксируем по размеру
    if (!orientationReady) {
      const [wcm, hcm] = currentWHcm;
      const next = orientFromSize(wcm, hcm);
      persistDraft(next);
    }
    const fn = typeof onDone === "function" ? onDone : typeof onConfirm === "function" ? onConfirm : undefined;
    if (fn) fn(payload);
    else console.error("SizeStep: ни onDone, ни onConfirm не переданы в props");
  };

  return (
    <div
      style={{
        color: "#fff",
        maxWidth: 600,
        margin: "0 auto",
        fontFamily:
          "var(--font-readable, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Helvetica Neue', sans-serif)",
        animation: "fade-slide-in-slow 480ms ease both",
        padding: 16
      }}
    >
      <TopBarWithIntro title="Размер" />

      <h2 style={{ margin: "8px 0 8px 0", textAlign: "center" }}>Параметры стелы</h2>
      <div style={{ marginBottom: 8, opacity: 0.9, textAlign: "center" }}>Выберите размер и толщину памятника.</div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        {/* Размер */}
        <div style={{ ...glassPanelStyle(), padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Размер</div>

          <div style={{ display: "grid", gap: 12 }}>
            {/* Стандартный — визуально отделён */}
            <div style={radioGroupBoxStyle()}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="sizeMode"
                  checked={sizeMode === "preset"}
                  onChange={() => setSizeMode("preset")}
                />
                <span>Стандартный</span>
              </label>

              {sizeMode === "preset" && (
                <div style={{ marginTop: 8, ...optionGrid2Style }}>
                  {PRESET_SIZES.map((s) => (
                    <label key={s} style={optionLabelStyle}>
                      <input
                        type="radio"
                        name="sizePreset"
                        checked={sizePreset === s}
                        onChange={() => setSizePreset(s)}
                      />
                      <span>{s} см</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Свой вариант — как было (без общей рамки вокруг радио) */}
            <div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="sizeMode"
                  checked={sizeMode === "custom"}
                  onChange={() => setSizeMode("custom")}
                />
                <span>Свой вариант</span>
              </label>

              {sizeMode === "custom" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span>Ширина, см</span>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={w}
                      onChange={(e) => setW(e.target.value)}
                      style={{ width: 90 }}
                    />
                  </label>

                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span>Высота, см</span>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={h}
                      onChange={(e) => setH(e.target.value)}
                      style={{ width: 90 }}
                    />
                  </label>

                  {!sizeValid && (
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

          <div style={{ display: "grid", gap: 12 }}>
            {/* Стандартная — визуально отделена */}
            <div style={radioGroupBoxStyle()}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="thickMode"
                  checked={thickMode === "preset"}
                  onChange={() => setThickMode("preset")}
                />
                <span>Стандартная</span>
              </label>

              {thickMode === "preset" && (
                <div style={{ marginTop: 8, ...optionWrapStyle }}>
                  {PRESET_THICKNESS.map((t) => (
                    <label key={t} style={optionLabelStyle}>
                      <input
                        type="radio"
                        name="thickPreset"
                        checked={thickPreset === t}
                        onChange={() => setThickPreset(t)}
                      />
                      <span>{t} см</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Свой вариант — как было */}
            <div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="thickMode"
                  checked={thickMode === "custom"}
                  onChange={() => setThickMode("custom")}
                />
                <span>Свой вариант</span>
              </label>

              {thickMode === "custom" && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span>Толщина, см</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={thickCustom}
                      onChange={(e) => setThickCustom(e.target.value)}
                      style={{ width: 90 }}
                    />
                  </label>

                  {!thickValid && (
                    <div style={{ color: "salmon", fontSize: 12 }}>Укажите положительное значение до 50 см.</div>
                  )}
                </div>
              )}
            </div>
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
                style={{
                  width: "100%",
                  maxWidth: 640,
                  maxHeight: "55vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  display: "block"
                }}
              />
            </div>

            <div
              style={{
                fontWeight: 600,
                fontSize: 18,
                textAlign: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
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
