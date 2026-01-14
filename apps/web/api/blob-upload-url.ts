// pages/api/blob-upload-url.ts
// Генерируем одноразовый uploadUrl через @vercel/blob (с поддержкой разных версий SDK)
// и строим публичный URL по вашему Base URL.
//
// Env:
//   - BLOB_READ_WRITE_TOKEN (RW токен из Vercel Storage)
//   - BLOB_PUBLIC_BASE_URL (ваш base: https://jqsjh7yt6zfkuqwf.public.blob.vercel-storage.com)

import type { NextApiRequest, NextApiResponse } from "next";
import * as VBlob from "@vercel/blob";

const VERSION = "blob-upload-url@sdk-flex-2026-01-16";

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

  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || "";
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

    // Пытаемся найти доступную функцию в SDK
    const anyBlob = VBlob as any;
    const genFn =
      anyBlob.generateUploadUrl ||
      anyBlob.createUploadUrl ||
      anyBlob.createUploadURL || // на случай разных кейсов
      anyBlob.unstable_generateUploadUrl;

    if (typeof genFn !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "generateUploadUrl is not available in @vercel/blob. Please `npm i @vercel/blob@latest`."
      });
    }

    // Параметры могут отличаться по версиям SDK — попробуем несколько сигнатур.
    const optionsA: any = { access, contentType, token, addRandomSuffix, name: blobName };
    const optionsB: any = { access, contentType, token, name: blobName };
    const optionsC: any = { access, token, name: blobName };

    let out: any = null;
    let lastErr: any = null;

    for (const opts of [optionsA, optionsB, optionsC]) {
      try {
        out = await genFn(opts);
        if (out) break;
      } catch (e) {
        lastErr = e;
        out = null;
      }
    }

    if (!out) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `Failed to generate upload URL via SDK${lastErr ? `: ${String(lastErr?.message || lastErr)}` : ""}`
      });
    }

    // Нормализуем результат
    const uploadUrl: string = out.uploadUrl || out.url;
    const pathname: string | null = out.pathname || out.key || null;
    const fileUrl: string | null =
      // если SDK сразу вернул финальный URL (некоторые версии так делают)
      (out.url && out.uploadUrl ? out.url : null) || buildPublicUrl(baseUrl, pathname);

    if (!uploadUrl) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "SDK returned empty uploadUrl"
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
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: e?.message || "Internal error"
    });
  }
}
