// apps/bot/api/telegram.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  if (SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== SECRET) return res.status(403).send('Forbidden');
  }

  let bot: any;
  try {
    ({ default: bot } = await import('../src/bot.js'));
  } catch (e) {
    console.error('[webhook] failed to import bot:', e);
    return res.status(500).send('Bot import error');
  }

  if (!bot) {
    console.error('[webhook] bot instance is null (missing TGBOT_TOKEN)');
    return res.status(500).send('Bot not configured');
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update);
  } catch (e) {
    console.error('[webhook] handleUpdate error:', e);
  }
  return res.status(200).send('OK');
}
