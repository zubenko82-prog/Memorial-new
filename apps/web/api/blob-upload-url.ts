// pages/api/blob-upload-url.ts
// Обновлённый роут: используем актуальную точку Vercel Blob
// POST https://api.vercel.com/v2/blob/generate-upload-url
//
// Env: BLOB_READ_WRITE_TOKEN (Storage → Access Tokens, RW)
// Body: { name?: string, access?: "public"|"private", contentType?: string, addRandomSuffix?: boolean }
// Resp: { ok: true, uploadUrl, url, pathname, access, name, version }

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@2026-01-16";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

type ReqBody = {
  name?: string;
  access?: "public" | "private";
  contentType?: string;
  addRandomSuffix?: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
  }

  try {
    const {
      name,
      access = "public",
      contentType = "application/octet-stream",
      addRandomSuffix = true
    } = (req.body || {}) as ReqBody;

    const blobName = name || `uploads/${Date.now()}.bin`;

    // Актуальный эндпоинт для выдачи одноразовой uploadUrl
    const endpoint = "https://api.vercel.com/v2/blob/generate-upload-url";

    const payload = {
      name: blobName,
      access, // "public" | "private"
      mimeType: contentType,
      addRandomSuffix
    };

    const vr = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await vr.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    // ожидаем в ответе хотя бы uploadUrl
    const uploadUrl = data?.uploadUrl;
    if (!vr.ok || !uploadUrl) {
      const msg =
        data?.error?.message ||
        data?.error ||
        data?.message ||
        text ||
        vr.statusText ||
        "Unknown error";
      cors(res, true);
      return res.status(vr.status || 500).json({
        ok: false,
        version: VERSION,
        error: msg
      });
    }

    const fileUrl = data?.url || null;
    const pathname = data?.pathname || data?.key || null;

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      uploadUrl,
      url: fileUrl,
      pathname,
      access,
      name: blobName
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: e?.message || "Internal error"
    });
  }
}
