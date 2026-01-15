// pages/api/tg-send-photo.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File as FormidableFile } from "formidable";

export const config = { api: { bodyParser: false } };

const VERSION = "tg-send-photo@2026-01-15+retries";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tgPostWithRetries(url: string, fd: FormData, opts?: { attempts?: number; baseDelayMs?: number; timeoutMs?: number }) {
  const attempts = Math.max(1, opts?.attempts ?? 4);
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  const timeoutMs = opts?.timeoutMs ?? 25000;

  let lastErr: any = null;

  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { method: "POST", body: fd as any, signal: ac.signal });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try { json = raw ? JSON.parse(raw) : null; } catch {}

      if (resp.ok && json?.ok) {
        clearTimeout(to);
        return { ok: true, json };
      }

      const errCode = json?.error_code || resp.status;
      const desc = json?.description || raw || resp.statusText;

      if (errCode === 403 || errCode === 400) {
        clearTimeout(to);
        return { ok: false, json, status: resp.status, description: desc };
      }

      if (errCode === 429) {
        const retryAfterSec = Number(json?.parameters?.retry_after || 0) || Number((json?.retry_after) || 0);
        const waitMs = Math.max(baseDelayMs, retryAfterSec * 1000);
        lastErr = { code: errCode, description: desc, retryAfterSec };
        clearTimeout(to);
        await sleep(waitMs);
        continue;
      }

      if ((errCode >= 500 && errCode <= 599) || !resp.ok) {
        lastErr = { code: errCode, description: desc };
        clearTimeout(to);
        await sleep(baseDelayMs * Math.pow(2, i));
        continue;
      }

      clearTimeout(to);
      return { ok: false, json, status: resp.status, description: desc };
    } catch (e: any) {
      lastErr = { code: "FETCH_ERROR", description: String(e?.message || e) };
      clearTimeout(to);
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  return { ok: false, error: lastErr || { code: "UNKNOWN", description: "Unknown error" } };
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
    const blob = new Blob([buf], { type: f.mimetype || "image/jpeg" });

    const results: any[] = [];
    for (const chatId of chats) {
      const fd = new FormData();
      fd.append("chat_id", chatId);
      if (caption) fd.append("caption", caption);
      fd.append("photo", blob, f.originalFilename || "photo.jpg");

      // Пауза между чатами
      await sleep(200);

      const out = await tgPostWithRetries(`https://api.telegram.org/bot${botToken}/sendPhoto`, fd);
      if (out.ok) {
        results.push({ ok: true, chatId, messageId: out.json?.result?.message_id });
      } else {
        const err = (out as any).json || (out as any).error || {};
        results.push({
          ok: false,
          chatId,
          error: err?.description || err?.message || "Telegram error",
          error_code: err?.error_code || err?.code || 0
        });
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
