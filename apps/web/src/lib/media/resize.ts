// src/lib/media/resize.ts
// Компрессия изображения в браузере до maxBytes, с понижением качества и масштаба.

export async function compressImageFileToMaxBytes(
  file: File,
  maxBytes: number,
  opts?: {
    maxWidth?: number;
    maxHeight?: number;
    mime?: "image/jpeg" | "image/webp";
    qualityStart?: number;
    qualityMin?: number;
    qualityStep?: number;
    scaleStep?: number;
  }
): Promise<Blob> {
  const {
    maxWidth = 2200,
    maxHeight = 2200,
    mime = "image/jpeg",
    qualityStart = 0.9,
    qualityMin = 0.5,
    qualityStep = 0.08,
    scaleStep = 0.9
  } = opts || {};

  const img = await createImageBitmap(file);
  let w = img.width;
  let h = img.height;
  const ratio = Math.min(1, maxWidth / w, maxHeight / h);
  w = Math.max(1, Math.round(w * ratio));
  h = Math.max(1, Math.round(h * ratio));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available");

  let scale = 1.0;
  let quality = qualityStart;

  const drawScaled = (s: number) => {
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  for (;;) {
    drawScaled(scale);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, quality)
    );
    if (!blob) throw new Error("Failed to encode image");

    if (blob.size <= maxBytes) {
      return blob;
    }

    if (quality > qualityMin + 1e-3) {
      quality = Math.max(qualityMin, quality - qualityStep);
      continue;
    }

    // Понижаем масштаб, если качество уже на минимуме
    const nextScale = scale * scaleStep;
    if (nextScale < 0.45) {
      // дальше уже теряется смысл
      return blob; // отдаём что получилось
    }
    scale = nextScale;
    // немного возвращаем качество, чтобы попробовать выиграть детализацией в меньшем размере
    quality = Math.min(0.92, quality + 0.12);
  }
}
