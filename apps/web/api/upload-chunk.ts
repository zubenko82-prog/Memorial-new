import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";

export const config = { api: { bodyParser: true } };

function tmpPath(uploadId: string) {
  return path.join("/tmp", `upload-${uploadId}.bin`);
}

function safeName(name: string) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const {
      uploadId,
      chunkBase64,
      final,
      pathname,
      contentType,
      originalName
    } = (req.body || {}) as any;

    if (!uploadId) return res.status(400).json({ ok: false, error: "uploadId required" });

    const filePath = tmpPath(String(uploadId));
    const isFinal = String(final || "") === "1";

    // append chunk
    if (chunkBase64) {
      const buf = Buffer.from(String(chunkBase64), "base64");
      await fs.promises.appendFile(filePath, buf);
      return res.status(200).json({ ok: true, appended: buf.length });
    }

    // finalize -> put to blob
    if (isFinal) {
      const p = safeName(String(pathname || "").trim());
      if (!p) return res.status(400).json({ ok: false, error: "pathname required on final" });

      const ct = String(contentType || "application/octet-stream");
      const buf = await fs.promises.readFile(filePath);

      const putRes = await put(p, buf, {
        access: "public",
        contentType: ct,
        addRandomSuffix: true
      });

      // cleanup tmp
      try {
        await fs.promises.unlink(filePath);
      } catch {}

      return res.status(200).json({
        ok: true,
        url: putRes.url,
        pathname: putRes.pathname,
        name: safeName(String(originalName || "")) || undefined,
        bytes: buf.length
      });
    }

    return res.status(400).json({ ok: false, error: "Provide chunkBase64 or final=1" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}