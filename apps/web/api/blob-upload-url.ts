// pages/api/blob-upload-url.ts
// Генерация одноразового uploadUrl для загрузки файла напрямую в Vercel Blob.
// Требуется переменная окружения BLOB_READ_WRITE_TOKEN (Storage → Access Tokens в Vercel).
//
// Клиент отправляет POST /api/blob-upload-url с body:
// { name?: string, access?: "public"|"private", contentType?: string, addRandomSuffix?: boolean }
// В ответ получает: { ok: true, uploadUrl, url, pathname, access, name }

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@2026-01-14";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

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
      addRandomSuffix = true,
      contentType = "application/octet-stream"
    } = (req.body || {}) as {
      name?: string;
      access?: "public" | "private";
      addRandomSuffix?: boolean;
      contentType?: string;
    };

    const blobName = name || `uploads/${Date.now()}.bin`;

    const vercelResp = await fetch(
      `https://api.vercel.com/v2/blobs?addRandomSuffix=${addRandomSuffix ? 1 : 0}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: blobName,
          mimeType: contentType,
          access // "public" | "private"
        })
      }
    );

    const data = await vercelResp.json().catch(() => null);
    if (!vercelResp.ok || !data?.uploadUrl) {
      const msg =
        data?.error?.message ||
        data?.error ||
        JSON.stringify(data) ||
        vercelResp.statusText ||
        "Blob API error";
      cors(res, true);
      return res.status(vercelResp.status || 500).json({
        ok: false,
        version: VERSION,
        error: msg
      });
    }

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      uploadUrl: data.uploadUrl,
      url: data.url,
      pathname: data.pathname,
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
