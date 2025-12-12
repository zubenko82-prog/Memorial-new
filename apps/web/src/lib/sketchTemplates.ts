// src/lib/sketchTemplates.ts
// Шаблоны компоновки в нормализованных координатах (0..1 по ширине/высоте редактора)

export type NormalizedRect = {
  x: number; // 0..1 (левая граница)
  y: number; // 0..1 (верхняя граница)
  w: number; // 0..1 (ширина)
  h: number; // 0..1 (высота)
  padding?: number; // внутренний отступ в px (для гарантии видимости)
};

export type SlotType =
  | "cross"
  | "photo"
  | "personName"
  | "dates"
  | "epitaph"
  | "decor"
  | "flower";

export interface TemplateSlot {
  type: SlotType;
  // Для множественных элементов (несколько людей, несколько декоров и т.п.)
  index?: number;
  rect: NormalizedRect;
  // Сколько максимально можно увеличивать элемент (1 = не увеличивать сверх его базового размера)
  maxScale?: number;
}

export interface SketchTemplate {
  id: string;
  name: string;
  slots: TemplateSlot[];
}

// Пример: классика — крест сверху слева, фото по центру, ФИО и даты ниже, эпитафия внизу
export const classicSingle: SketchTemplate = {
  id: "classic_single",
  name: "Классический (один усопший)",
  slots: [
    { type: "cross", rect: { x: 0.06, y: 0.05, w: 0.14, h: 0.14, padding: 4 }, maxScale: 1.25 },
    { type: "photo", rect: { x: 0.28, y: 0.18, w: 0.44, h: 0.40, padding: 8 }, maxScale: 1.15 },
    { type: "personName", rect: { x: 0.18, y: 0.62, w: 0.64, h: 0.10, padding: 6 } },
    { type: "dates", rect: { x: 0.26, y: 0.73, w: 0.48, h: 0.07, padding: 6 } },
    { type: "epitaph", rect: { x: 0.12, y: 0.84, w: 0.76, h: 0.10, padding: 8 } }
  ]
};

// Пример: два портрета, крест сверху
export const doublePortrait: SketchTemplate = {
  id: "double_portrait",
  name: "Двойной портрет",
  slots: [
    { type: "cross", rect: { x: 0.06, y: 0.05, w: 0.14, h: 0.14, padding: 4 }, maxScale: 1.25 },
    { type: "photo", index: 0, rect: { x: 0.12, y: 0.22, w: 0.34, h: 0.38, padding: 8 } },
    { type: "photo", index: 1, rect: { x: 0.54, y: 0.22, w: 0.34, h: 0.38, padding: 8 } },
    { type: "personName", index: 0, rect: { x: 0.08, y: 0.62, w: 0.40, h: 0.10, padding: 6 } },
    { type: "personName", index: 1, rect: { x: 0.52, y: 0.62, w: 0.40, h: 0.10, padding: 6 } },
    { type: "dates", index: 0, rect: { x: 0.12, y: 0.73, w: 0.32, h: 0.07, padding: 6 } },
    { type: "dates", index: 1, rect: { x: 0.56, y: 0.73, w: 0.32, h: 0.07, padding: 6 } },
    { type: "epitaph", rect: { x: 0.12, y: 0.84, w: 0.76, h: 0.10, padding: 8 } }
  ]
};

export const SketchTemplates: SketchTemplate[] = [classicSingle, doublePortrait];
