// src/lib/order.ts
// Единый стор заказа (draft) в localStorage + оригинал фото в IndexedDB.
//
// ВАЖНО (анти-OOM):
// - localStorage может переполняться из-за base64 (previewUrl/previewHiUrl и т.п.).
// - JSON.parse огромной строки может убить вкладку (Out of Memory) ещё ДО рендера.
// Поэтому loadOrderDraft() теперь:
//   1) проверяет размер raw и при превышении лимита сбрасывает драфт (removeItem)
//   2) дополнительно "подрезает" большие preview-поля уже после parse
//
// saveOrderDraft() также защищён: если JSON.stringify слишком большой и setItem падает,
// мы пытаемся удалить тяжёлые preview-поля и сохранить облегчённый вариант.

import { idbPutBlob, idbGetBlob, idbDel } from "./idb";

export type Orientation = "vertical" | "horizontal";

export type OrderItem = {
  id?: string;
  name?: string;
  url?: string;
  relPath?: string;
};

export type OrderSize = {
  width?: number; // мм
  height?: number; // мм
  thickness?: number; // мм
  orientation?: Orientation; // вертикально/горизонтально
  notes?: string;
};

export type Person = {
  id?: string;
  lastName?: string;
  firstName?: string;
  middleName?: string;
  birthDate?: string;
  deathDate?: string;
  lines?: string[];
  photoPreview?: string | null;
};

export type EngravingData = {
  persons?: Person[];
  epitaphs?: string[];
  epitaphText?: string; // если одна строка
  lines?: string[]; // legacy
  photoPreview?: string | null;
  photoFileName?: string | null;
  photoMime?: string | null;
  photoOriginalKey?: string | null;
};

export type Graphic = {
  id: string;
  name: string;
  url: string;
  preview?: string;
  catName?: string;
  catSlug?: string;
  subCatName?: string;
  subCatSlug?: string;
};

export type OrderDraft = {
  orderNumber?: string | null;
  intro?: {
    customerName?: string;
    customerPhone?: string;
    customerNotes?: string;
  } | null;
  item?: OrderItem | null;
  size?: OrderSize | null;
  engraving?: EngravingData | null;
  graphics?: Graphic[];
  notes?: string;
  orientation?: Orientation; // legacy-дубль для совместимости
  updatedAt?: number;

  // extras у вас используются в проекте, но типом не описаны — оставляем совместимость
  extras?: any;
  editor?: any;
  editorBack?: any;
};

export const LS_ORDER_DRAFT_KEY = "memorial.order.draft.v1";
export const DRAFT_UPDATED_EVENT = "memorial:orderDraftUpdated";

/* ==================== Helpers ==================== */

function emitDraftUpdated() {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    }
  } catch {}
}

function now() {
  return Date.now();
}

/* ==================== Deep merge with delete ==================== */

/**
 * Маркер удаления поля.
 * Можно использовать del() или просто null в patch.
 */
export const __delete__ = Symbol("order.delete");

/** Удобный helper: del() */
export function del() {
  return __delete__ as any;
}

/**
 * Правила:
 * - undefined: игнорируем (не трогаем поле)
 * - null: удаляем поле (delete)
 * - __delete__: удаляем поле (delete)
 * - object (не массив): рекурсивно мержим
 * - массив/примитив: заменяем целиком
 */
function deepMergeWithDelete<T>(target: T, source: Partial<T>): T {
  if (source == null) return target as any;

  const out: any = Array.isArray(target) ? [...(target as any)] : { ...(target as any) };

  for (const [k, v] of Object.entries(source as any)) {
    if (v === undefined) continue;

    if (v === null) {
      delete out[k];
      continue;
    }

    if ((v as any) === __delete__) {
      delete out[k];
      continue;
    }

    if (typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMergeWithDelete(out[k] ?? {}, v as any);
    } else {
      out[k] = v;
    }
  }

  return out;
}

/* ==================== Draft sanitizing (anti-OOM) ==================== */

// Максимальный размер JSON строки драфта (символов) до того, как мы перестаём его парсить.
// 2_000_000 символов ~ 2MB текста; base64-превью легко делает 5-20MB.
const MAX_DRAFT_RAW_CHARS = 2_000_000;

// Максимальная длина одного preview-поля (base64) в символах.
// Всё что больше — считаем опасным, режем в null.
const MAX_PREVIEW_CHARS = 250_000;

