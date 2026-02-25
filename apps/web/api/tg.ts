//Memorial\apps\web\api\tg.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File as FormidableFile } from "formidable";
import fs from "node:fs";

export const config = { api: { bodyParser: false } };

const VERSION = "tg@2026-01-20+unified";

function cors(res: VercelResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseForm(req: VercelRequest): Promise<{ fields: formidable.Fields; files: formidable.Files }> {
  const form = formidable({ multiples: false, keepExtensions: false, maxFileSize: Math.floor(4.5 * 1024 * 1024) });
  return new Promise((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
  });
}

function getManagerChats(): string[] {
  const single = process.env.MANAGER_CHAT_ID || "";
  const multi = process.env.MANAGER_CHAT_IDS || "";
  const chats = (multi ? multi.split(",") : []).map((s) => s.trim()).filter(Boolean);
  if (!chats.length && single) chats.push(single);
  return chats;
}

async function tgCall(botToken: string, method: string, fd: FormData) {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", body: fd as any });
  const raw = await resp.text().catch(() => "");
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  return { resp, raw, json };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS,HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  const botToken = process.env.TGBOT_TOKEN || "";
  if (!botToken) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: TGBOT_TOKEN missing" });
  }

  try {
    // action может прийти как JSON, или как multipart field
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
      action = String((fields.action as any) || "");
      body = fields;
    } else {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      action = String(body.action || "");
    }

    if (!action) {
      cors(res, true);
      return res.status(400).json({ ok: false, version: VERSION, error: "action is required" });
    }

    // -------- action: manager_message --------
    if (action === "manager_message") {
      const chats = getManagerChats();
      const text = String(body.text || "").slice(0, 4096);
      if (!chats.length) {
        cors(res, true);
        return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: MANAGER_CHAT_ID(S) missing" });
      }
      if (!text) {
        cors(res, true);
        return res.status(400).json({ ok: false, version: VERSION, error: "text is required" });
      }

      const results: any[] = [];
      for (const chatId of chats) {
        const fd = new FormData();
        fd.append("chat_id", chatId);
        fd.append("text", text);
        fd.append("disable_web_page_preview", "true");

        const { resp, raw, json } = await tgCall(botToken, "sendMessage", fd);
        if (!resp.ok || !json?.ok) {
          results.push({ ok: false, chatId, error: json?.description || raw || resp.statusText, error_code: json?.error_code || resp.status });
        } else {
          results.push({ ok: true, chatId, messageId: json?.result?.message_id });
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      const allFailed = results.every((r) => !r.ok);
      cors(res, true);
      if (allFailed) return res.status(502).json({ ok: false, version: VERSION, error: "TELEGRAM_SEND_FAILED", results });
      return res.status(200).json({ ok: true, version: VERSION, results, partial: results.some((r) => !r.ok) });
    }

    // -------- action: manager_photo --------
    if (action === "manager_photo") {
      const chats = getManagerChats();
      if (!chats.length) {
        cors(res, true);
        return res.status(500).json({ ok: false, version: VERSION, error: "CONFIG_ERROR: MANAGER_CHAT_ID(S) missing" });
      }

      // caption может быть пустой (вам нужно для топбара — без подписи)
      const caption = String(body.caption || "").slice(0, 1024);
      const urlField = String(body.url || body.photoUrl || "").trim();

      const fAny = (files as any)?.file as FormidableFile | FormidableFile[] | undefined;
      const f: FormidableFile | undefined = Array.isArray(fAny) ? fAny[0] : fAny;

      const useUrl = !!urlField && !f?.filepath;

      const results: any[] = [];
      for (const chatId of chats) {
        const fd = new FormData();
        fd.append("chat_id", chatId);
        if (caption) fd.append("caption", caption);

        if (useUrl) {
          fd.append("photo", urlField);
        } else {
          if (!f?.filepath) {
            results.push({ ok: false, chatId, error: "No file or URL provided" });
            continue;
          }
          const buf = await fs.promises.readFile(f.filepath);
          const blob = new Blob([buf], { type: f.mimetype || "image/jpeg" });
          fd.append("photo", blob, f.originalFilename || "photo.jpg");
        }

        const { resp, raw, json } = await tgCall(botToken, "sendPhoto", fd);
        if (!resp.ok || !json?.ok) {
          results.push({ ok: false, chatId, error: json?.description || raw || resp.statusText, error_code: json?.error_code || resp.status });
        } else {
          results.push({ ok: true, chatId, messageId: json?.result?.message_id });
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      const allFailed = results.every((r) => !r.ok);
      cors(res, true);
      if (allFailed) return res.status(502).json({ ok: false, version: VERSION, error: "TELEGRAM_SEND_FAILED", results });
      return res.status(200).json({ ok: true, version: VERSION, results, partial: results.some((r) => !r.ok) });
    }

    // -------- action: dm --------
    if (action === "dm") {
      const userIdRaw = body.userId ?? body.chat_id ?? body.chatId ?? "";
      const userId = Number(userIdRaw);
      const text = String(body.text || "").slice(0, 4096);

      if (!Number.isFinite(userId) || userId <= 0) {
        cors(res, true);
        return res.status(400).json({ ok: false, version: VERSION, error: "userId is required (positive number)" });
      }
      if (!text) {
        cors(res, true);
        return res.status(400).json({ ok: false, version: VERSION, error: "text is required" });
      }

      const fd = new FormData();
      fd.append("chat_id", String(userId));
      fd.append("text", text);
      fd.append("disable_web_page_preview", "true");

      const { resp, raw, json } = await tgCall(botToken, "sendMessage", fd);
      cors(res, true);

      if (!resp.ok || !json?.ok) {
        return res.status(502).json({
          ok: false,
          version: VERSION,
          error: "TELEGRAM_SEND_FAILED",
          error_code: json?.error_code || resp.status,
          description: json?.description || raw || resp.statusText
        });
      }

      return res.status(200).json({ ok: true, version: VERSION, result: { chatId: userId, messageId: json?.result?.message_id } });
    }

    cors(res, true);
    return res.status(400).json({ ok: false, version: VERSION, error: `Unknown action: ${action}` });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
