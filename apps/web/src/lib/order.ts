// src/lib/order.ts
// Единый стор заказа (draft) в localStorage + оригинал фото в IndexedDB.
// Поля: size.width/height/thickness/notes/orientation, graphics, engraving, etc.

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
      // рекурсивный merge
      out[k] = deepMergeWithDelete(out[k] ?? {}, v as any);
    } else {
      out[k] = v;
    }
  }

  return out;
}

/* ==================== Load/Save ==================== */

export function loadOrderDraft(): OrderDraft {
  try {
    const raw = localStorage.getItem(LS_ORDER_DRAFT_KEY);
    if (!raw) return { graphics: [], updatedAt: now() };
    const obj = JSON.parse(raw) as OrderDraft;

    if (!Array.isArray(obj.graphics)) obj.graphics = [];
    if (obj.size && typeof obj.size !== "object") obj.size = null;
    if (obj.item && typeof obj.item !== "object") obj.item = null;
    if (obj.engraving && typeof obj.engraving !== "object") obj.engraving = null;

    return { ...obj, updatedAt: obj.updatedAt || now() };
  } catch {
    return { graphics: [], updatedAt: now() };
  }
}

export function saveOrderDraft(patch: Partial<OrderDraft>): OrderDraft {
  const prev = loadOrderDraft();

  // updatedAt всегда обновляем
  const next: OrderDraft = deepMergeWithDelete(prev, { ...patch, updatedAt: now() });

  try {
    localStorage.setItem(LS_ORDER_DRAFT_KEY, JSON.stringify(next));
  } catch {}

  emitDraftUpdated();
  return next;
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
      photoOriginalKey: null, // удаляем
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
