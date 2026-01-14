// pages/api/blob-upload-url.ts
// Генерирует одноразовый uploadUrl через @vercel/blob и возвращает публичный URL файла.
// Требуются env: BLOB_READ_WRITE_TOKEN, BLOB_PUBLIC_BASE_URL
//
// POST /api/blob-upload-url
// body: { name?: string; access?: "public"|"private"; contentType?: string; addRandomSuffix?: boolean }
// resp: { ok: true, uploadUrl, url, pathname, access, name, version }

import type { NextApiRequest, NextApiResponse } from "next";
import * as VBlob from "@vercel/blob";

const VERSION = "blob-upload-url@sdk-2026-01-16";

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
  const encoded = p.split("/").map(encodeURIComponent).join("/");
  return `${b}/${encoded}`;
}

type ReqBody = {
  name?: string;
  access?: "public" | "private";
  contentType?: string;
  addRandomSuffix?: boolean; // некоторые версии SDK добавляют суффиксы сами
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || "";
  if (!baseUrl) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_PUBLIC_BASE_URL" });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
  }

  // Поддержка разных версий SDK: generateUploadUrl или unstable_generateUploadUrl
  const gen =
    (VBlob as any).generateUploadUrl ||
    (VBlob as any).unstable_generateUploadUrl;

  if (typeof gen !== "function") {
    cors(res, true);
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: "generateUploadUrl is not available. Please `npm i @vercel/blob@latest`."
    });
  }

  try {
    const {
      name,
      access = "public",
      contentType = "application/octet-stream",
      addRandomSuffix = true
    } = (req.body || {}) as ReqBody;

    const blobName = name || `uploads/${Date.now()}.bin`;

    // Параметры зависят от версии SDK. Минимально — access/contentType.
    // Некоторые версии принимают ещё: token, allowedContentTypes, contentDisposition и т.п.
    const options: any = {
      access,
      contentType,
      // allowedContentTypes: [contentType], // при необходимости ограничить тип
      token: process.env.BLOB_READ_WRITE_TOKEN
    };

    // В разных версиях может не поддерживаться "name" — тогда он станет частью pathname после загрузки
    if ("name" in (gen as any)) {
      options.name = blobName;
    }

    const out = await gen(options);

    // Нормализация результата для клиента:
    // В одних версиях: { uploadUrl, pathname, url }
    // В других — { url } (ссылка прямо для загрузки) и { pathname }
    const uploadUrl: string = out?.uploadUrl || out?.url;
    const pathname: string | null = out?.pathname || out?.key || null;
    const fileUrl: string | null = out?.url && out?.uploadUrl ? out.url : buildPublicUrl(baseUrl, pathname);

    if (!uploadUrl) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "Failed to generate upload URL (SDK returned empty result)"
      });
    }

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
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
