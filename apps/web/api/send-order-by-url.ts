// pages/api/send-order-by-url.ts
// Отправка документа в Telegram по URL (например, из Vercel Blob).
// Env: TGBOT_TOKEN, MANAGER_CHAT_ID (или MANAGER_CHAT_IDS через запятую).
//
// POST body: { fileUrl: string; orderNo?: string; caption?: string }

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "send-order-by-url@2026-01-14";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

async function tgSendDocumentUrl(botToken: string, chatId: string, fileUrl: string, caption?: string) {
  const fd = new FormData();
  fd.append("chat_id", chatId);
  if (caption) fd.append("caption", caption.slice(0, 1024));
  // Важно: Telegram примет URL, если он общедоступный
  fd.append("document", fileUrl);

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: "POST",
    body: fd as any
  });

  const text = await resp.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!resp.ok || !json?.ok) {
    const msg = (json && (json.description || JSON.stringify(json))) || text || resp.statusText;
    throw new Error(`Telegram error: ${resp.status} ${msg}`);
  }
  return json.result;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  const botToken = process.env.TGBOT_TOKEN || "";
  const single = process.env.MANAGER_CHAT_ID || "";
  const multi = process.env.MANAGER_CHAT_IDS || "";
  const chats = (multi ? multi.split(",") : []).map((s) => s.trim()).filter(Boolean);
  if (!chats.length && single) chats.push(single);

  if (!botToken || !chats.length) {
    cors(res, true);
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: "Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required"
    });
  }

  try {
    const { fileUrl, orderNo, caption } = (req.body || {}) as {
      fileUrl?: string;
      orderNo?: string;
      caption?: string;
    };
    if (!fileUrl) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "fileUrl is required" });
    }

    const cap = caption || (orderNo ? `Заявка №${orderNo}` : "Заявка");

    const results: any[] = [];
    for (const chatId of chats) {
      try {
        const r = await tgSendDocumentUrl(botToken, chatId, fileUrl, cap);
        results.push({ ok: true, chatId, messageId: r?.message_id, chat: r?.chat || { id: chatId } });
      } catch (e: any) {
        results.push({ ok: false, chatId, error: String(e?.message || e) });
      }
    }

    const allFailed = results.every((r) => !r.ok);
    cors(res, true);
    if (allFailed) {
      return res.status(502).json({
        ok: false,
        version: VERSION,
        error: "Failed to send to all chats",
        results
      });
    }
    return res.status(200).json({
      ok: true,
      version: VERSION,
      orderNo: orderNo || undefined,
      results
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
