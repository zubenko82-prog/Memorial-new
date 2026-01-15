// apps/web/src/lib/pdf/generateOrderPdf.ts
// Генерация PDF без встраивания шрифтов: только стандартные PDF‑шрифты (Helvetica).
// Чтобы кириллица не «ломалась» без встраивания шрифта — для строк с нелатиницей
// используем безопасный фолбэк: рисуем текст на offscreen‑canvas и вставляем в PDF как PNG.
// Итого:
// - Никаких TTF, никаких addFont/addFileToVFS (только базовый Helvetica).
// - Весь латиница/цифры/знаки — обычным текстом PDF (doc.text).
// - Весь кириллический текст — как картинка (надёжно показывается в любом PDF‑ридере).
//
// Важное: прикреплённые фотографии (портреты) можно не вставлять при отправке в Telegram,
// а вставлять только при скачивании — для этого используйте флаг includeAttachedPhotos.
// Также увеличены отступы между блоками (gapRow, gapText и прочее) для лучшей читаемости.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { htmlToImage?: any; jspdf?: any }
}

/* ===== dynamic deps ===== */
async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.htmlToImage) return window.htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("html-to-image load error"));
    document.head.appendChild(s);
  });
  if (!window.htmlToImage) throw new Error("html-to-image unavailable");
  return window.htmlToImage;
}

async function ensureJsPdf(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  const CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("jspdf load error"));
    document.head.appendChild(s);
  });
  if (!window.jspdf?.jsPDF) throw new Error("jspdf unavailable");
  return window.jspdf.jsPDF;
}

