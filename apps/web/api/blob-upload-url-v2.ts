// pages/api/blob-upload-url-v2.ts
// INIT multipart upload для @vercel/blob с максимально широкой совместимостью.
// Теперь пробуем две сигнатуры:
//  - createMultipartUpload(pathname, options)
//  - createMultipartUpload(options)
// Плюс фолбэк через createMultipartUploader с теми же стилями.
// GET — для проверки версии/конфига.

import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";

export const config = { api: { bodyParser: true } };

const VERSION = "blob-upload-url@multipart-init+v2-two-arg+uploader-fallback";

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
          hasToken: !!process.env.BLOB_READ_WRITE_TOKEN
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

    // Для мелких — 1 часть; иначе ~8 MiB
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
      // дублируем альтернативные поля
      size: sizeBytes,
      sizeBytes,
      metadata: { filename: fileBase }
    };

    const callsTried: string[] = [];
    let rsp: any = null;
    const errors: string[] = [];

    // 1) createMultipartUpload — двухаргументный стиль
    if (typeof createMultipartUpload === "function" && !rsp) {
      const twoArgAttempts = [
        [pathname, { ...baseOpts, parts: wantParts, partSize: wantPartSize }],
        [pathname, { ...baseOpts }], // без parts
        [fileBase, { ...baseOpts, parts: wantParts, partSize: wantPartSize }],
        [fileBase, { ...baseOpts }]
      ] as const;

      for (const [arg1, arg2] of twoArgAttempts) {
        try {
          callsTried.push(`createMultipartUpload("${arg1}", opts:${Object.keys(arg2).join(",")})`);
          rsp = await createMultipartUpload(arg1 as any, arg2 as any);
          if (rsp) break;
        } catch (e: any) {
          errors.push(`two-arg: ${String(e?.message || e)}`);
        }
      }
    }

    // 2) createMultipartUpload — одноаргументный стиль (объект)
    if (typeof createMultipartUpload === "function" && !rsp) {
      const oneArgAttempts = [
        { ...baseOpts, pathname, parts: wantParts, partSize: wantPartSize },
        { ...baseOpts, pathname },
        { ...baseOpts, key: pathname, parts: wantParts, partSize: wantPartSize },
        { ...baseOpts, key: pathname },
        { ...baseOpts, path: pathname, parts: wantParts, partSize: wantPartSize },
        { ...baseOpts, path: pathname },
        { ...baseOpts, filename: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
        { ...baseOpts, filename: fileBase, addRandomSuffix: false },
        { ...baseOpts, name: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
        { ...baseOpts, name: fileBase, addRandomSuffix: false },
        { ...baseOpts }
      ];

      for (const opts of oneArgAttempts) {
        try {
          callsTried.push(`createMultipartUpload(opts:${Object.keys(opts).join(",")})`);
          rsp = await createMultipartUpload(opts);
          if (rsp) break;
        } catch (e: any) {
          errors.push(`one-arg: ${String(e?.message || e)}`);
        }
      }
    }

    // 3) Фолбэк: createMultipartUploader (и двух-, и одноарг. стили)
    if (!rsp) {
      const createMultipartUploader = VBlob?.createMultipartUploader || VBlob?.default?.createMultipartUploader;
      if (typeof createMultipartUploader === "function") {
        let uploader: any = null;
        let uploaderErr: string | null = null;
        const uOptsList = [{ token, access }, { token }, { token, access, cacheControlMaxAge: 31536000 }];
        for (const uo of uOptsList) {
          try {
            callsTried.push(`createMultipartUploader(${JSON.stringify(Object.keys(uo))})`);
            uploader = await createMultipartUploader(uo);
            if (uploader) break;
          } catch (e: any) {
            uploaderErr = String(e?.message || e);
          }
        }
        if (!uploader) errors.push(`uploader: ${uploaderErr || "no instance"}`);

        if (uploader) {
          const methods = ["createUpload", "initUpload", "initiateUpload", "startUpload", "prepareUpload", "create"];
          const entry = methods.map(k => ({ k, fn: (uploader as any)[k] })).find(x => typeof x.fn === "function");

          if (entry) {
            // двухаргументный стиль
            const twoArgUAttempts = [
              [pathname, { ...baseOpts, parts: wantParts, partSize: wantPartSize }],
              [pathname, { ...baseOpts }],
              [fileBase, { ...baseOpts, parts: wantParts, partSize: wantPartSize }],
              [fileBase, { ...baseOpts }]
            ] as const;
            for (const [arg1, arg2] of twoArgUAttempts) {
              try {
                callsTried.push(`uploader.${entry.k}("${arg1}", opts)`);
                rsp = await entry.fn.call(uploader, arg1 as any, arg2 as any);
                if (rsp) break;
              } catch (e: any) {
                errors.push(`uploader two-arg ${entry.k}: ${String(e?.message || e)}`);
              }
            }
            // одноаргументный стиль
            if (!rsp) {
              const oneArgUAttempts = [
                { ...baseOpts, pathname, parts: wantParts, partSize: wantPartSize },
                { ...baseOpts, pathname },
                { ...baseOpts, key: pathname, parts: wantParts, partSize: wantPartSize },
                { ...baseOpts, key: pathname },
                { ...baseOpts, path: pathname, parts: wantParts, partSize: wantPartSize },
                { ...baseOpts, path: pathname },
                { ...baseOpts, filename: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
                { ...baseOpts, filename: fileBase, addRandomSuffix: false },
                { ...baseOpts, name: fileBase, parts: wantParts, partSize: wantPartSize, addRandomSuffix: false },
                { ...baseOpts, name: fileBase, addRandomSuffix: false },
                { ...baseOpts }
              ];
              for (const opts of oneArgUAttempts) {
                try {
                  callsTried.push(`uploader.${entry.k}(opts:${Object.keys(opts).join(",")})`);
                  rsp = await entry.fn.call(uploader, opts);
                  if (rsp) break;
                } catch (e: any) {
                  errors.push(`uploader one-arg ${entry.k}: ${String(e?.message || e)}`);
                }
              }
            }
          } else {
            errors.push(`uploader has no known method. Keys: ${Object.keys(uploader || {}).join(", ")}`);
          }
        }
      } else {
        errors.push("createMultipartUploader is not a function");
      }
    }

    if (!rsp) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `createMultipartUpload failed: ${errors[errors.length - 1] || "Unknown"}`,
        debug: {
          exportedKeys,
          triedPathname: pathname,
          triedFilename: fileBase,
          triedParts: wantParts,
          triedPartSize: wantPartSize,
          attemptsCount: callsTried.length,
          callsSample: callsTried.slice(-6),
          errorsSample: errors.slice(-6)
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
