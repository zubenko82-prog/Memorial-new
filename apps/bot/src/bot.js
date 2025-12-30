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

// ------------ ENV ------------
const token = process.env.TGBOT_TOKEN ?? '';
const MANAGER_CHAT_ID = Number(process.env.MANAGER_CHAT_ID ?? '-1003021100938'); // чат менеджера
const CHANNEL_ID = process.env.CHANNEL_ID ? Number(process.env.CHANNEL_ID) : null; // канал для /post
const BOT_ADMINS = (process.env.BOT_ADMINS || '')
  .split(',')
  .map((s) => Number(String(s).trim()))
  .filter(Boolean);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.com'; // WebApp "Подобрать памятник"
const DEEPLINK_START = 'order'; // /start order
const WEBAPP_HINT =
  'Заполните необходимые поля и приложите фото — так мы быстрее согласуем детали и начнём изготовление.';

// ------------ Optional Redis (Upstash) для устойчивых сессий ------------
let redisInstance; // undefined = не инициализирован, null = нет Redis, object = клиент
const mem = new Map(); // фолбэк для локальной разработки (на серверлесс данные не сохранятся между вызовами)

async function getRedis() {
  if (redisInstance !== undefined) return redisInstance;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisInstance = null;
    return redisInstance;
  }
  try {
    const mod = await import('@upstash/redis');
    redisInstance = new mod.Redis({ url, token });
  } catch (e) {
    console.warn('[bot] Upstash Redis недоступен, будет использована in-memory сессия:', e?.message || e);
    redisInstance = null;
  }
  return redisInstance;
}

async function loadSession(userId) {
  const r = await getRedis();
  if (r) {
    const data = await r.get(`sess:${userId}`);
    return data || {};
  }
  return mem.get(userId) || {};
}
async function saveSession(userId, data) {
  const r = await getRedis();
  if (r) {
    await r.set(`sess:${userId}`, data, { ex: 60 * 60 * 24 }); // TTL 1 день
  } else {
    mem.set(userId, data);
  }
}

// ------------ Helpers ------------
const phoneOk = (s) => {
  if (!s) return false;
  const only = String(s).replace(/[^\d+]/g, '');
  return only.length >= 6 && /^[+]?[\d\s\-()]{6,}$/.test(String(s));
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
      ...(i === 0 ? { caption: text } : {}),
    }));
    await ctx.telegram.sendMediaGroup(MANAGER_CHAT_ID, media);
    if (photos.length > 10) {
      await ctx.telegram.sendMessage(
        MANAGER_CHAT_ID,
        `Дополнительные фото (${photos.length - 10} шт.) пользователь отправит отдельно.`
      );
    }
  } else {
    await ctx.telegram.sendMessage(MANAGER_CHAT_ID, text);
  }
}

// ------------ Bot ------------
let bot = null;

