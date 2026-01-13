// pages/api/send-order-by-url.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = process.env.TGBOT_TOKEN;
  const chat = process.env.MANAGER_CHAT_ID;
  if (!token || !chat) return res.status(500).json({ ok: false, error: "Config error" });

  const { fileUrl, orderNo, caption } = req.body || {};
  if (!fileUrl) return res.status(400).json({ ok: false, error: "fileUrl is required" });

  const fd = new FormData();
  fd.append("chat_id", chat);
  fd.append("document", fileUrl); // ВАЖНО: можно передать URL, Telegram скачает его сам
  fd.append("caption", caption || (orderNo ? `Заявка №${orderNo}` : "Заявка"));

  const tg = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: fd as any });
  const text = await tg.text().catch(() => "");
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!tg.ok || !json?.ok) {
    const msg = (json && (json.description || JSON.stringify(json))) || text || tg.statusText;
    return res.status(tg.status || 500).json({ ok: false, error: msg });
  }
  return res.status(200).json({ ok: true, result: json.result });
}
