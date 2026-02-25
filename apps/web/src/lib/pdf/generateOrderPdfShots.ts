// src/lib/pdf/generateOrderPdfShots.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    htmlToImage?: any;
    jspdf?: any;
  }
}

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

async function nodeToPng(node?: HTMLElement | null, pixelRatio = 2, bg = "#ffffff"): Promise<string | null> {
  if (!node) return null;
  const hti = await ensureHtmlToImage();
  return await hti.toPng(node, { backgroundColor: bg, pixelRatio, cacheBust: true });
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

export type GenerateOrderPdfShotsArgs = {
  draft: any;
  intro: any;

  // what we already have on Review screen
  topbarNode: HTMLElement | null;

  frontNode?: HTMLElement | null;

  backNode?: HTMLElement | null;
  backUrlFallback?: string | null;

  plateNodes?: Array<HTMLElement | null>;
  plateUrlFallbacks?: Array<string | null>;

  // text to render (already built in ReviewAndSendStep)
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

  // geometry
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const innerW = pageW - margin * 2;
  const innerH = pageH - margin * 2;
  const gapCols = 28;
  const rightW = Math.round(innerW * 0.40);
  const leftW = innerW - gapCols - rightW;

  // capture images
  onProgress?.("capture");

  const topbarPng = await nodeToPng(topbarNode, 2, "#111111");

  const frontPng = frontNode ? await nodeToPng(frontNode, 2, "#ffffff") : null;

  const backPng = backNode
    ? await nodeToPng(backNode, 2, "#ffffff")
    : await urlToDataUrl(backUrlFallback || (draft as any)?.editorBack?.previewHiUrl || (draft as any)?.editorBack?.previewUrl || null);

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

  // page 1: left topbar, right sketches
  onProgress?.("page-1");

  // helper: place image with contain fit
  async function placeImage(dataUrl: string, x: number, y: number, maxW: number, maxH: number) {
    const im = new Image();
    await new Promise<void>((rs, rj) => {
      im.onload = () => rs();
      im.onerror = () => rj(new Error("img load"));
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

  // LEFT: topbar shot
  if (topbarPng) {
    await placeImage(topbarPng, margin, margin, leftW, innerH);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("TopBar screenshot отсутствует", margin, margin + 30);
  }

  // RIGHT: sketches list (front/back/plates)
  const sketches: Array<{ label: string; data: string | null }> = [
    { label: "Лицевая", data: frontPng },
    { label: "Тыльная", data: backPng },
    ...platePngs.map((d, idx) => ({ label: `Плита ${idx + 1}`, data: d }))
  ].filter((x) => !!x.data);

  let yR = margin;
  const xR = margin + leftW + gapCols;

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
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(sketches[i].label, xR + rightW / 2, yR + 20, { align: "center" });

      // image box below label
      const boxY = yR + 34;
      const boxH = Math.max(40, maxH - 34);
      await placeImage(sketches[i].data!, xR, boxY, rightW, boxH);

      yR += maxH + gap;
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(16);
    doc.text("Эскизы отсутствуют", xR + rightW / 2, margin + 30, { align: "center" });
  }

  // page 2: text version
  onProgress?.("text-page");
  doc.addPage();

  const orderNo = String(intro?.orderNumber || "—");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(`Текст заказа №${orderNo}`, margin, margin + 24);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);

  const text = String(orderText || "").trim();
  const body = text || "—";
  let yT = margin + 60;
  const lines = splitToLines(doc, body, innerW);

  const lineH = 20;
  for (const ln of lines) {
    if (yT > pageH - margin) {
      doc.addPage();
      yT = margin;
    }
    doc.text(String(ln), margin, yT);
    yT += lineH;
  }

  // photos pages
  if (includeAttachedPhotos) {
    onProgress?.("photos");
    const persons: any[] = (((draft?.engraving?.persons as any[]) || []).filter(Boolean) as any[]).concat(
      (((draft as any)?.editorBack?.people as any[]) || []).filter(Boolean)
    );

    for (const p of persons) {
      const photo =
        p?.photoPreview || p?.photoDataUrl || p?.photoUrl || p?.photo || null;

      if (!photo) continue;

      const data = await urlToDataUrl(photo);
      if (!data) continue;

      doc.addPage();

      const fio = [
        String(p?.lastName || "").trim(),
        [p?.firstName, p?.middleName].map((x: any) => String(x || "").trim()).filter(Boolean).join(" ")
      ].filter(Boolean).join(" ").trim();

      const dates = [p?.birthDate, p?.deathDate].map((x: any) => String(x || "").trim()).filter(Boolean).join(" — ");

      let yP = margin;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text(fio || "—", margin, yP + 22);
      yP += 36;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(16);
      if (dates) {
        doc.text(dates, margin, yP + 16);
        yP += 28;
      } else {
        yP += 10;
      }

      await placeImage(data, margin, yP, innerW, pageH - margin - yP);
    }
  }

  return doc.output("blob");
}