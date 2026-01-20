// pages/api/blob-upload-url.ts
// INIT multipart upload для @vercel/blob.
// Если файл < 5 MiB — multipart недоступен: возвращаем SMALL_FILE_USE_SERVER_PUT и клиент пойдёт в fallback.
//
// Env:
//  - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... (без кавычек)
//  - BLOB_PUBLIC_BASE_URL=https://<store>.public.blob.vercel-storage.com

import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: true } };

const VERSION = "blob-upload-url@multipart-init+compat+small-fallback";
const MIN_MULTIPART_BYTES = 5 * 1024 * 1024; // 5 MiB

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

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function pickParts(sizeBytes: number) {
  const MIN = MIN_MULTIPART_BYTES;
  const TARGET = 8 * 1024 * 1024;
  let partSize = Math.max(MIN, TARGET);
  let parts = Math.max(1, Math.ceil(sizeBytes / partSize));
  partSize = Math.ceil(sizeBytes / parts);
  if (partSize < MIN && sizeBytes > 0) {
    partSize = MIN;
    parts = Math.max(1, Math.ceil(sizeBytes / partSize));
  }
  return { partSize, parts };
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

    let bodyRaw: any = req.body;
    if (typeof bodyRaw === "string") { try { bodyRaw = JSON.parse(bodyRaw); } catch {} }
    if (bodyRaw == null || typeof bodyRaw !== "object") bodyRaw = {};
    const q = req.query || {};

    const nameIn = (bodyRaw.name ?? q.name) as string | undefined;
    const accessIn = (bodyRaw.access ?? q.access) as ("public" | "private") | undefined;
    const contentTypeIn = (bodyRaw.contentType ?? (q as any).contentType ?? bodyRaw.mimeType ?? (q as any).mimeType) as string | undefined;
    const sizeIn = (bodyRaw.sizeBytes ?? (q as any).sizeBytes ?? bodyRaw.size ?? (q as any).size ?? bodyRaw.contentLength ?? (q as any).contentLength) as number | string | undefined;

    const access = accessIn === "private" ? "private" : "public";
    const contentType = (contentTypeIn || "").trim();
    const sizeBytes = toNumber(sizeIn);
    const providedName = (nameIn && String(nameIn).trim()) || `uploads/${Date.now()}.bin`;
    const pathname = sanitizePathName(providedName);

    if (!contentType) {
      cors(res, true);
      return res.status(400).json({
        ok: false, version: VERSION,
        error: "contentType is required",
        debug: { bodyKeys: Object.keys(bodyRaw || {}), queryKeys: Object.keys(q || {}) }
      });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      cors(res, true);
      return res.status(400).json({
        ok: false, version: VERSION,
        error: "sizeBytes is required and must be > 0",
        debug: { rawSize: sizeIn ?? null }
      });
    }

    // ВАЖНО: маленькие файлы (<5 MiB) нельзя грузить multipart. Возвращаем явный сигнал на fallback.
    if (sizeBytes < MIN_MULTIPART_BYTES) {
      cors(res, true);
      return res.status(409).json({
        ok: false,
        version: VERSION,
        error: "SMALL_FILE_USE_SERVER_PUT",
        minMultipartBytes: MIN_MULTIPART_BYTES,
        sizeBytes,
        note: "File is smaller than 5 MiB; multipart upload is not supported. Use server fallback (PUT to your API)."
      });
    }

    // Дальше — multipart только для >= 5 MiB
    const { partSize, parts } = pickParts(sizeBytes);

    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }
    const exportedKeys = Object.keys(VBlob || {});

    const createMultipartUpload =
      VBlob?.createMultipartUpload || VBlob?.default?.createMultipartUpload;

    // Попытки сигнатур
    const baseOpts: any = {
      token,
      access,
      contentType,
      contentLength: sizeBytes
    };
    const attempts = [
      { ...baseOpts, pathname, parts, partSize },
      { ...baseOpts, key: pathname, parts, partSize },
      { ...baseOpts, pathname },
      { ...baseOpts, key: pathname }
    ];

    let rsp: any = null;
    let lastErr: any = null;
    if (typeof createMultipartUpload === "function") {
      for (const opts of attempts) {
        try {
          rsp = await createMultipartUpload(opts);
          if (rsp) break;
        } catch (e) {
          lastErr = e;
        }
      }
    } else {
      // Фолбэк через uploader
      const createMultipartUploader =
        VBlob?.createMultipartUploader || VBlob?.default?.createMultipartUploader;
      if (typeof createMultipartUploader === "function") {
        let uploader: any = null;
        const uAttempts = [{ token, access }, { token }, { token, access, cacheControlMaxAge: 31536000 }];
        for (const u of uAttempts) {
          try { uploader = await createMultipartUploader(u); if (uploader) break; } catch (e) { lastErr = e; }
        }
        if (uploader) {
          const candidates = ["createUpload", "initUpload", "initiateUpload", "startUpload", "prepareUpload", "create"];
          const entry = candidates.map(k => ({ k, fn: (uploader as any)[k] })).find(x => typeof x.fn === "function");
          if (entry) {
            for (const opts of attempts) {
              try { rsp = await entry.fn.call(uploader, opts); if (rsp) break; } catch (e) { lastErr = e; }
            }
          }
        }
      }
    }

    if (!rsp) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `createMultipartUpload failed${lastErr ? `: ${String((lastErr as any)?.message || lastErr)}` : ""}`,
        debug: { exportedKeys, triedParts: parts, triedPartSize: partSize, pathname }
      });
    }

    const uploadId: string = rsp.uploadId || rsp.UploadId || rsp.id;
    const outPath: string = rsp.pathname || rsp.key || pathname;
    const urls: string[] =
      Array.isArray(rsp.urls) ? rsp.urls :
      Array.isArray(rsp.parts) ? rsp.parts.map((p: any) => p.url).filter(Boolean) :
      Array.isArray(rsp.uploadUrls) ? rsp.uploadUrls :
      [];

    const resolvedPartSize = rsp.partSize || rsp.chunkSize || partSize || undefined;

    if (!uploadId || !urls.length) {
      cors(res, true);
      return res.status(500).json({
        ok: false, version: VERSION,
        error: "Multipart init did not return uploadId or part URLs",
        details: { hasUploadId: !!uploadId, urlsCount: urls.length }
      });
    }

    const url = buildPublicUrl(baseUrl, outPath);
    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      mode: "multipart",
      uploadId,
      pathname: outPath,
      partUrls: urls,
      partSize: resolvedPartSize,
      url
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
