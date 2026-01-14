// pages/api/blob-upload-url.ts
// Генерация одноразового uploadUrl для загрузки в Vercel Blob + построение финального публичного URL
// по вашему Base URL (только для чтения).
//
// Обязательно:
// 1) Добавьте в переменные окружения (Vercel → Settings → Environment Variables):
//    - BLOB_READ_WRITE_TOKEN=...    (RW токен из Storage → Access Tokens)
//    - BLOB_PUBLIC_BASE_URL=https://jqsjh7yt6zfkuqwf.public.blob.vercel-storage.com
// 2) Задеплойте проект.
//
// Клиент шлёт POST /api/blob-upload-url c JSON:
//   { name?: string, access?: "public"|"private", contentType?: string, addRandomSuffix?: boolean }
// Возвратим:
//   { ok: true, uploadUrl, url, pathname, access, name, version }

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@2026-01-16+base";

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
  // Корректно кодируем сегменты пути (но сохраняем /)
  const encoded = p.split("/").map(encodeURIComponent).join("/");
  return `${b}/${encoded}`;
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
  const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || ""; // https://<store>.public.blob.vercel-storage.com
  if (!token) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
  }
  if (!baseUrl) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_PUBLIC_BASE_URL" });
  }

  try {
    const {
      name,
      access = "public",
      contentType = "application/octet-stream",
      addRandomSuffix = true
    } = (req.body || {}) as ReqBody;

    const blobName = name || `uploads/${Date.now()}.bin`;

    // Актуальный REST-эндпоинт генерации одноразовой ссылки
    const endpoint = "https://api.vercel.com/v2/blob/generate-upload-url";

    const payload = {
      name: blobName,
      access,                // "public" | "private"
      mimeType: contentType, // поле, ожидаемое API
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
    } catch {}

    const uploadUrl = data?.uploadUrl;
    // pathname/key могут называться по-разному в разных версиях
    const pathname = data?.pathname ?? data?.key ?? null;
    // если API не вернул публичный URL — строим его из Base URL и pathname
    const fileUrl = data?.url || buildPublicUrl(baseUrl, pathname);

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

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      uploadUrl,
      url: fileUrl,     // финальный публичный URL (Telegram сможет скачать)
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
