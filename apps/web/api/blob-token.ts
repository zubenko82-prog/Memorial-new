import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload } from "@vercel/blob/client";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    if (req.method === "GET") {
      res.status(200).json({
        ok: true,
        method: "GET",
        hasToken: !!token,
        tokenLen: token ? token.length : 0
      });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    if (!token) {
      res.status(500).json({ ok: false, error: "BLOB_READ_WRITE_TOKEN missing" });
      return;
    }

    // ВАЖНО: handleUpload сам пишет в res и может бросить исключение
    return await handleUpload({
      req,
      res,
      token,
      // включим ограничения, чтобы не было странных падений
      // (можно менять)
      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "application/octet-stream"
          ],
          maximumSizeInBytes: 50 * 1024 * 1024
        };
      }
    });
  } catch (e: any) {
    // если handleUpload упал, вернём JSON (чтобы увидеть причину)
    try {
      res.status(500).json({
        ok: false,
        error: e?.message || String(e),
        stack: String(e?.stack || "").slice(0, 3000)
      });
    } catch {
      // если headers уже отправлены
    }
  }
}