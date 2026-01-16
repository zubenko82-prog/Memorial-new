// src/lib/order.ts

export type OrderDraft = {
  item?: { name?: string; url?: string; relPath?: string | null } | null;
  size?: any;
  engraving?: {
    persons?: Array<{
      id: string;
      lastName?: string;
      firstName?: string;
      middleName?: string;
      birthDate?: string;
      deathDate?: string;
      photoPreview?: string | null;
    }>;
    epitaphs?: string[];
    epitaphText?: string;
  } | null;
  graphics?: any[];   // выбранная графика (фронт/общая)
  editorBack?: any;   // данные тыльной стороны
  updatedAt?: number;
  // + любые другие поля драфта
};

const STORAGE_KEY = "memorial.orderDraft.v1";
export const DRAFT_UPDATED_EVENT = "memorial:orderDraftUpdated";

// Специальная метка «стереть поле» при мердже (если нужно убрать конкретный ключ)
export const CLEAR = Symbol("memorial:clear");

export function loadOrderDraft(): OrderDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

// Глубокий мердж объектов.
// - Массивы заменяем целиком.
// - undefined в patch пропускаем.
// - null в patch по умолчанию ТАКЖЕ пропускаем (чтобы другие шаги случайно не «затирали» разделы null'ом).
//   Если нужно очистить ключ намеренно — используйте значение CLEAR.
function deepMerge<T extends Record<string, any>>(base: T | undefined, patch: Partial<T> | undefined): T {
  if (!base) base = {} as T;
  if (!patch) return base as T;

  const out: any = Array.isArray(base) ? base.slice() : { ...base };

  for (const k of Object.keys(patch)) {
    const pv: any = (patch as any)[k];
    const bv: any = (base as any)[k];

    if (pv === undefined) continue;

    if (pv === CLEAR) {
      // Явное удаление ключа
      if (Array.isArray(out)) {
        // для массивов удалить по индексу нельзя — пропускаем
      } else {
        delete out[k];
      }
      continue;
    }

    // По умолчанию игнорируем null в patch (не стираем существующие данные).
    if (pv === null) {
      // хотим игнорировать null — просто оставим исходное значение
      // если ключа не было — не добавляем
      continue;
    }

    if (
      pv &&
      typeof pv === "object" &&
      !Array.isArray(pv) &&
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      out[k] = deepMerge(bv, pv);
    } else {
      // массивы, примитивы — замена
      out[k] = pv;
    }
  }

  return out as T;
}

// Единая точка записи: безопасный мердж с существующим драфтом + updatedAt + событие
export function saveOrderDraft(patch: Partial<OrderDraft>): OrderDraft {
  if (typeof window === "undefined") return { ...(patch || {}), updatedAt: Date.now() };

  const prev = loadOrderDraft();
  const merged = deepMerge(prev, patch) as OrderDraft;
  const next: OrderDraft = { ...merged, updatedAt: Date.now() };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/blocked
  }

  try {
    // Уведомляем все подписчики (TopBar, шаги, другие вкладки)
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("storage")); // некоторые окружения слушают общий storage
  } catch {
    // ignore
  }

  return next;
}

// Явная очистка всего драфта
export function clearOrderDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("storage"));
  } catch {
    // ignore
  }
}
