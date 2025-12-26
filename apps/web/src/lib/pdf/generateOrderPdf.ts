// apps/web/src/lib/pdf/generateOrderPdf.ts
// Генерация PDF вынесена в отдельный модуль.
//
// Экспорт:
// - generateOrderPdf(args) -> Blob (PDF)
// - downloadBlob(blob, filename)
// - sendPdfToServer(blob, meta)
//
// В этой версии:
// - Номер заказа — в самом верху по центру (первой строкой).
// - Верхний эскиз справа опущен ниже (добавлен верхний отступ).
// - Усопшие — всегда 2 столбца; миниатюры крупнее; метрика в 3 строки; при переполнении добавляются новые строки.
// - Эпитафии: увеличен нижний отступ (между блоком эпитафий и следующими разделами).

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

/* ===== Century Schoolbook (bold + regular, если доступен) ===== */
let fontsReady = false;
let regularAvailable = false;
async function ensureCenturyFonts(doc: any) {
  if (fontsReady) return { regularAvailable };
  try {
    const bold = await fetch("/fonts/CenturySchoolbook-Bold.ttf", { mode: "cors" });
    if (bold.ok) {
      const ab = await bold.arrayBuffer();
      const b64 = toBase64(ab);
      doc.addFileToVFS("CenturySchoolbook-Bold.ttf", b64);
      doc.addFont("CenturySchoolbook-Bold.ttf", "CenturySchoolbook", "bold");
    }
  } catch {}
  try {
    const reg = await fetch("/fonts/CenturySchoolbook-Regular.ttf", { mode: "cors" });
    if (reg.ok) {
      const ab = await reg.arrayBuffer();
      const b64 = toBase64(ab);
      doc.addFileToVFS("CenturySchoolbook-Regular.ttf", b64);
      doc.addFont("CenturySchoolbook-Regular.ttf", "CenturySchoolbook", "normal");
      regularAvailable = true;
    }
  } catch {}
  fontsReady = true;
  return { regularAvailable };
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
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}
function lines(doc: any, txt: string, maxW: number) {
  return doc.splitTextToSize(txt, maxW);
}
function dl(text: string) { return (text || "").trim(); }

/* ===== Публичное API ===== */
export type GeneratePdfArgs = {
  draft: any;
  intro: any;
  frontNode?: HTMLElement | null;
  backNode?: HTMLElement | null;
  backUrlFallback?: string | null;
  onProgress?: (stage: string) => void;
};

