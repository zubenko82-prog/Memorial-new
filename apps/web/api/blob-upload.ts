import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

export const config = { api: { bodyParser: false } };

function cors(res: VercelResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseForm(req: VercelRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({
    multiples: true,
    keepExtensions: true,
    maxFileSize: Math.floor(80 * 1024 * 1024)
  });
  return new Promise((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function safeBaseName(name: string) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function guessContentTypeByExt(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  return "application/octet-stream";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, true);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const { fields, files } = await parseForm(req);

    const orderNo = String((fields.orderNo as any) || "").trim() || `order-${Date.now()}`;

    const pdfAny = (files as any)?.file as FormidableFile | FormidableFile[] | undefined;
    const pdf = Array.isArray(pdfAny) ? pdfAny[0] : pdfAny;
    if (!pdf?.filepath) return res.status(400).json({ ok: false, error: 'No PDF file (field "file")' });

    const pdfName = safeBaseName(String(pdf.originalFilename || `order-${orderNo}.pdf`)) || `order-${orderNo}.pdf`;
    const pdfBuf = await fs.promises.readFile(pdf.filepath);

    const pdfPut = await put(`orders/${orderNo}/${pdfName}`, pdfBuf, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: true
    });

    const photosAny = (files as any)?.photos as FormidableFile | FormidableFile[] | undefined;
    const photos = toArray(photosAny).filter((f) => !!f?.filepath);

    const photoResults: { url: string; pathname: string; contentType?: string; originalFilename?: string }[] = [];
    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      const orig = safeBaseName(String(ph.originalFilename || `photo-${i + 1}.jpg`)) || `photo-${i + 1}.jpg`;
      const buf = await fs.promises.readFile(ph.filepath);

      const contentType = guessContentTypeByExt(orig);
      const putRes = await put(`orders/${orderNo}/photos/${orig}`, buf, {
        access: "public",
        contentType,
        addRandomSuffix: true
      });

      photoResults.push({ url: putRes.url, pathname: putRes.pathname, contentType, originalFilename: orig });
    }

    return res.status(200).json({
      ok: true,
      orderNo,
      pdf: { url: pdfPut.url, pathname: pdfPut.pathname, filename: pdfName },
      photos: photoResults
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Upload error" });
  }
}