// apps/bot/api/telegram.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';

// лучше держать токен в переменной окружения BOT_TOKEN
const bot = new Telegraf(process.env.BOT_TOKEN as string);

// ——— ваши хэндлеры ———
bot.start((ctx) => ctx.reply('Здравствуйте!'));
bot.hears(/привет/i, (ctx) => ctx.reply('Привет!'));
// вынесите логику в отдельный модуль, если нужно

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body as any);
      return res.status(200).send('ok');
    } catch (e: any) {
      console.error('telegram handler error', e);
      return res.status(200).send('ok'); // телега ожидает 200 даже при ошибках
    }
  }
  // GET — для проверки
  return res.status(200).json({ ok: true });
}
