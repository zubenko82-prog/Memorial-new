import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import { del } from "@vercel/blob";

export const config = { api: { bodyParser: true } };

const VERSION = "email@2026-02-25+blob+attachments+fio+diag1";

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

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`CONFIG_ERROR: ${name} missing`);
  return v;
}

function safeStr(x: any, max = 50_000) {
  return String(x ?? "").slice(0, max);
}

async function fetchToBuffer(url: string, maxBytes: number): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FETCH_FAILED ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "application/octet-stream";

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
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  const debug = isDebug();

  try {
    const body: any = req.body || {};
    const action = safeStr(body.action || "send_blob", 64);
    if (action !== "send_blob") {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: `Unknown action: ${action}` });
    }

    const orderNo = safeStr(body.orderNo || "—", 80).trim() || "—";
    const subject = safeStr(body.subject || `Заявка №${orderNo} (PDF)`, 250);
    const text = safeStr(body.text || `Заявка №${orderNo}\n`, 200_000);

    const pdfUrl = safeStr(body.pdfUrl, 4000);
    const pdfPathname = safeStr(body.pdfPathname, 4000);
    const pdfFilename = safeStr(body.pdfFilename || `order-${orderNo}.pdf`, 180) || `order-${orderNo}.pdf`;

    const photoUrls: string[] = Array.isArray(body.photoUrls) ? body.photoUrls.map((x: any) => safeStr(x, 4000)).filter(Boolean) : [];
    const photoPathnames: string[] = Array.isArray(body.photoPathnames) ? body.photoPathnames.map((x: any) => safeStr(x, 4000)).filter(Boolean) : [];
    const photoFilenames: string[] = Array.isArray(body.photoFilenames) ? body.photoFilenames.map((x: any) => safeStr(x, 180)).filter(Boolean) : [];

    if (!pdfUrl || !pdfPathname) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "pdfUrl/pdfPathname required" });
    }

    // Лимиты
    const MAX_TOTAL_BYTES = Number(process.env.EMAIL_MAX_TOTAL_BYTES || String(22 * 1024 * 1024)); // ~22MB
    const MAX_ONE_FILE = Number(process.env.EMAIL_MAX_ONE_FILE_BYTES || String(12 * 1024 * 1024)); // 12MB

    const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
    let total = 0;

    // PDF
    const pdfFetched = await fetchToBuffer(pdfUrl, MAX_ONE_FILE);
    total += pdfFetched.buf.length;
    attachments.push({ filename: pdfFilename, content: pdfFetched.buf, contentType: "application/pdf" });

    // Photos
    for (let i = 0; i < photoUrls.length; i++) {
      const url = photoUrls[i];
      const fetched = await fetchToBuffer(url, MAX_ONE_FILE);
      total += fetched.buf.length;

      if (total > MAX_TOTAL_BYTES) throw new Error(`TOTAL_ATTACHMENTS_TOO_LARGE ${total} > ${MAX_TOTAL_BYTES}`);

      const name = photoFilenames[i] || `photo-${i + 1}.jpg`;
      attachments.push({ filename: name, content: fetched.buf, contentType: fetched.contentType });
    }

    try {
      await sendMailWithAttachments({ subject, text, attachments });
    } catch (e: any) {
      cors(res, true);
      return res.status(502).json({
        ok: false,
        version: VERSION,
        error: e?.message || "SMTP error",
        smtp: debug ? { code: e?.code, command: e?.command, response: e?.response, responseCode: e?.responseCode } : undefined,
        diag: debug
          ? { orderNo, subject, textLen: text.length, totalBytes: total, pdfBytes: pdfFetched.buf.length, photoCount: photoUrls.length }
          : undefined
      });
    }

    // Удаление из Blob (временное хранение)
    try {
      await del(pdfPathname);
    } catch {}
    for (const p of photoPathnames) {
      try {
        await del(p);
      } catch {}
    }

    cors(res, true);
    return res.status(200).json({ ok: true, version: VERSION, totalBytes: total });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}