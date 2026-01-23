// apps/web/src/lib/pdf/generateOrderPdf.ts
// Генерация PDF без встраивания шрифтов: только стандартные PDF‑шрифты (Helvetica).
// Чтобы кириллица не «ломалась» без встраивания шрифта — для строк с нелатиницей
// используем безопасный фолбэк: рисуем текст на offscreen‑canvas и вставляем в PDF как PNG.
//
// ИЗМЕНЕНИЕ (по задаче):
// - Добавлена поддержка третьего превью: "плита".
// - Высота правой колонки теперь распределяется АККУРАТНО по количеству реально имеющихся превью
//   (лицевая / тыльная / плита). Если чего-то нет — остальные получают больше места.
// - Превью берутся из node (если передан), иначе по URL fallback из draft.
// - Никаких изменений в логике левой колонки и страниц фото.
//
// Важно: если вы не передадите plateNode/plateUrlFallback, превью плиты будет пытаться взяться
// из draft.extras.platePreviewHiUrl / platePreviewUrl.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    htmlToImage?: any;
    jspdf?: any;
  }
}

/* ===== dynamic deps ===== */
async function ensureHtmlToImage(): Promise<any> {
  if (typeof window === "undefined") throw new Error("No window");
  if (window.htmlToImage) return window.htmlToImage;
  const CDN = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.min.js";
  await new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = CDN;
    s.async = true;
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
    s.src = CDN;
    s.async = true;
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
  } catch {
    return null;
  }
}

function splitToLines(doc: any, txt: string, maxW: number) {
  return doc.splitTextToSize(txt, maxW);
}
function dl(text: string) {
  return (text || "").trim();
}
function toParagraphsSafe(input?: string | string[] | null): string[] {
  if (Array.isArray(input))
    return input
      .map((s) => String(s || "").replace(/\r\n?/g, "\n").trim())
      .filter(Boolean);

  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map((s) => s.trim()).filter(Boolean);
}
function fileNameFromUrl(url?: string): string {
  if (!url) return "";
  try {
    const noQ = url.split(/[?#]/)[0];
    const base = (noQ.split("/").pop() || noQ).split("\\").pop() || noQ;
    return decodeURIComponent(base.replace(/\+/g, " "));
  } catch {
    return url;
  }
}

/* ===== Fallback: рисуем нелатинские строки в canvas и вставляем в PDF как PNG ===== */
function hasNonLatin(text: string): boolean {
  return /[^\x00-\x7E]/.test(text);
}
type DrawLineOpts = { align?: "left" | "center" | "right" };

function renderLineToPng(text: string, px: number, bold = false) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const font = `${bold ? "700" : "400"} ${px}px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Noto Sans",sans-serif`;

  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = font;

  const m = ctx.measureText(text);
  const ascent = Math.ceil(m.actualBoundingBoxAscent || px * 0.8);
  const descent = Math.ceil(m.actualBoundingBoxDescent || px * 0.2);
  const w = Math.ceil(m.width) + 2;
  const h = ascent + descent + 2;

  const cw = Math.max(1, Math.round(w * dpr));
  const ch = Math.max(1, Math.round(h * dpr));
  const can = document.createElement("canvas");
  can.width = cw;
  can.height = ch;
  const cx = can.getContext("2d")!;
  cx.scale(dpr, dpr);
  cx.font = font;
  cx.textBaseline = "alphabetic";
  cx.fillStyle = "#000";
  cx.fillText(text, 1, 1 + ascent);

  const dataUrl = can.toDataURL("image/png");
  return { dataUrl, w, h, baseline: ascent };
}

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
    let drawX = x;
    let drawY = y;
    const align: DrawLineOpts["align"] = opts?.align || "left";
    if (align === "center") drawX = x - line.w / 2;
    else if (align === "right") drawX = x - line.w;
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

  // NEW: plate preview
  plateNode?: HTMLElement | null;
  plateUrlFallback?: string | null;

  onProgress?: (stage: string) => void;
};

