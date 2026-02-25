// src/lib/pdf/generateOrderPdfShots.ts
// PDF сборка "как в Telegram":
// - 1-я страница: слева скрин TopBar (header+panel), справа эскизы (лицевая/тыльная/плиты) как превью.
// - 2-я страница: текстовая версия заказа (кириллица безопасно: строки с нелатиницей рисуем на canvas и вставляем PNG).
// - Далее: отдельные страницы с фотографиями (лицевая + тыл), если includeAttachedPhotos=true.
//
// Зависимости динамические (CDN):
// - html-to-image
// - jspdf
//
// ВАЖНО: стандартные PDF-шрифты (Helvetica) не поддерживают кириллицу.
// Поэтому для doc.text(...) включён fallback: если строка содержит нелатиницу,
// она рендерится в PNG через canvas и добавляется в PDF как изображение.

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
async function nodeToPng(node?: HTMLElement | null, pixelRatio = 2, bg = "#ffffff"): Promise<string | null> {
  if (!node) return null;
  const hti = await ensureHtmlToImage();
  return await hti.toPng(node, {
    backgroundColor: bg,
    pixelRatio: Math.max(1, Math.min(2, pixelRatio)),
    cacheBust: true
  });
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

/* ===== Fallback: кириллицу рисуем на canvas и вставляем в PDF как PNG ===== */
function hasNonLatin(text: string): boolean {
  return /[^\x00-\x7E]/.test(text);
}
type DrawLineOpts = { align?: "left" | "center" | "right" };

function renderLineToPng(text: string, px: number, bold = false) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const font = `${bold ? "700" : "400"} ${px}px -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Noto Sans",sans-serif`;

  // measure
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = font;

  const m = ctx.measureText(text);
  const ascent = Math.ceil((m as any).actualBoundingBoxAscent || px * 0.8);
  const descent = Math.ceil((m as any).actualBoundingBoxDescent || px * 0.2);
  const w = Math.ceil(m.width) + 2;
  const h = ascent + descent + 2;

  // render
  const can = document.createElement("canvas");
  can.width = Math.max(1, Math.round(w * dpr));
  can.height = Math.max(1, Math.round(h * dpr));

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
  (doc as any).__text_original = origText;

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
export type GenerateOrderPdfShotsArgs = {
  draft: any;
  intro: any;

  // Screenshot container that includes header + opened panel
  topbarNode: HTMLElement | null;

  // Sketches
  frontNode?: HTMLElement | null;

  backNode?: HTMLElement | null;
  backUrlFallback?: string | null;

  plateNodes?: Array<HTMLElement | null>;
  plateUrlFallbacks?: Array<string | null>;

  // Text version (already built in Review step)
  orderText?: string;

  includeAttachedPhotos?: boolean;
  onProgress?: (stage: string) => void;
};

export async function generateOrderPdfShots(args: GenerateOrderPdfShotsArgs): Promise<Blob> {
  const {
    draft,
    intro,
    topbarNode,
    frontNode,
    backNode,
    backUrlFallback,
    plateNodes,
    plateUrlFallbacks,
    orderText,
    includeAttachedPhotos = true,
    onProgress
  } = args;

  onProgress?.("init");
  const jsPDF = await ensureJsPdf();
  const doc = new jsPDF({ unit: "px", format: [1512, 2138] });

  // State for cyrillic-as-image fallback
  let curFontSize = 16;
  let curFontBold = false;
  const useFont = (bold: boolean, size: number) => {
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
  const gapCols = 28;
  const rightW = Math.round(innerW * 0.40);
  const leftW = innerW - gapCols - rightW;

  async function placeImageContain(dataUrl: string, x: number, y: number, maxW: number, maxH: number) {
    const im = new Image();
    await new Promise<void>((rs, rj) => {
      im.onload = () => rs();
      im.onerror = () => rj(new Error("image load error"));
      im.src = dataUrl;
    });

    const iw = im.naturalWidth || 1;
    const ih = im.naturalHeight || 1;
    const s = Math.min(maxW / iw, maxH / ih, 1);
    const w = Math.round(iw * s);
    const h = Math.round(ih * s);
    const dx = x + Math.round((maxW - w) / 2);
    const dy = y + Math.round((maxH - h) / 2);

    doc.addImage(dataUrl, /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG", dx, dy, w, h, undefined, "FAST");
    return { w, h, dx, dy };
  }

  /* ===== Capture screenshots ===== */
  onProgress?.("capture");

  const topbarPng = await nodeToPng(topbarNode, 2, "#111111");

  const frontPng = frontNode ? await nodeToPng(frontNode, 2, "#ffffff") : null;

  const backPng = backNode
    ? await nodeToPng(backNode, 2, "#ffffff")
    : await urlToDataUrl(
        backUrlFallback ||
          (draft as any)?.editorBack?.previewHiUrl ||
          (draft as any)?.editorBack?.previewUrl ||
          null
      );

  const normPlateNodes: Array<HTMLElement | null> = Array.isArray(plateNodes) ? plateNodes : [];
  const normPlateFallbacks: Array<string | null> = Array.isArray(plateUrlFallbacks) ? plateUrlFallbacks : [];
  const plateCount = Math.max(normPlateNodes.length, normPlateFallbacks.length, 0);

  const platePngs: Array<string | null> = [];
  for (let i = 0; i < plateCount; i++) {
    const n = normPlateNodes[i] || null;
    const fb = normPlateFallbacks[i] || null;
    const png = n ? await nodeToPng(n, 2, "#ffffff") : await urlToDataUrl(fb);
    platePngs.push(png || null);
  }

  /* ===== Page 1: left topbar, right sketches ===== */
  onProgress?.("page-1");

  if (topbarPng) {
    await placeImageContain(topbarPng, margin, margin, leftW, innerH);
  } else {
    useFont(true, 22);
    doc.text("TopBar screenshot отсутствует", margin, margin + 30);
  }

  const sketches: Array<{ label: string; data: string | null }> = [
    { label: "Лицевая", data: frontPng },
    { label: "Тыльная", data: backPng },
    ...platePngs.map((d, idx) => ({ label: `Плита ${idx + 1}`, data: d }))
  ].filter((x) => !!x.data);

  const xR = margin + leftW + gapCols;
  let yR = margin;

  if (sketches.length > 0) {
    const gap = 18;
    const available = innerH;
    const gapsTotal = gap * Math.max(0, sketches.length - 1);
    const per = Math.floor((available - gapsTotal) / sketches.length);

    for (let i = 0; i < sketches.length; i++) {
      const remaining = Math.max(60, innerH - (yR - margin));
      const remainingCount = sketches.length - i;
      const maxH =
        i === sketches.length - 1
          ? remaining
          : Math.min(per, Math.floor((remaining - gap * (remainingCount - 1)) / remainingCount));

      // label
      useFont(true, 18);
      doc.text(sketches[i].label, xR + rightW / 2, yR + 20, { align: "center" });

      // image box under label
      const boxY = yR + 34;
      const boxH = Math.max(40, maxH - 34);
      await placeImageContain(sketches[i].data!, xR, boxY, rightW, boxH);

      yR += maxH + gap;
    }
  } else {
    useFont(false, 16);
    doc.text("Эскизы отсутствуют", xR + rightW / 2, margin + 30, { align: "center" });
  }

  /* ===== Page 2: text version ===== */
  onProgress?.("text-page");
  doc.addPage();

  const orderNo = String(intro?.orderNumber || "—");
  useFont(true, 24);
  doc.text(`Текст заказа №${orderNo}`, margin, margin + 24);

  useFont(false, 16);
  const body = String(orderText || "").trim() || "—";

  const lines = splitToLines(doc, body, innerW);
  const lineH = 20;

  let yT = margin + 60;
  for (const ln of lines) {
    if (yT > pageH - margin) {
      doc.addPage();
      yT = margin;
      useFont(false, 16);
    }
    doc.text(String(ln), margin, yT);
    yT += lineH;
  }

  /* ===== Photos pages ===== */
  if (includeAttachedPhotos) {
    onProgress?.("photos");

    const frontPeople = (((draft?.engraving?.persons as any[]) || []).filter(Boolean) as any[]) || [];
    const rearPeople = ((((draft as any)?.editorBack?.people as any[]) || []).filter(Boolean) as any[]) || [];

    const persons = [...frontPeople, ...rearPeople];

    for (const p of persons) {
      const photo =
        p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || null;

      if (!photo) continue;

      const data = await urlToDataUrl(String(photo));
      if (!data) continue;

      doc.addPage();

      const fio = [
        String(p?.lastName || "").trim(),
        [p?.firstName, p?.middleName].map((x: any) => String(x || "").trim()).filter(Boolean).join(" ")
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const dates = [p?.birthDate, p?.deathDate].map((x: any) => String(x || "").trim()).filter(Boolean).join(" — ");

      let yP = margin;

      useFont(true, 22);
      doc.text(fio || "—", margin, yP + 22);
      yP += 36;

      useFont(false, 16);
      if (dates) {
        doc.text(dates, margin, yP + 16);
        yP += 28;
      } else {
        yP += 10;
      }

      await placeImageContain(data, margin, yP, innerW, pageH - margin - yP);
    }
  }

  return doc.output("blob");
}