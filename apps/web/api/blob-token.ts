import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload } from "@vercel/blob/client";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    // Диагностика: чтобы в браузере увидеть что функция вообще работает
    if (req.method === "GET") {
      res.status(200).json({
        ok: true,
        method: "GET",
        hasToken: !!token,
        tokenLen: token ? token.length : 0,
        // важно: покажем content-type запроса, чтобы понимать что приходит от sdk
        contentType: String(req.headers["content-type"] || "")
      });
      return;
    }

    if (!token) {
      res.status(500).json({ ok: false, error: "BLOB_READ_WRITE_TOKEN missing" });
      return;
    }

    // обязательно вернуть handleUpload
    return handleUpload({ req, res, token });
  } catch (e: any) {
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      stack: String(e?.stack || "").slice(0, 3000)
    });
  }
}