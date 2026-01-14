// pages/api/blob-upload-url.ts
// Универсальная генерация uploadUrl для Vercel Blob (совместимо с 0.24.x и 2.x SDK),
// без "named import", чтобы не падать на этапе загрузки модуля.
//
// Env (обязательно):
// - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...   (RW-токен, без кавычек)
// - BLOB_PUBLIC_BASE_URL=https://<store>.public.blob.vercel-storage.com
//
// Клиент: POST /api/blob-upload-url { name?, access?, contentType?, addRandomSuffix? }

import type { NextApiRequest, NextApiResponse } from "next";
import * as VBlob from "@vercel/blob";

const VERSION = "blob-upload-url@sdk-auto-2026-01-16";

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

type ReqBody = {
  name?: string;
  access?: "public" | "private";
  contentType?: string;
  addRandomSuffix?: boolean;
};

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
      addRandomSuffix = true
    } = (req.body || {}) as ReqBody;

    const blobName = name || `uploads/${Date.now()}.bin`;

    // Безопасно определяем функцию генерации для разных версий SDK
    const anyBlob = VBlob as any;
    const genFn =
      anyBlob.generateUploadUrl ||               // @vercel/blob 2.x
      anyBlob.unstable_generateUploadUrl ||      // @vercel/blob 0.24.x
      anyBlob.createUploadUrl ||                 // на всякий случай
      anyBlob.createUploadURL ||                 // на всякий случай
      null;

    if (typeof genFn !== "function") {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "@vercel/blob SDK does not expose a generateUploadUrl function. Check package version."
      });
    }

    // Опции — максимально совместимые
    const optionsA: any = { access, contentType, token, addRandomSuffix, name: blobName };
    const optionsB: any = { access, contentType, token, name: blobName };
    const optionsC: any = { access, contentType, token };

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
      console.error("Blob generateUploadUrl failed:", lastErr);
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `Failed to generate upload URL${lastErr ? `: ${String((lastErr as Error).message || lastErr)}` : ""}`
      });
    }

    // Нормализация результата разных версий SDK
    const uploadUrl: string = out.uploadUrl || out.url;
    const pathname: string | null = out.pathname || out.key || null;
    const finalUrl: string | null =
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
      url: finalUrl,
      pathname,
      access,
      name: blobName
    });
  } catch (e: any) {
    console.error("blob-upload-url handler crashed:", e);
    cors(res, true);
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: e?.message || "Internal error"
    });
  }
}
