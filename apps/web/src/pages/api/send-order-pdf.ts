// apps/web/src/pages/api/send-order-pdf.ts
// API: принимает PDF из веб‑приложения и пересылает его(их) в чат(ы) менеджеров в Telegram.
// Требуемые переменные окружения (в веб‑проекте, например Vercel → Project Settings → Environment Variables):
// - TGBOT_TOKEN           — токен бота (например, от @SonetConstructor_bot)
// - MANAGER_CHAT_ID       — один целевой чат/канал, например "-1003021100938"
//   ИЛИ
// - MANAGER_CHAT_IDS      — несколько chat_id через запятую: "-1003021100938,123456789"
// Дополнительно (необязательно):
// - ALLOW_ORIGIN          — для CORS, по умолчанию "*"
//
// Маршрут ожидает: POST multipart/form-data с полями:
// - pdf: File (application/pdf)
// - payload: JSON-строка с метаданными: { orderNo?: string, intro?: { customerName?: string, customerPhone?: string }, extras?: any }
//
// Примечания:
// - Отвечает на OPTIONS (204) и HEAD (200) — удобно для предзапросов/проверок.
// - GET вернёт 405 (Method Not Allowed).

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";

export const config = {
  api: { bodyParser: false }, // обязательнo: мы сами разбираем multipart через formidable
};

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

async function sendToTelegramDocument(params: {
  botToken: string;
  chatId: string;
  filePath: string;
  fileName: string;
  caption?: string;
}) {
  const { botToken, chatId, filePath, fileName, caption } = params;
  const tgUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;

  // Читаем файл в память. Для больших файлов можно переделать на поток.
  const buf = await fs.promises.readFile(filePath);
  const blob = new Blob([buf], { type: "application/pdf" });

  // В среде Node 18+ доступны глобальные FormData и File
  // @ts-expect-error: В среде исполнения (Node 18+/Vercel) File доступен как глобальный класс
  const webFile = new File([blob], fileName, { type: "application/pdf" });

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  form.append("document", webFile);

  const resp = await fetch(tgUrl, { method: "POST", body: form as any });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Telegram error: ${resp.status} ${text}`);
  }
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

  try {
    const { fields, files } = await parseForm(req);

    // Достаём payload
    const metaRaw = typeof fields.payload === "string" ? fields.payload : Array.isArray(fields.payload) ? fields.payload[0] : "{}";
    let meta: any = {};
    try {
      meta = JSON.parse(String(metaRaw || "{}"));
    } catch {
      meta = {};
    }

    // Достаём файл (учитываем возможный массив)
    const fAny = (files as any).pdf as FormidableFile | FormidableFile[] | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;
    if (!f?.filepath) {
      return res.status(400).send("No pdf");
    }

    const filePath = f.filepath;
    const originalName = f.originalFilename || f.newFilename || `order-${Date.now()}.pdf`;
    const safeBase = path.basename(originalName).replace(/[^\w.\-]+/g, "_");

    // Формируем подпись
    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const captionLines = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ].filter(Boolean);
    const caption = captionLines.join("\n");

    // Отправляем во все целевые чаты
    for (const chatId of chats) {
      await sendToTelegramDocument({
        botToken,
        chatId,
        filePath,
        fileName: safeBase,
        caption,
      });
    }

    // Удаляем временный файл (formidable может сам очистить, но подстрахуемся)
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // ignore
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("/api/send-order-pdf error:", e);
    return res.status(500).send(e?.message || "Internal error");
  }
}
