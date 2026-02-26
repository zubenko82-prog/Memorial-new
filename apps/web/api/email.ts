import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import { del, head } from "@vercel/blob";

export const config = { api: { bodyParser: true } };

const VERSION = "email@diag2-never-crash";

function cors(res: VercelResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`CONFIG_ERROR: ${name} missing`);
  return v;
}

function safeStr(x: any, max = 200_000) {
  return String(x ?? "").slice(0, max);
}

/**
 * Для private Blob хранилища нельзя просто fetch(pdfUrl) — нужны подписанные URL.
 * head(pathname) возвращает info.url (signed), который можно fetch'ить.
 */
async function blobPathnameToBuffer(pathname: string, maxBytes: number) {
  const info = await head(pathname);

  const res = await fetch(info.url);
  if (!res.ok) throw new Error(`BLOB_FETCH_FAILED ${res.status} ${res.statusText} pathname=${pathname}`);

  const ct = res.headers.get("content-type") || info.contentType || "application/octet-stream";
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  if (buf.length > maxBytes) throw new Error(`FILE_TOO_LARGE ${buf.length} > ${maxBytes}`);
  return { buf, contentType: ct };
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
  cors(res, true);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();

  // диагностический GET
  if (req.method === "GET") {
    try {
      const env = {
        SMTP_HOST: !!process.env.SMTP_HOST,
        SMTP_PORT: !!process.env.SMTP_PORT,
        SMTP_USER: !!process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS ? `len=${process.env.SMTP_PASS.length}` : null,
        MAIL_FROM: !!process.env.MAIL_FROM,
        MAIL_TO: !!process.env.MAIL_TO,

        EMAIL_MAX_TOTAL_BYTES: process.env.EMAIL_MAX_TOTAL_BYTES || null,
        EMAIL_MAX_ONE_FILE_BYTES: process.env.EMAIL_MAX_ONE_FILE_BYTES || null
      };
      return res.status(200).json({ ok: true, version: VERSION, env });
    } catch (e: any) {
      return res.status(500).json({ ok: false, version: VERSION, error: e?.message || String(e) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, version: VERSION, error: "Method Not Allowed" });

  try {
    const body: any = req.body || {};
    const action = safeStr(body.action || "", 64);

    if (action !== "send_blob") {
      return res.status(400).json({ ok: false, version: VERSION, error: `Unknown action: ${action}` });
    }

    const orderNo = safeStr(body.orderNo || "—", 80).trim() || "—";
    const subject = safeStr(body.subject || `Заявка №${orderNo} (PDF)`, 250);
    const text = safeStr(body.text || `Заявка №${orderNo}\n`, 200_000);

    // Для private store используем pathname (pdfUrl может быть бесполезен)
    const pdfPathname = safeStr(body.pdfPathname, 4000);
    const pdfFilename = safeStr(body.pdfFilename || `order-${orderNo}.pdf`, 180);

    const photoPathnames: string[] = Array.isArray(body.photoPathnames)
      ? body.photoPathnames.map((x: any) => safeStr(x, 4000)).filter(Boolean)
      : [];
    const photoFilenames: string[] = Array.isArray(body.photoFilenames)
      ? body.photoFilenames.map((x: any) => safeStr(x, 200)).filter(Boolean)
      : [];

    if (!pdfPathname) return res.status(400).json({ ok: false, version: VERSION, error: "pdfPathname required" });

    const MAX_TOTAL_BYTES = Number(process.env.EMAIL_MAX_TOTAL_BYTES || String(22 * 1024 * 1024));
    const MAX_ONE_FILE = Number(process.env.EMAIL_MAX_ONE_FILE_BYTES || String(12 * 1024 * 1024));

    const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
    let total = 0;

    // PDF
    const pdfFetched = await blobPathnameToBuffer(pdfPathname, MAX_ONE_FILE);
    total += pdfFetched.buf.length;
    if (total > MAX_TOTAL_BYTES) throw new Error(`TOTAL_ATTACHMENTS_TOO_LARGE ${total} > ${MAX_TOTAL_BYTES}`);

    attachments.push({ filename: pdfFilename, content: pdfFetched.buf, contentType: "application/pdf" });

    // Photos
    for (let i = 0; i < photoPathnames.length; i++) {
      const fetched = await blobPathnameToBuffer(photoPathnames[i], MAX_ONE_FILE);
      total += fetched.buf.length;
      if (total > MAX_TOTAL_BYTES) throw new Error(`TOTAL_ATTACHMENTS_TOO_LARGE ${total} > ${MAX_TOTAL_BYTES}`);

      attachments.push({
        filename: photoFilenames[i] || `photo-${i + 1}.jpg`,
        content: fetched.buf,
        contentType: fetched.contentType
      });
    }

    await sendMailWithAttachments({ subject, text, attachments });

    // cleanup (best-effort)
    try {
      await del(pdfPathname);
    } catch {}
    for (const p of photoPathnames) {
      try {
        await del(p);
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      version: VERSION,
      sent: {
        attachments: attachments.length,
        totalBytes: total,
        pdfBytes: pdfFetched.buf.length,
        photos: photoPathnames.length
      }
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: e?.message || String(e),
      stack: String(e?.stack || "").slice(0, 3000)
    });
  }
}