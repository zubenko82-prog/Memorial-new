// Memorial/apps/web/api/email.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import nodemailer from "nodemailer";

export const config = { api: { bodyParser: false } };

const VERSION = "email@2026-02-25+pdf";

function cors(res: VercelResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseForm(req: VercelRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  // PDF может быть чуть больше. Поставим лимит 18MB (под Vercel тоже надо помнить лимиты).
  const form = formidable({ multiples: false, keepExtensions: true, maxFileSize: Math.floor(18 * 1024 * 1024) });
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

async function sendMailWithPdf(params: { subject: string; text: string; filename: string; pdf: Buffer }) {
  const host = mustEnv("SMTP_HOST");
  const port = Number(mustEnv("SMTP_PORT"));
  const user = mustEnv("SMTP_USER");
  const pass = mustEnv("SMTP_PASS");
  const from = mustEnv("MAIL_FROM");
  const to = process.env.MAIL_TO || "Remstiralmash@yandex.com";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    attachments: [{ filename, content: params.pdf, contentType: "application/pdf" }]
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

  try {
    const contentType = String(req.headers["content-type"] || "");
    const isMultipart = contentType.includes("multipart/form-data");

    let action = "";
    let body: any = {};
    let fields: formidable.Fields | null = null;
    let files: formidable.Files | null = null;

    if (isMultipart) {
      const parsed = await parseForm(req);
      fields = parsed.fields;
      files = parsed.files;
      action = safeStr((fields.action as any) || "send_pdf", 64);
      body = fields;
    } else {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      action = safeStr(body.action || "send_pdf", 64);
    }

    if (!action) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "action is required" });
    }

    // Единственное действие: отправить PDF на почту
    if (action !== "send_pdf") {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: `Unknown action: ${action}` });
    }

    const orderNo = safeStr(body.orderNo, 80).trim() || "—";
    const filename = safeStr(body.filename || body.pdfFilename || `order-${orderNo || Date.now()}.pdf`, 140);
    const subject = safeStr(body.subject || `Заявка №${orderNo} (PDF)`, 250);
    const text = safeStr(body.text || body.message || `Заявка №${orderNo}\n\nВо вложении PDF.\n`, 200_000);

    let pdfBuf: Buffer | null = null;

    if (isMultipart) {
      const fAny = (files as any)?.file as FormidableFile | FormidableFile[] | undefined;
      const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;

      if (!f?.filepath) {
        cors(res, true);
        return res.status(400).json({ ok: false, version: VERSION, error: "No file provided (field name: file)" });
      }

      pdfBuf = await fs.promises.readFile(f.filepath);
    } else {
      const b64 = safeStr(body.pdfBase64, 50_000_000).trim();
      if (!b64) {
        cors(res, true);
        return res.status(400).json({ ok: false, version: VERSION, error: "pdfBase64 is required for JSON mode" });
      }
      pdfBuf = Buffer.from(b64, "base64");
    }

    if (!pdfBuf || pdfBuf.length < 300) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "PDF content is empty" });
    }

    await sendMailWithPdf({ subject, text, filename, pdf: pdfBuf });

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}