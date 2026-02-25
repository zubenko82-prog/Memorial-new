// Memorial/apps/web/api/email.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";
import nodemailer from "nodemailer";

export const config = { api: { bodyParser: false } };

const VERSION = "email@2026-02-25+pdf+diag1";

/**
 * ВКЛ/ВЫКЛ диагностику через env:
 *   EMAIL_DEBUG=1
 *
 * Диагностика НЕ возвращает пароль, только:
 * - host/port/secure
 * - user/from/to (обрезанные)
 * - длину пароля и маску (первые/последние 2 символа)
 * - body/fields summary
 * - точку падения nodemailer (код/команда/response)
 */

function cors(res: VercelResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseForm(req: VercelRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
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

function isDebug() {
  return String(process.env.EMAIL_DEBUG || "").trim() === "1";
}

function mask(s: string, head = 2, tail = 2) {
  const t = String(s ?? "");
  if (!t) return "";
  if (t.length <= head + tail) return "*".repeat(t.length);
  return `${t.slice(0, head)}***${t.slice(-tail)}`;
}

function clip(s: string, max = 120) {
  const t = String(s ?? "");
  return t.length <= max ? t : t.slice(0, max) + "…";
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

async function sendMailWithPdf(params: { subject: string; text: string; filename: string; pdf: Buffer }) {
  const host = mustEnv("SMTP_HOST").trim();
  const port = Number(mustEnv("SMTP_PORT"));
  const user = mustEnv("SMTP_USER").trim();
  const pass = mustEnv("SMTP_PASS"); // не тримим пароль специально
  const from = mustEnv("MAIL_FROM").trim();
  const to = (process.env.MAIL_TO || user).trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from,
    to,
    subject: params.subject,
    text: params.text,
    attachments: [{ filename: params.filename, content: params.pdf, contentType: "application/pdf" }]
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
      return res.status(400).json({ ok: false, version: VERSION, error: "action is required", diag: debug ? diagEnv() : undefined });
    }

    if (action !== "send_pdf") {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: `Unknown action: ${action}`, diag: debug ? diagEnv() : undefined });
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
        return res.status(400).json({
          ok: false,
          version: VERSION,
          error: "No file provided (field name: file)",
          diag: debug
            ? {
                ...diagEnv(),
                req: { isMultipart, contentType: clip(contentType, 120), fieldsKeys: Object.keys(fields || {}), filesKeys: Object.keys(files || {}) }
              }
            : undefined
        });
      }

      pdfBuf = await fs.promises.readFile(f.filepath);
    } else {
      const b64 = safeStr(body.pdfBase64, 50_000_000).trim();
      if (!b64) {
        cors(res, true);
        return res.status(400).json({ ok: false, version: VERSION, error: "pdfBase64 is required for JSON mode", diag: debug ? diagEnv() : undefined });
      }
      pdfBuf = Buffer.from(b64, "base64");
    }

    if (!pdfBuf || pdfBuf.length < 300) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "PDF content is empty", diag: debug ? diagEnv() : undefined });
    }

    try {
      await sendMailWithPdf({ subject, text, filename, pdf: pdfBuf });
    } catch (e: any) {
      // nodemailer errors often include: code, command, response, responseCode
      cors(res, true);
      return res.status(502).json({
        ok: false,
        version: VERSION,
        error: e?.message || "SMTP error",
        smtp: debug
          ? {
              code: e?.code,
              command: e?.command,
              response: e?.response,
              responseCode: e?.responseCode
            }
          : undefined,
        diag: debug
          ? {
              ...diagEnv(),
              mail: {
                subject: clip(subject, 120),
                filename: clip(filename, 160),
                textLen: text.length,
                pdfBytes: pdfBuf.length
              },
              req: {
                isMultipart,
                contentType: clip(contentType, 120),
                action: clip(action, 80)
              }
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