export async function generateOrderPdf(args: GeneratePdfArgs): Promise<Blob> {
  const {
    draft,
    intro,
    frontNode,
    backNode,
    backUrlFallback,
    plateNode,
    plateUrlFallback,
    onProgress
  } = args;

  onProgress?.("init");
  const jsPDF = await ensureJsPdf();
  const doc = new jsPDF({ unit: "px", format: [1512, 2138] });

  // State for cyrillic-as-image fallback
  let curFontSize = 30;
  let curFontBold = false;
  const useFont = (bold = false, size = curFontSize) => {
    curFontBold = !!bold;
    curFontSize = size;
    try {
      doc.setFont("helvetica", bold ? "bold" : "normal");
    } catch {
      doc.setFont("times", bold ? "bold" : "normal");
    }
    doc.setFontSize(size);
  };
  patchDocTextForImages(doc, () => ({ size: curFontSize, bold: curFontBold }));

  // Geometry
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  const rightW = Math.round(innerW * 0.40);
  const gapCols = 28;
  const leftW = innerW - gapCols - rightW;

  // Typography
  let base = 30,
    lhK = 1.18;
  const minBase = 20,
    minLhK = 1.10;
  const TITLE = 28,
    FILE = 28,
    EP = 32;

  // Thumbs
  const PEOPLE_COLS = 2,
    PEOPLE_IMG_W_FACTOR = 0.50;
  let photoH = 140,
    gfxH = 80,
    plateH = 80;
  const minImgH = 54;
  const IMG_BOTTOM_PAD = 10;

  // Grid
  let minColW = 240,
    gapCol = 14,
    gapRow = 12,
    gapText = 12;

  const lh = (size = base) => Math.ceil(size * lhK);
  const split = (text: string, width: number, size = base, bold = false) => {
    useFont(bold, size);
    return splitToLines(doc, text, width);
  };
  const cols = (availW: number) => Math.max(2, Math.floor((availW + gapCol) / (minColW + gapCol)));
  const hr = (y: number) => {
    doc.setDrawColor(210);
    doc.setLineWidth(1.1);
    doc.line(margin, y, margin + leftW, y);
  };

  // Centered underlined heading
  const underlineOffset = 3;
  function headingCentered(text: string, yPos: number, size = TITLE): number {
    useFont(true, size);
    const cx = margin + leftW / 2;
    doc.text(text, cx, yPos, { align: "center", maxWidth: leftW });
    const tw = doc.getTextWidth(text);
    doc.setDrawColor(40);
    doc.setLineWidth(0.9);
    doc.line(cx - tw / 2, yPos + underlineOffset, cx + tw / 2, yPos + underlineOffset);
    return yPos + lh(size);
  }

  // Data
  const custName = dl(intro?.intro?.customerName) || "—";
  const custPhone = dl(intro?.intro?.customerPhone) || "—";
  const orderNo = String(intro?.orderNumber || "—");

  const persons: Array<{ photo?: string | null; last: string; namePatr: string; dates: string }> = (
    ((draft?.engraving?.persons as any[]) || []).filter(Boolean)
  ).map((p: any) => ({
    photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null,
    last: dl(p.lastName),
    namePatr: [dl(p.firstName), dl(p.middleName)].filter(Boolean).join(" "),
    dates: [dl(p.birthDate), dl(p.deathDate)].filter(Boolean).join(" — ")
  }));

  const gfxFront: Array<{ name: string; url?: string | null }> = ((draft as any)?.graphics || []).map((g: any) => ({
    name: g.name || g.id || fileNameFromUrl(g.url) || "—",
    url: g.preview || g.url || null
  }));

  const rearIds: string[] = (((draft as any)?.editorBack?.selectedGraphicsIds || []) as string[]);
  const rearMeta: Record<string, any> = (((draft as any)?.editorBack?.graphicsMeta || {}) as Record<string, any>);
  const rearCounts: Record<string, number> = {};
  (rearIds || []).forEach((id) => (rearCounts[id] = (rearCounts[id] || 0) + 1));
  const gfxRear = Array.from(new Set(rearIds || [])).map((id) => rearMeta?.[id] || { id, name: id, url: "" });

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
  const plateUnique = Array.from(new Set(plateIds)).map((id) => plateMeta[id] || { id, name: id, url: "" });

  // IMPORTANT: plate epitaphs may be stored in plateEpitaph (string) or plateEpitaphs (array),
  // but this old file only reads plateEpitaph. Keep as-is but you may extend if needed.
  const plateEps = toParagraphsSafe(((draft as any)?.extras?.plateEpitaph || "").trim());

  const flowerbed = !!(draft as any)?.extras?.flowerbed;
  const baseOn = !!((draft as any)?.extras?.base);
  const notes = dl((draft as any)?.extras?.orderNotes);

  // Sketches for right column
  onProgress?.("capture-sketches");
  const frontPng = frontNode ? await nodeToPng(frontNode) : null;

  const backPng = backNode
    ? await nodeToPng(backNode)
    : await urlToDataUrl(
        backUrlFallback ||
          (draft as any)?.editorBack?.previewHiUrl ||
          (draft as any)?.editorBack?.previewUrl ||
          null
      );

  const platePng = plateNode
    ? await nodeToPng(plateNode)
    : await urlToDataUrl(
        plateUrlFallback ||
          (draft as any)?.extras?.platePreviewHiUrl ||
          (draft as any)?.extras?.platePreviewUrl ||
          null
      );

  /* ===== Measure left column (for fitting) ===== */
  function measureLeft() {
    let y = margin;
    split(custName || "—", leftW, base, true).forEach(() => (y += lh(base)));
    split(custPhone || "—", leftW, base).forEach(() => (y += lh(base)));
    split(`№ ${orderNo}`, leftW, 22).forEach(() => (y += lh(22)));

    if (itemUrl || itemName) {
      y += 6;
      const c = cols(leftW),
        cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const nameH =
        split(itemName || "—", cellW - Math.floor(cellW * 0.40) - gapText, FILE).length * lh(FILE);
      y += Math.max(gfxH + IMG_BOTTOM_PAD, nameH) + gapRow;
    }

    y += lh(TITLE);
    y += measurePeople();

    if (gfxFront.length) {
      y += lh(base);
      y += measureGraphics(gfxFront, gfxH);
    }
    if (gfxRear.length) {
      y += lh(base);
      y += measureGraphics(
        gfxRear.map((g) => ({
          name: `${g.name || "—"}${(rearCounts[g.id || ""] || 1) > 1 ? ` ×${rearCounts[g.id || ""]}` : ""}`,
          url: g.url
        })),
        gfxH
      );
    }

    if (epsFront.length) {
      y += lh(base);
      y += measureEpitaphs(epsFront) + 10;
    }
    if (epsRear.length) {
      y += lh(base);
      y += measureEpitaphs(epsRear) + 10;
    }

    if (plateOn) {
      y += lh(TITLE);
      if (plateSize) y += lh(base);
      if (plateThick) y += lh(base);
      if (plateOrient) y += lh(base);
      if (plateUnique.length) {
        y += lh(base);
        y += measureGraphics(plateUnique.map((p) => ({ name: p.name || p.id || "—", url: p.url })), plateH);
      }
      if (plateEps.length) {
        y += lh(base);
        y += measureEpitaphs(plateEps) + 10;
      }
    }

    y += lh(base);
    y += lh(base);
    y += lh(base);

    if (notes) {
      y += lh(base);
      y += split(notes, leftW, base).length * lh(base);
    }

    return { total: y - margin };

    function measurePeople(): number {
      const c = PEOPLE_COLS;
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * PEOPLE_IMG_W_FACTOR);
      const txtW = Math.max(40, cellW - imgW - gapText);
      let used = 0,
        colI = 0,
        rowMax = 0;
      for (let i = 0; i < persons.length; i++) {
        const textH =
          split(persons[i].last || "—", txtW, base).length * lh(base) +
          split(persons[i].namePatr || "—", txtW, base).length * lh(base) +
          split(persons[i].dates || "—", txtW, base).length * lh(base);
        rowMax = Math.max(rowMax, Math.max(photoH + IMG_BOTTOM_PAD, textH));
        if (++colI >= c || i === persons.length - 1) {
          used += rowMax + gapRow;
          colI = 0;
          rowMax = 0;
        }
      }
      return used;
    }

    function measureGraphics(list: Array<{ name: string; url?: string | null }>, imgH: number): number {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * 0.40);
      const txtW = Math.max(40, cellW - imgW - gapText);
      let used = 0,
        colI = 0,
        rowMax = 0;
      if (!list.length) return lh(base);
      for (let i = 0; i < list.length; i++) {
        const nameH = split(list[i].name || "—", txtW, FILE).length * lh(FILE);
        rowMax = Math.max(rowMax, Math.max(imgH + IMG_BOTTOM_PAD, nameH));
        if (++colI >= c || i === list.length - 1) {
          used += rowMax + gapRow;
          colI = 0;
          rowMax = 0;
        }
      }
      return used;
    }

    function measureEpitaphs(list: string[]): number {
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      let used = 0,
        colI = 0,
        rowMax = 0;
      if (!list.length) return lh(base);
      for (let i = 0; i < list.length; i++) {
        const hTxt = split(list[i], cellW, EP).length * lh(EP);
        rowMax = Math.max(rowMax, hTxt);
        if (++colI >= c || i === list.length - 1) {
          used += rowMax + gapRow;
          colI = 0;
          rowMax = 0;
        }
      }
      return used;
    }
  }

  // Fit loop
  onProgress?.("fit");
  let meas = measureLeft();
  while (meas.total > innerH) {
    let changed = false;
    if (photoH > minImgH || gfxH > minImgH || plateH > minImgH) {
      photoH = Math.max(minImgH, Math.round(photoH * 0.92));
      gfxH = Math.max(minImgH, Math.round(gfxH * 0.92));
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

  /* ===== Render left column ===== */
  let y = margin;
  useFont(true, base);
  doc.text(custName || "—", margin, y);
  y += lh(base);
  useFont(false, base);
  doc.text(custPhone || "—", margin, y);
  y += lh(base);
  useFont(false, 22);
  doc.text(`№ ${orderNo}`, margin, y);
  y += lh(22);

  y += 6;
  hr(y);
  y += 1;

  // Carving item
  if (itemUrl || itemName) {
    useFont(true, TITLE);
    doc.text("Резная работа", margin, y);
    y += lh(TITLE);

    const c = cols(leftW);
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    const imgW = Math.floor(cellW * 0.40);
    const txtW = Math.max(40, cellW - imgW - gapText);
    const cx = margin;
    let usedH = 0;

    if (itemUrl) {
      const data = await urlToDataUrl(itemUrl);
      if (data) {
        const im = new Image();
        await new Promise<void>((rs) => {
          im.onload = () => rs();
          im.src = data;
        });
        const iw = im.naturalWidth || 0,
          ih = im.naturalHeight || 0;
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
    let yT = y;
    const xT = cx + imgW + gapText;
    for (const ln of split(itemName || "—", txtW, FILE)) {
      doc.text(ln, xT, yT);
      yT += lh(FILE);
    }
    y = y + Math.max(usedH, yT - y) + gapRow;
  }

  // People
  y = headingCentered("Люди", y);
  y = await drawPeople(y);

  // Graphics front
  if (gfxFront.length) {
    y = headingCentered("Графика (лицевая)", y, base);
    y = await drawGraphics(y, gfxFront, gfxH);
  }

  // Graphics rear
  if (gfxRear.length) {
    y = headingCentered("Графика (тыльная)", y, base);
    y = await drawGraphics(
      y,
      gfxRear.map((g) => ({
        name: `${g.name || "—"}${(rearCounts[g.id || ""] || 1) > 1 ? ` ×${rearCounts[g.id || ""]}` : ""}`,
        url: g.url
      })),
      gfxH
    );
  }

  // Epitaphs front/rear
  if (epsFront.length) {
    y = headingCentered("Эпитафии (лицевая)", y, base);
    y = drawEpitaphs(y, epsFront) + 10;
  }
  if (epsRear.length) {
    y = headingCentered("Эпитафии (тыльная)", y, base);
    y = drawEpitaphs(y, epsRear) + 10;
  }

  // Plate
  if (plateOn) {
    y = headingCentered("Надгробная плита", y);
    useFont(false, base);
    if (plateSize) {
      doc.text(`Размер: ${plateSize}`, margin, y);
      y += lh(base);
    }
    if (plateThick) {
      doc.text(`Толщина: ${plateThick}`, margin, y);
      y += lh(base);
    }
    if (plateOrient) {
      doc.text(`Ориентация: ${plateOrient === "horizontal" ? "горизонтально" : "вертикально"}`, margin, y);
      y += lh(base);
    }

    if (plateUnique.length) {
      y = headingCentered("Графика (плита)", y, base);
      y = await drawGraphics(
        y,
        plateUnique.map((p) => ({ name: p.name || p.id || "—", url: p.url })),
        plateH
      );
    }
    if (plateEps.length) {
      y = headingCentered("Эпитафии (плита)", y, base);
      y = drawEpitaphs(y, plateEps) + 10;
    }
  }

  // Extras
  useFont(false, base);
  doc.text("Дополнительно", margin, y);
  y += lh(base);
  doc.text(`Цветник: ${flowerbed ? "да" : "нет"}`, margin, y);
  y += lh(base);
  doc.text(`Тумба: ${baseOn ? "да" : "нет"}`, margin, y);
  y += lh(base);

  // Notes
  if (notes) {
    y = headingCentered("Примечания", y, base);
    useFont(false, base);
    for (const ln of split(notes, leftW, base)) {
      doc.text(ln, margin, y);
      y += lh(base);
    }
  }

  /* ===== Right column — sketches ===== */
  onProgress?.("right-column");
  let yR = margin + 80;

  async function placeRight(dataUrl?: string | null, maxH?: number) {
    if (!dataUrl || !maxH) return;
    const im = new Image();
    await new Promise<void>((rs) => {
      im.onload = () => rs();
      im.src = dataUrl!;
    });
    const iw = im.naturalWidth || 0,
      ih = im.naturalHeight || 0;
    if (!iw || !ih) return;
    const s = Math.min(rightW / iw, maxH / ih, 1);
    const w = Math.round(iw * s),
      h = Math.round(ih * s);
    const x = margin + leftW + gapCols + Math.round((rightW - w) / 2);
    doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl!) ? "PNG" : "JPEG", x, yR, w, h, undefined, "FAST");
    yR += h + 18;
  }

  // --- NEW: distribute available height among existing previews (front/back/plate) ---
  // We only place previews that are реально доступны (dataUrl not null).
  const previewList: Array<{ key: "front" | "back" | "plate"; data: string | null }> = [
    { key: "front", data: frontPng },
    { key: "back", data: backPng },
    { key: "plate", data: platePng }
  ].filter((x) => !!x.data);

  if (previewList.length > 0) {
    const gaps = 18;
    const available = Math.max(60, innerH - (yR - margin));
    const gapsTotal = gaps * Math.max(0, previewList.length - 1);

    // Allocate equal maxH blocks; leftover stays as bottom slack (so last fits too).
    const per = Math.floor((available - gapsTotal) / previewList.length);

    for (let i = 0; i < previewList.length; i++) {
      const remaining = Math.max(60, innerH - (yR - margin));
      const remainingCount = previewList.length - i;
      const maxH = i === previewList.length - 1 ? remaining : Math.min(per, Math.floor((remaining - gaps * (remainingCount - 1)) / remainingCount));
      await placeRight(previewList[i].data, maxH);
    }
  }

  /* ===== Separate pages with photos (portraits) ===== */
  for (let i = 0; i < persons.length; i++) {
    const p = persons[i];
    if (!p.photo) continue;
    const data = await urlToDataUrl(p.photo);
    if (!data) continue;

    doc.addPage();
    let yP = margin;

    useFont(false, base);
    for (const ln of split(p.last || "—", pageW - margin * 2, base)) {
      doc.text(ln, margin, yP);
      yP += lh(base);
    }
    for (const ln of split(p.namePatr || "—", pageW - margin * 2, base)) {
      doc.text(ln, margin, yP);
      yP += lh(base);
    }
    for (const ln of split(p.dates || "—", pageW - margin * 2, base)) {
      doc.text(ln, margin, yP);
      yP += lh(base) + 8;
    }

    const im = new Image();
    await new Promise<void>((rs) => {
      im.onload = () => rs();
      im.src = data;
    });
    const iw = im.naturalWidth || 0,
      ih = im.naturalHeight || 0;
    if (iw && ih) {
      const availW = pageW - margin * 2;
      const availH = pageH - margin - yP;
      const s = Math.min(availW / iw, availH / ih, 1);
      const w = Math.round(iw * s),
        h = Math.round(ih * s);
      const x = margin + Math.max(0, (availW - w) / 2);
      doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", x, yP, w, h, undefined, "FAST");
    }
  }

  return doc.output("blob");

  /* ===== Render helpers ===== */
  async function drawGraphics(yStart: number, list: Array<{ name: string; url?: string | null }>, imgH: number) {
    let yLoc = yStart;
    const c = cols(leftW);
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    const imgW = Math.floor(cellW * 0.40);
    const txtW = Math.max(40, cellW - imgW - gapText);

    let colI = 0,
      rowMax = 0,
      rowStartY = yLoc;

    if (!list.length) {
      useFont(false, base);
      doc.text("—", margin, yLoc);
      yLoc += lh(base);
      return yLoc;
    }

    for (let i = 0; i < list.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let usedH = 0;

      const data = await urlToDataUrl(list[i].url || null);
      if (data) {
        const im = new Image();
        await new Promise<void>((rs) => {
          im.onload = () => rs();
          im.src = data;
        });
        const iw = im.naturalWidth || 0,
          ih = im.naturalHeight || 0;
        if (iw && ih) {
          const s = Math.min(imgW / iw, imgH / ih, 1);
          const w = Math.min(imgW, Math.round(iw * s));
          const h = Math.round(ih * s);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
          usedH = h + IMG_BOTTOM_PAD;
        }
      }

      useFont(false, FILE);
      let yTxt = rowStartY;
      const xTxt = cx + imgW + gapText;
      for (const ln of doc.splitTextToSize(list[i].name || "—", txtW)) {
        doc.text(ln, xTxt, yTxt);
        yTxt += lh(FILE);
      }

      rowMax = Math.max(rowMax, Math.max(usedH, yTxt - rowStartY));
      if (++colI >= c || i === list.length - 1) {
        yLoc = rowStartY + rowMax + gapRow;
        rowStartY = yLoc;
        colI = 0;
        rowMax = 0;
      }
    }
    return yLoc;
  }

  function drawEpitaphs(yStart: number, list: string[]) {
    let yLoc = yStart;
    const c = cols(leftW);
    const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
    let colI = 0,
      rowMax = 0,
      rowStartY = yLoc;

    if (!list.length) {
      useFont(false, base);
      doc.text("—", margin, yLoc);
      yLoc += lh(base);
      return yLoc;
    }

    for (let i = 0; i < list.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let yC = rowStartY;
      useFont(false, EP);
      for (const ln of doc.splitTextToSize(list[i], cellW)) {
        doc.text(ln, cx, yC);
        yC += lh(EP);
      }
      rowMax = Math.max(rowMax, yC - rowStartY);
      if (++colI >= c || i === list.length - 1) {
        yLoc = rowStartY + rowMax + gapRow;
        rowStartY = yLoc;
        colI = 0;
        rowMax = 0;
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

    let colI = 0,
      rowMax = 0,
      rowStartY = yLoc;

    if (!persons.length) {
      useFont(false, base);
      doc.text("—", margin, yLoc);
      yLoc += lh(base);
      return yLoc;
    }

    for (let i = 0; i < persons.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let usedH = 0;

      const data = await urlToDataUrl(persons[i].photo || null);
      if (data) {
        const im = new Image();
        await new Promise<void>((rs) => {
          im.onload = () => rs();
          im.src = data;
        });
        const iw = im.naturalWidth || 0,
          ih = im.naturalHeight || 0;
        if (iw && ih) {
          const s = Math.min(imgW / iw, photoH / ih, 1);
          const w = Math.min(imgW, Math.round(iw * s));
          const h = Math.round(ih * s);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
          usedH = h + IMG_BOTTOM_PAD;
        }
      }

      let yTxt = rowStartY;
      const xTxt = cx + imgW + gapText;
      useFont(false, base);
      for (const ln of split(persons[i].last || "—", txtW, base)) {
        doc.text(ln, xTxt, yTxt);
        yTxt += lh(base);
      }
      for (const ln of split(persons[i].namePatr || "—", txtW, base)) {
        doc.text(ln, xTxt, yTxt);
        yTxt += lh(base);
      }
      for (const ln of split(persons[i].dates || "—", txtW, base)) {
        doc.text(ln, xTxt, yTxt);
        yTxt += lh(base);
      }

      const cellH = Math.max(usedH, yTxt - rowStartY);
      rowMax = Math.max(rowMax, cellH);
      if (++colI >= c || i === persons.length - 1) {
        yLoc = rowStartY + rowMax + gapRow;
        rowStartY = yLoc;
        colI = 0;
        rowMax = 0;
      }
    }
    return yLoc;
  }
}

/* ===== Send / Download ===== */
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
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 800);
}
