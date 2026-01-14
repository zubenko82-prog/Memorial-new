// pages/api/blob-upload-url.ts
// Генерация одноразового uploadUrl для Vercel Blob (совместимо с разными версиями API).
// Env: BLOB_READ_WRITE_TOKEN (Storage → Access Tokens).
//
// POST /api/blob-upload-url
// body: { name?: string; access?: "public"|"private"; contentType?: string; addRandomSuffix?: boolean }
// resp: { ok: true, uploadUrl, url, pathname, access, name, version }

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@2026-01-15";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

type Body = {
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
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: "Missing BLOB_READ_WRITE_TOKEN env var"
    });
  }

  try {
    const {
      name,
      access = "public",
      contentType = "application/octet-stream",
      addRandomSuffix = true
    } = (req.body || {}) as Body;

    const blobName = name || `uploads/${Date.now()}.bin`;

    // Пулы эндпоинтов на случай изменений API.
    const endpoints = [
      // Варианты, встречающиеся в разных версиях API
      "https://api.vercel.com/v2/blob/upload-url",
      "https://api.vercel.com/v2/blobs",
      "https://api.vercel.com/v1/blobs"
    ];

    // Собираем payload с максимально совместимыми ключами
    const payload = {
      name: blobName,
      filename: blobName,
      mimeType: contentType,
      contentType,
      access, // "public" | "private"
      addRandomSuffix
    };

    let respOk = false;
    let lastStatus = 0;
    let lastText = "";
    let data: any = null;

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        lastStatus = r.status;
        lastText = await r.text().catch(() => "");
        try {
          data = lastText ? JSON.parse(lastText) : null;
        } catch {
          data = null;
        }
        // ожидаемые поля разных версий: uploadUrl / upload_url
        const uploadUrl = data?.uploadUrl || data?.upload_url;
        if (r.ok && uploadUrl) {
          respOk = true;
          break;
        }
        // если 404 — пробуем следующий эндпоинт
        if (r.status === 404) continue;
        // если не 404 и не ок — прекращаем
        if (!r.ok) break;
      } catch (e: any) {
        lastStatus = 0;
        lastText = e?.message || String(e);
        data = null;
        // Пробуем следующий эндпоинт
      }
    }

    if (!respOk) {
      const errMsg =
        (data && (data.error?.message || data.error || JSON.stringify(data))) ||
        lastText ||
        "The requested API endpoint was not found.";
      cors(res, true);
      return res.status(lastStatus || 502).json({
        ok: false,
        version: VERSION,
        error: errMsg
      });
    }

    const uploadUrl = data.uploadUrl || data.upload_url;
    const fileUrl = data.url || data.fileUrl || data.file_url || null;
    const pathname = data.pathname || data.key || data.path || null;

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
