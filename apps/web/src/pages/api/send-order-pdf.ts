// apps/web/src/pages/api/send-order-pdf.ts
// Принимает PDF и шлёт в Telegram менеджерский чат. Возвращает детали ответа Telegram.
// Env (в веб-проекте):
// - TGBOT_TOKEN            — токен бота
// - MANAGER_CHAT_ID        — один chat_id, например "-1003021100938"
//   или MANAGER_CHAT_IDS   — несколько через запятую
// - ALLOW_ORIGIN           — CORS (опционально, по умолчанию "*")
// - DEBUG_TELEGRAM=1       — логировать подробности в логи функции

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";

export const config = { api: { bodyParser: false } };

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 20 * 1024 * 1024, // 20MB
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

type TgSendResult = {
  ok: boolean;
  result?: {
    message_id: number;
    date: number;
    chat?: { id?: number | string; title?: string; type?: string; username?: string };
    document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
    caption?: string;
  };
  description?: string;
};

async function sendToTelegramDocument(params: {
  botToken: string;
  chatId: string;
  filePath: string;
  fileName: string;
  caption?: string;
}): Promise<TgSendResult> {
  const { botToken, chatId, filePath, fileName, caption } = params;
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;

  const buf = await fs.promises.readFile(filePath);
  const blob = new Blob([buf], { type: "application/pdf" });
  // @ts-expect-error Node 18+ имеет глобальный File
  const webFile = new File([blob], fileName, { type: "application/pdf" });

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  form.append("document", webFile);

  const resp = await fetch(tgUrl, { method: "POST", body: form as any });
  const text = await resp.text().catch(() => "");
  let json: TgSendResult | null = null;
  try {
    json = text ? (JSON.parse(text) as TgSendResult) : null;
  } catch {
    json = null;
  }

  if (!resp.ok || !json?.ok) {
    const details = json?.description || text || resp.statusText;
    throw new Error(`Telegram error: ${resp.status} ${details}`);
  }
  return json!;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).send("Method Not Allowed");
  }

  const botToken = process.env.TGBOT_TOKEN || "";
  const chatSingle = process.env.MANAGER_CHAT_ID || "";
  const chatMulti = process.env.MANAGER_CHAT_IDS || "";
  const chats: string[] = (chatMulti ? chatMulti.split(",") : [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chats.length && chatSingle) chats.push(chatSingle);

  if (!botToken || !chats.length) {
    return res.status(500).send("Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required");
  }

  const DEBUG = process.env.DEBUG_TELEGRAM === "1";

  try {
    const { fields, files } = await parseForm(req);

    // payload
    const metaRaw = typeof fields.payload === "string" ? fields.payload : Array.isArray(fields.payload) ? fields.payload[0] : "{}";
    let meta: any = {};
    try { meta = JSON.parse(String(metaRaw || "{}")); } catch { meta = {}; }

    // файл
    const fAny = (files as any).pdf as FormidableFile | FormidableFile[] | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;
    if (!f?.filepath) return res.status(400).send("No pdf");

    const filePath = f.filepath;
    const originalName = f.originalFilename || f.newFilename || `order-${Date.now()}.pdf`;
    const safeBase = path.basename(originalName).replace(/[^\w.\-]+/g, "_");

    // подпись
    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const captionLines = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ].filter(Boolean);
    const caption = captionLines.join("\n");

    // шлём во все чаты и собираем результаты
    const results: Array<{ chatId: string; messageId?: number; chat?: any }> = [];
    for (const chatId of chats) {
      const r = await sendToTelegramDocument({
        botToken,
        chatId,
        filePath,
        fileName: safeBase,
        caption,
      });
      const messageId = r?.result?.message_id;
      const chatObj = r?.result?.chat || { id: chatId };
      results.push({ chatId, messageId, chat: chatObj });
      if (DEBUG) {
        console.log("[send-order-pdf] sent:", {
          chat_id: chatId,
          message_id: messageId,
          chat: chatObj,
          file: safeBase,
        });
      }
    }

    // чистим временный файл
    try { await fs.promises.unlink(filePath); } catch {}

    return res.status(200).json({ ok: true, results });
  } catch (e: any) {
    console.error("/api/send-order-pdf error:", e);
    return res.status(500).send(e?.message || "Internal error");
  }
}
