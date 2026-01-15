// pages/api/tg-send-document.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";

export const config = { api: { bodyParser: false } };

const VERSION = "tg-send-document@2026-01-15+diag";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseForm(req: NextApiRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({ multiples: false, keepExtensions: false, maxFileSize: Math.floor(4.2 * 1024 * 1024) });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const botToken = process.env.TGBOT_TOKEN || "";
    const single = process.env.MANAGER_CHAT_ID || "";
    const multi = process.env.MANAGER_CHAT_IDS || "";
    const chats = (multi ? multi.split(",") : []).map(s => s.trim()).filter(Boolean);
    if (!chats.length && single) chats.push(single);
    if (!botToken || !chats.length) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: TGBOT_TOKEN/CHAT_ID(S) missing" });
    }

    const { fields, files } = await parseForm(req);
    const caption = String((fields.caption as any) || "").slice(0, 1024);
    const fAny = (files as any).file as FormidableFile | FormidableFile[] | undefined;
    const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;
    if (!f?.filepath) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "No file" });
    }

    const buf = await import("node:fs").then(fs => fs.promises.readFile(f.filepath));
    const blob = new Blob([buf], { type: "application/pdf" });

    const results: any[] = [];
    for (const chatId of chats) {
      try {
        const fd = new FormData();
        fd.append("chat_id", chatId);
        if (caption) fd.append("caption", caption);
        fd.append("document", blob, f.originalFilename || "order.pdf");

        const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: "POST",
          body: fd as any
        });

        const raw = await tg.text().catch(() => "");
        let json: any = null;
        try { json = raw ? JSON.parse(raw) : null; } catch {}

        if (!tg.ok || !json?.ok) {
          const errText = json?.description || raw || tg.statusText || "Telegram error";
          const errCode = json?.error_code || tg.status;
          results.push({ ok: false, chatId, error: errText, error_code: errCode });
        } else {
          results.push({ ok: true, chatId, messageId: json?.result?.message_id });
        }
      } catch (e: any) {
        results.push({ ok: false, chatId, error: String(e?.message || e) });
      }
    }

    const allFailed = results.every(r => !r.ok);
    cors(res, true);
    if (allFailed) return res.status(502).json({ ok: false, version: VERSION, error: "TELEGRAM_SEND_FAILED", results });
    return res.status(200).json({ ok: true, version: VERSION, results, partial: results.some(r => !r.ok) });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
