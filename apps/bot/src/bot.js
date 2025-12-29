// apps/bot/src/bot.js
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// Локально читаем .env; на Vercel переменные задаются в Settings
if (!process.env.VERCEL) {
  try {
    dotenv.config({ path: resolve(__dirname, '../../../.env') });
  } catch {}
}

const token = process.env.TGBOT_TOKEN ?? '';
const WEBAPP_URL = process.env.WEBAPP_URL ?? 'https://example.com';

let bot = null;

if (token) {
  bot = new Telegraf(token);

  bot.start((ctx) => {
    const kb = Markup.keyboard([[Markup.button.webApp('Заполнить заказ', WEBAPP_URL)]]).resize();
    return ctx.reply(
      'Добро пожаловать в Memorial! Заполните заказ для просчета и изготовления памятника:',
      kb
    );
  });

  bot.command('web', (ctx) => {
    const kb = Markup.inlineKeyboard([Markup.button.webApp('Заполнить заказ', WEBAPP_URL)]);
    return ctx.reply('Заполните заказ в мини‑приложении:', kb);
  });

  bot.on('message', (ctx) => ctx.reply('Я бот проекта Memorial. Используйте /start или кнопку WebApp.'));
  bot.catch((err) => console.error('[bot] error:', err));
} else {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
}

// Локально — polling, на Vercel — webhook
const MODE = process.env.BOT_MODE ?? (process.env.VERCEL ? 'webhook' : 'polling');

if (MODE === 'polling') {
  if (bot) {
    void bot.launch().then(() => console.log('[bot] Launched (polling).'));
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    console.error('[bot] Cannot launch polling without TGBOT_TOKEN');
  }
}

export default bot;
