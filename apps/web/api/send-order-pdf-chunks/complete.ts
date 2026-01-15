import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";

const VERSION = "send-order-pdf-chunks@2026-01-15-complete";
const SAFE_LIMIT = Math.floor(Number(process.env.MAX_UPLOAD_BYTES || 4.2 * 1024 * 1024)); // инфо для заголовка

export const config = { api: { bodyParser: true } };

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Upload-Limit-Bytes");
  res.setHeader("X-Upload-Limit-Bytes", String(SAFE_LIMIT));
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

type TgSendResult = { ok: boolean; result?: any; description?: string };
async function tgSendDocument(
  botToken: string,
  chatId: string,
  blob: Blob,
  fileName: string,
  caption?: string
): Promise<TgSendResult> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("document", blob, fileName);
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: form as any });
  const text = await resp.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!resp.ok || !json?.ok) {
    const details = (json && (json.description || JSON.stringify(json))) || text || resp.statusText;
    throw new Error(`Telegram error: ${resp.status} ${details}`);
  }
  return json!;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const { uploadId, fileName, contentType, payload } =
      (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
    if (!uploadId || !fileName || !contentType) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Bad payload" });
    }

    const root = path.join("/tmp", "so-chunks-" + uploadId);
    const metaPath = path.join(root, "meta.json");
    const exists = await fs.promises.stat(metaPath).then(() => true).catch(() => false);
    if (!exists) {
      cors(res, true);
      return res.status(404).json({ ok: false, version: VERSION, error: "Upload not found" });
    }

    const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf-8"));
    const parts = await fs.promises.readdir(root);
    const partFiles = parts.filter((f) => /^part-\d+\.bin$/.test(f)).sort((a, b) => {
      const ai = Number(a.match(/\d+/)?.[0] || 0);
      const bi = Number(b.match(/\d+/)?.[0] || 0);
      return ai - bi;
    });
    if (!partFiles.length) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "No parts uploaded" });
    }

    // Собираем в один файл
    const finalPath = path.join("/tmp", `so-final-${uploadId}.pdf`);
    const out = fs.createWriteStream(finalPath);
    for (const pf of partFiles) {
      const p = path.join(root, pf);
      await new Promise<void>((resolve, reject) => {
        const r = fs.createReadStream(p);
        r.on("error", reject);
        out.on("error", reject);
        r.on("end", resolve);
        r.pipe(out, { end: false });
      });
    }
    await new Promise<void>((r) => out.end(r));

    // Отправляем в Telegram (многим чатам)
    const botToken = process.env.TGBOT_TOKEN || "";
    const single = process.env.MANAGER_CHAT_ID || "";
    const multi = process.env.MANAGER_CHAT_IDS || "";
    const chats = (multi ? multi.split(",") : []).map((s) => s.trim()).filter(Boolean);
    if (!chats.length && single) chats.push(single);
    if (!botToken || !chats.length) {
      try { await fs.promises.rm(root, { recursive: true, force: true }); } catch {}
      try { await fs.promises.unlink(finalPath); } catch {}
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: TGBOT_TOKEN/CHAT_ID(S) missing" });
    }

    const buf = await fs.promises.readFile(finalPath);
    const blob = new Blob([buf], { type: "application/pdf" });

    const caption = (() => {
      const orderNo = String(payload?.orderNo || "").trim();
      const intro = payload?.intro || {};
      return [
        orderNo ? `Заявка №${orderNo}` : "Заявка",
        intro.customerName ? `Заказчик: ${intro.customerName}` : "",
        intro.customerPhone ? `Телефон: ${intro.customerPhone}` : ""
      ].filter(Boolean).join("\n");
    })();

    const results: any[] = [];
    for (const chatId of chats) {
      try {
        const resp = await tgSendDocument(botToken, chatId, blob, path.basename(fileName), caption);
        results.push({ ok: true, chatId, messageId: resp?.result?.message_id, chat: resp?.result?.chat || { id: chatId } });
      } catch (e: any) {
        results.push({ ok: false, chatId, error: String(e?.message || e) });
      }
    }

    try { await fs.promises.rm(root, { recursive: true, force: true }); } catch {}
    try { await fs.promises.unlink(finalPath); } catch {}

    const allFailed = results.every((r) => !r.ok);
    cors(res, true);
    if (allFailed) {
      return res.status(502).json({ ok: false, version: VERSION, error: "TELEGRAM_SEND_FAILED", results });
    }
    return res.status(200).json({ ok: true, version: VERSION, results, partial: results.some((r) => !r.ok) });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
