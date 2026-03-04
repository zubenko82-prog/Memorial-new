// src/lib/stackedPreview.ts
//
// Генерация превью для тыла/плит (canvas -> dataURL)
//
// ВАЖНО: этот файл не зависит от React. Его можно вызывать из любых шагов.
// Здесь собраны:
// - loadImageSafe
// - drawImageCover/drawImageContain
// - buildSilhouetteOverlayDataUrl (для тыла с отзеркаливанием)
// - рендер "портрет/метрика/графика/эпитафии" в композицию 1:2

export const PREVIEW_W = 450;
export const PREVIEW_H = 900;

export const FONT_CENTURY = `"Century Schoolbook","Times New Roman",serif`;

export type StackItem =
  | { kind: "photo"; url: string }
  | { kind: "metrica"; lastName: string; firstName: string; middleName: string; dates: string }
  | { kind: "img"; url: string }
  | { kind: "text"; text: string };

export type PreviewBg =
  | { type: "gradient" }
  | { type: "image"; url: string; fit?: "cover" | "contain" }
  | { type: "solid"; color: string };

function normEpitaph(t: string) {
  return (t || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function splitHardLines(text: string): string[] {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((s) => s.trimEnd());
}

function isPomnimLubenSkorbim(text: string): boolean {
  const x = normEpitaph(String(text || ""))
    .toLowerCase()
    .replace(/[ ]+/g, " ");
  const canon1 = "помним, любим, скорбим...";
  const canon2 = "помним, любим, скорбим…";
  const canon3 = "помним,\nлюбим,\nскорбим...";
  const canon4 = "помним,\nлюбим,\nскорбим…";
  return x === canon1 || x === canon2 || x === canon3 || x === canon4;
}

function pomnimStairLines(): [string, string, string] {
  return ["Помним,", "любим,", "скорбим..."];
}

function measureHardLinesHeight(fontPx: number, lineH: number, linesCount: number) {
  return Math.round(linesCount * fontPx * lineH);
}

function fitFontToBoxHardLines(params: {
  ctx: CanvasRenderingContext2D;
  lines: string[];
  maxW: number;
  maxH: number;
  startSize: number;
  minSize: number;
  lineH: number;
}) {
  const { ctx, lines, maxW, maxH, startSize, minSize, lineH } = params;
  let fs = startSize;

  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l || " ").width), 0);

  while (fs > minSize) {
    ctx.font = `${fs}px ${FONT_CENTURY}`;
    const w = widest();
    const h = measureHardLinesHeight(fs, lineH, lines.length);
    if (w <= maxW && h <= maxH) break;
    fs -= 1;
  }
  return fs;
}

