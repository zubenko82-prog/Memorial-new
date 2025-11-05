// src/lib/order.ts
// Единый стор заказа (draft) в localStorage + оригинал фото в IndexedDB.
// Поддержка:
// - size.width/height/thickness в миллиметрах;
// - size.orientation: "vertical" | "horizontal";
// - engraving.photoPreview (dataURL), photoOriginalKey (IndexedDB), fileName/mime;
// - graphics: список выбранной графики;
// - события обновления: window.dispatchEvent(new Event("memorial:orderDraftUpdated")).

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
  photoOriginalKey?: string | null; // ключ в IndexedDB
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
  orderNumber?: string | null; // опционально, основной источник — lib/intro.ts
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
  updatedAt?: number;
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

/* ==================== Load/Save ==================== */

export function loadOrderDraft(): OrderDraft {
  try {
    const raw = localStorage.getItem(LS_ORDER_DRAFT_KEY);
    if (!raw) return { graphics: [], updatedAt: now() };
    const obj = JSON.parse(raw) as OrderDraft;

    // Нормализация
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
  const next: OrderDraft = {
    ...prev,
    ...patch,
    // глубокое объединение некоторых вложенных объектов
    intro: { ...(prev.intro || {}), ...(patch.intro || {}) },
    item: { ...(prev.item || {}), ...(patch.item || {}) },
    size: { ...(prev.size || {}), ...(patch.size || {}) },
    engraving: { ...(prev.engraving || {}), ...(patch.engraving || {}) },
    graphics: Array.isArray(patch.graphics) ? patch.graphics : prev.graphics || [],
    updatedAt: now()
  };
  try {
    localStorage.setItem(LS_ORDER_DRAFT_KEY, JSON.stringify(next));
  } catch {}

  emitDraftUpdated();
  return next;
}

/* ==================== Размеры: удобные сеттеры ==================== */

// Установить размеры и ориентацию из сантиметров (см -> мм)
export function setSizeFromCm(params: {
  heightCm?: number;
  widthCm?: number;
  thicknessCm?: number;
  orientation?: Orientation;
  notes?: string;
}): OrderDraft {
  const { heightCm, widthCm, thicknessCm, orientation, notes } = params;
  const mm = (v?: number) => (typeof v === "number" && isFinite(v) ? Math.round(v * 10) : undefined);
  return saveOrderDraft({
    size: {
      height: mm(heightCm),
      width: mm(widthCm),
      thickness: mm(thicknessCm),
      orientation,
      notes: notes?.trim() || undefined
    }
  });
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

// Удаляет оригинал фото (если есть) из IndexedDB и чистит ссылки в драфте
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
  // JPEG 0.8 — компромисс по размеру/качеству
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

// Рисуем изображение «contain» в заданный прямоугольник (с отступами по центру)
function drawContain(img: HTMLImageElement, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  // фон — лёгкий светло-серый, чтобы миниатюра корректно выглядела на светлой теме
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

/* ==================== Графика (удобные хелперы, опционально) ==================== */

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
