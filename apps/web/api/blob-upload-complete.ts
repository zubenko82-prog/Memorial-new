// pages/api/blob-upload-complete.ts
// Завершение multipart загрузки.
// POST body: { uploadId: string, pathname: string, parts: { partNumber: number, etag: string }[] }
//
// Возвращает: { ok: true, url, pathname, version }
// Env:
//  - BLOB_READ_WRITE_TOKEN
//  - BLOB_PUBLIC_BASE_URL

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-complete@multipart";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function buildPublicUrl(base: string, pathname?: string | null) {
  if (!base || !pathname) return null;
  const b = base.replace(/\/+$/, "");
  const p = String(pathname).replace(/^\/+/, "");
  return `${b}/${p.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method === "HEAD") return res.status(200).end();
    if (req.method !== "POST") { res.setHeader("Allow", "POST,OPTIONS,HEAD"); return res.status(405).end("Method Not Allowed"); }

    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || "";
    if (!token) { cors(res, true); return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" }); }
    if (!baseUrl) { cors(res, true); return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_PUBLIC_BASE_URL" }); }

    const { uploadId, pathname, parts } = (req.body || {}) as {
      uploadId?: string;
      pathname?: string;
      parts?: { partNumber: number; etag: string }[];
    };

    if (!uploadId || !pathname || !Array.isArray(parts) || parts.length === 0) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "uploadId, pathname and parts[] are required" });
    }

    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }

    const completeMultipartUpload =
      VBlob?.completeMultipartUpload || VBlob?.default?.completeMultipartUpload;

    if (typeof completeMultipartUpload !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "@vercel/blob completeMultipartUpload is not available",
        exportedKeys: Object.keys(VBlob || {})
      });
    }

    const normalizedParts = parts.map(p => ({
      PartNumber: Number(p.partNumber),
      ETag: p.etag
    }));

    const attempts = [
      { token, uploadId, key: pathname, parts: normalizedParts },
      { token, UploadId: uploadId, key: pathname, parts: normalizedParts },
      { token, uploadId, pathname, parts: normalizedParts }
    ];

    let ok = false;
    let lastErr: any = null;
    for (const opts of attempts) {
      try {
        await completeMultipartUpload(opts);
        ok = true;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!ok) {
      cors(res, true);
      return res.status(500).json({
        ok: false, version: VERSION,
        error: `completeMultipartUpload failed${lastErr ? `: ${String((lastErr as any)?.message || lastErr)}` : ""}`
      });
    }

    const url = buildPublicUrl(baseUrl, pathname);
    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, url, pathname });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
