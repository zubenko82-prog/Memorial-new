import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";
import fs from "node:fs";

const VERSION = "send-order-pdf-chunks@2026-01-15-complete-from-blob";
const SAFE_LIMIT = Math.floor(Number(process.env.MAX_UPLOAD_BYTES || 4.2 * 1024 * 1024));

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
    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    if (!token) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
    }

    const { uploadId, fileName, contentType, payload } =
      (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
    if (!uploadId || !fileName || !contentType) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Bad payload" });
    }

    // SDK
    let VBlob: any;
    try { VBlob = require("@vercel/blob"); } catch { VBlob = await import("@vercel/blob"); }
    const list = VBlob?.list || VBlob?.default?.list;
    const del = VBlob?.del || VBlob?.default?.del;
    const getDownloadUrl = VBlob?.getDownloadUrl || VBlob?.default?.getDownloadUrl;

    if (typeof list !== "function" || typeof del !== "function" || typeof getDownloadUrl !== "function") {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "@vercel/blob list/getDownloadUrl/del not available" });
    }

    const prefix = path.posix.join("tmp-chunks", uploadId, "/");
    const listed = await list({ token, prefix }).catch((e: any) => {
      throw new Error(`Blob list failed: ${e?.message || e}`);
    });

    const chunks = (listed?.blobs || [])
      .map((b: any) => {
        const m = b.pathname.match(/part-(\d+)\.bin$/);
        const idx = m ? Number(m[1]) : -1;
        return { idx, pathname: b.pathname };
      })
      .filter((x: any) => x.idx >= 0)
      .sort((a: any, b: any) => a.idx - b.idx);

    if (!chunks.length) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "No parts uploaded" });
    }

    // Скачиваем чанки и собираем в память (объём PDF небольшой)
    const buffers: Buffer[] = [];
    for (const ch of chunks) {
      const d = await getDownloadUrl(ch.pathname, { token }).catch((e: any) => {
        throw new Error(`Blob getDownloadUrl failed: ${e?.message || e}`);
      });
      const url = d?.url;
      if (!url) throw new Error("No signed URL for chunk");
      const arr = await fetch(url).then(r => r.arrayBuffer());
      buffers.push(Buffer.from(arr));
    }
    const finalBuf = Buffer.concat(buffers);
    const finalBlob = new Blob([finalBuf], { type: "application/pdf" });

    // Telegram отправка
    const botToken = process.env.TGBOT_TOKEN || "";
    const single = process.env.MANAGER_CHAT_ID || "";
    const multi = process.env.MANAGER_CHAT_IDS || "";
    const chats = (multi ? multi.split(",") : []).map((s) => s.trim()).filter(Boolean);
    if (!chats.length && single) chats.push(single);
    if (!botToken || !chats.length) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: TGBOT_TOKEN/CHAT_ID(S) missing" });
    }

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
        const resp = await tgSendDocument(botToken, chatId, finalBlob, path.basename(fileName), caption);
        results.push({ ok: true, chatId, messageId: resp?.result?.message_id, chat: resp?.result?.chat || { id: chatId } });
      } catch (e: any) {
        results.push({ ok: false, chatId, error: String(e?.message || e) });
      }
    }

    // Чистим куски
    try { await del(chunks.map(c => c.pathname), { token }); } catch {}

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
