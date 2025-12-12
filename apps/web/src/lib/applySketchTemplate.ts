// src/lib/applySketchTemplate.ts
// Применение шаблона SketchTemplate: вычисляем x/y/scale для элементов так,
// чтобы они попадали в целевые слоты и оставались полностью видимыми в пределах канваса.

import { SketchTemplate, SlotType } from "./sketchTemplates";

export interface EditorElement {
  id: string;
  type: SlotType | string;
  index?: number; // порядковый номер для множественных элементов типа "photo", "personName", "dates"
  x: number; // px (левая граница)
  y: number; // px (верхняя граница)
  w: number; // px (текущая ширина элемента)
  h: number; // px (текущая высота элемента)
  baseW?: number; // px (базовая/естественная ширина, если есть)
  baseH?: number; // px (базовая/естественная высота)
  scale?: number; // множитель (если редактор его поддерживает)
  rotation?: number;
  [key: string]: any;
}

type Canvas = { width: number; height: number; framePadding?: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pixelRectFromNormalized(
  canvas: Canvas,
  n: { x: number; y: number; w: number; h: number; padding?: number }
) {
  const pad = (n.padding || 0) + (canvas.framePadding || 0);
  const x = Math.round(n.x * canvas.width) + pad;
  const y = Math.round(n.y * canvas.height) + pad;
  const w = Math.round(n.w * canvas.width) - pad * 2;
  const h = Math.round(n.h * canvas.height) - pad * 2;
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.max(0, w), h: Math.max(0, h) };
}

function fitIn(targetW: number, targetH: number, contentW: number, contentH: number, maxScale = Infinity) {
  if (contentW <= 0 || contentH <= 0) return { scale: 1, outW: 0, outH: 0 };
  const s = Math.min(targetW / contentW, targetH / contentH, maxScale);
  return { scale: s, outW: Math.floor(contentW * s), outH: Math.floor(contentH * s) };
}

function clampIntoCanvas(canvas: Canvas, x: number, y: number, w: number, h: number) {
  const maxX = canvas.width - w;
  const maxY = canvas.height - h;
  return {
    x: clamp(x, 0, Math.max(0, maxX)),
    y: clamp(y, 0, Math.max(0, maxY))
  };
}

function pickElement(
  elements: EditorElement[],
  type: string,
  index?: number
): EditorElement | undefined {
  const candidates = elements.filter(e => e.type === type);
  if (!candidates.length) return undefined;
  if (typeof index === "number") {
    const sorted = [...candidates].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted[index] ?? sorted[sorted.length - 1];
  }
  return candidates[0];
}

/**
 * Основная функция автокомпоновки.
 * Возвращает новый массив элементов с x/y/scale, рассчитанных под слоты шаблона.
 * canvas.width/height — размеры рабочей области в пикселях (без внешних рамок).
 * canvas.framePadding — если внутри есть рамка, вычитаем её.
 */
export function applySketchTemplate(
  elements: EditorElement[],
  template: SketchTemplate,
  canvas: Canvas
): EditorElement[] {
  const next = elements.map(e => ({ ...e }));

  template.slots.forEach(slot => {
    const el = pickElement(next, slot.type, slot.index);
    if (!el) return;

    const target = pixelRectFromNormalized(canvas, slot.rect);
    const baseW = el.baseW || el.w;
    const baseH = el.baseH || el.h;

    const { scale, outW, outH } = fitIn(target.w, target.h, baseW, baseH, slot.maxScale ?? Infinity);

    // Центрирование в слоте
    let newX = target.x + Math.round((target.w - outW) / 2);
    let newY = target.y + Math.round((target.h - outH) / 2);

    // Гарантируем, что элемент не выходит за границы канваса
    const clamped = clampIntoCanvas(canvas, newX, newY, outW, outH);
    newX = clamped.x;
    newY = clamped.y;

    el.scale = scale;
    el.w = outW;
    el.h = outH;
    el.x = newX;
    el.y = newY;
  });

  return next;
}
