// apps/bot/src/bot.ts
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';

// __dirname для ESM/TypeScript
const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// Загружаем .env только вне Vercel (на Vercel переменные задаются в Settings)
if (!process.env.VERCEL) {
  try {
    dotenv.config({ path: resolve(__dirname, '../../../.env') });
  } catch (e) {
    // опционально залогировать, но не падать
    console.warn('[bot] .env not loaded:', e);
  }
}

const token = process.env.TGBOT_TOKEN;
if (!token) {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
  process.exit(1);
}

const WEBAPP_URL = process.env.WEBAPP_URL ?? 'https://example.com';

export const bot = new Telegraf(token);

// Handlers
bot.start(async (ctx) => {
  const kb = Markup.keyboard([[Markup.button.webApp('Заполнить заказ', WEBAPP_URL)]]).resize();
  return ctx.reply(
    'Добро пожаловать в Memorial! Заполните заказ для просчета и изготовления памятника:',
    kb
  );
});

bot.command('web', async (ctx) => {
  const kb = Markup.inlineKeyboard([Markup.button.webApp('Заполнить заказ', WEBAPP_URL)]);
  return ctx.reply('Заполните заказ в мини‑приложении:', kb);
});

bot.on('message', (ctx) => ctx.reply('Я бот проекта Memorial. Используйте /start или кнопку WebApp.'));

bot.catch((err) => {
  console.error('[bot] error:', err);
});

// Режимы запуска: локально — polling, на Vercel — webhook
const MODE = process.env.BOT_MODE ?? (process.env.VERCEL ? 'webhook' : 'polling');

if (MODE === 'polling') {
  void bot.launch().then(() => {
    console.log('[bot] Launched (polling). Press Ctrl+C to stop.');
  });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// Экспорт для использования в серверлес-обработчике (Vercel webhook)
export default bot;
