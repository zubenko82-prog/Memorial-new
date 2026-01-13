// pages/api/send-order-pdf.ts
// Принимает PDF (multipart/form-data) и отправляет его в Telegram чат(ы) менеджеров.
// Pages Router + formidable. Без использования req.formData().
// Имя файла передаём третьим аргументом FormData.append(..., blob, fileName).

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";

const VERSION = "send-order-pdf@pages-2026-01-12-fd2";

export const config = { api: { bodyParser: false } };

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
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

type TgSendResult = { ok: boolean; result?: any; description?: string };

async function tgSendDocument(botToken: string, chatId: string, blob: Blob, fileName: string, caption?: string): Promise<TgSendResult> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  // НЕ используем new File(...). Имя файла передаём 3-м аргументом:
  form.append("document", blob, fileName);

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: form as any });
  const text = await resp.text().catch(() => "");
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!resp.ok || !json?.ok) {
    const details = (json && (json.description || JSON.stringify(json))) || text || resp.statusText;
    throw new Error(`Telegram error: ${resp.status} ${details}`);
  }
  return json!;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST,OPTIONS,HEAD"); return res.status(405).send("Method Not Allowed"); }

  const botToken = process.env.TGBOT_TOKEN || "";
  const single = process.env.MANAGER_CHAT_ID || "";
  const multi = process.env.MANAGER_CHAT_IDS || "";
  const chats = (multi ? multi.split(",") : []).map(s => s.trim()).filter(Boolean);
  if (!chats.length && single) chats.push(single);
  if (!botToken || !chats.length) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required" });
  }

  try {
    const { fields, files } = await parseForm(req);

    // payload (meta)
    const payloadRaw = typeof fields.payload === "string" ? fields.payload : Array.isArray(fields.payload) ? fields.payload[0] : "{}";
    let meta: any = {}; try { meta = JSON.parse(String(payloadRaw || "{}")); } catch {}

    // файл
    const fAny = (files as any).pdf as FormidableFile | FormidableFile[] | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;
    if (!f?.filepath) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "No pdf" });
    }

    const filePath = f.filepath;
    const originalName = f.originalFilename || f.newFilename || `order-${Date.now()}.pdf`;
    const safeBase = path.basename(originalName).replace(/[^\w.\-]+/g, "_");

    // подпись TG
    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const caption = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ].filter(Boolean).join("\n");

    // читаем файл и создаём Blob (Node 18+)
    const buf = await fs.promises.readFile(filePath);
    const blob = new Blob([buf], { type: "application/pdf" });

    // отправка в чаты
    const results: any[] = [];
    for (const chatId of chats) {
      const resp = await tgSendDocument(botToken, chatId, blob, safeBase, caption);
      results.push({ chatId, messageId: resp?.result?.message_id, chat: resp?.result?.chat || { id: chatId } });
    }

    // очистка
    try { await fs.promises.unlink(filePath); } catch {}

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, orderNo: orderNo || undefined, chats, results });
  } catch (e: any) {
    console.error("send-order-pdf pages error:", e);
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
