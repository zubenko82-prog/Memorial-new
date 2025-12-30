// apps/bot/src/bot.js
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';

let RedisClient = null;
try {
  // Опционально: Upstash Redis для устойчивых сессий на Vercel
  const mod = await import('@upstash/redis');
  RedisClient = mod.Redis;
} catch { /* пакет не установлен - ок для локалки */ }

// ----------------- ENV & INIT -----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

if (!process.env.VERCEL) {
  try { dotenv.config({ path: resolve(__dirname, '../../../.env') }); } catch {}
}

const token = process.env.TGBOT_TOKEN ?? '';
const WEBAPP_HINT = 'Заполните необходимые поля и приложите фото — так мы быстрее согласуем детали и начнём изготовление.';
const MANAGER_CHAT_ID = Number(process.env.MANAGER_CHAT_ID ?? '-1003021100938');
const CHANNEL_ID = process.env.CHANNEL_ID ? Number(process.env.CHANNEL_ID) : null;
const BOT_ADMINS = (process.env.BOT_ADMINS || '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(Boolean);

const DEEPLINK_START = 'order'; // /start order

// --------------- SESSION STORAGE ---------------
const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN && RedisClient);
const redis = hasUpstash ? new RedisClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
}) : null;

const mem = new Map(); // fallback для локальной разработки

async function loadSession(userId) {
  if (redis) {
    const data = await redis.get(`sess:${userId}`);
    return data || {};
  }
  return mem.get(userId) || {};
}
async function saveSession(userId, data) {
  if (redis) {
    await redis.set(`sess:${userId}`, data, { ex: 60 * 60 * 24 }); // TTL 1 день
  } else {
    mem.set(userId, data);
  }
}

// --------------- HELPERS ---------------
const phoneOk = (s) => {
  if (!s) return false;
  const t = String(s).replace(/[^\d+]/g, '');
  return t.length >= 6 && /^[+]?[\d\s\-()]{6,}$/.test(String(s));
};

const buildSummary = (s) => {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';
  return [
    'Новая заявка:',
    '',
    `Представьтесь: ${s.name || '—'}`,
    `Телефон: ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ].join('\n');
};

async function sendOrderToManager(ctx, state) {
  const text = buildSummary(state);
  const photos = Array.isArray(state.photos) ? state.photos : [];

  if (photos.length > 0) {
    const media = photos.slice(0, 10).map((fileId, i) => ({
      type: 'photo',
      media: fileId,
      ...(i === 0 ? { caption: text } : {})
    }));
    await ctx.telegram.sendMediaGroup(MANAGER_CHAT_ID, media);
    if (photos.length > 10) {
      await ctx.telegram.sendMessage(MANAGER_CHAT_ID, `Доп. фото (${photos.length - 10}): отправлены пользователем позже`);
    }
  } else {
    await ctx.telegram.sendMessage(MANAGER_CHAT_ID, text);
  }
}

// --------------- BOT LOGIC ---------------
let bot = null;

if (token) {
  bot = new Telegraf(token);

  // Простая сессия
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return next();
    ctx.session = await loadSession(uid);
    try {
      await next();
    } finally {
      await saveSession(uid, ctx.session || {});
    }
  });

  // Команда /start (+ deep-link)
  bot.start(async (ctx) => {
    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ');
    const kb = Markup.inlineKeyboard([
      Markup.button.callback('Заполнить анкету', 'start_order')
    ]);
    await ctx.reply('Добро пожаловать в Memorial!', kb);
    if (arg === DEEPLINK_START) {
      return startOrder(ctx);
    }
  });

  // Команда /cancel
  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Отменено.'));

  // Команда /post для админов — публикует в канал пост с кнопкой
  bot.command('post', async (ctx) => {
    if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID не задан в переменных окружения.');
    if (!BOT_ADMINS.includes(ctx.from.id)) return ctx.reply('Недостаточно прав.');

    const text = ctx.message?.text?.replace(/^\/post(@\S+)?\s*/i, '').trim();
    if (!text) return ctx.reply('Используйте: /post текст_поста');

    const kb = Markup.inlineKeyboard([
      Markup.button.url('Заполнить анкету', `https://t.me/${ctx.botInfo?.username}?start=${DEEPLINK_START}`)
    ]);
    await ctx.telegram.sendMessage(CHANNEL_ID, text + `\n\n${WEBAPP_HINT}`, kb);
    return ctx.reply('Пост опубликован в канал.');
  });

  // Кнопки
  bot.action('start_order', async (ctx) => {
    await ctx.answerCbQuery();
    return startOrder(ctx);
  });
  bot.action('cancel_order', async (ctx) => {
    await ctx.answerCbQuery('Анкета отменена');
    return cancelOrder(ctx);
  });
  bot.action('next_from_photos', async (ctx) => {
    await ctx.answerCbQuery();
    return stepReview(ctx);
  });
  bot.action('submit_order', async (ctx) => {
    await ctx.answerCbQuery();
    return submitOrder(ctx);
  });

  // Обработка текстов и фото по шагам
  bot.on('message', async (ctx) => {
    const st = ctx.session?.order?.step;
    if (!st) return; // не в анкете

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();
      if (st === 'name') {
        ctx.session.order.name = text;
        return stepPhone(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply('Введите корректный номер телефона (не меньше 6 цифр, можно с +).');
        }
        ctx.session.order.phone = text;
        return stepFio(ctx);
      }
      if (st === 'fio') {
        ctx.session.order.fio = text;
        return stepDates(ctx);
      }
      if (st === 'dates') {
        ctx.session.order.dates = text;
        return stepPhotos(ctx);
      }
    }

    if ('photo' in ctx.message && ctx.message.photo) {
      const file = ctx.message.photo.at(-1); // самое большое
      const fileId = file?.file_id;
      if (ctx.session?.order?.step === 'photos' && fileId) {
        ctx.session.order.photos = ctx.session.order.photos || [];
        ctx.session.order.photos.push(fileId);
        return ctx.reply('Фото добавлено. Отправьте ещё или нажмите «Далее».');
      }
    }
  });

  // Диагностика: показать id
  bot.command('dump', async (ctx) => {
    const chat = ctx.chat || {};
    const from = ctx.from || {};
    const info = [
      `chat_id = ${chat.id}`,
      `chat_type = ${chat.type}`,
      `user_id = ${from.id}`,
      `username = ${ctx.botInfo?.username}`
    ].join('\n');
    return ctx.reply('DEBUG:\n' + info);
  });

  bot.catch((err) => console.error('[bot] error:', err));
} else {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
}

