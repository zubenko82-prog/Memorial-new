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
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID
  ? Number(process.env.MANAGER_CHAT_ID)
  : -1003021100938; // чат менеджера
const CHANNEL_ID_RAW = process.env.CHANNEL_ID || ''; // можно -100… или @username
const BOT_ADMINS = (process.env.BOT_ADMINS || '')
  .split(',')
  .map((s) => Number(String(s).trim()))
  .filter(Boolean);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://memorial-web-five.vercel.app/'; // ваш WebApp
const DEEPLINK_START = 'order'; // /start order
const WEBAPP_HINT =
  'Заполните необходимые поля и приложите фото — так мы быстрее согласуем детали и начнём изготовление.';

// CHANNEL_ID может быть -100… (число) или @username (строка)
function getChannelId() {
  if (!CHANNEL_ID_RAW) return null;
  if (CHANNEL_ID_RAW.startsWith('@')) return CHANNEL_ID_RAW;
  const n = Number(CHANNEL_ID_RAW);
  return Number.isFinite(n) ? n : null;
}

// ------------ Optional Redis (Upstash) для устойчивых сессий ------------
let redisInstance; // undefined = не инициализирован, null = нет Redis, object = клиент
const mem = new Map(); // фолбэк для локальной разработки

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

// Сборка клавиатур для канала
function buildInlineKbForChannel(username, useWebApp = true) {
  const row = [
    Markup.button.url('Заказать', `https://t.me/${username}?start=${DEEPLINK_START}`),
  ];
  if (useWebApp) {
    // Для web_app кнопки нужен /setdomain у @BotFather с доменом WEBAPP_URL (origin)
    row.push(Markup.button.webApp('Подобрать памятник', WEBAPP_URL));
  } else {
    row.push(Markup.button.url('Подобрать памятник', WEBAPP_URL));
  }
  return Markup.inlineKeyboard([row]);
}

