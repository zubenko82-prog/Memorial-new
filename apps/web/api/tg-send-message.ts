// pages/api/tg-send-message.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: true } };

const VERSION = "tg-send-message@2026-01-15+4096";

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
    const single = process.env.MANAGER_CHAT_ID || "";
    const multi = process.env.MANAGER_CHAT_IDS || "";
    const chats = (multi ? multi.split(",") : []).map(s => s.trim()).filter(Boolean);
    if (!chats.length && single) chats.push(single);
    if (!botToken || !chats.length) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: TGBOT_TOKEN/CHAT_ID(S) missing" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    // Telegram limit 4096 chars
    const text = String(body.text || "").slice(0, 4096);
    if (!text) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Text is required" });
    }

    const results: any[] = [];
    for (const chatId of chats) {
      const fd = new FormData();
      fd.append("chat_id", chatId);
      fd.append("text", text);
      const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", body: fd as any });
      const raw = await tg.text().catch(() => "");
      let json: any = null;
      try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (!tg.ok || !json?.ok) {
        results.push({ ok: false, chatId, error: (json?.description || raw || tg.statusText), error_code: json?.error_code || tg.status });
      } else {
        results.push({ ok: true, chatId, messageId: json?.result?.message_id });
      }
      await new Promise(r => setTimeout(r, 120));
    }

    const allFailed = results.every(r => !r.ok);
    cors(res, true);
    if (allFailed) return res.status(502).json({ ok: false, version: VERSION, error: "TELEGRAM_SEND_FAILED", results });
    return res.status(200).json({ ok: true, version: VERSION, results, partial: results.some(r => !r.ok) });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
