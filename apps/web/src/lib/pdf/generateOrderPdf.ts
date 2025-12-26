// apps/web/src/lib/pdf/generateOrderPdf.ts
// PDF в стиле TopBar:
// - Слева — компактная «панель заказа» как в TopBar: Имя/Телефон, № заказа,
//   Резная работа (миниатюра того же размера, что и остальные), Люди (2 колонки),
//   Графика (лицевая/тыльная), Эпитафии (лицевая/тыльная),
//   Плита — выбранное (параметры, графика, эпитафии),
//   Дополнительно (Цветник, Тумба) и Примечания.
// - Справа — эскизы (лицевой сверху, тыльный ниже).
//
// Экспорт:
// - generateOrderPdf(args) -> Blob
// - downloadBlob(blob, filename)
// - sendPdfToServer(blob, meta)
//
// Зависимости шрифтов: Noto Sans тянется с CDN (Unicode, с кириллицей).

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { htmlToImage?: any; jspdf?: any } }

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

/* ===== Unicode fonts via CDN (Noto Sans) ===== */
let fontsReady = false;
let activeFont = "PDFNotoSans";
let haveRegular = false;
let haveBold = false;
async function ensurePdfFonts(doc: any) {
  if (fontsReady) return { activeFont, haveRegular, haveBold };
  const CDN_NOTO_REG = "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
  const CDN_NOTO_BOLD = "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoSans/NotoSans-Bold.ttf";
  async function addTtf(url: string, fam: string, style: "normal" | "bold") {
    try {
      const r = await fetch(url, { mode: "cors" });
      if (!r.ok) return false;
      const ab = await r.arrayBuffer();
      const b64 = toBase64(ab);
      const vfs = `${fam}-${style}-${url.split("/").pop() || "font"}.ttf`;
      doc.addFileToVFS(vfs, b64);
      doc.addFont(vfs, fam, style);
      return true;
    } catch { return false; }
  }
  haveRegular = await addTtf(CDN_NOTO_REG, "PDFNotoSans", "normal");
  haveBold = await addTtf(CDN_NOTO_BOLD, "PDFNotoSans", "bold");
  fontsReady = true;
  return { activeFont, haveRegular, haveBold };
}
function toBase64(ab: ArrayBuffer) {
  let binary = ""; const bytes = new Uint8Array(ab);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || "")); fr.readAsDataURL(blob);
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
const isCarving = (name?: string) => /резн|резная|барельеф|relief/i.test(String(name || ""));

/* ===== Public API ===== */
export type GeneratePdfArgs = {
  draft: any;                     // order draft
  intro: any;                     // intro state (name/phone/order number)
  frontNode?: HTMLElement | null; // DOM node for front sketch
  backNode?: HTMLElement | null;  // DOM node for back sketch
  backUrlFallback?: string | null;// fallback image URL for back sketch
  onProgress?: (stage: string) => void;
};

