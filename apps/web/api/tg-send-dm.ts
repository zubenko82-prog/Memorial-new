// pages/api/tg-send-dm.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: true } };

const VERSION = "tg-send-dm@2026-01-20+user_confirm";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
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
    const botToken = process.env.TGBOT_TOKEN || "";
    if (!botToken) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: TGBOT_TOKEN missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const userIdRaw = body.userId ?? body.chat_id ?? body.chatId ?? "";
    const userId = Number(userIdRaw);

    if (!Number.isFinite(userId) || userId <= 0) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "userId is required (positive number)" });
    }

    // Telegram limit 4096 chars
    const text = String(body.text || "").slice(0, 4096);
    if (!text) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Text is required" });
    }

    const fd = new FormData();
    fd.append("chat_id", String(userId));
    fd.append("text", text);
    fd.append("disable_web_page_preview", "true");

    const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      body: fd as any
    });

    const raw = await tg.text().catch(() => "");
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {}

    cors(res, true);

    if (!tg.ok || !json?.ok) {
      // типичный кейс: "Forbidden: bot can't initiate conversation with a user"
      return res.status(502).json({
        ok: false,
        version: VERSION,
        error: "TELEGRAM_SEND_FAILED",
        error_code: json?.error_code || tg.status,
        description: json?.description || raw || tg.statusText
      });
    }

    return res.status(200).json({
      ok: true,
      version: VERSION,
      result: {
        chatId: userId,
        messageId: json?.result?.message_id
      }
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
