// apps/web/src/pages/api/send-order-pdf.ts
// API: принимает PDF от мини‑приложения и пересылает в чат менеджеров Telegram.
// Env (на стороне web-приложения):
// - TGBOT_TOKEN=123456:ABC... (токен бота)
// - MANAGER_CHAT_ID=-1003021100938  (или MANAGER_CHAT_IDS=-100...,12345 для нескольких)
// Рекомендуется использовать MANAGER_CHAT_ID (один чат). MANAGER_CHAT_IDS поддерживается для совместимости.

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File } from "formidable";
import fs from "node:fs";
import path from "node:path";

export const config = { api: { bodyParser: false } };

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files; }> {
  const form = formidable({ multiples: false, keepExtensions: true, maxFileSize: 20 * 1024 * 1024 }); // до 20 MB
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function sendToTelegram(filePath: string, fileName: string, caption: string, chatId: string, botToken: string) {
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const f = new FormData();
  f.append("chat_id", chatId);
  f.append("caption", caption.slice(0, 1024));
  // В Node 18+ доступен Blob/FS ReadableStream — используем File/Blob для корректного имени
  const buf = await fs.promises.readFile(filePath);
  const blob = new Blob([buf], { type: "application/pdf" });
  // @ts-expect-error Web File ctor поддерживается в Node 18.13+/Vercel
  const webFile = new File([blob], fileName, { type: "application/pdf" });
  f.append("document", webFile);

  const res = await fetch(tgUrl, { method: "POST", body: f as any });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Telegram error: ${res.status} ${text}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const botToken = process.env.TGBOT_TOKEN || "";
  const chatSingle = process.env.MANAGER_CHAT_ID || "";
  const chatMulti = process.env.MANAGER_CHAT_IDS || "";
  const chats: string[] = (chatMulti ? chatMulti.split(",") : [])
    .map((s) => s.trim()).filter(Boolean);
  if (!chats.length && chatSingle) chats.push(chatSingle);

  if (!botToken || !chats.length) {
    return res.status(500).send("Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required");
  }

  try {
    const { fields, files } = await parseForm(req);
    const metaRaw = String(fields.payload || "{}");
    const meta = JSON.parse(metaRaw || "{}") as any;

    const f = files.pdf as File;
    if (!f || !f.filepath) {
      return res.status(400).send("No pdf");
    }
    const filePath = f.filepath;
    const safeBase = path.basename(f.originalFilename || f.newFilename || `order-${Date.now()}.pdf`).replace(/[^\w.\-]+/g, "_");
    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const captionLines = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ].filter(Boolean);
    const caption = captionLines.join("\n");

    // отправка во все целевые чаты
    for (const chatId of chats) {
      await sendToTelegram(filePath, safeBase, caption, chatId, botToken);
    }

    // подчистим временный файл (formidable может сам убирать, но на всякий случай)
    try { await fs.promises.unlink(filePath); } catch {}

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("/api/send-order-pdf error:", e);
    return res.status(500).send(e?.message || "Internal error");
  }
}
