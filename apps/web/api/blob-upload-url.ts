// pages/api/blob-upload-url.ts
// Для @vercel/blob@0.24.x (используем unstable_generateUploadUrl)
// Env:
//   - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...  (без кавычек)
//   - BLOB_PUBLIC_BASE_URL=https://jqsjh7yt6zfkuqwf.public.blob.vercel-storage.com

import type { NextApiRequest, NextApiResponse } from "next";
import { unstable_generateUploadUrl } from "@vercel/blob";

const VERSION = "blob-upload-url@0.24.x";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function buildPublicUrl(base: string, pathname?: string | null): string | null {
  if (!base || !pathname) return null;
  const b = base.replace(/\/+$/, "");
  const p = String(pathname).replace(/^\/+/, "");
  return `${b}/${p.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST,OPTIONS,HEAD"); return res.status(405).end("Method Not Allowed"); }

  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || "";
  if (!token) { cors(res, true); return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" }); }
  if (!baseUrl) { cors(res, true); return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_PUBLIC_BASE_URL" }); }

  try {
    const { name, access = "public", contentType = "application/octet-stream" } = (req.body || {}) as {
      name?: string; access?: "public" | "private"; contentType?: string;
    };

    // 0.24.x обычно не принимает name прямо тут — это ок
    const out: any = await unstable_generateUploadUrl({
      access,
      contentType,
      token
    } as any);

    const uploadUrl: string = out?.uploadUrl || out?.url;
    const pathname: string | null = out?.pathname || out?.key || null;
    const publicUrl = out?.url && out?.uploadUrl ? out.url : buildPublicUrl(baseUrl, pathname);

    if (!uploadUrl) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "No uploadUrl returned by SDK" });
    }

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      uploadUrl,
      url: publicUrl,
      pathname,
      access,
      name: name || null
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
