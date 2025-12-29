// apps/bot/api/telegram.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
// ВАЖНО: поправьте путь импорта на ваш реальный экспорт бота.
// Например, если вы экспортируете bot из apps/bot/src/bot.ts:
import bot from '../src/bot.ts';

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    // Для GET/других методов отдаём 405, чтобы вы могли проверить, что маршрут существует
    return res.status(405).send('Method Not Allowed');
  }

  // Проверка секретного токена из заголовка Telegram (если вы его зададите в setWebhook)
  if (SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== SECRET) {
      return res.status(403).send('Forbidden');
    }
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update as any);
    // Важно отвечать 200 быстро, чтобы Telegram не ретраил
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[bot] handleUpdate error:', err);
    // Всё равно 200, чтобы избежать ретраев от Telegram
    return res.status(200).send('OK');
  }
}