export async function generateOrderPdf(args: GeneratePdfArgs): Promise<Blob> {
  const { draft, intro, frontNode, backNode, backUrlFallback, onProgress } = args;

  onProgress?.("init");
  const jsPDF = await ensureJsPdf();
  const doc = new jsPDF({ unit: "px", format: [1512, 2138] });
  const { regularAvailable } = await ensureCenturyFonts(doc);

  // Геометрия
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  const gapCols = 28;
  const rightW = Math.round(innerW * 0.40);
  const leftW = innerW - gapCols - rightW;

  // Типографика
  let base = 32;
  const minBase = 22;
  const SIZE_TITLE = 28;
  const SIZE_FILE = 30;
  const SIZE_EP = 34;
  let lhK = 1.22;
  const minLhK = 1.14;

  // Усопшие: 2 столбца + более крупные миниатюры
  const PEOPLE_COLS = 2;
  const PEOPLE_IMG_W_FACTOR = 0.50; // 50% ширины ячейки под миниатюру
  let photoH = 160;                 // крупнее
  let gfxH = 90, plateH = 90;
  const minImgH = 56;

  // Эпитафии: увеличить нижний отступ
  const EP_BOTTOM_EXTRA = 24;

  let minColW = 255, gapCol = 16, gapRow = 16, gapText = 14;

  const FONT = "CenturySchoolbook";
  const setFont = (bold = false, size = base) => {
    if (bold) doc.setFont(FONT, "bold");
    else doc.setFont(regularAvailable ? FONT : "helvetica", regularAvailable ? "normal" : undefined);
    doc.setFontSize(size);
  };
  const lh = (size = base) => Math.ceil(size * lhK);
  const split = (text: string, width: number, size = base, bold = false) => { setFont(bold, size); return lines(doc, text, width); };
  const cols = (availW: number) => Math.max(2, Math.floor((availW + gapCol) / (minColW + gapCol)));
  const hr = (y: number) => { doc.setDrawColor(180); doc.setLineWidth(1.2); doc.line(margin, y, margin + leftW, y); };

  // Данные
  const custName = dl(intro?.intro?.customerName) || "—";
  const custPhone = dl(intro?.intro?.customerPhone) || "—";
  const orderNo = String(intro?.orderNumber || "—");

  const people: Array<{ photo?: string | null; last: string; namePatr: string; dates: string }> =
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
  (rearIds || []).forEach((id) => (rearCounts[id] = (rearCounts[id] || 0) + 1));
  const gfxRear = Array.from(new Set(rearIds || [])).map((id) => rearMeta?.[id] || { id, name: id, url: "" });

  const epsFront: string[] = toParagraphsSafe((draft?.engraving as any)?.epitaphs ?? (draft?.engraving as any)?.epitaphText);
  const epsRear: string[] = (((draft as any)?.editorBack?.epitaphTexts || []) as string[]).filter(Boolean);

  const plateOn = !!(draft as any)?.extras?.headstonePlate;
  const plateSize = (draft as any)?.extras?.plateSize || "—";
  const plateThick = (draft as any)?.extras?.plateThickness || "—";
  const plateList: { id: string; name: string; url?: string }[] =
    Array.from(new Set(((draft as any)?.extras?.plateGraphicsIds as string[]) || []))
    .map((gid) => ((draft as any)?.extras?.plateGraphicsMeta || {})[gid] || { id: gid, name: gid, url: "" });
  const plateEps: string[] = toParagraphsSafe(((draft as any)?.extras?.plateEpitaph || "").trim());
  const flowerbed = !!(draft as any)?.extras?.flowerbed;
  const baseOn = !!((draft as any)?.extras?.base);
  const notes = dl((draft as any)?.extras?.orderNotes);

  // Снимки эскизов
  onProgress?.("capture-sketches");
  const frontPng = frontNode ? await nodeToPng(frontNode) : null;
  const backPng = backNode ? await nodeToPng(backNode) : await urlToDataUrl(backUrlFallback || (draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl);

  // Оценка высоты левой колонки
  function measureLeft(): number {
    let y = margin;

    // 1) Номер заказа — САМЫЙ ВЕРХ (по центру)
    split(`Заказ № ${orderNo}`, leftW, base, true).forEach(() => y += lh(base));
    // 2) Имя и телефон — ниже, слева
    split(`${custName} · ${custPhone}`, leftW, base, false).forEach(() => y += lh(base));

    // Лицевая
    y += 6; y += 1;
    split("Лицевая", leftW, SIZE_TITLE, true).forEach(() => y += lh(SIZE_TITLE));

    split("Усопшие", leftW, base).forEach(() => y += lh(base));
    y += measurePeople(y);

    y += 4; split("Графика", leftW, base).forEach(() => y += lh(base));
    y += measureGraphics(gfxFront, y, gfxH);

    y += 4; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
    y += measureEpitaphs(epsFront, y) + EP_BOTTOM_EXTRA;

    // Тыльная
    y += 10; y += 1;
    split("Тыльная", leftW, SIZE_TITLE, true).forEach(() => y += lh(SIZE_TITLE));
    split("Усопшие", leftW, base).forEach(() => y += lh(base));
    y += lh(base);

    y += 4; split("Графика", leftW, base).forEach(() => y += lh(base));
    y += measureGraphics(
      gfxRear.map(g => ({ name: `${g.name || "—"}${(rearCounts[g.id || ""] || 1) > 1 ? ` ×${rearCounts[g.id || ""]}` : ""}`, url: g.url })),
      y, gfxH
    );

    y += 4; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
    y += measureEpitaphs(epsRear, y) + EP_BOTTOM_EXTRA;

    // Плита
    y += 10; y += 1;
    split("Надгробная плита", leftW, SIZE_TITLE, true).forEach(() => y += lh(SIZE_TITLE));
    split(`Размер: ${plateOn ? plateSize : "—"}`, leftW, base).forEach(() => y += lh(base));
    split(`Толщина: ${plateOn ? plateThick : "—"}`, leftW, base).forEach(() => y += lh(base));

    y += 4; split("Графика", leftW, base).forEach(() => y += lh(base));
    y += measureGraphics(plateOn ? plateList.map(p => ({ name: p.name || "—", url: p.url })) : [], y, plateH);

    y += 4; split("Эпитафии", leftW, base).forEach(() => y += lh(base));
    y += measureEpitaphs(plateOn ? plateEps : [], y) + EP_BOTTOM_EXTRA;

    // Дополнительно
    y += 10; split("Дополнительно", leftW, base).forEach(() => y += lh(base));
    split(`Цветник: ${flowerbed ? "да" : "нет"}`, leftW, base).forEach(() => y += lh(base));
    split(`Тумба: ${baseOn ? "да" : "нет"}`, leftW, base).forEach(()people[i].last || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
      for (const ln of split(people[i].namePatr || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }
      for (const ln of split(people[i].dates || "—", txtW, base)) { doc.text(ln, xTxt, yTxt); yTxt += lh(base); }

      const cellH = Math.max(usedH, yTxt - rowStartY);
      rowMax = Math.max(rowMax, cellH);

      if (++colI >= c || i === people.length - 1) {
        yLoc = rowStartY + rowMax + gapRow; rowStartY = yLoc; colI = 0; rowMax = 0;
      }
    }
    return yLoc;
  }

  async function placeRight(dataUrl?: string | null, maxH?: number) {
    if (!dataUrl || !maxH) return;
    const im = new Image(); await new Promise<void>((rs) => { im.onload = () => rs(); im.src = dataUrl!; });
    const iw = im.naturalWidth || 0, ih = im.naturalHeight || 0;
    if (!iw || !ih) return;
    const s = Math.min(rightW / iw, maxH / ih, 1);
    const w = Math.round(iw * s), h = Math.round(ih * s);
    const x = margin + leftW + gapCols + Math.round((rightW - w) / 2);
    doc.addImage(dataUrl!, /^data:image\/png/i.test(dataUrl!) ? "PNG" : "JPEG", x, yR, w, h, undefined, "FAST");
    yR += h + 18;
  }
}

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

/* ===== утил ===== */
function toParagraphsSafe(input?: string | string[] | null): string[] {
  if (Array.isArray(input)) return input.map(s => String(s || "").replace(/\r\n?/g, "\n").trim()).filter(Boolean);
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const blocks = t.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  return blocks.length ? blocks : t.split(/\n/g).map(s => s.trim()).filter(Boolean);
}