function clampBigStringToNull(v: any, maxChars = MAX_PREVIEW_CHARS) {
  return typeof v === "string" && v.length > maxChars ? null : v;
}

function sanitizeDraftPreviews(d: OrderDraft): OrderDraft {
  try {
    const out: any = { ...d };

    // editorBack previews
    if (out.editorBack && typeof out.editorBack === "object") {
      out.editorBack = { ...out.editorBack };
      out.editorBack.previewUrl = clampBigStringToNull(out.editorBack.previewUrl);
      out.editorBack.previewHiUrl = clampBigStringToNull(out.editorBack.previewHiUrl);
    }

    // extras previews
    if (out.extras && typeof out.extras === "object") {
      out.extras = { ...out.extras };
      out.extras.platePreviewUrl = clampBigStringToNull(out.extras.platePreviewUrl);
      out.extras.platePreviewHiUrl = clampBigStringToNull(out.extras.platePreviewHiUrl);
    }

    // engraving photo preview (тоже бывает большой)
    if (out.engraving && typeof out.engraving === "object") {
      out.engraving = { ...out.engraving };
      out.engraving.photoPreview = clampBigStringToNull(out.engraving.photoPreview, 350_000);
    }

    return out as OrderDraft;
  } catch {
    return d;
  }
}

function dropAllHeavyPreviews(d: OrderDraft): OrderDraft {
  const out: any = { ...d };

  if (out.editorBack && typeof out.editorBack === "object") {
    out.editorBack = { ...out.editorBack, previewUrl: null, previewHiUrl: null };
  }

  if (out.extras && typeof out.extras === "object") {
    out.extras = { ...out.extras, platePreviewUrl: null, platePreviewHiUrl: null };
  }

  if (out.engraving && typeof out.engraving === "object") {
    out.engraving = { ...out.engraving, photoPreview: null };
  }

  return out as OrderDraft;
}

/* ==================== Load/Save ==================== */

export function loadOrderDraft(): OrderDraft {
  try {
    const raw = localStorage.getItem(LS_ORDER_DRAFT_KEY);
    if (!raw) return { graphics: [], updatedAt: now() };

    // Anti-OOM: если драфт стал слишком большим — не парсим, а сбрасываем.
    if (raw.length > MAX_DRAFT_RAW_CHARS) {
      try {
        localStorage.removeItem(LS_ORDER_DRAFT_KEY);
      } catch {}
      return { graphics: [], updatedAt: now() };
    }

    const obj = JSON.parse(raw) as OrderDraft;

    // минимальная нормализация
    if (!Array.isArray(obj.graphics)) obj.graphics = [];
    if (obj.size && typeof obj.size !== "object") obj.size = null;
    if (obj.item && typeof obj.item !== "object") obj.item = null;
    if (obj.engraving && typeof obj.engraving !== "object") obj.engraving = null;

    const sanitized = sanitizeDraftPreviews(obj);

    return { ...sanitized, updatedAt: sanitized.updatedAt || now() };
  } catch {
    // Если JSON.parse упал или localStorage недоступен — сбрасываем ключ (чтобы не падать каждый раз).
    try {
      localStorage.removeItem(LS_ORDER_DRAFT_KEY);
    } catch {}
    return { graphics: [], updatedAt: now() };
  }
}

export function saveOrderDraft(patch: Partial<OrderDraft>): OrderDraft {
  const prev = loadOrderDraft();

  // updatedAt всегда обновляем
  const next0: OrderDraft = deepMergeWithDelete(prev, { ...patch, updatedAt: now() });
  const next: OrderDraft = sanitizeDraftPreviews(next0);

  // Пытаемся сохранить как есть.
  try {
    const raw = JSON.stringify(next);
    // Anti-OOM: если получился слишком большой JSON — сначала пробуем выбросить превью и сохранить облегчённый.
    if (raw.length > MAX_DRAFT_RAW_CHARS) {
      const lite = dropAllHeavyPreviews(next);
      localStorage.setItem(LS_ORDER_DRAFT_KEY, JSON.stringify(lite));
      emitDraftUpdated();
      return lite;
    }

    localStorage.setItem(LS_ORDER_DRAFT_KEY, raw);
    emitDraftUpdated();
    return next;
  } catch {
    // Если localStorage.setItem упал (quota / memory), пробуем сохранить облегчённую версию.
    try {
      const lite = dropAllHeavyPreviews(next);
      localStorage.setItem(LS_ORDER_DRAFT_KEY, JSON.stringify(lite));
      emitDraftUpdated();
      return lite;
    } catch {
      // Последний шанс: ничего не сохраняем, но возвращаем next (в памяти).
      emitDraftUpdated();
      return next;
    }
  }
}