export function loadImageSafe(src?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

export function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const sr = iw / ih;
  const dr = r.w / r.h;

  let dw = r.w,
    dh = r.h,
    dx = r.x,
    dy = r.y;

  if (sr > dr) {
    dh = r.h;
    dw = Math.round(r.h * sr);
    dx = r.x + Math.round((r.w - dw) / 2);
  } else {
    dw = r.w;
    dh = Math.round(r.w / sr);
    dy = r.y + Math.round((r.h - dh) / 2);
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

export function drawImageContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const sr = iw / ih;
  const dr = r.w / r.h;

  let dw = r.w,
    dh = r.h,
    dx = r.x,
    dy = r.y;

  if (sr > dr) {
    dh = Math.round(r.w / sr);
    dy = r.y + Math.round((r.h - dh) / 2);
  } else {
    dw = Math.round(r.h * sr);
    dx = Math.round(r.x + (r.w - dw) / 2);
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

export async function buildSilhouetteOverlayDataUrl(params: { src: string; W: number; H: number; mirrorX?: boolean }): Promise<string | null> {
  const { src, W, H, mirrorX } = params;
  const baseImg = await loadImageSafe(src);
  if (!baseImg) return null;

  const iw = baseImg.naturalWidth || baseImg.width;
  const ih = baseImg.naturalHeight || baseImg.height;
  const sr = iw / ih;
  const dr = W / H;

  let rw = W,
    rh = H,
    rx = 0,
    ry = 0;
  if (sr > dr) {
    rh = Math.round(W / sr);
    ry = Math.round((H - rh) / 2);
  } else {
    rw = Math.round(H * sr);
    rx = Math.round((W - rw) / 2);
  }

  const off = document.createElement("canvas");
  off.width = rw;
  off.height = rh;
  const octx = off.getContext("2d");
  if (!octx) return null;
  octx.clearRect(0, 0, rw, rh);
  octx.drawImage(baseImg, 0, 0, rw, rh);

  const imgData = octx.getImageData(0, 0, rw, rh);
  const d = imgData.data;

  let hasUsefulAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) {
      hasUsefulAlpha = true;
      break;
    }
  }

  const mask = octx.createImageData(rw, rh);
  const md = mask.data;

  if (hasUsefulAlpha) {
    for (let i = 0; i < d.length; i += 4) {
      const A = d[i + 3];
      const alpha = A > 10 ? 255 : 0;
      md[i + 0] = 0;
      md[i + 1] = 0;
      md[i + 2] = 0;
      md[i + 3] = alpha;
    }
  } else {
    const pxAt = (x: number, y: number) => {
      const idx = (y * rw + x) * 4;
      return [d[idx], d[idx + 1], d[idx + 2]] as [number, number, number];
    };
    const corners = [pxAt(0, 0), pxAt(rw - 1, 0), pxAt(0, rh - 1), pxAt(rw - 1, rh - 1)];
    const bg = corners
      .reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]] as [number, number, number], [0, 0, 0])
      .map((v) => Math.round(v / 4)) as [number, number, number];

    const BG_DELTA = 26;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i + 0],
        g = d[i + 1],
        b = d[i + 2];
      const diff = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      const alpha = diff > BG_DELTA ? 255 : 0;
      md[i + 0] = 0;
      md[i + 1] = 0;
      md[i + 2] = 0;
      md[i + 3] = alpha;
    }
  }

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = rw;
  maskCanvas.height = rh;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) return null;
  mctx.putImageData(mask, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, W, H);
  ctx.save();

  if (mirrorX) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }

  // заливка силуэта
  ctx.fillStyle = "#1b1b1b";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "destination-in";

  const drawX = mirrorX ? W - (rx + rw) : rx;
  ctx.drawImage(maskCanvas, drawX, ry);

  ctx.restore();
  return canvas.toDataURL("image/png");
}

function drawImageFitWidth(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: { x: number; y: number; w: number; h: number }) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;

  let dw = r.w;
  let dh = Math.round((dw * ih) / iw);

  if (dh > r.h) {
    dh = r.h;
    dw = Math.round((dh * iw) / ih);
  }

  const dx = r.x + Math.round((r.w - dw) / 2);
  const dy = r.y + Math.round((r.h - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);
}