if (token) {
  bot = new Telegraf(token);

  // Сессии
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

  // /start — приветствие + кнопки: Заказать (анкета в ЛС), Подобрать памятник (WebApp)
  bot.start(async (ctx) => {
    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ');
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('Заказать', 'start_order'),
        Markup.button.webApp('Подобрать памятник', WEBAPP_URL),
      ],
    ]);
    await ctx.reply('Добро пожаловать в Memorial!', kb);
    if (arg === DEEPLINK_START) {
      return startOrder(ctx);
    }
  });

  // Команды справки
  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Анкета отменена.'));
  bot.command('web', async (ctx) => {
    const kb = Markup.inlineKeyboard([[Markup.button.webApp('Подобрать памятник', WEBAPP_URL)]]);
    return ctx.reply('Откройте каталог памятников в мини‑приложении:', kb);
  });

  // Диагностика
  bot.command('dump', async (ctx) => {
    const chat = ctx.chat || {};
    const from = ctx.from || {};
    const info = [
      `chat_id = ${chat.id}`,
      `chat_type = ${chat.type}`,
      `user_id = ${from.id}`,
      `username = ${ctx.botInfo?.username || (await ctx.telegram.getMe()).username}`,
    ].join('\n');
    return ctx.reply('DEBUG:\n' + info);
  });

  bot.command('id', async (ctx) => {
    const fwd = ctx.message?.forward_from_chat;
    if (fwd) {
      return ctx.reply(
        `CHANNEL_ID: ${fwd.id}\nusername: ${fwd.username || '—'}\ntitle: ${fwd.title || '—'}`
      );
    }
    return ctx.reply('Перешлите мне пост канала и повторите /id — пришлю CHANNEL_ID.');
  });

  // /post — публикует в канал пост (текст или медиа по reply) с кнопками: Заказать (анкета в ЛС), Подобрать памятник (WebApp)
  bot.command('post', async (ctx) => {
    try {
      if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID не задан в переменных окружения.');
      if (!BOT_ADMINS.includes(ctx.from.id)) return ctx.reply('Недостаточно прав.');
      const me = ctx.botInfo || (await ctx.telegram.getMe());
      const username = me.username;

      const raw = ctx.message?.text || '';
      const base = raw.replace(/^\/post(@\S+)?\s*/i, '').trim();

      const finalText = base ? `${base}\n\n${WEBAPP_HINT}` : WEBAPP_HINT;

      const kb = Markup.inlineKeyboard([
        [
          Markup.button.url('Заказать', `https://t.me/${username}?start=${DEEPLINK_START}`),
          Markup.button.webApp('Подобрать памятник', WEBAPP_URL),
        ],
      ]);

      const r = ctx.message?.reply_to_message;

      if (r?.photo?.length) {
        const fileId = r.photo.at(-1).file_id; // наибольшее по размеру
        await ctx.telegram.sendPhoto(CHANNEL_ID, fileId, {
          caption: finalText.slice(0, 1024),
          parse_mode: 'HTML',
          reply_markup: kb.reply_markup,
        });
        return ctx.reply('Фото‑пост опубликован в канал.');
      }

      if (r?.video) {
        await ctx.telegram.sendVideo(CHANNEL_ID, r.video.file_id, {
          caption: finalText.slice(0, 1024),
          parse_mode: 'HTML',
          reply_markup: kb.reply_markup,
        });
        return ctx.reply('Видео‑пост опубликован в канал.');
      }

      if (r?.document) {
        await ctx.telegram.sendDocument(CHANNEL_ID, r.document.file_id, {
          caption: finalText.length <= 1024 ? finalText : undefined,
          parse_mode: 'HTML',
          reply_markup: kb.reply_markup,
        });
        if (finalText.length > 1024) {
          await ctx.telegram.sendMessage(CHANNEL_ID, finalText, {
            parse_mode: 'HTML',
            reply_markup: kb.reply_markup,
            disable_web_page_preview: true,
          });
        }
        return ctx.reply('Документ‑пост опубликован в канал.');
      }

      if (!base) {
        return ctx.reply(
          'Добавьте текст после /post или ответьте командой /post на фото/видео/документ.'
        );
      }

      await ctx.telegram.sendMessage(CHANNEL_ID, finalText, {
        parse_mode: 'HTML',
        reply_markup: kb.reply_markup,
        disable_web_page_preview: true,
      });
      return ctx.reply('Текстовый пост опубликован в канал.');
    } catch (e) {
      console.error('[bot]/post error:', e);
      return ctx.reply('Ошибка публикации. Проверьте права бота и корректность данных.');
    }
  });

  // --------- Анкета в ЛС: callback-кнопки и шаги ---------
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

  // Обработка сообщений по текущему шагу анкеты
  bot.on('message', async (ctx) => {
    const st = ctx.session?.order?.step;
    if (!st) return; // не в процессе анкеты

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();
      if (st === 'name') {
        ctx.session.order.name = text;
        return stepPhone(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply('Введите корректный номер телефона (минимум 6 цифр, можно с +).');
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

  bot.catch((err) => console.error('[bot] error:', err));
} else {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
}

// ------------ Анкета: шаги ------------
async function startOrder(ctx) {
  ctx.session.order = { step: 'name', photos: [] };
  const kb = Markup.inlineKeyboard([[Markup.button.callback('Отменить', 'cancel_order')]]);
  await ctx.reply(
    `${WEBAPP_HINT}\n\nШаг 1/5. Представьтесь (ФИО/имя):`,
    kb
  );
}

async function stepPhone(ctx) {
  ctx.session.order.step = 'phone';
  const kb = Markup.inlineKeyboard([[Markup.button.callback('Отменить', 'cancel_order')]]);
  await ctx.reply('Шаг 2/5. Номер телефона:', kb);
}

async function stepFio(ctx) {
  ctx.session.order.step = 'fio';
  const kb = Markup.inlineKeyboard([[Markup.button.callback('Отменить', 'cancel_order')]]);
  await ctx.reply('Шаг 3/5. Фамилия/Имя/Отчество усопшего:', kb);
}

async function stepDates(ctx) {
  ctx.session.order.step = 'dates';
  const kb = Markup.inlineKeyboard([[Markup.button.callback('Отменить', 'cancel_order')]]);
  await ctx.reply('Шаг 4/5. Дата рождения — Дата смерти (в свободном формате):', kb);
}

async function stepPhotos(ctx) {
  ctx.session.order.step = 'photos';
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Далее', 'next_from_photos')],
    [Markup.button.callback('Отменить', 'cancel_order')],
  ]);
  await ctx.reply(
    'Шаг 5/5. Прикрепите фото (по одному или альбомом). Когда закончите — нажмите «Далее».',
    kb
  );
}

async function stepReview(ctx) {
  ctx.session.order.step = 'review';
  const s = ctx.session.order;
  const text = buildSummary(s);
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Отправить', 'submit_order')],
    [Markup.button.callback('Отменить', 'cancel_order')],
  ]);
  await ctx.reply(text, kb);
}

async function submitOrder(ctx) {
  const s = ctx.session.order || {};
  if (!s.name || !s.phone || !phoneOk(s.phone)) {
    return ctx.reply(
      'Обязательные поля не заполнены: «Представьтесь» и/или «Номер телефона». Вернитесь и исправьте.'
    );
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

// ------------ MODE ------------
const MODE = process.env.BOT_MODE ?? (process.env.VERCEL ? 'webhook' : 'polling');
if (MODE === 'polling') {
  if (bot) {
    await bot.launch();
    console.log('[bot] Launched (polling).');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    console.error('[bot] Cannot launch polling without TGBOT_TOKEN');
  }
}

export default bot;