// Безопасная отправка в канал: HTML и web_app с фолбэками
async function safeSendToChannel(ctx, sendKind, payload) {
  const me = ctx.botInfo || (await ctx.telegram.getMe());
  const username = me.username;
  const chatId = getChannelId();
  if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');

  const text = payload.text || '';
  const caption = payload.caption || '';
  const fileId = payload.fileId;

  let kb = buildInlineKbForChannel(username, true);
  try {
    if (sendKind === 'text') {
      return await ctx.telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: kb.reply_markup,
        disable_web_page_preview: true,
      });
    }
    if (sendKind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, fileId, {
        caption: caption.slice(0, 1024),
        parse_mode: 'HTML',
        reply_markup: kb.reply_markup,
      });
    }
    if (sendKind === 'video') {
      return await ctx.telegram.sendVideo(chatId, fileId, {
        caption: caption.slice(0, 1024),
        parse_mode: 'HTML',
        reply_markup: kb.reply_markup,
      });
    }
    if (sendKind === 'document') {
      const canCaption = caption.length <= 1024 ? caption : undefined;
      const msg = await ctx.telegram.sendDocument(chatId, fileId, {
        caption: canCaption,
        parse_mode: 'HTML',
        reply_markup: kb.reply_markup,
      });
      if (!canCaption) {
        await ctx.telegram.sendMessage(chatId, caption, {
          parse_mode: 'HTML',
          reply_markup: kb.reply_markup,
          disable_web_page_preview: true,
        });
      }
      return msg;
    }
  } catch (e) {
    const desc = e?.response?.description || e?.message || '';
    // Повтор без HTML
    if (/parse entities|can't parse entities|entity|wrong entity/i.test(desc)) {
      try {
        if (sendKind === 'text') {
          return await ctx.telegram.sendMessage(chatId, text, {
            reply_markup: kb.reply_markup,
            disable_web_page_preview: true,
          });
        }
        if (sendKind === 'photo') {
          return await ctx.telegram.sendPhoto(chatId, fileId, {
            caption: caption.slice(0, 1024),
            reply_markup: kb.reply_markup,
          });
        }
        if (sendKind === 'video') {
          return await ctx.telegram.sendVideo(chatId, fileId, {
            caption: caption.slice(0, 1024),
            reply_markup: kb.reply_markup,
          });
        }
        if (sendKind === 'document') {
          const canCaption = caption.length <= 1024 ? caption : undefined;
          const msg = await ctx.telegram.sendDocument(chatId, fileId, {
            caption: canCaption,
            reply_markup: kb.reply_markup,
          });
          if (!canCaption) {
            await ctx.telegram.sendMessage(chatId, caption, {
              reply_markup: kb.reply_markup,
              disable_web_page_preview: true,
            });
          }
          return msg;
        }
      } catch (e2) {
        e = e2;
      }
    }
    // Проблема с web_app — заменяем на URL
    if (/webapp|web_app|button.*invalid/i.test(desc)) {
      kb = buildInlineKbForChannel(username, false);
      if (sendKind === 'text') {
        return await ctx.telegram.sendMessage(chatId, text, {
          reply_markup: kb.reply_markup,
          disable_web_page_preview: true,
        });
      }
      if (sendKind === 'photo') {
        return await ctx.telegram.sendPhoto(chatId, fileId, {
          caption: caption.slice(0, 1024),
          reply_markup: kb.reply_markup,
        });
      }
      if (sendKind === 'video') {
        return await ctx.telegram.sendVideo(chatId, fileId, {
          caption: caption.slice(0, 1024),
          reply_markup: kb.reply_markup,
        });
      }
      if (sendKind === 'document') {
        const canCaption = caption.length <= 1024 ? caption : undefined;
        const msg = await ctx.telegram.sendDocument(chatId, fileId, {
          caption: canCaption,
          reply_markup: kb.reply_markup,
        });
        if (!canCaption) {
          await ctx.telegram.sendMessage(chatId, caption, {
            reply_markup: kb.reply_markup,
            disable_web_page_preview: true,
          });
        }
        return msg;
      }
    }
    throw e;
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

  // /start — анкета запускается сразу (без лишних кликов). Отдельным сообщением дадим WebApp.
  bot.start(async (ctx) => {
    // Если deep-link /start order — начнём анкету, иначе тоже начнём для снижения трения.
    await startOrder(ctx);
    // Доп. сообщение: кнопка WebApp "Подобрать памятник"
    const kb = Markup.inlineKeyboard([[Markup.button.webApp('Подобрать памятник', WEBAPP_URL)]]);
    await ctx.reply('Или откройте каталог памятников в мини‑приложении:', kb);
  });

  // Команды
  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Анкета отменена.'));
  bot.command('web', async (ctx) => {
    const kb = Markup.inlineKeyboard([[Markup.button.webApp('Подобрать памятник', WEBAPP_URL)]]);
    return ctx.reply('Откройте каталог памятников в мини‑приложении:', kb);
  });

  // Диагностика
  bot.command('dump', async (ctx) => {
    const chat = ctx.chat || {};
    const from = ctx.from || {};
    const me = ctx.botInfo || (await ctx.telegram.getMe());
    const info = [
      `chat_id = ${chat.id}`,
      `chat_type = ${chat.type}`,
      `user_id = ${from.id}`,
      `username = ${me.username}`,
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

  // /post — пост в канал (текст или медиа по reply) с кнопками: Заказать + Подобрать памятник
  bot.command('post', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
      if (!BOT_ADMINS.includes(ctx.from.id)) return ctx.reply('Недостаточно прав.');

      const raw = ctx.message?.text || '';
      const base = raw.replace(/^\/post(@\S+)?\s*/i, '').trim();
      const finalText = base ? `${base}\n\n${WEBAPP_HINT}` : WEBAPP_HINT;

      const r = ctx.message?.reply_to_message;

      if (r?.photo?.length) {
        const fileId = r.photo.at(-1).file_id;
        await safeSendToChannel(ctx, 'photo', { fileId, caption: finalText });
        return ctx.reply('Фото‑пост опубликован в канал.');
      }

      if (r?.video) {
        await safeSendToChannel(ctx, 'video', { fileId: r.video.file_id, caption: finalText });
        return ctx.reply('Видео‑пост опубликован в канал.');
      }

      if (r?.document) {
        await safeSendToChannel(ctx, 'document', { fileId: r.document.file_id, caption: finalText });
        return ctx.reply('Документ‑пост опубликован в канал.');
      }

      if (!base) {
        return ctx.reply(
          'Добавьте текст после /post или ответьте командой /post на фото/видео/документ.'
        );
      }

      await safeSendToChannel(ctx, 'text', { text: finalText });
      return ctx.reply('Текстовый пост опубликован в канал.');
    } catch (e) {
      console.error('[bot]/post error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(`Ошибка публикации: ${desc}\nПроверьте права бота, CHANNEL_ID и /setdomain у @BotFather.`);
    }
  });

  // --------- Анкета: шаги и кнопки ---------
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
  if (typeof bot?.launch === 'function') {
    await bot.launch();
    console.log('[bot] Launched (polling).');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    console.error('[bot] Cannot launch polling without TGBOT_TOKEN');
  }
}

export default bot;