// ---------- Анкета: шаги ----------
async function startOrder(ctx) {
  ctx.session.order = { step: 'name', photos: [] };
  const kb = Markup.inlineKeyboard([Markup.button.callback('Отменить', 'cancel_order')]);
  await ctx.reply(
    `${WEBAPP_HINT}\n\nШаг 1/5. Представьтесь (ФИО/имя):`,
    kb
  );
}

async function stepPhone(ctx) {
  ctx.session.order.step = 'phone';
  const kb = Markup.inlineKeyboard([Markup.button.callback('Отменить', 'cancel_order')]);
  await ctx.reply('Шаг 2/5. Номер телефона:', kb);
}

async function stepFio(ctx) {
  ctx.session.order.step = 'fio';
  const kb = Markup.inlineKeyboard([Markup.button.callback('Отменить', 'cancel_order')]);
  await ctx.reply('Шаг 3/5. Фамилия/Имя/Отчество усопшего:', kb);
}

async function stepDates(ctx) {
  ctx.session.order.step = 'dates';
  const kb = Markup.inlineKeyboard([Markup.button.callback('Отменить', 'cancel_order')]);
  await ctx.reply('Шаг 4/5. Дата рождения — Дата смерти (в свободном формате):', kb);
}

async function stepPhotos(ctx) {
  ctx.session.order.step = 'photos';
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Далее', 'next_from_photos')],
    [Markup.button.callback('Отменить', 'cancel_order')]
  ]);
  await ctx.reply('Шаг 5/5. Прикрепите фото (по одному или альбомом). Когда закончите — нажмите «Далее».', kb);
}

async function stepReview(ctx) {
  ctx.session.order.step = 'review';
  const s = ctx.session.order;
  const text = buildSummary(s);
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Отправить', 'submit_order')],
    [Markup.button.callback('Отменить', 'cancel_order')]
  ]);
  await ctx.reply(text, kb);
}

async function submitOrder(ctx) {
  const s = ctx.session.order || {};
  if (!s.name || !s.phone || !phoneOk(s.phone)) {
    return ctx.reply('Заполните обязательные поля: Представьтесь и Номер телефона. Вернитесь и исправьте.');
  }
  try {
    await sendOrderToManager(ctx, s);
    await ctx.reply('Заявка отправлена. Спасибо! Наш менеджер свяжется с вами.');
  } catch (e) {
    console.error('submitOrder error', e);
    await ctx.reply('Не удалось отправить заявку. Попробуйте позже.');
  } finally {
    ctx.session.order = null;
  }
}

async function cancelOrder(ctx, msg = 'Отменено.') {
  ctx.session.order = null;
  return ctx.reply(msg);
}

// ----------------- MODE -----------------
const MODE = process.env.BOT_MODE ?? (process.env.VERCEL ? 'webhook' : 'polling');
if (MODE === 'polling') {
  if (bot) {
    await bot.launch();
    console.log('[bot] Launched (polling).');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
}

export default bot;