/* ==================== Размеры: удобные сеттеры ==================== */

export function setSizeFromCm(params: {
  heightCm?: number;
  widthCm?: number;
  thicknessCm?: number;
  orientation?: Orientation;
  notes?: string;
}): OrderDraft {
  const { heightCm, widthCm, thicknessCm, orientation, notes } = params;
  const mm = (v?: number) => (typeof v === "number" && isFinite(v) ? Math.round(v * 10) : undefined);

  const sizePatch: any = {};
  if (typeof heightCm === "number" && isFinite(heightCm)) sizePatch.height = mm(heightCm);
  if (typeof widthCm === "number" && isFinite(widthCm)) sizePatch.width = mm(widthCm);
  if (typeof thicknessCm === "number" && isFinite(thicknessCm)) sizePatch.thickness = mm(thicknessCm);
  if (orientation) sizePatch.orientation = orientation;
  if (typeof notes === "string" && notes.trim()) sizePatch.notes = notes.trim();

  return saveOrderDraft({ size: sizePatch, ...(orientation ? { orientation } : {}) });
}

/* ==================== Работа с фото (оригинал в IndexedDB) ==================== */

export async function setPhotoOriginal(file: File): Promise<OrderDraft> {
  const key = `photo:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await idbPutBlob(key, file);
  const preview = await makePreviewDataUrl(file, 300);

  const next = saveOrderDraft({
    engraving: {
      photoOriginalKey: key,
      photoFileName: file.name || "photo",
      photoMime: file.type || "image/jpeg",
      photoPreview: preview
    }
  });

  return next;
}

export async function getPhotoOriginalFromDraft(draft?: OrderDraft): Promise<Blob | null> {
  const cur = draft || loadOrderDraft();
  const key = cur.engraving?.photoOriginalKey;
  if (!key) return null;
  try {
    return await idbGetBlob(key);
  } catch {
    return null;
  }
}

export async function clearPhotoOriginal(): Promise<OrderDraft> {
  const cur = loadOrderDraft();
  const key = cur.engraving?.photoOriginalKey;

  if (key) {
    try {
      await idbDel(key);
    } catch {}
  }

  return saveOrderDraft({
    engraving: {
      ...(cur.engraving || {}),
      photoOriginalKey: null,
      photoPreview: null,
      photoFileName: null,
      photoMime: null
    }
  });
}

/* ==================== Очистка драфта ==================== */

export async function clearOrderDraft(): Promise<void> {
  try {
    const cur = loadOrderDraft();
    const key = cur.engraving?.photoOriginalKey;
    if (key) {
      try {
        await idbDel(key);
      } catch {}
    }
    localStorage.removeItem(LS_ORDER_DRAFT_KEY);
  } catch {}
  emitDraftUpdated();
}

/* ==================== Превью изображений ==================== */

async function makePreviewDataUrl(file: File, maxSide = 300): Promise<string> {
  const img = await fileToImage(file);
  const { canvas } = drawContain(img, maxSide, maxSide);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function drawContain(img: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, w, h);
  const ratio = Math.min(w / img.width, h / img.height);
  const nw = Math.round(img.width * ratio);
  const nh = Math.round(img.height * ratio);
  const dx = Math.round((w - nw) / 2);
  const dy = Math.round((h - nh) / 2);
  ctx.drawImage(img, dx, dy, nw, nh);
  return { canvas, ctx };
}

/* ==================== Графика (удобные хелперы) ==================== */

export function addGraphic(g: Graphic): OrderDraft {
  const cur = loadOrderDraft();
  const exists = (cur.graphics || []).some((x) => x.id === g.id);
  const nextGraphics = exists ? cur.graphics! : [...(cur.graphics || []), g];
  return saveOrderDraft({ graphics: nextGraphics });
}

export function removeGraphicById(id: string): OrderDraft {
  const cur = loadOrderDraft();
  const nextGraphics = (cur.graphics || []).filter((x) => x.id !== id);
  return saveOrderDraft({ graphics: nextGraphics });
}

export function clearGraphics(): OrderDraft {
  return saveOrderDraft({ graphics: [] });
}
