// apps/bot/api/telegram.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx) => ctx.reply('Здравствуйте!'));
bot.hears(/привет/i, (ctx) => ctx.reply('Привет!'));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  try {
    // Если задавали secret_token в setWebhook — проверьте заголовок:
    // if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.TG_SECRET) return res.status(401).end();
    await bot.handleUpdate(req.body as any);
    return res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    return res.status(200).send('ok');
  }
}
