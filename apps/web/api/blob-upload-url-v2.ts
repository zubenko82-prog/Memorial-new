// pages/api/blob-upload-url-v2.ts
// INIT multipart upload для @vercel/blob с максимально широкой совместимостью.
// Пробуем createMultipartUpload с разными наборами опций.
// Если не вышло — пробуем createMultipartUploader и разные методы на нём.
// GET — для быстрой проверки деплоя/конфига.

import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";

export const config = { api: { bodyParser: true } };

const VERSION = "blob-upload-url@multipart-init+wide-compat-v2+uploader-fallback";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
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

    if (req.method === "GET") {
      return res.status(200).json({
        ok: false,
        version: VERSION,
        error: "Use POST",
        exportedEnv: {
          hasToken: !!process.env.BLOB_READ_WRITE_TOKEN,
          hasBaseUrl: !!(process.env.BLOB_PUBLIC_BASE_URL || "")
        }
      });
    }

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method === "HEAD") return res.status(200).end();
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET,POST,OPTIONS,HEAD");
      return res.status(405).end("Method Not Allowed");
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    if (!token) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
    }

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

    // 1 часть для мелких файлов, иначе ~8 MiB
    const wantParts = Math.max(1, Math.ceil(sizeBytes / (8 * 1024 * 1024)));
    const wantPartSize = Math.ceil(sizeBytes / wantParts);

    // SDK
    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }
    const exportedKeys = Object.keys(VBlob || {});
    const createMultipartUpload = VBlob?.createMultipartUpload || VBlob?.default?.createMultipartUpload;

    const baseOpts: any = {
      token,
      access,
      contentType,
      contentLength: sizeBytes,
      // дублируем альтернативные поля, если SDK ищет другое имя:
      size: sizeBytes,
      sizeBytes,
      metadata: { filename: fileBase }
    };

    const buildAttempts = () => {
      const withParts = [
        { ...baseOpts, pathname, parts: wantParts, partSize: wantPartSize },
        { ...baseOpts, key: pathname, parts: wantParts, partSize: wantPartSize },
        { ...baseOpts, path: pathname, parts: wantParts, partSize: wantPartSize },
        { ...baseOpts, filename: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
        { ...baseOpts, name: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false }
      ];
      const minimal = [
        { ...baseOpts, pathname },
        { ...baseOpts, key: pathname },
        { ...baseOpts, path: pathname },
        { ...baseOpts, filename: fileBase, addRandomSuffix: false },
        { ...baseOpts, name: fileBase, addRandomSuffix: false }
      ];
      return [...withParts, ...minimal, { ...baseOpts }];
    };

    const attempts = buildAttempts();

    let rsp: any = null;
    let lastErrText: string[] = [];

    // 1) Пробуем createMultipartUpload
    if (typeof createMultipartUpload === "function") {
      for (const opts of attempts) {
        try {
          rsp = await createMultipartUpload(opts);
          if (rsp) break;
        } catch (e: any) {
          lastErrText.push(String(e?.message || e));
        }
      }
    }

    // 2) Фолбэк: createMultipartUploader
    if (!rsp) {
      const createMultipartUploader = VBlob?.createMultipartUploader || VBlob?.default?.createMultipartUploader;
      if (typeof createMultipartUploader === "function") {
        let uploader: any = null;
        const uOptsList = [
          { token, access },
          { token },
          { token, access, cacheControlMaxAge: 31536000 }
        ];
        let uploaderErr: string | null = null;
        for (const uo of uOptsList) {
          try {
            uploader = await createMultipartUploader(uo);
            if (uploader) break;
          } catch (e: any) {
            uploaderErr = String(e?.message || e);
          }
        }
        if (!uploader && uploaderErr) lastErrText.push(`uploader: ${uploaderErr}`);

        if (uploader) {
          const candidates = ["createUpload", "initUpload", "initiateUpload", "startUpload", "prepareUpload", "create"];
          const entry = candidates
            .map((k) => ({ k, fn: (uploader as any)[k] }))
            .find((x) => typeof x.fn === "function");

          if (entry) {
            for (const opts of attempts) {
              try {
                rsp = await entry.fn.call(uploader, opts);
                if (rsp) break;
              } catch (e: any) {
                lastErrText.push(`${entry.k}: ${String(e?.message || e)}`);
              }
            }
          } else if (typeof uploader === "function") {
            for (const opts of attempts) {
              try {
                rsp = await uploader(opts);
                if (rsp) break;
              } catch (e: any) {
                lastErrText.push(`uploader() call: ${String(e?.message || e)}`);
              }
            }
          } else {
            lastErrText.push(`uploader has no callable methods. Keys: ${Object.keys(uploader || {}).join(", ")}`);
          }
        }
      } else {
        lastErrText.push("createMultipartUploader is not a function");
      }
    }

    if (!rsp) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `createMultipartUpload failed: ${lastErrText[lastErrText.length - 1] || "Unknown"}`,
        debug: {
          exportedKeys,
          triedPathname: pathname,
          triedFilename: fileBase,
          triedParts: wantParts,
          triedPartSize: wantPartSize,
          attemptsCount: attempts.length,
          errorsSample: lastErrText.slice(-4)
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

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      mode: "multipart",
      uploadId,
      pathname: outPath,
      partUrls: urls,
      partSize: resolvedPartSize
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
