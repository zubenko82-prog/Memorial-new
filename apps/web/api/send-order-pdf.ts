// pages/api/send-order-pdf.ts
// Принимает PDF (multipart/form-data) и отправляет его в Telegram чат(ы) менеджеров.
// Возвращает подробный ответ (message_id, chat.id), чтобы было видно, куда ушло.
//
// Env (в веб‑проекте, например Vercel → Project Settings → Environment Variables):
// - TGBOT_TOKEN            — токен бота
// - MANAGER_CHAT_ID        — один chat_id, например "-1003021100938"
//   или
// - MANAGER_CHAT_IDS       — несколько chat_id через запятую: "-1003021100938,123456789"
// - ALLOW_ORIGIN (опц.)    — CORS, по умолчанию "*"

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";

const VERSION = "send-order-pdf@2026-01-12-fix-no-File";

export const config = {
  api: { bodyParser: false }, // сами парсим multipart через formidable
};

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 20 * 1024 * 1024, // 20 MB
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

type TgSendResult = {
  ok: boolean;
  result?: {
    message_id?: number;
    date?: number;
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

  // Читаем файл в Buffer и создаём Blob (Node 18+).
  const buf = await fs.promises.readFile(filePath);
  const blob = new Blob([buf], { type: "application/pdf" });

  // ВАЖНО: НЕ используем new File(...).
  // Передаём имя файла как 3-й аргумент append — это поддерживается undici FormData в Node 18.
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("document", blob, fileName);

  const resp = await fetch(tgUrl, { method: "POST", body: form as any });
  const text = await resp.text().catch(() => "");
  let json: TgSendResult | null = null;
  try { json = text ? (JSON.parse(text) as TgSendResult) : null; } catch { json = null; }

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
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: "Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required",
    });
  }

  try {
    const { fields, files } = await parseForm(req);

    // payload
    const metaRaw =
      typeof fields.payload === "string"
        ? fields.payload
        : Array.isArray(fields.payload)
        ? fields.payload[0]
        : "{}";
    let meta: any = {};
    try { meta = JSON.parse(String(metaRaw || "{}")); } catch { meta = {}; }

    // файл
    const fAny = (files as any).pdf as FormidableFile | FormidableFile[] | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;
    if (!f?.filepath) return res.status(400).json({ ok: false, version: VERSION, error: "No pdf" });

    const filePath = f.filepath;
    const originalName = f.originalFilename || f.newFilename || `order-${Date.now()}.pdf`;
    const safeBase = path.basename(originalName).replace(/[^\w.\-]+/g, "_");

    // подпись к сообщению
    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const caption = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ].filter(Boolean).join("\n");

    // отправка в чаты
    const results: Array<{ chatId: string; messageId?: number; chat?: any }> = [];
    for (const chatId of chats) {
      const r = await sendToTelegramDocument({
        botToken,
        chatId,
        filePath,
        fileName: safeBase,
        caption,
      });
      results.push({
        chatId,
        messageId: r?.result?.message_id,
        chat: r?.result?.chat || { id: chatId },
      });
    }

    // очистка
    try { await fs.promises.unlink(filePath); } catch {}

    return res.status(200).json({
      ok: true,
      version: VERSION,
      orderNo: orderNo || undefined,
      chats,
      results,
    });
  } catch (e: any) {
    console.error("/api/send-order-pdf error:", e);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
