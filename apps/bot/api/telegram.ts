import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.start((ctx) => ctx.reply('Здравствуйте!'));
bot.on('message', (ctx) => ctx.reply('Принято'));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  try {
    await bot.handleUpdate(req.body as any);
    return res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    return res.status(200).send('ok');
  }
}
