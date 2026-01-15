import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const config = { api: { bodyParser: true } };

const VERSION = "send-order-pdf-chunks@2026-01-15-init";
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const { fileName, contentType, totalBytes } = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
    if (!fileName || !contentType || !Number.isFinite(Number(totalBytes))) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Bad payload" });
    }

    const uploadId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const root = path.join("/tmp", "so-chunks-" + uploadId);
    await fs.promises.mkdir(root, { recursive: true });

    const meta = { fileName: String(fileName), contentType: String(contentType), totalBytes: Number(totalBytes), createdAt: Date.now() };
    await fs.promises.writeFile(path.join(root, "meta.json"), JSON.stringify(meta));

    // Рекомендованный размер чанка (85% от лимита функции)
    const maxChunkBytes = Math.max(64 * 1024, Math.floor(SAFE_LIMIT * 0.85));

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, uploadId, maxChunkBytes });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
