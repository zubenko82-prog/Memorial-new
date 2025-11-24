// api/send-order-email.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

type Extras = { base?: boolean; headstonePlate?: boolean; flowerbed?: boolean };

function recipients(): string[] {
  const envList = (process.env.MAIL_TO || "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
  return envList.length ? envList : ["Zubenko82@gmail.com", "Remstiralmash@yandex.com"];
}
function cm(n?: number) { return (typeof n === 'number' && isFinite(n)) ? (n/10).toFixed(1).replace(/\.0$/,'') : '—'; }
function escapeHtml(s: string) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function shortList(arr?: any[], limit = 50) {
  if (!Array.isArray(arr) || arr.length === 0) return '—';
  return arr.slice(0, limit).map((x) => (typeof x === 'string' ? x : (x?.name || x?.id || JSON.stringify(x)))).join('\n');
}

function buildEmail(draft: any, extras: Extras) {
  const intro = draft?.intro || {};
  const name = intro.customerName || '';
  const phone = intro.customerPhone || '';
  const notes = intro.customerNotes || '';

  const item = draft?.item || {};
  const size = draft?.size || {};

  const persons = Array.isArray(draft?.engraving?.persons) ? draft.engraving.persons : [];
  const personsHtml = persons.length
    ? persons.map((p: any) => {
        const l1 = (p.lastName || '').trim();
        const l2 = [p.firstName, p.middleName].map((s: string) => (s || '').trim()).filter(Boolean).join(' ');
        const l3 = [p.birthDate, p.deathDate].map((s: string) => (s || '').trim()).filter(Boolean).join(' — ');
        return `<li>${[l1, l2, l3].filter(Boolean).join(' | ')}</li>`;
      }).join('')
    : '<li>—</li>';

  let frontEpitaphs: string[] = [];
  if (Array.isArray(draft?.engraving?.epitaphs) && draft.engraving.epitaphs.length) {
    frontEpitaphs = draft.engraving.epitaphs;
  } else if (draft?.engraving?.epitaphText) {
    frontEpitaphs = String(draft.engraving.epitaphText).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  const frontGraphics = Array.isArray(draft?.graphics) ? draft.graphics : [];
  const rearEpitaphs: string[] = Array.isArray(draft?.editorBack?.epitaphTexts) ? draft.editorBack.epitaphTexts : [];
  const rearSel: string[] = Array.isArray(draft?.editorBack?.selectedGraphicsIds) ? draft.editorBack.selectedGraphicsIds : [];

  const frontPreview = draft?.editor?.previewHiUrl || draft?.editor?.previewUrl || '';
  const rearPreview  = draft?.editorBack?.previewHiUrl || draft?.editorBack?.previewUrl || '';

  const extrasHtml = `
    <ul>
      <li>Тумба: ${extras.base ? 'да' : 'нет'}</li>
      <li>Надгробная плита: ${extras.headstonePlate ? 'да' : 'нет'}</li>
      <li>Цветник: ${extras.flowerbed ? 'да' : 'нет'}</li>
    </ul>`.trim();

  const subject = `Заявка Memorial ${draft?.orderNumber ? `№${draft.orderNumber} ` : ""}— ${name || 'без имени'} ${phone || ''}`.trim();

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111">
    <h2 style="margin:0 0 8px">Новая заявка Memorial</h2>

    <h3 style="margin:12px 0 6px">Контакты</h3>
    <div>Имя: <strong>${escapeHtml(name) || '—'}</strong></div>
    <div>Телефон: <strong>${escapeHtml(phone) || '—'}</strong></div>
    ${notes ? `<div>Примечание: ${escapeHtml(notes)}</div>` : ''}

    <h3 style="margin:12px 0 6px">Изделие</h3>
    <div>${escapeHtml(item?.name || '')}</div>

    <h3 style="margin:12px 0 6px">Размеры</h3>
    <div>${cm(size?.height)} × ${cm(size?.width)} × ${cm(size?.thickness)} см</div>
    ${size?.notes ? `<div>Примечание: ${escapeHtml(size.notes)}</div>` : ''}

    <h3 style="margin:12px 0 6px">Люди</h3>
    <ul>${personsHtml}</ul>

    <h3 style="margin:12px 0 6px">Эпитафии (лицевая)</h3>
    <pre style="white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:8px">${escapeHtml(shortList(frontEpitaphs, 20))}</pre>

    <h3 style="margin:12px 0 6px">Графика (лицевая)</h3>
    <pre style="white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:8px">${escapeHtml(shortList(frontGraphics, 50))}</pre>

    <h3 style="margin:12px 0 6px">Эпитафии (тыльная)</h3>
    <pre style="white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:8px">${escapeHtml(shortList(rearEpitaphs, 20))}</pre>

    <h3 style="margin:12px 0 6px">Графика (тыльная)</h3>
    <pre style="white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:8px">${escapeHtml(shortList(rearSel, 50))}</pre>

    <h3 style="margin:12px 0 6px">Эскизы</h3>
    <div>Лицевая: ${frontPreview ? `<a href="${frontPreview}">ссылка</a>` : '—'}</div>
    <div>Тыльная: ${rearPreview ? `<a href="${rearPreview}">ссылка</a>` : '—'}</div>

    <h3 style="margin:12px 0 6px">Дополнительно</h3>
    ${extrasHtml}
  </div>`.trim();

  return { subject, html };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try {
    const { draft, extras } = (req.body || {}) as { draft: any; extras?: Extras };
    const extrasNorm: Extras = {
      base: !!extras?.base,
      headstonePlate: !!extras?.headstonePlate,
      flowerbed: !!extras?.flowerbed
    };

    // SMTP transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_PORT || "465") === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const { subject, html } = buildEmail(draft, extrasNorm);
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `Memorial <no-reply@localhost>`,
      to: recipients().join(", "),
      subject,
      html
    });

    // Уведомление в Telegram (опционально)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      const name = draft?.intro?.customerName || '';
      const phone = draft?.intro?.customerPhone || '';
      const msg = [
        "🧾 Новая заявка Memorial",
        draft?.orderNumber ? `• № ${draft.orderNumber}` : "",
        name ? `• Имя: ${name}` : "",
        phone ? `• Телефон: ${phone}` : "",
        `• Доп.: тумба:${extrasNorm.base ? "да" : "нет"}, плита:${extrasNorm.headstonePlate ? "да" : "нет"}, цветник:${extrasNorm.flowerbed ? "да" : "нет"}`
      ].filter(Boolean).join("\n");

      try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: msg })
        });
      } catch (e) {
        console.error("Telegram notify failed", e);
      }
    }

    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).send(e?.message || "Send failed");
  }
}
