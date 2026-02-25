// Memorial/apps/web/api/email.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import nodemailer from "nodemailer";
import path from "node:path";

export const config = { api: { bodyParser: false } };

const VERSION = "email@2026-02-25+pdf+photos+diag1";

function cors(res: VercelResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function isDebug() {
  return String(process.env.EMAIL_DEBUG || "").trim() === "1";
}

function parseForm(req: VercelRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  // Важно: общий лимит Vercel всё равно ограничен. Не грузите десятки фото по 10MB.
  const form = formidable({
    multiples: true,
    keepExtensions: true,
    maxFileSize: Math.floor(18 * 1024 * 1024)
  });

  return new Promise((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`CONFIG_ERROR: ${name} missing`);
  return v;
}

function safeStr(x: any, max = 10_000) {
  return String(x ?? "").slice(0, max);
}

function clip(s: string, max = 120) {
  const t = String(s ?? "");
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function mask(s: string, head = 2, tail = 2) {
  const t = String(s ?? "");
  if (!t) return "";
  if (t.length <= head + tail) return "*".repeat(t.length);
  return `${t.slice(0, head)}***${t.slice(-tail)}`;
}

function diagEnv() {
  const host = String(process.env.SMTP_HOST ?? "");
  const portStr = String(process.env.SMTP_PORT ?? "");
  const port = portStr ? Number(portStr) : NaN;
  const secure = port === 465;

  const user = String(process.env.SMTP_USER ?? "");
  const pass = String(process.env.SMTP_PASS ?? "");
  const from = String(process.env.MAIL_FROM ?? "");
  const to = String(process.env.MAIL_TO ?? "");

  return {
    host: { raw: clip(host, 200), trimmed: clip(host.trim(), 200), len: host.length },
    port: { raw: clip(portStr, 40), num: port, isNaN: Number.isNaN(port), secure },
    user: { raw: clip(user, 200), trimmed: clip(user.trim(), 200), len: user.length },
    from: { raw: clip(from, 200), trimmed: clip(from.trim(), 200), len: from.length },
    to: { raw: clip(to, 200), trimmed: clip(to.trim(), 200), len: to.length },
    pass: { len: pass.length, masked: mask(pass, 2, 2), hasSpaces: pass !== pass.trim() }
  };
}

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function guessContentTypeByExt(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  return "application/octet-stream";
}

async function sendMailWithAttachments(params: {
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[];
}) {
  const host = mustEnv("SMTP_HOST").trim();
  const port = Number(mustEnv("SMTP_PORT"));
  const user = mustEnv("SMTP_USER").trim();
  const pass = mustEnv("SMTP_PASS");
  const from = mustEnv("MAIL_FROM").trim();
  const to = (process.env.MAIL_TO || user).trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from,
    to,
    subject: params.subject,
    text: params.text,
    encoding: "utf-8",
    attachments: params.attachments
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  const debug = isDebug();

  try {
    const contentType = String(req.headers["content-type"] || "");
    const isMultipart = contentType.includes("multipart/form-data");
    if (!isMultipart) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "Use multipart/form-data (PDF + photos)" });
    }

    const { fields, files } = await parseForm(req);

    const action = safeStr((fields.action as any) || "send_pdf", 64);
    if (action !== "send_pdf") {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: `Unknown action: ${action}`, diag: debug ? diagEnv() : undefined });
    }

    const orderNo = safeStr((fields.orderNo as any) || "—", 80).trim() || "—";
    const filename = safeStr((fields.filename as any) || `order-${orderNo || Date.now()}.pdf`, 140);
    const subject = safeStr((fields.subject as any) || `Заявка №${orderNo} (PDF)`, 250);
    const text = safeStr((fields.text as any) || `Заявка №${orderNo}\n\nВо вложении PDF и фото.\n`, 200_000);

    // PDF (обязателен)
    const pdfFileAny = (files as any)?.file as FormidableFile | FormidableFile[] | undefined;
    const pdfFile = Array.isArray(pdfFileAny) ? pdfFileAny[0] : pdfFileAny;

    if (!pdfFile?.filepath) {
      cors(res, true);
      return res.status(400).json({
        ok: false,
        version: VERSION,
        error: "No PDF provided (field name: file)",
        diag: debug ? { ...diagEnv(), filesKeys: Object.keys(files || {}) } : undefined
      });
    }

    const pdfBuf = await fs.promises.readFile(pdfFile.filepath);
    if (pdfBuf.length < 300) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "PDF content is empty", diag: debug ? diagEnv() : undefined });
    }

    const attachments: { filename: string; content: Buffer; contentType?: string }[] = [
      { filename, content: pdfBuf, contentType: "application/pdf" }
    ];

    // Фото (необязательны, но вы хотите "обязательно" — тогда сделаем проверку ниже)
    const photoFilesAny = (files as any)?.photos as FormidableFile | FormidableFile[] | undefined;
    const photoFiles = toArray(photoFilesAny).filter((f) => !!f?.filepath);

    // Если фото должны быть обязательно — раскомментируйте:
    // if (photoFiles.length === 0) {
    //   cors(res, true);
    //   return res.status(400).json({ ok: false, version: VERSION, error: "No photos provided (field name: photos)" });
    // }

    // Ограничение количества (чтобы не убить лимиты)
    const MAX_PHOTOS = Number(process.env.EMAIL_MAX_PHOTOS || "12");
    const limitedPhotos = photoFiles.slice(0, MAX_PHOTOS);

    for (let i = 0; i < limitedPhotos.length; i++) {
      const f = limitedPhotos[i];
      const orig = safeStr(f.originalFilename || `photo-${i + 1}`, 140);
      const ext = path.extname(orig) || "";
      const safeName = `photo-${i + 1}${ext || ""}`;
      const buf = await fs.promises.readFile(f.filepath);

      attachments.push({
        filename: safeName,
        content: buf,
        contentType: guessContentTypeByExt(safeName)
      });
    }

    try {
      await sendMailWithAttachments({ subject, text, attachments });
    } catch (e: any) {
      cors(res, true);
      return res.status(502).json({
        ok: false,
        version: VERSION,
        error: e?.message || "SMTP error",
        smtp: debug
          ? { code: e?.code, command: e?.command, response: e?.response, responseCode: e?.responseCode }
          : undefined,
        diag: debug
          ? {
              ...diagEnv(),
              mail: { subject: clip(subject, 120), filename: clip(filename, 160), textLen: text.length, pdfBytes: pdfBuf.length, photos: limitedPhotos.length }
            }
          : undefined
      });
    }

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, diag: debug ? { env: diagEnv() } : undefined });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error", diag: debug ? diagEnv() : undefined });
  }
}