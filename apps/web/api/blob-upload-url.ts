// pages/api/blob-upload-url.ts
import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@2026-01-13";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: "BLOB_READ_WRITE_TOKEN is required" });

  try {
    const { name, access = "public", addRandomSuffix = true, contentType = "application/octet-stream" } = (req.body || {});
    // Имя файла/путь (можете добавить префикс "orders/" и т.д.)
    const blobName = name || `uploads/${Date.now()}.bin`;

    // Вызов REST API Vercel для создания Blob c uploadUrl.
    // Документация: Vercel Blob REST (Create a Blob)
    const resp = await fetch(`https://api.vercel.com/v2/blobs?addRandomSuffix=${addRandomSuffix ? 1 : 0}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: blobName,
        mimeType: contentType,
        access, // "public" | "private"
      }),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.uploadUrl) {
      const msg = data?.error?.message || data?.error || JSON.stringify(data) || resp.statusText;
      return res.status(resp.status || 500).json({ ok: false, version: VERSION, error: msg });
    }

    // uploadUrl — одноразовая ссылка для прямой загрузки (PUT);
    // url — финальный CDN-URL после загрузки (станет доступен, когда вы завершите PUT).
    return res.status(200).json({
      ok: true,
      version: VERSION,
      uploadUrl: data.uploadUrl,
      url: data.url,            // финальный URL
      pathname: data.pathname,  // может пригодиться для удаления/метаданных
      access,
      name: blobName,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
