// server/index.js
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '8mb' }));

function recipients() {
  const envList = (process.env.MAIL_TO || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  return envList.length ? envList : ['Zubenko82@gmail.com', 'Remstiralmash@yandex.com'];
}
function cm(n) { return (typeof n === 'number' && isFinite(n)) ? (n / 10).toFixed(1).replace(/\.0$/, '') : '—'; }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function shortList(arr, limit = 50) {
  if (!Array.isArray(arr) || arr.length === 0) return '—';
  return arr.slice(0, limit).map(x => (typeof x === 'string' ? x : (x?.name || x?.id || JSON.stringify(x)))).join('\n');
}
function buildEmail(draft, extras) {
  const intro = draft?.intro || {};
  const name = intro.customerName || '';
  const phone = intro.customerPhone || '';
  const notes = intro.customerNotes || '';

  const item = draft?.item || {};
  const size = draft?.size || {};

  const persons = Array.isArray(draft?.engraving?.persons) ? draft.engraving.persons : [];
  const personsHtml = persons.length
    ? persons.map(p => {
        const l1 = (p.lastName || '').trim();
        const l2 = [p.firstName, p.middleName].map(s => (s || '').trim()).filter(Boolean).join(' ');
        const l3 = [p.birthDate, p.deathDate].map(s => (s || '').trim()).filter(Boolean).join(' — ');
        return `<li>${[l1, l2, l3].filter(Boolean).join(' | ')}</li>`;
      }).join('')
    : '<li>—</li>';

  let frontEpitaphs = [];
  if (Array.isArray(draft?.engraving?.epitaphs) && draft.engraving.epitaphs.length) {
    frontEpitaphs = draft.engraving.epitaphs;
  } else if (draft?.engraving?.epitaphText) {
    frontEpitaphs = String(draft.engraving.epitaphText).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  const frontGraphics = Array.isArray(draft?.graphics) ? draft.graphics : [];
  const rearEpitaphs = Array.isArray(draft?.editorBack?.epitaphTexts) ? draft.editorBack.epitaphTexts : [];
  const rearSel = Array.isArray(draft?.editorBack?.selectedGraphicsIds) ? draft.editorBack.selectedGraphicsIds : [];

  const frontPreview = draft?.editor?.previewHiUrl || draft?.editor?.previewUrl || '';
  const rearPreview  = draft?.editorBack?.previewHiUrl || draft?.editorBack?.previewUrl || '';

  const extrasHtml = `
    <ul>
      <li>Тумба: ${extras.base ? 'да' : 'нет'}</li>
      <li>Надгробная плита: ${extras.headstonePlate ? 'да' : 'нет'}</li>
      <li>Цветник: ${extras.flowerbed ? 'да' : 'нет'}</li>
    </ul>`.trim();

  const subject = `Заявка Memorial ${draft?.orderNumber ? `№${draft.orderNumber} ` : ''}— ${name || 'без имени'} ${phone || ''}`.trim();

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

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.post('/api/send-order-email', async (req, res) => {
  try {
    const draft = req.body?.draft || {};
    const extras = {
      base: !!req.body?.extras?.base,
      headstonePlate: !!req.body?.extras?.headstonePlate,
      flowerbed: !!req.body?.extras?.flowerbed
    };

    const { subject, html } = buildEmail(draft, extras);
    const to = recipients().join(', ');

    const hasSmtp = process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS;
    if (hasSmtp) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_PORT || '465') === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.MAIL_FROM || `Memorial <no-reply@localhost>`,
        to,
        subject,
        html
      });
    } else {
      console.warn('[send-order-email] SMTP не настроен. Письмо не отправлено. Адресаты:', to);
    }

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && typeof fetch === 'function') {
      const name = draft?.intro?.customerName || '';
      const phone = draft?.intro?.customerPhone || '';
      const msg = [
        '🧾 Новая заявка Memorial',
        draft?.orderNumber ? `• № ${draft.orderNumber}` : '',
        name ? `• Имя: ${name}` : '',
        phone ? `• Телефон: ${phone}` : '',
        `• Доп.: тумба:${extras.base ? 'да' : 'нет'}, плита:${extras.headstonePlate ? 'да' : 'нет'}, цветник:${extras.flowerbed ? 'да' : 'нет'}`
      ].filter(Boolean).join('\n');

      try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: msg })
        });
      } catch (e) {
        console.error('TG notify failed', e);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send('Send failed');
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
