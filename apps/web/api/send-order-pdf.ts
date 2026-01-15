// pages/api/blob-upload-url.ts
// INIT multipart upload для @vercel/blob (без generateUploadUrl).
// Разрешаем multipart для любых размеров (в т.ч. < 5 MiB) — 1 часть.
// Перебираем множество сигнатур: pathname|key|path|filename|name|без пути, с/без parts.
//
// Env:
//  - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
//  - BLOB_PUBLIC_BASE_URL=https://<store>.public.blob.vercel-storage.com

import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";

export const config = { api: { bodyParser: true } };

const VERSION = "blob-upload-url@multipart-init+wide-compat";

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

    let body: any = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
    if (!body || typeof body !== "object") body = {};
    const q = req.query || {};

    const nameIn = (body.name ?? q.name) as string | undefined;
    const accessIn = (body.access ?? q.access) as ("public" | "private") | undefined;
    const contentTypeIn = (body.contentType ?? (q as any).contentType ?? body.mimeType ?? (q as any).mimeType) as string | undefined;
    const sizeIn = (body.sizeBytes ?? (q as any).sizeBytes ?? body.size ?? (q as any).size ?? body.contentLength ?? (q as any).contentLength) as number | string | undefined;

    const access = accessIn === "private" ? "private" : "public";
    const contentType = (contentTypeIn || "").trim();
    const sizeBytes = toNumber(sizeIn);
    const providedName = (nameIn && String(nameIn).trim()) || `uploads/${Date.now()}.bin`;
    const pathname = sanitizePathName(providedName);
    const fileBase = path.basename(pathname);

    if (!contentType) {
      cors(res, true);
      return res.status(400).json({
        ok: false, version: VERSION,
        error: "contentType is required",
        debug: { bodyKeys: Object.keys(body || {}), queryKeys: Object.keys(q || {}) }
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

    // Для универсальности: 1 часть на маленькие файлы, иначе подберёт сам бекенд
    const wantParts = Math.max(1, Math.ceil(sizeBytes / (8 * 1024 * 1024))); // целимся в ~8MiB
    const wantPartSize = Math.ceil(sizeBytes / wantParts);

    // Загружаем SDK
    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }
    const exportedKeys = Object.keys(VBlob || {});

    const createMultipartUpload =
      VBlob?.createMultipartUpload || VBlob?.default?.createMultipartUpload;

    if (typeof createMultipartUpload !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false, version: VERSION,
        error: "@vercel/blob createMultipartUpload is not available",
        exportedKeys
      });
    }

    const baseOpts: any = {
      token,
      access,
      contentType,
      contentLength: sizeBytes,
      metadata: { filename: fileBase }
    };

    // Перебор разных сигнатур
    const attempts: any[] = [
      { ...baseOpts, pathname, parts: wantParts, partSize: wantPartSize },
      { ...baseOpts, key: pathname, parts: wantParts, partSize: wantPartSize },
      { ...baseOpts, path: pathname, parts: wantParts, partSize: wantPartSize },
      { ...baseOpts, filename: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
      { ...baseOpts, name: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
      // без разбиения (пусть SDK сам решит)
      { ...baseOpts, pathname },
      { ...baseOpts, key: pathname },
      { ...baseOpts, path: pathname },
      { ...baseOpts, filename: fileBase, addRandomSuffix: false },
      { ...baseOpts, name: fileBase, addRandomSuffix: false },
      // совсем без пути — автоимя на стороне Blob
      { ...baseOpts }
    ];

    let rsp: any = null;
    let lastErr: any = null;
    for (const opts of attempts) {
      try {
        rsp = await createMultipartUpload(opts);
        if (rsp) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!rsp) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `createMultipartUpload failed${lastErr ? `: ${String((lastErr as any)?.message || lastErr)}` : ""}`,
        debug: {
          exportedKeys,
          triedPathname: pathname,
          triedFilename: fileBase,
          triedParts: wantParts,
          triedPartSize: wantPartSize
        }
      });
    }

    // Нормализация ответа
    const uploadId: string = rsp.uploadId || rsp.UploadId || rsp.id;
    const outPath: string = rsp.pathname || rsp.key || rsp.path || pathname || fileBase;
    const urls: string[] =
      Array.isArray(rsp.urls) ? rsp.urls :
      Array.isArray(rsp.parts) ? rsp.parts.map((p: any) => p.url).filter(Boolean) :
      Array.isArray(rsp.uploadUrls) ? rsp.uploadUrls :
      [];

    const resolvedPartSize = rsp.partSize || rsp.chunkSize || wantPartSize || undefined;

    if (!uploadId || !urls.length) {
      cors(res, true);
      return res.status(500).json({
        ok: false, version: VERSION,
        error: "Multipart init did not return uploadId or part URLs",
        details: { hasUploadId: !!uploadId, urlsCount: urls.length },
        rspKeys: Object.keys(rsp || {})
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
