// src/wizard/steps.ts
export type StepId =
  | 'item'
  | 'params'
  | 'persons'
  | 'graphics'
  | 'epitaph'
  //| 'editor'
  | 'rear'
  | 'extras'
  | 'finish';

export const STEPS: { id: StepId; title: string }[] = [
  { id: 'item',    title: 'Резная работа' },
  { id: 'params',  title: 'Размеры стелы' },
  { id: 'persons', title: 'Усопшие' },
  { id: 'graphics',title: 'Графика' },
  { id: 'epitaph', title: 'Эпитафия' },
  //{ id: 'editor',  title: 'Редактор' },
  { id: 'rear',    title: 'Тыльная сторона' },
  { id: 'extras',  title: 'Доп. элементы' },
  { id: 'finish',  title: 'Завершение' }
];

export const stepIndexById = Object.fromEntries(
  STEPS.map((s, i) => [s.id, i] as const)
) as Record<StepId, number>;

export const stepIdByIndex = (i: number): StepId => STEPS[Math.max(0, Math.min(STEPS.length - 1, i))].id;
