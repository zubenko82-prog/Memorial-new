// pages/api/tg-check-perms.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: false } };

const VERSION = "tg-check-perms@2026-01-15";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const botToken = process.env.TGBOT_TOKEN || "";
    const single = process.env.MANAGER_CHAT_ID || "";
    const multi = process.env.MANAGER_CHAT_IDS || "";
    const chats = (multi ? multi.split(",") : []).map(s => s.trim()).filter(Boolean);
    if (!chats.length && single) chats.push(single);

    if (!botToken) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Missing TGBOT_TOKEN" });
    }

    const rMe = await fetch(`https://api.telegram.org/bot${botToken}/getMe`).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    const checks: any[] = [];
    for (const chatId of chats) {
      const info = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`)
        .then(r => r.json())
        .catch((e) => ({ ok: false, error: String(e) }));
      let member: any = null;
      try {
        member = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent((rMe as any)?.result?.id ?? "")}`)
          .then(r => r.json())
          .catch((e) => ({ ok: false, error: String(e) }));
      } catch {}
      checks.push({ chatId, getChat: info, getChatMember: member });
    }

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, getMe: rMe, checks });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
