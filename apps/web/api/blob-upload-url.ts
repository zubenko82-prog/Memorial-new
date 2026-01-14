// pages/api/blob-upload-url.ts
// INIT multipart upload for @vercel/blob (no generateUploadUrl in your build).
// Requires JSON body from client with: name, contentType (file.type), sizeBytes (file.size).
// Env:
//  - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... (no quotes)
//  - BLOB_PUBLIC_BASE_URL=https://<store>.public.blob.vercel-storage.com

import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: true }
};

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

function sanitizePathName(input: string): string {
  const normalized = input.replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\\+/g, "/");
  return normalized.replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
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

    // Expect JSON body
    const body = (req.body || {}) as {
      name?: string;
      access?: "public" | "private";
      contentType?: string;
      sizeBytes?: number | string;
      parts?: number;
      partSize?: number;
    };

    const access = (body.access === "private" ? "private" : "public") as "public" | "private";
    const contentType = (body.contentType || "").trim();

    // Accept both number and string for sizeBytes
    const rawSize = (body as any).sizeBytes;
    const sizeBytes = typeof rawSize === "string" ? parseInt(rawSize, 10) : Number(rawSize);

    const providedName = (body.name && body.name.trim()) || `uploads/${Date.now()}.bin`;
    const pathname = sanitizePathName(providedName);

    if (!contentType) {
      cors(res, true);
      return res.status(400).json({
        ok: false, version: VERSION,
        error: "contentType is required"
      });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      cors(res, true);
      return res.status(400).json({
        ok: false, version: VERSION,
        error: "sizeBytes is required and must be > 0"
      });
    }

    // Load SDK dynamically (covers CJS/ESM)
    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }

    const createMultipartUpload =
      VBlob?.createMultipartUpload || VBlob?.default?.createMultipartUpload;

    if (typeof createMultipartUpload !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "@vercel/blob createMultipartUpload is not available",
        exportedKeys: Object.keys(VBlob || {})
      });
    }

    // Required base options
    const baseOpts: any = {
      token,
      access,
      contentType,
      contentLength: sizeBytes
    };

    // Try compatible signatures: pathname vs key, with/without parts/partSize
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

    // Normalize
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

    const url = buildPublicUrl(baseUrl, outPath); // Becomes valid after COMPLETE

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
