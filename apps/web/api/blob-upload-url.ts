// pages/api/blob-upload-url.ts
// INIT multipart upload для @vercel/blob (у вас нет generateUploadUrl; используем createMultipartUpload).
// Обязательные поля от клиента: name, contentType, sizeBytes.
// Env:
//  - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... (без кавычек)
//  - BLOB_PUBLIC_BASE_URL=https://jqsjh7yt6zfkuqwf.public.blob.vercel-storage.com

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@multipart-init+strict";

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
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST,OPTIONS,HEAD");
      return res.status(405).end("Method Not Allowed");
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || "";
    if (!token) { cors(res, true); return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" }); }
    if (!baseUrl) { cors(res, true); return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_PUBLIC_BASE_URL" }); }

    const body = (req.body || {}) as {
      name?: string;                  // ОБЯЗАТЕЛЬНО (путь/имя)
      access?: "public" | "private";  // по умолчанию public
      contentType?: string;           // ОБЯЗАТЕЛЬНО (MIME)
      sizeBytes?: number;             // ОБЯЗАТЕЛЬНО (точный размер)
      parts?: number;                 // опционально: желаемое кол-во частей
      partSize?: number;              // опционально: размер части, байт
    };

    const access = body.access || "public";
    const contentType = body.contentType || "";
    const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : NaN;
    const pathname = (body.name && body.name.trim()) || `uploads/${Date.now()}.bin`;

    if (!contentType) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "contentType is required" });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "sizeBytes is required and must be > 0" });
    }

    // Импорт SDK
    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }

    const createMultipartUpload =
      VBlob?.createMultipartUpload || VBlob?.default?.createMultipartUpload;

    if (typeof createMultipartUpload !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false, version: VERSION,
        error: "@vercel/blob createMultipartUpload is not available",
        exportedKeys: Object.keys(VBlob || {})
      });
    }

    // Собирам опции. Разные версии требуют key или pathname.
    const baseOpts: any = {
      token,
      access,
      contentType,
      contentLength: sizeBytes
    };
    const attempts = [
      { ...baseOpts, pathname, parts: body.parts, partSize: body.partSize },
      { ...baseOpts, key: pathname, parts: body.parts, partSize: body.partSize },
      { ...baseOpts, pathname },
      { ...baseOpts, key: pathname }
    ];

    let rsp: any = null;
    let lastErr: any = null;
    for (const opts of attempts) {
      try {
        rsp = await createMultipartUpload(opts);
        if (rsp) break;
      } catch (e: any) {
        lastErr = e;
      }
    }
    if (!rsp) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `createMultipartUpload failed${lastErr ? `: ${String(lastErr?.message || lastErr)}` : ""}`
      });
    }

    // Нормализация ответа
    const uploadId: string = rsp.uploadId || rsp.UploadId || rsp.id;
    const outPath: string = rsp.pathname || rsp.key || pathname;
    const urls: string[] =
      Array.isArray(rsp.urls) ? rsp.urls :
      Array.isArray(rsp.parts) ? rsp.parts.map((p: any) => p.url).filter(Boolean) :
      Array.isArray(rsp.uploadUrls) ? rsp.uploadUrls :
      [];

    const partSize = rsp.partSize || rsp.chunkSize || body.partSize || undefined;

    if (!uploadId || !urls.length) {
      cors(res, true);
      return res.status(500).json({
        ok: false, version: VERSION,
        error: "Multipart init did not return uploadId or part URLs",
        details: { hasUploadId: !!uploadId, urlsCount: urls.length }
      });
    }

    const url = buildPublicUrl(baseUrl, outPath); // станет доступным после complete

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      mode: "multipart",
      uploadId,
      pathname: outPath,
      partUrls: urls,
      partSize,
      url
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
