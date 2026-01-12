// pages/api/send-order-pdf.ts
import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "send-order-pdf@pages-2026-01-12";

export const config = {
  api: { bodyParser: false }, // важно: сами читаем formData()
};

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
  if (req.method !== "POST") { res.setHeader("Allow", "POST,OPTIONS,HEAD"); return res.status(405).send("Method Not Allowed"); }

  try {
    const botToken = process.env.TGBOT_TOKEN || "";
    const single = process.env.MANAGER_CHAT_ID || "";
    const multi = process.env.MANAGER_CHAT_IDS || "";
    const chats = (multi ? multi.split(",") : []).map(s => s.trim()).filter(Boolean);
    if (!chats.length && single) chats.push(single);
    if (!botToken || !chats.length) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required" });
    }

    // Web API formData на Node 18+
    // @ts-ignore
    const form: FormData = await (req as any).formData();
    const pdf = form.get("pdf") as any; // File | Blob
    const payloadRaw = form.get("payload") as string | null;

    if (!pdf) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "No pdf" });
    }

    let meta: any = {};
    try { meta = payloadRaw ? JSON.parse(payloadRaw) : {}; } catch {}

    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const caption = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ].filter(Boolean).join("\n");
    const fileName = (pdf as any)?.name || `order-${orderNo || Date.now()}.pdf`;

    async function sendOne(chatId: string) {
      const tg = new FormData();
      tg.append("chat_id", chatId);
      if (caption) tg.append("caption", caption.slice(0, 1024));
      tg.append("document", pdf, fileName);
      const tgUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
      const r = await fetch(tgUrl, { method: "POST", body: tg as any });
      const text = await r.text().catch(() => "");
      let json: any = null; try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok || !json?.ok) {
        const details = (json && (json.description || JSON.stringify(json))) || text || r.statusText;
        throw new Error(`Telegram error: ${r.status} ${details}`);
      }
      return { chatId, messageId: json?.result?.message_id, chat: json?.result?.chat || { id: chatId } };
    }

    const results: any[] = [];
    for (const chatId of chats) results.push(await sendOne(chatId));

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, orderNo: orderNo || undefined, chats, results });
  } catch (e: any) {
    console.error("send-order-pdf pages error:", e);
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