export async function renderStackedCenteredPreview(params: {
  W: number;
  H: number;
  bg: PreviewBg;
  overlayPng?: string | null;
  items: StackItem[];
  profile?: "rear" | "plate";
  // если хотите строго: графика/эпитафии = 75% ширины фрейма
  contentWidthFrac?: number; // default 0.75
}): Promise<string | null> {
  const { W, H, bg, overlayPng, items, profile = "rear", contentWidthFrac = 0.75 } = params;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // background
  if (bg.type === "solid") {
    ctx.fillStyle = bg.color || "#fff";
    ctx.fillRect(0, 0, W, H);
  } else if (bg.type === "gradient") {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#6e6e6e");
    grad.addColorStop(0.2, "#464545");
    grad.addColorStop(0.4, "#424242");
    grad.addColorStop(0.7, "#888");
    grad.addColorStop(1.0, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const bgIm = await loadImageSafe(bg.url);
    if (bgIm) {
      const fit = bg.fit || "cover";
      if (fit === "contain") drawImageContain(ctx, bgIm, { x: 0, y: 0, w: W, h: H });
      else drawImageCover(ctx, bgIm, { x: 0, y: 0, w: W, h: H });
    }
  }

  // overlay
  if (overlayPng) {
    const ov = await loadImageSafe(overlayPng);
    if (ov) ctx.drawImage(ov, 0, 0, W, H);
  }

  const isPlate = profile === "plate";

  const padY = Math.round(H * 0.06);

  const gap = Math.max(10, Math.round(H * 0.02));
  const top = padY;
  const bottom = H - padY;
  const usable = Math.max(10, bottom - top);
  if (!items.length) return null;

  // Высоты: чуть более “крупные” для img/text, чтобы не получалось “мелко” на сетке в Review
  const basePhotoH = Math.round(H * (isPlate ? 0.28 : 0.26));
  const baseMetricaH = Math.round(H * (isPlate ? 0.16 : 0.14));
  const baseImgH = Math.round(H * (isPlate ? 0.26 : 0.20));
  const baseTextH = Math.round(H * (isPlate ? 0.24 : 0.18));

  const plannedHeights = items.map((it) => {
    if (it.kind === "photo") return basePhotoH;
    if (it.kind === "metrica") return baseMetricaH;
    if (it.kind === "img") return baseImgH;
    return baseTextH;
  });

  const totalGaps = gap * (items.length - 1);
  const totalPlanned = plannedHeights.reduce((a, b) => a + b, 0);

  const k = Math.min(1, (usable - totalGaps) / Math.max(1, totalPlanned));
  const heights = plannedHeights.map((h) => Math.max(34, Math.floor(h * k)));

  const totalH = heights.reduce((a, b) => a + b, 0) + totalGaps;
  let y = Math.round(top + (usable - totalH) / 2);

  // ✅ “контент” (графика/эпитафии) по ширине от всего фрейма W
  const targetW = Math.max(10, Math.min(W, Math.round(W * contentWidthFrac)));
  const contentX = Math.round((W - targetW) / 2);

  // draw
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const h = heights[i];

    // общий прямоугольник для элемента (по ширине весь фрейм)
    const r = { x: 0, y, w: W, h };

    if (it.kind === "photo" || it.kind === "img") {
      const im = await loadImageSafe(it.url);
      if (im) {
        if (it.kind === "img") {
          // ✅ графика: строго 75% ширины фрейма
          const rr = { x: contentX, y: r.y + Math.round(h * 0.08), w: targetW, h: h - Math.round(h * 0.16) };
          drawImageFitWidth(ctx, im, rr);
        } else {
          // фото: оставляем "contain" по центру, но шире (почти весь кадр)
          const rr = { x: Math.round(W * 0.08), y: r.y + Math.round(h * 0.08), w: Math.round(W * 0.84), h: h - Math.round(h * 0.16) };
          drawImageContain(ctx, im, rr);
        }
      }
    }

    if (it.kind === "metrica") {
      const innerPad = Math.round(Math.min(W, h) * 0.10);
      const rr = { x: innerPad, y: r.y + innerPad, w: W - innerPad * 2, h: h - innerPad * 2 };

      const ln = (it.lastName || "").trim();
      const fn = [it.firstName, it.middleName].map((s) => (s || "").trim()).filter(Boolean).join(" ");
      const dates = (it.dates || "").trim();

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lastBase = Math.min(isPlate ? 52 : 44, Math.max(18, Math.floor(rr.h * 0.44)));
      const fnBase = Math.min(isPlate ? 40 : 32, Math.max(14, Math.floor(rr.h * 0.32)));
      const datesBase = Math.min(isPlate ? 32 : 26, Math.max(12, Math.floor(rr.h * 0.24)));

      const fit = (text: string, start: number, min: number) => {
        let fs = start;
        while (fs > min) {
          ctx.font = `${fs}px "Times New Roman", serif`;
          if (ctx.measureText(text || " ").width <= rr.w) break;
          fs -= 1;
        }
        return fs;
      };

      const lastSize = ln ? fit(ln, lastBase, 12) : lastBase;
      const fnSize = fn ? fit(fn, fnBase, 11) : fnBase;
      const datesSize = dates ? fit(dates, datesBase, 10) : datesBase;

      const lh1 = Math.round(lastSize * 1.05);
      const lh2 = fn ? Math.round(fnSize * 1.05) : 0;
      const lh3 = dates ? Math.round(datesSize * 1.05) : 0;
      const total = lh1 + lh2 + lh3;
      let ty = rr.y + Math.round(rr.h / 2 - total / 2);

      if (ln) {
        ctx.font = `${lastSize}px "Times New Roman", serif`;
        ctx.fillText(ln, rr.x + rr.w / 2, ty + lh1 / 2);
        ty += lh1;
      }
      if (fn) {
        ctx.font = `${fnSize}px "Times New Roman", serif`;
        ctx.fillText(fn, rr.x + rr.w / 2, ty + lh2 / 2);
        ty += lh2;
      }
      if (dates) {
        ctx.font = `${datesSize}px "Times New Roman", serif`;
        ctx.fillText(dates, rr.x + rr.w / 2, ty + lh3 / 2);
        ty += lh3;
      }

      ctx.restore();
    }

    if (it.kind === "text") {
      const innerPad = Math.round(Math.min(W, h) * 0.10);
      const rr0 = { x: innerPad, y: r.y + innerPad, w: W - innerPad * 2, h: h - innerPad * 2 };

      const specialStair = isPomnimLubenSkorbim(it.text);
      const lines = specialStair ? pomnimStairLines() : splitHardLines(it.text);

      // лесенка шире (как у вас было), обычный текст — 75% ширины фрейма
      const rr = specialStair ? rr0 : { x: contentX, y: rr0.y, w: targetW, h: rr0.h };
      const widthSafety = specialStair ? Math.round(rr.w * 0.98) : rr.w;

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";

      const startRaw = specialStair
        ? Math.min(isPlate ? 40 : 34, Math.max(isPlate ? 18 : 16, Math.floor(rr.h * (isPlate ? 0.50 : 0.44))))
        : Math.min(isPlate ? 32 : 26, Math.max(isPlate ? 16 : 14, Math.floor(rr.h * (isPlate ? 0.40 : 0.32))));

      const lineH = specialStair ? 1.15 : 1.18;

      const fs = fitFontToBoxHardLines({
        ctx,
        lines: Array.from(lines),
        maxW: widthSafety,
        maxH: rr.h,
        startSize: startRaw,
        minSize: specialStair ? (isPlate ? 13 : 12) : isPlate ? 11 : 10,
        lineH
      });

      ctx.font = `italic ${fs}px ${FONT_CENTURY}`;

      const lineHpx = Math.round(fs * lineH);
      const total = lineHpx * lines.length;
      let ty = rr.y + Math.round(rr.h / 2 - total / 2 + lineHpx / 2);

      for (let li = 0; li < lines.length; li++) {
        const line = (lines[li] || " ") as string;

        if (specialStair && lines.length === 3) {
          if (li === 0) {
            ctx.textAlign = "left";
            ctx.fillText(line, rr.x, ty);
          } else if (li === 1) {
            ctx.textAlign = "center";
            ctx.fillText(line, rr.x + rr.w / 2, ty);
          } else {
            ctx.textAlign = "right";
            ctx.fillText(line, rr.x + rr.w, ty);
          }
        } else {
          ctx.textAlign = "center";
          ctx.fillText(line, rr.x + rr.w / 2, ty);
        }

        ty += lineHpx;
      }

      ctx.restore();
    }

    y += h + gap;
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}