export async function generateOrderPdf(args: GeneratePdfArgs): Promise<Blob> {
  const { draft, intro, frontNode, backNode, backUrlFallback, onProgress } = args;

  onProgress?.("init");
  const jsPDF = await ensureJsPdf();
  const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
  await ensurePdfFonts(doc);

  // Page grid
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  const rightW = Math.round(innerW * 0.40);
  const gapCols = 28;
  const leftW = innerW - rightW - gapCols;

  // Typography, compact like TopBar
  let base = 30;
  const minBase = 20;
  const TITLE = 28;
  const FILE = 28;
  const EP = 32;
  let lhK = 1.18;
  const minLhK = 1.10;

  // Cards, equal mini size for everything incl. «резная работа»
  const PEOPLE_COLS = 2;
  const PEOPLE_IMG_W_FACTOR = 0.50;
  let photoH = 140;
  let gfxH = 80;
  let plateH = 80;
  const minImgH = 54;

  let minColW = 240, gapCol = 14, gapRow = 12, gapText = 12;

  // Safe font selection (never helvetica unless forced)
  const setFont = (bold = false, size = base) => {
    const list = (doc.getFontList && doc.getFontList()) || {};
    const has = (fam: string, style: "normal" | "bold") => !!(list[fam] && (list[fam] as any)[style]);
    let fam = activeFont;
    let style: "normal" | "bold" = bold ? "bold" : "normal";
    if (!has(fam, style)) {
      if (has(fam, style === "bold" ? "normal" : "bold")) style = style === "bold" ? "normal" : "bold";
      else if (has("PDFNotoSans", "normal")) { fam = "PDFNotoSans"; style = "normal"; }
      else if (has("times", "normal")) { fam = "times"; style = "normal"; }
    }
    doc.setFont(fam, style);
    doc.setFontSize(size);
  };
  const lh = (size = base) => Math.ceil(size * lhK);
  const split = (text: string, width: number, size = base, bold = false) => { setFont(bold, size); return splitToLines(doc, text, width); };
  const cols = (availW: number) => Math.max(2, Math.floor((availW + gapCol) / (minColW + gapCol)));
  const hr = (y: number) => { doc.setDrawColor(210); doc.setLineWidth(1.1); doc.line(margin, y, margin + leftW, y); };

  // Data
  const custName = dl(intro?.intro?.customerName) || "—";
  const custPhone = dl(intro?.intro?.customerPhone) || "—";
  const orderNo = String(intro?.orderNumber || "—");

  const persons: Array<{ photo?: string | null; last: string; namePatr: string; dates: string }> =
    (((draft?.engraving?.persons as any[]) || []).filter(Boolean)).map((p: any) => ({
      photo: p.photoPreview || p.photoDataUrl || p.photoUrl || p.photo || null,
      last: dl(p.lastName),
      namePatr: [dl(p.firstName), dl(p.middleName)].filter(Boolean).join(" "),
      dates: [dl(p.birthDate), dl(p.deathDate)].filter(Boolean).join(" — ")
    }));

  const gfxFront: Array<{ name: string; url?: string | null }> =
    ((draft as any)?.graphics || []).map((g: any) => ({ name: g.name || g.id || "—", url: g.preview || g.url || null }));

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

  // Sketches (right column)
  onProgress?.("capture-sketches");
  const frontPng = frontNode ? await nodeToPng(frontNode) : null;
  const backPng = backNode ? await nodeToPng(backNode) : await urlToDataUrl(backUrlFallback || (draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl);

  /* ========== Measure left column (to fit) ========== */
  function measureLeft() {
    let y = margin;

    // Head like TopBar
    split(custName || "—", leftW, base, true).forEach(() => y += lh(base));
    split(custPhone || "—", leftW, base, false).forEach(() => y += lh(base));
    split(`№ ${orderNo}`, leftW, 22, false).forEach(() => y += lh(22));

    // «Резная работа» (миниатюра как у графики)
    if (itemUrl || itemName) {
      y += 6; split("Резная работа", leftW, TITLE, true).forEach(() => y += lh(TITLE));
      const c = cols(leftW);
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      // одна карточка
      const nameH = split(itemName || "—", cellW - Math.floor(cellW * 0.40) - gapText, FILE).length * lh(FILE);
      y += Math.max(gfxH, nameH) + gapRow;
    }

    // Люди
    if (persons.length) {
      y += 6; split("Люди", leftW, TITLE, true).forEach(() => y += lh(TITLE));
      y += measurePeople();
    }

    // Графика (лицевая, тыльная)
    if (gfxFront.length) {
      y += 6; split("Графика (лицевая)", leftW, base).forEach(() => y += lh(base));
      y += measureGraphics(gfxFront, gfxH);
    }
    if (gfxRear.length) {
      y += 6; split("Графика (тыльная)", leftW, base).forEach(() => y += lh(base));
      y += measureGraphics(gfxRear.map(g => ({ name: `${g.name || "—"}${(rearCounts[g.id || ""] || 1) > 1 ? ` ×${rearCounts[g.id || ""]}` : ""}`, url: g.url })), gfxH);
    }

    // Эпитафии
    if (epsFront.length || epsRear.length) {
      y += 6; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
      y += measureEpitaphs([...epsFront, ...epsRear]) + 10;
    }

    // Плита
    let plateTop = y, plateBottom = y;
    if (plateOn) {
      y += 10; plateTop = y;
      split("Надгробная плита — выбрано", leftW, TITLE, true).forEach(() => y += lh(TITLE));
      if (plateSize) { split(`Размер: ${plateSize}`, leftW, base).forEach(() => y += lh(base)); }
      if (plateThick) { split(`Толщина: ${plateThick}`, leftW, base).forEach(() => y += lh(base)); }
      if (plateOrient) { split(`Ориентация: ${plateOrient === "horizontal" ? "горизонтально" : "вертикально"}`, leftW, base).forEach(() => y += lh(base)); }

      if (plateUnique.length) {
        y += 6; split("Графика плиты", leftW, base).forEach(() => y += lh(base));
        y += measureGraphics(plateUnique.map(p => ({ name: p.name || p.id || "—", url: p.url })), plateH);
      }
      if (plateEps.length) {
        y += 6; split("Эпитафии плиты", leftW, base).forEach(() => y += lh(base));
        y += measureEpitaphs(plateEps) + 10;
      }
      plateBottom = y;
    }

    // Дополнительно
    y += 6; split("Дополнительно", leftW, base).forEach(() => y += lh(base));
    split(`Цветник: ${flowerbed ? "да" : "нет"}`, leftW, base).forEach(() => y += lh(base));
    split(`Тумба: ${baseOn ? "да" : "нет"}`, leftW, base).forEach(() => y += lh(base));

    // Примечания
    if (notes) {
      y += 6; split("Примечания", leftW, base).forEach(() => y += lh(base));
      y += split(notes, leftW, base).length * lh(base);
    }

    return { total: y - margin, plateTop, plateBottom };

    function measurePeople(): number {
      const c = PEOPLE_COLS;
      const cellW = Math.floor((leftW - gapCol * (c - 1)) / c);
      const imgW = Math.floor(cellW * PEOPLE_IMG_W_FACTOR);
      const txtW = Math.max(40, cellW - imgW - gapText);
      let used = 0, colI = 0, rowMax = 0;
      for (let i = 0; i < persons.length; i++) {
        const hText =
          split(persons[i].last || "—", txtW, base).length * lh(base) +
          split(persons[i].namePatr || "—", txtW, base).length * lh(base) +
          split(persons[i].dates || "—", txtW, base).length * lh(base);
        const hCell = Math.max(photoH, hText);
        rowMax = Math.max(rowMax, hCell);
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
        const hCell = Math.max(imgH, nameH);
        rowMax = Math.max(rowMax, hCell);
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
        if (++colI >= c || i === list.length - (40, cellW - imgW - gapText);

    let colI = 0, rowMax = 0, rowStartY = yLoc;
    if (!list.length) { setFont(false, base); doc.text("—", margin, yLoc); yLoc += lh(base); return yLoc; }

    for (let i = 0; i < list.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let usedH = 0;

      const data = await urlToDataUrl(list[i].url || null);
      if (data) {
        const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = data; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (iw && ih) {
          const s = Math.min(imgW / iw, imgH / ih, 1); // резная работа — тот же imgH
          const w = Math.min(imgW, Math.round(iw * s));
          const h = Math.round(ih * s);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
          usedH = h;
        }
      }

      setFont(false, FILE);
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
    if (!list.length) { setFont(false, base); doc.text("—", margin, yLoc); yLoc += lh(base); return yLoc; }

    for (let i = 0; i < list.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let yC = rowStartY; setFont(false, EP);
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
    if (!persons.length) { setFont(false, base); doc.text("—", margin, yLoc); yLoc += lh(base); return yLoc; }

    for (let i = 0; i < persons.length; i++) {
      const cx = margin + colI * (cellW + gapCol);
      let usedH = 0;

      const data = await urlToDataUrl(persons[i].photo || null);
      if (data) {
        const im = new Image(); await new Promise<void>(rs => { im.onload = () => rs(); im.src = data; });
        const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
        if (iw && ih) {
          const s = Math.min(imgW / iw, photoH / ih, 1);
          const w = Math.min(imgW, Math.round(iw * s));
          const h = Math.round(ih * s);
          doc.addImage(data, /^data:image\/png/i.test(data) ? "PNG" : "JPEG", cx, rowStartY, w, h, undefined, "FAST");
          usedH = h;
        }
      }

      let yTxt = rowStartY; const xTxt = cx + imgW + gapText;
      setFont(false, base);
      for (const ln of split(persons[i].last || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
      for (const ln of split(persons[i].namePatr || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
      for (const ln of split(persons[i].dates || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }

      const cellH = Math.max(usedH, yTxt - rowStartY);
      rowMax = Math.max(rowMax, cellH);

      if (++colI >= c || i === persons.length - 1) {
        yLoc = rowStartY + rowMax + gapRow; rowStartY = yLoc; colI = 0; rowMax = 0;
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
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
