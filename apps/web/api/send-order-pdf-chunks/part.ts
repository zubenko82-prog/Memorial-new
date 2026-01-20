import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";

export const config = { api: { bodyParser: false } };

const VERSION = "send-order-pdf-chunks@2026-01-15-part-to-blob";
const SAFE_LIMIT = Math.floor(Number(process.env.MAX_UPLOAD_BYTES || 4.2 * 1024 * 1024)); // ~4.2 MiB

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Upload-Limit-Bytes");
  res.setHeader("X-Upload-Limit-Bytes", String(SAFE_LIMIT));
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({ multiples: false, keepExtensions: true, maxFileSize: SAFE_LIMIT });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    if (!token) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
    }

    const { fields, files } = await parseForm(req);
    const uploadId = String((fields.uploadId as any) || "").trim();
    const index = Number((fields.index as any) || -1);
    const total = Number((fields.total as any) || -1);
    if (!uploadId || index < 0 || total <= 0) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Bad fields" });
    }

    const fAny = (files as any).chunk as FormidableFile | FormidableFile[] | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;
    if (!f?.filepath) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "No chunk" });
    }

    const key = path.posix.join("tmp-chunks", uploadId, `part-${index}.bin`);

    // Заливаем чанк в Vercel Blob (private)
    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }
    const put = VBlob?.put || VBlob?.default?.put;
    if (typeof put !== "function") {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "@vercel/blob put() is not available" });
    }

    const stream = fs.createReadStream(f.filepath);
    await put(key, stream as any, {
      access: "private",
      token,
      contentType: "application/octet-stream",
      addRandomSuffix: false
    }).catch((e: any) => {
      throw new Error(`Blob put failed: ${e?.message || e}`);
    });

    try { await fs.promises.unlink(f.filepath); } catch {}

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, uploadId, index, total, key });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
