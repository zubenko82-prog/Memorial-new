// pages/api/send-order-pdf.ts
// Принимает PDF (multipart/form-data) и отправляет его в Telegram чат(ы) менеджеров.
// Pages Router + formidable. Без req.formData(). Имя файла передаём 3-м аргументом FormData.append(..., blob, fileName).
//
// Обновления:
// - Ранний контроль размера по заголовку Content-Length → 413 JSON с понятным сообщением (FUNCTION_PAYLOAD_TOO_LARGE).
// - Ограничение maxFileSize в formidable синхронизировано с лимитом (по умолчанию ~4.2 МБ, можно поменять через env MAX_UPLOAD_BYTES).
// - Детальные ответы при частичных/полных сбоях отправки в Telegram (results по каждому чату).
// - Всегда отдаём JSON с ok/кодом ошибки, чтобы фронт мог показать уведомление.

import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import path from "node:path";

// версию меняйте при правках
const VERSION = "send-order-pdf@pages-2026-01-13-fix413";
// Мягкий лимит под прокси serverless (~4.2 МБ по умолчанию). Можно переопределить переменной окружения.
const MAX_UPLOAD_BYTES = Math.floor(
  Number(process.env.MAX_UPLOAD_BYTES || 4.2 * 1024 * 1024)
);

export const config = { api: { bodyParser: false } };

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Upload-Limit-Bytes");
  res.setHeader("X-Upload-Limit-Bytes", String(MAX_UPLOAD_BYTES));
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function jsonError(
  res: NextApiResponse,
  status: number,
  code: string,
  error: string,
  extra?: Record<string, any>
) {
  cors(res, true);
  return res.status(status).json({
    ok: false,
    version: VERSION,
    code,
    error,
    ...(extra || {})
  });
}

function parseForm(
  req: NextApiRequest
): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    maxFileSize: MAX_UPLOAD_BYTES, // защита на уровне парсера
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) =>
      err ? reject(err) : resolve({ fields, files })
    );
  });
}

type TgSendResult = { ok: boolean; result?: any; description?: string };

async function tgSendDocument(
  botToken: string,
  chatId: string,
  blob: Blob,
  fileName: string,
  caption?: string
): Promise<TgSendResult> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  // НЕ используем new File(...). Имя файла передаём 3-м аргументом:
  form.append("document", blob, fileName);

  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendDocument`,
    { method: "POST", body: form as any }
  );
  const text = await resp.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!resp.ok || !json?.ok) {
    const details =
      (json && (json.description || JSON.stringify(json))) ||
      text ||
      resp.statusText;
    throw new Error(`Telegram error: ${resp.status} ${details}`);
  }
  return json!;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).send("Method Not Allowed");
  }

  // Ранний отказ по заголовку Content-Length (если известен).
  try {
    const cl = Array.isArray(req.headers["content-length"])
      ? Number(req.headers["content-length"][0])
      : Number(req.headers["content-length"] || 0);
    if (cl && cl > MAX_UPLOAD_BYTES) {
      return jsonError(
        res,
        413,
        "FUNCTION_PAYLOAD_TOO_LARGE",
        `PDF слишком большой: ${(cl / (1024 * 1024)).toFixed(
          2
        )} МБ. Лимит ~${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(
          2
        )} МБ. Уменьшите размер файла или отправьте менеджеру вручную.`,
        { limitBytes: MAX_UPLOAD_BYTES, contentLength: cl }
      );
    }
  } catch {
    // игнорируем
  }

  const botToken = process.env.TGBOT_TOKEN || "";
  const single = process.env.MANAGER_CHAT_ID || "";
  const multi = process.env.MANAGER_CHAT_IDS || "";
  const chats = (multi ? multi.split(",") : [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chats.length && single) chats.push(single);

  if (!botToken || !chats.length) {
    return jsonError(
      res,
      500,
      "CONFIG_ERROR",
      "Server misconfigured: TGBOT_TOKEN and MANAGER_CHAT_ID(S) required"
    );
  }

  let filePath = "";
  try {
    const { fields, files } = await parseForm(req);

    // payload (meta)
    const payloadRaw =
      typeof fields.payload === "string"
        ? fields.payload
        : Array.isArray(fields.payload)
          ? fields.payload[0]
          : "{}";
    let meta: any = {};
    try {
      meta = JSON.parse(String(payloadRaw || "{}"));
    } catch {}

    // файл
    const fAny = (files as any).pdf as
      | FormidableFile
      | FormidableFile[]
      | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;

    if (!f?.filepath) {
      return jsonError(res, 400, "NO_FILE", "No pdf");
    }

    filePath = f.filepath;
    const originalName =
      f.originalFilename || f.newFilename || `order-${Date.now()}.pdf`;
    const safeBase = path.basename(originalName).replace(/[^\w.\-]+/g, "_");

    // Дополнительная проверка фактического размера файла (если удалось сохранить)
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > MAX_UPLOAD_BYTES) {
        // удалим временный файл и вернём 413
        try { await fs.promises.unlink(filePath); } catch {}
        return jsonError(
          res,
          413,
          "FUNCTION_PAYLOAD_TOO_LARGE",
          `PDF слишком большой: ${(stat.size / (1024 * 1024)).toFixed(
            2
          )} МБ. Лимит ~${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(
            2
          )} МБ. Уменьшите размер файла или отправьте менеджеру вручную.`,
          { limitBytes: MAX_UPLOAD_BYTES, fileSize: stat.size }
        );
      }
    } catch {
      // нет stat — продолжаем
    }

    // подпись TG
    const orderNo = String(meta?.orderNo || "").trim();
    const intro = meta?.intro || {};
    const caption = [
      orderNo ? `Заявка №${orderNo}` : "Заявка",
      intro.customerName ? `Заказчик: ${intro.customerName}` : "",
      intro.customerPhone ? `Телефон: ${intro.customerPhone}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // читаем файл и создаём Blob (Node 18+)
    const buf = await fs.promises.readFile(filePath);
    const blob = new Blob([buf], { type: "application/pdf" });

    // отправка в чаты
    const results: any[] = [];
    for (const chatId of chats) {
      try {
        const resp = await tgSendDocument(
          botToken,
          chatId,
          blob,
          safeBase,
          caption
        );
        results.push({
          ok: true,
          chatId,
          messageId: resp?.result?.message_id,
          chat: resp?.result?.chat || { id: chatId },
        });
      } catch (e: any) {
        results.push({
          ok: false,
          chatId,
          error: String(e?.message || e) || "Telegram send error",
        });
      }
    }

    // очистка временного файла
    try {
      await fs.promises.unlink(filePath);
    } catch {}

    const allFailed = results.every((r) => !r.ok);
    const partial = !allFailed && results.some((r) => !r.ok);

    if (allFailed) {
      return jsonError(res, 502, "TELEGRAM_SEND_FAILED", "Failed to send to all chats", {
        version: VERSION,
        orderNo: orderNo || undefined,
        chats,
        results,
      });
    }

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      orderNo: orderNo || undefined,
      chats,
      results,
      partial, // true, если в какие-то чаты не получилось
    });
  } catch (e: any) {
    console.error("send-order-pdf pages error:", e);
    return jsonError(
      res,
      500,
      "INTERNAL_ERROR",
      e?.message || "Internal error"
    );
  } finally {
    // на всякий случай
    if (filePath) {
      try {
        await fs.promises.unlink(filePath);
      } catch {}
    }
  }
}
