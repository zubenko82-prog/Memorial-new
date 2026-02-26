import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload } from "@vercel/blob/client";

async function readRaw(req: VercelRequest): Promise<{ raw: string; bytes: number }> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve());
    req.on("error", (e) => reject(e));
  });
  const buf = Buffer.concat(chunks);
  return { raw: buf.toString("utf8"), bytes: buf.length };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hasToken: !!token, tokenLen: token ? token.length : 0 });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    // СНИМАЕМ СЫРОЕ ТЕЛО (важно: до handleUpload)
    const ct = String(req.headers["content-type"] || "");
    const { raw, bytes } = await readRaw(req);

    // Вернём это наружу, чтобы понять что SDK реально присылает
    // (временная диагностика!)
    if (String(process.env.BLOB_TOKEN_DIAG || "") === "1") {
      return res.status(200).json({
        ok: true,
        diag: {
          contentType: ct,
          bytes,
          rawPreview: raw.slice(0, 800)
        }
      });
    }

    // Если DIAG=0, то пробуем восстановить body и вызвать handleUpload
    if (ct.includes("application/json") && raw.trim()) {
      try {
        (req as any).body = JSON.parse(raw);
      } catch {
        (req as any).body = undefined;
      }
    }

    if (!token) return res.status(500).json({ ok: false, error: "BLOB_READ_WRITE_TOKEN missing" });

    return await handleUpload({ req: req as any, res, token });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e), stack: String(e?.stack || "").slice(0, 3000) });
  }
}