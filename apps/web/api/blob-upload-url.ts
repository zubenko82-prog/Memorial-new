// pages/api/blob-upload-url.ts
// INIT multipart upload using @vercel/blob (no generateUploadUrl in your build).
// Env:
//  - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
//  - BLOB_PUBLIC_BASE_URL=https://jqsjh7yt6zfkuqwf.public.blob.vercel-storage.com
//
// Request (POST):
//  { name?: string, access?: "public"|"private", contentType?: string, sizeBytes?: number }
// Response:
//  {
//    ok: true,
//    mode: "multipart",
//    uploadId: string,
//    pathname: string,
//    partUrls: string[],
//    partSize?: number,
//    url: string | null,     // final public URL (becomes valid after completion)
//    version: string
//  }

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@multipart-init";

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

    const {
      name,
      access = "public",
      contentType = "application/octet-stream",
      sizeBytes
    } = (req.body || {}) as {
      name?: string;
      access?: "public" | "private";
      contentType?: string;
      sizeBytes?: number;
    };

    // dynamic import to avoid CJS/ESM pitfalls
    let VBlob: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      VBlob = require("@vercel/blob");
    } catch {
      VBlob = await import("@vercel/blob");
    }
    const createMultipartUpload =
      VBlob?.createMultipartUpload ||
      VBlob?.default?.createMultipartUpload;

    if (typeof createMultipartUpload !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "@vercel/blob createMultipartUpload is not available. Check package version.",
        exportedKeys: Object.keys(VBlob || {})
      });
    }

    // Try several option signatures for compatibility
    const attempts = [
      { access, contentType, token, contentLength: sizeBytes, name },
      { access, contentType, token, name },
      { access, contentType, token }
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
        error: `createMultipartUpload failed${lastErr ? `: ${String(lastErr?.message || lastErr)}` : ""}`
      });
    }

    // Normalize response
    // Expected fields in some versions:
    //  - uploadId
    //  - key or pathname
    //  - urls (string[]) or parts [{ url, partNumber }]
    //  - partSize or chunkSize
    const uploadId: string = rsp.uploadId || rsp.UploadId || rsp.id;
    const pathname: string =
      rsp.pathname || rsp.key || rsp.path || name || `uploads/${Date.now()}.bin`;

    const urls: string[] =
      Array.isArray(rsp.urls) ? rsp.urls :
      Array.isArray(rsp.parts) ? rsp.parts.map((p: any) => p.url).filter(Boolean) :
      Array.isArray(rsp.uploadUrls) ? rsp.uploadUrls :
      [];

    const partSize: number | undefined = rsp.partSize || rsp.chunkSize || undefined;

    if (!uploadId || !urls.length) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "Multipart init did not return uploadId or part URLs",
        details: { hasUploadId: !!uploadId, urlsCount: urls.length }
      });
    }

    const url = buildPublicUrl(baseUrl, pathname); // becomes valid after completion

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      mode: "multipart",
      uploadId,
      pathname,
      partUrls: urls,
      partSize,
      url
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
