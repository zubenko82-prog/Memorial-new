import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload } from "@vercel/blob/client";

async function readJsonBody(req: VercelRequest): Promise<any> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve());
    req.on("error", (e) => reject(e));
  });

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

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

    // ВАЖНО: в @vercel/blob/client handleUpload ожидает req.body
    const contentType = String(req.headers["content-type"] || "");
    if (contentType.includes("application/json")) {
      (req as any).body = await readJsonBody(req);
    }

    return await handleUpload({
      req,
      res,
      token,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "application/octet-stream"
        ],
        maximumSizeInBytes: 50 * 1024 * 1024
      })
    });
  } catch (e: any) {
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
      stack: String(e?.stack || "").slice(0, 3000)
    });
  }
}