/* ===== Helpers ===== */
async function nodeToPng(node?: HTMLElement | null): Promise<string | null> {
  if (!node) return null;
  const hti = await ensureHtmlToImage();
  return await hti.toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true });
}
async function urlToDataUrl(url?: string | null): Promise<string | null> {
  try {
    if (!url) return null;
    if (url.startsWith("data:")) return url;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}
function splitToLines(doc: any, txt: string, maxW: number) { return doc.splitTextToSize(txt, maxW); }
function dl(text: string) { return (text || "").trim(); }
function toParagraphsSafe(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}
function fileNameFromUrl(url?: string): string {
  if (!url) return "";
  try {
    const noQ = url.split(/[?#]/)[0];
    const base = (noQ.split("/").pop() || noQ).split("\\").pop() || noQ;
    return decodeURIComponent(base.replace(/\+/g, " "));
  } catch { return url; }
}

/* ===== Fallback: рисуем нелатинские строки в canvas и вставляем в PDF как PNG ===== */
function hasNonLatin(text: string): boolean {
  // Всё что не ASCII — считаем «нелатиницей» (включая кириллицу)
  return /[^\x00-\x7E]/.test(text);
}
type DrawLineOpts = { align?: "left" | "center" | "right" };
function renderLineToPng(text: string, px: number, bold = false) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // ограничим до 2x
  const font = `${bold ? "700" : "400"} ${px}px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Noto Sans",sans-serif`;

  // Создадим маленький canvas для измерения, затем финальный
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = font;
  // Метрики строки
  const m = ctx.measureText(text);
  const ascent = Math.ceil((m.actualBoundingBoxAscent || px * 0.8));
  const descent = Math.ceil((m.actualBoundingBoxDescent || px * 0.2));
  const w = Math.ceil(m.width) + 2;
  const h = ascent + descent + 2;

  // Финальный canvas с масштабом
  const cw = Math.max(1, Math.round(w * dpr));
  const ch = Math.max(1, Math.round(h * dpr));
  const can = document.createElement("canvas");
  can.width = cw; can.height = ch;
  const cx = can.getContext("2d")!;
  cx.scale(dpr, dpr);
  cx.font = font;
  cx.textBaseline = "alphabetic";
  cx.fillStyle = "#000";
  // Рисуем так, чтобы базовая линия была на высоте ascent
  cx.fillText(text, 1, 1 + ascent);
  const dataUrl = can.toDataURL("image/png");
  return { dataUrl, w, h, baseline: ascent };
}

/* Патч: переопределяем doc.text, чтобы строки с нелатиницей уходили в PNG */
function patchDocTextForImages(doc: any, getState: () => { size: number; bold: boolean }) {
  const origText = doc.text.bind(doc);
  doc.__text_original = origText;
  doc.text = (txt: any, x: number, y: number, opts?: any, transform?: any) => {
    const s = Array.isArray(txt) ? String(txt.join(" ")) : String(txt);
    if (!hasNonLatin(s)) {
      return origText(txt, x, y, opts, transform);
    }
    const { size, bold } = getState();
    const line = renderLineToPng(s, size, bold);
    let drawX = x, drawY = y;
    const align: DrawLineOpts["align"] = opts?.align || "left";
    if (align === "center") drawX = x - line.w / 2;
    else if (align === "right") drawX = x - line.w;
    // doc.text рисует по базовой линии; картинку ставим так, чтобы её базовая линия совпала с y
    drawY = y - line.baseline;
    doc.addImage(line.dataUrl, "PNG", drawX, drawY, line.w, line.h, undefined, "FAST");
    return doc;
  };
}

/* ===== Public API ===== */
export type GeneratePdfArgs = {
  draft: any;
  intro: any;
  frontNode?: HTMLElement | null;
  backNode?: HTMLElement | null;
  backUrlFallback?: string | null;
  onProgress?: (stage: string) => void;
  // Новое: встраивать ли прикреплённые фотографии (портреты) в PDF.
  // Для отправки в Telegram устанавливайте false (уменьшит размер).
  // Для скачивания пользователю — true.
  includeAttachedPhotos?: boolean;
};

export async function generateOrderPdf(args: GeneratePdfArgs): Promise<Blob> {
  const {
    draft, intro, frontNode, backNode, backUrlFallback, onProgress,
    includeAttachedPhotos = true
  } = args;

  onProgress?.("init");
  const jsPDF = await ensureJsPdf();
  const doc = new jsPDF({ unit: "px", format: [1512, 2138] });

  // БАЗОВЫЙ стандартный шрифт PDF — Helvetica (без встраивания TTF)
  // Состояние текущего размера/жирности — нужно для канвас‑фолбэка
  let curFontSize = 30;
  let curFontBold = false;
  const useFont = (bold = false, size = curFontSize) => {
    curFontBold = !!bold;
    curFontSize = size;
    try {
      doc.setFont("helvetica", bold ? "bold" : "normal");
    } catch {
      // fallback к times, если вдруг helvetica не доступна (не должно случиться)
      doc.setFont("times", bold ? "bold" : "normal");
    }
    doc.setFontSize(size);
  };

  // Патчим doc.text: все строки с нелатиницей рисуем как PNG
  patchDocTextForImages(doc, () => ({ size: curFontSize, bold: curFontBold }));

  // Геометрия
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56; // был 48 — слегка увеличили общие поля
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  const rightW = Math.round(innerW * 0.40);
  const gapCols = 32; // было 28 — увеличили зазор между колонками
  const leftW = innerW - gapCols - rightW;

  // Типографика
  let base = 30, lhK = 1.22; // было 1.18 — чуть выше межстрочный
  const minBase = 20, minLhK = 1.12;
  const TITLE = 30; // было 28
  const FILE = 28;
  const EP = 34; // было 32

  // Миниатюры + отступ снизу
  const PEOPLE_COLS = 2, PEOPLE_IMG_W_FACTOR = 0.50;
  let photoH = 140, gfxH = 86, plateH = 86; // слегка увеличили высоту для единообразия
  const minImgH = 54;
  const IMG_BOTTOM_PAD = 14; // было 10 — больше отступ под изображениями

  // Грид и зазоры — УВЕЛИЧЕНЫ
  let minColW = 248; // было 240
  let gapCol = 18;   // было 14
  let gapRow = 20;   // было 12
  let gapText = 16;  // было 12

  const lh = (size = base) => Math.ceil(size * lhK);
  const split = (text: string, width: number, size = base, bold = false) => { useFont(bold, size); return splitToLines(doc, text, width); };
  const cols = (availW: number) => Math.max(2, Math.floor((availW + gapCol) / (minColW + gapCol)));
  const hr = (y: number) => { doc.setDrawColor(210); doc.setLineWidth(1.1); doc.line(margin, y, margin + leftW, y); };

  // Центрированный подчёркнутый заголовок
  const underlineOffset = 4; // +1 пикс.
  function headingCentered(text: string, yPos: number, size = TITLE): number {
    // Добавим вертикальный «воздух» перед заголовком
    yPos += Math.max(8, Math.floor(lh(base) * 0.25));
    useFont(true, size);
    const cx = margin + leftW / 2;
    doc.text(text, cx, yPos, { align: "center", maxWidth: leftW });
    const tw = doc.getTextWidth(text); // для нелатиницы это будет оценка, но линия всё равно декоративная
    doc.setDrawColor(40); doc.setLineWidth(0.9);
    doc.line(cx - tw / 2, yPos + underlineOffset, cx + tw / 2, yPos + underlineOffset);
    return yPos + lh(size);
  }

  // Данные
  const custName = dl(intro?.intro?.customerName) || "—";
  const custPhone = dl(intro?.intro?.customerPhone) || "—";
  const orderNo = String(intro?.orderNumber || "—");

  const persons: Array<{ photo?: string | null; last: string; namePatr: string; dates: string }> =
    (((draft?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      photo: includeAttachedPhotos ? (p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null) : null, // при отправке (includeAttachedPhotos=false) — не вставляем
      last: dl(p.lastName),
      namePatr: [dl(p.firstName), dl(p.middleName)].filter(Boolean).join(" "),
      dates: [dl(p.birthDate), dl(p.deathDate)].filter(Boolean).join(" — ")
    }));

  const gfxFront: Array<{ name: string; url?: string | null }> =
    ((draft as any)?.graphics || []).map((g: any) => ({ name: g.name || g.id || fileNameFromUrl(g.url) || "—", url: g.preview || g.url || null }));

  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCounts: Record<string, number> = {};
  (rearIds || []).forEach(id => rearCounts[id] = (rearCounts[id] || 0) + 1);
  const gfxRear = Array.from(new Set(rearIds || [])).map(id => rearMeta?.[id] || { id, name: id, url: "" });

  const epsFront = toParagraphsSafe((draft?.engraving as any)?.epitaphs ?? (draft?.engraving as any)?.epitaphText);
  const epsRear = (((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean);

  const itemName = dl((draft as any)?.item?.name) || fileNameFromUrl((draft as any)?.item?.url) || "";
  const itemUrl = (draft as any)?.item?.url as string | undefined;

  const plateOn = !!(draft as any)?.extras?.headstonePlate;
  const plateSize = (draft as any)?.extras?.plateSize || "";
  const plateThick = (draft as any)?.extras?.plateThickness || "";
  const plateOrient = (draft as any)?.extras?.plateOrientation || "";

  const plateIds: string[] = ((draft as any)?.extras?.plateGraphicsIds as string[]) || [];
  const plateMeta: Record<string, any> = (draft as any)?.extras?.plateGraphicsMeta || {};
  const plateUnique = Array.from(new Set(plateIds)).map(id => plateMeta[id] || { id, name: id, url: "" });
  const plateEps = toParagraphsSafe(((draft as any)?.extras?.plateEpitaph || "").trim());

  const flowerbed = !!(draft as any)?.extras?.flowerbed;
  const baseOn = !!((draft as any)?.extras?.base);
  const notes = dl((draft as any)?.extras?.orderNotes);

  // Эскизы (справа)
  onProgress?.("capture-sketches");
  const frontPng = frontNode ? await nodeToPng(frontNode) : null;
  const backPng = backNode ? await nodeToPng(backNode) : await urlToDataUrl(backUrlFallback || (draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl);

  /* ===== Измерение (для подгонки) ===== */
  function measureLeft() {
    let y = margin;

    split(custName || "—", leftW, base, true).forEach(() => y += lh(base));
    y += Math.floor(lh(base) * 0.25); // дополнительный «воздух»
    split(custPhone || "—", leftW, base).forEach(() => y += lh(base));
    split(`№ ${orderNo}`, leftW, 22).forEach(() => y += lh(22));

    if (itemUrl || itemName) {
      y += 10; // было 6 — больше воздуха перед разделителем
      const c = cols(leftW), cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const nameH = split(itemName || "—", cellW - Math.floor(cellW * 0.40) - gapText, FILE).length * lh(FILE);
      y += Math.max(gfxH + IMG_BOTTOM_PAD, nameH) + gapRow;
    }

    y += lh(TITLE);
    y += measurePeople();

    if (gfxFront.length) { y += lh(base); y += measureGraphics(gfxFront, gfxH); }
    if (gfxRear.length)  { y += lh(base); y += measureGraphics(gfxRear.map(g => ({ name: `${g.name || "—"}${(rearCounts[g.id || ""] || 1) > 1 ? ` ×${rearCounts[g.id || ""]}` : ""}`, url: g.url })), gfxH); }

    if (epsFront.length) { y += lh(base); y += measureEpitaphs(epsFront) + 12; } // +2px
    if (epsRear.length)  { y += lh(base); y += measureEpitaphs(epsRear) + 12; }

    if (plateOn) {
      y += lh(TITLE);
      if (plateSize)  y += lh(base);
      if (plateThick) y += lh(base);
      if (plateOrient) y += lh(base);
      if (plateUnique.length) { y += lh(base); y += measureGraphics(plateUnique.map(p => ({ name: p.name || p.id || "—", url: p.url })), plateH); }
      if (plateEps.length)    { y += lh(base); y += measureEpitaphs(plateEps) + 12; }
    }

    y += lh(base);
    y += lh(base);
    y += lh(base);

    if (notes) { y += lh(base); y += split(notes, leftW, base).length * lh(base); }

    return { total: y - margin };

    function measurePeople(): number {
      const c = PEOPLE_COLS;
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * PEOPLE_IMG_W_FACTOR);
      const txtW = Math.max(40, cellW - imgW - gapText);
      let used = 0, colI = 0, rowMax = 0;

      for (let i = 0; i < persons.length; i++) {
        const textH =
          split(persons[i].last || "—", txtW, base).length * lh(base) +
          split(persons[i].namePatr || "—", txtW, base).length * lh(base) +
          split(persons[i].dates || "—", txtW, base).length * lh(base);
        const imageBlockH = includeAttachedPhotos ? (photoH + IMG_BOTTOM_PAD) : 0;
        rowMax = Math.max(rowMax, Math.max(imageBlockH, textH));
        if (++colI >= c || i === persons.length - 1) { used += rowMax + gapRow; colI = 0; rowMax = 0; }
      }
      return used;
    }
    function measureGraphics(list: Array<{ name: string; url?: string | null }>, imgH: number): number {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * 0.40);
      const txtW = Math.max(40, cellW - imgW - gapText);
      let used = 0, colI = 0, rowMax = 0;
      if (!list.length) return lh(base);
      for (let i = 0; i < list.length; i++) {
        const nameH = split(list[i].name || "—", txtW, FILE).length * lh(FILE);
        rowMax = Math.max(rowMax, Math.max(imgH + IMG_BOTTOM_PAD, nameH));
        if (++colI >= c || i === list.length - 1) { used += rowMax + gapRow; colI = 0; rowMax = 0; }
      }
      return used;
    }
    function measureEpitaphs(list: string[]): number {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      let used = 0, colI = 0, rowMax = 0;
      if (!list.length) return lh(base);
      for (let i = 0; i < list.length; i++) {
        const hTxt = split(list[i], cellW, EP).length * lh(EP);
        rowMax = Math.max(rowMax, hTxt);
        if (++colI >= c || i === list.length - 1) { used += rowMax + gapRow; colI = 0; rowMax = 0; }
      }
      return used;
    }
  }

  // Подгонка
  onProgress?.("fit");
  let meas = measureLeft();
  while (meas.total > innerH) {
    let changed = false;
    if (photoH > minImgH || gfxH > minImgH || plateH > minImgH) {
      photoH = Math.max(minImgH, Math.round(photoH * 0.92));
      gfxH   = Math.max(minImgH, Math.round(gfxH   * 0.92));
      plateH = Math.max(minImgH, Math.round(plateH * 0.92));
      changed = true;
    } else if (lhK > minLhK) {
      lhK = Math.max(minLhK, +(lhK - 0.02).toFixed(2));
      changed = true;
    } else if (minColW > 210) {
      minColW = Math.max(210, minColW - 15);
      changed = true;
    } else if (base > minBase) {
      base = Math.max(minBase, base - 2);
      changed = true;
    }
    if (!changed) break;
    meas = measureLeft();
  }

  /* ===== Рендер левой колонки ===== */
  let y = margin;
  useFont(true, base);  doc.text(custName || "—", margin, y); y += lh(base);
  useFont(false, base); doc.text(custPhone || "—", margin, y); y += lh(base);
  useFont(false, 22);   doc.text(`№ ${orderNo}`, margin, y); y += lh(22);

  y += 10; hr(y); y += 2; // разделитель с большим отступом

  // Резная работа
  if (itemUrl || itemName) {
    y = headingCentered("Резная работа", y, TITLE);
    const c = cols(leftW);
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    const imgW = Math.floor(cellW * 0.40);
    const txtW = Math.max(40, cellW - imgW - gapText);
    const cx = margin;
    let usedH = 0;
    if (itemUrl) {
      const data = await urlToDataUrl(itemUrl);
      if (data) {
        const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = data; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (iw && ih) {
          const s = Math.min(imgW / iw, gfxH / ih, 1);
          const w = Math.min(imgW, Math.round(iw * s));
          const h = Math.round(ih * s);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, y, w, h, undefined, "FAST");
          usedH = h + IMG_BOTTOM_PAD;
        }
      }
    }
    useFont(false, FILE);
    let yT = y; const xT = cx + imgW + gapText;
    for (const ln of split(itemName || "—", txtW, FILE)) { doc.text(ln, xT, yT); yT += lh(FILE); }
    y = y + Math.max(usedH, yT - y) + gapRow;
  }

  // Люди
  y = headingCentered("Люди", y);
  y = await drawPeople(y);

  // Графика (лицевая)
  if (gfxFront.length) {
    y = headingCentered("Графика (лицевая)", y, base);
    y = await drawGraphics(y, gfxFront, gfxH);
  }
  // Графика (тыльная)
  if (gfxRear.length) {
    y = headingCentered("Графика (тыльная)", y, base);
    y = await drawGraphics(y, gfxRear.map(g => ({ name: `${g.name || "—"}${(rearCounts[g.id || ""] || 1) > 1 ? ` ×${rearCounts[g.id || ""]}` : ""}`, url: g.url })), gfxH);
  }

  // Эпитафии
  if (epsFront.length) {
    y = headingCentered("Эпитафии (лицевая)", y, base);
    y = drawEpitaphs(y, epsFront) + 12;
  }
  if (epsRear.length) {
    y = headingCentered("Эпитафии (тыльная)", y, base);
    y = drawEpitaphs(y, epsRear) + 12;
  }

  // Плита
  if (plateOn) {
    y = headingCentered("Надгробная плита", y);
    useFont(false, base);
    if (plateSize)   { doc.text(`Размер: ${plateSize}`, margin, y); y += lh(base); }
    if (plateThick)  { doc.text(`Толщина: ${plateThick}`, margin, y); y += lh(base); }
    if (plateOrient) { doc.text(`Ориентация: ${plateOrient === "horizontal" ? "горизонтально" : "вертикально"}`, margin, y); y += lh(base); }

    if (plateUnique.length) {
      y = headingCentered("Графика (плита)", y, base);
      y = await drawGraphics(y, plateUnique.map(p => ({ name: p.name || p.id || "—", url: p.url })), plateH);
    }
    if (plateEps.length) {
      y = headingCentered("Эпитафии (плита)", y, base);
      y = drawEpitaphs(y, plateEps) + 12;
    }
  }

  // Дополнительно
  y = headingCentered("Дополнительно", y, base);
  useFont(false, base);
  doc.text(`Цветник: ${flowerbed ? "да" : "нет"}`, margin, y); y += lh(base);
  doc.text(`Тумба: ${baseOn ? "да" : "нет"}`, margin, y); y += lh(base);

  // Примечания
  if (notes) {
    y = headingCentered("Примечания", y, base);
    useFont(false, base);
    for (const ln of split(notes, leftW, base)) { doc.text(ln, margin, y); y += lh(base); }
  }

  /* ===== Правая колонка — эскизы ===== */
  let yR = margin + 88; // было +80 — больше отступ сверху
  async function placeRight(dataUrl?: string | null, maxH?: number) {
    if (!dataUrl || !maxH) return;
    const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = dataUrl!; });
    const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
    if (!iw || !ih) return;
    const s = Math.min(rightW / iw, maxH / ih, 1);
    const w = Math.round(iw * s), h = Math.round(ih * s);
    const x = margin + leftW + gapCols + Math.round((rightW - w) / 2);
    doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl!) ? "PNG" : "JPEG", x, yR, w, h, undefined, "FAST");
    yR += h + 22; // было +18 — больше промежуток между картинками
  }
  await placeRight(frontPng, Math.floor(innerH / 2) - 64);
  await placeRight(backPng, innerH - (yR - margin));

  /* ===== Отдельные страницы с фото (портреты) — ТОЛЬКО ЕСЛИ includeAttachedPhotos ===== */
  if (includeAttachedPhotos) {
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      if (!p.photo) continue;
      const data = await urlToDataUrl(p.photo);
      if (!data) continue;
      doc.addPage();
      let yP = margin;
      useFont(false, base);
      for (const ln of split(p.last || "—", pageW - margin * 2, base))  { doc.text(ln, margin, yP); yP += lh(base); }
      for (const ln of split(p.namePatr || "—", pageW - margin * 2, base)) { doc.text(ln, margin, yP); yP += lh(base); }
      for (const ln of split(p.dates || "—", pageW - margin * 2, base))    { doc.text(ln, margin, yP); yP += lh(base) + 10; }
      const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = data; });
      const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
      if (iw && ih) {
        const availW = pageW - margin * 2, availH = pageH - margin - yP;
        const s = Math.min(availW / iw, availH / ih, 1);
        const w = Math.round(iw * s), h = Math.round(ih * s);
        const x = margin + Math.max(0, (availW - w) / 2);
        doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, yP, w, h, undefined, "FAST");
      }
    }
  }

  return doc.output("blob");

  /* ===== Рендер‑помощники ===== */
  async function drawGraphics(yStart: number, list: Array<{ name: string; url?: string | null }>, imgH: number) {
    let yLoc = yStart;
    const c = cols(leftW);
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    const imgW = Math.floor(cellW * 0.40);
    const txtW = Math.max(40, cellW - imgW - gapText);

    let colI = 0, rowMax = 0, rowStartY = yLoc;
    if (!list.length) { useFont(false, base); doc.text("—", margin, yLoc); yLoc += lh(base); return yLoc; }

    for (let i = 0; i < list.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let usedH = 0;

      const data = await urlToDataUrl(list[i].url || null);
      if (data) {
        const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = data; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (iw && ih) {
          const s = Math.min(imgW / iw, imgH / ih, 1);
          const w = Math.min(imgW, Math.round(iw * s));
          const h = Math.round(ih * s);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
          usedH = h + IMG_BOTTOM_PAD;
        }
      }

      useFont(false, FILE);
      let yTxt = rowStartY; const xTxt = cx + imgW + gapText;
      for (const ln of doc.splitTextToSize(list[i].name || "—", txtW)) { doc.text(ln, xTxt, yTxt); yTxt += lh(FILE); }

      rowMax = Math.max(rowMax, Math.max(usedH, yTxt - rowStartY));
      if (++colI >= c || i === list.length - 1) {
        yLoc = rowStartY + rowMax + gapRow; rowStartY = yLoc; colI = 0; rowMax = 0;
      }
    }
    return yLoc;
  }

  function drawEpitaphs(yStart: number, list: string[]) {
    let yLoc = yStart;
    const c = cols(leftW);
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    let colI = 0, rowMax = 0, rowStartY = yLoc;
    if (!list.length) { useFont(false, base); doc.text("—", margin, yLoc); yLoc += lh(base); return yLoc; }

    for (let i = 0; i < list.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let yC = rowStartY; useFont(false, EP);
      for (const ln of doc.splitTextToSize(list[i], cellW)) { doc.text(ln, cx, yC); yC += lh(EP); }
      rowMax = Math.max(rowMax, yC - rowStartY);
      if (++colI >= c || i === list.length - 1) {
        yLoc = rowStartY + rowMax + gapRow; rowStartY = yLoc; colI = 0; rowMax = 0;
      }
    }
    return yLoc;
  }

  async function drawPeople(yStart: number) {
    let yLoc = yStart;
    const c = PEOPLE_COLS;
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    const imgW = Math.floor(cellW * PEOPLE_IMG_W_FACTOR);
    const txtW = Math.max(40, cellW - imgW - gapText);

    let colI = 0, rowMax = 0, rowStartY = yLoc;
    if (!persons.length) { useFont(false, base); doc.text("—", margin, yLoc); yLoc += lh(base); return yLoc; }

    for (let i = 0; i < persons.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let usedH = 0;

      // ВСТРОЕННЫЕ ПРИКРЕПЛЁННЫЕ ФОТО — ТОЛЬКО ЕСЛИ includeAttachedPhotos === true
      if (includeAttachedPhotos) {
        const data = await urlToDataUrl(persons[i].photo || null);
        if (data) {
          const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = data; });
          const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
          if (iw && ih) {
            const s = Math.min(imgW / iw, photoH / ih, 1);
            const w = Math.min(imgW, Math.round(iw * s));
            const h = Math.round(ih * s);
            doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
            usedH = h + IMG_BOTTOM_PAD;
          }
        }
      }

      let yTxt = rowStartY; const xTxt = cx + (includeAttachedPhotos ? (imgW + gapText) : 0);
      useFont(false, base);
      for (const ln of split(persons[i].last || "—", includeAttachedPhotos ? txtW : cellW, base))  { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
      for (const ln of split(persons[i].namePatr || "—", includeAttachedPhotos ? txtW : cellW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
      for (const ln of split(persons[i].dates || "—", includeAttachedPhotos ? txtW : cellW, base))    { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }

      const cellH = Math.max(usedH, yTxt - rowStartY);
      rowMax = Math.max(rowMax, cellH);
      if (++colI >= c || i === persons.length - 1) {
        yLoc = rowStartY + rowMax + gapRow; rowStartY = yLoc; colI = 0; rowMax = 0;
      }
    }
    return yLoc;
  }
}

/* ===== Send / Download helpers (как были) ===== */
export async function sendPdfToServer(blob: Blob, meta: any) {
  const fd = new FormData();
  fd.append("pdf", blob, `order-${meta?.orderNo || Date.now()}.pdf`);
  fd.append("payload", JSON.stringify(meta || {}));
  const res = await fetch("/api/send-order-pdf", { method: "POST", body: fd });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
