// pages/api/send-order.ts
// Отправка заказа в админ-чат Telegram (-1003021100938).
// Требуется переменная окружения TELEGRAM_BOT_TOKEN (токен бота).
//
// Важно:
// - Увеличен лимит bodyParser до 10mb (чтобы принимать dataURL превью).
// - Поддерживает отправку текста + превью (front/back) как медиа-группу.
// - Не светим токен в браузере: вызов только с фронта на этот API.
//
// Пример .env.local:
// TELEGRAM_BOT_TOKEN=1234567890:AA...your-bot-token...
//
// Фронт вызывает POST /api/send-order с payload, который вы уже формируете в ReviewAndSendStep (extras).
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

type SendResult = { ok: boolean; id?: string; message?: string };

const ADMIN_CHAT_ID = "-1003021100938";

export default async function handler(req: NextApiRequest, res: NextApiResponse<SendResult>) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, message: "TELEGRAM_BOT_TOKEN is not set" });
  }

  try {
    const body = req.body || {};
    const extras = body.extras || body || {};
    // Извлекаем полезные поля (если есть)
    const orderNo = extras.orderNo || "";
    const customerName = extras?.intro?.customerName || extras?.name || "";
    const customerPhone = extras?.intro?.customerPhone || extras?.phone || "";
    const orderNotes = extras?.orderNotes || extras?.notes || "";

    // Доп. части заказа
    const base = extras.base ? "да" : "нет";
    const flowerbed = extras.flowerbed ? "да" : "нет";
    const plateEnabled = extras.headstonePlate ? "да" : "нет";
    const plateSize = extras.plateSize || "—";
    const plateThickness = extras.plateThickness || "—";
    const plateOrient = extras.plateOrientation === "horizontal" ? "горизонтально" : (extras.plateOrientation === "vertical" ? "вертикально" : "—");

    // Текст сообщения
    const lines: string[] = [];
    lines.push("🧾 Новый заказ");
    if (orderNo) lines.push(`№: ${orderNo}`);
    if (customerName || customerPhone) lines.push(`Клиент: ${customerName || "—"} · ${customerPhone || "—"}`);
    lines.push(`Тумба: ${base}; Цветник: ${flowerbed}`);
    lines.push(`Плита: ${plateEnabled}`);
    if (extras.headstonePlate) {
      lines.push(`— Размер: ${plateSize}; Толщина: ${plateThickness}; Ориентация: ${plateOrient}`);
      if (extras.plateEpitaph) lines.push(`— Эпитафия (плита): ${String(extras.plateEpitaph).slice(0, 500)}`);
      const g = Array.isArray(extras.plateGraphicsIds) ? extras.plateGraphicsIds : [];
      if (g.length) lines.push(`— Графика (плита): ${g.length} шт.`);
    }
    if (orderNotes) lines.push(`Примечание: ${String(orderNotes).slice(0, 1000)}`);
    lines.push("");
    lines.push("Эскизы см. медиа ниже (если приложены).");

    const text = lines.join("\n");

    // Отправка текста
    const baseUrl = `https://api.telegram.org/bot${token}`;
    const sendMessageUrl = `${baseUrl}/sendMessage`;

    const sendMessageRes = await fetch(sendMessageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text })
    });
    const msgJson = await sendMessageRes.json();
    if (!sendMessageRes.ok || msgJson?.ok !== true) {
      throw new Error(`sendMessage failed: ${sendMessageRes.status} ${sendMessageRes.statusText} ${JSON.stringify(msgJson)}`);
    }

    // Подготовка медиа (если есть превью из фронта)
    const attachments = extras.attachments || {};
    const front = attachments.frontPreview as string | undefined;
    const back = attachments.backPreview as string | undefined;

    const media: { type: "photo"; media: string; caption?: string }[] = [];
    const form = new FormData();

    let fileCount = 0;
    const appendDataUrlAsFile = async (dataUrl: string, field: string, filename: string) => {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return false;
      const { mime, buffer } = parsed;
      // Blob/undici FormData в Node 18+
      const blob = new Blob([buffer], { type: mime || "image/jpeg" });
      form.append(field, blob, filename);
      return true;
    };

    if (front && isDataUrl(front)) {
      fileCount++;
      media.push({ type: "photo", media: "attach://front.jpg", caption: "Эскиз: лицевая" });
      await appendDataUrlAsFile(front, "front.jpg", "front.jpg");
    }
    if (back && isDataUrl(back)) {
      fileCount++;
      media.push({ type: "photo", media: "attach://back.jpg", caption: "Эскиз: тыльная" });
      await appendDataUrlAsFile(back, "back.jpg", "back.jpg");
    }

    if (fileCount > 0) {
      // Telegram требует media как JSON, и файлы с именами, совпадающими с attach://...
      const sendMediaUrl = `${baseUrl}/sendMediaGroup`;
      form.append("chat_id", ADMIN_CHAT_ID);
      form.append("media", JSON.stringify(media));

      const sendMediaRes = await fetch(sendMediaUrl, { method: "POST", body: form as any });
      const mediaJson = await sendMediaRes.json();
      if (!sendMediaRes.ok || mediaJson?.ok !== true) {
        // Не критично — мы уже отправили текст
        console.warn("sendMediaGroup failed:", sendMediaRes.status, sendMediaRes.statusText, mediaJson);
      }
    }

    return res.status(200).json({ ok: true, id: String(msgJson?.result?.message_id || "") });
  } catch (e: any) {
    console.error("send-order error:", e);
    return res.status(500).json({ ok: false, message: e?.message || "Internal error" });
  }
}

// ===== helpers =====
function isDataUrl(s?: string): boolean {
  return !!s && /^data:/.test(s);
}
function parseDataUrl(dataUrl?: string): { mime: string; buffer: Buffer } | null {
  try {
    if (!dataUrl) return null;
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1];
    const b64 = m[2];
    const buffer = Buffer.from(b64, "base64");
    return { mime, buffer };
  } catch {
    return null;
  }
}
