// apps/bot/src/bot.js
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// .env локально; на Vercel переменные задаются в Settings
if (!process.env.VERCEL) {
  try {
    dotenv.config({ path: resolve(__dirname, '../../../.env') });
  } catch {}
}

// ---------------- ENV ----------------
const token = process.env.TGBOT_TOKEN ?? '';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID ? Number(process.env.MANAGER_CHAT_ID) : -1003021100938;
const CHANNEL_ID_RAW = process.env.CHANNEL_ID || ''; // можно -100… или @username
const BOT_ADMINS = (process.env.BOT_ADMINS || '')
  .split(',')
  .map((s) => Number(String(s).trim()))
  .filter(Boolean);

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://memorial-web-five.vercel.app/'; // ваш WebApp
const DEEPLINK_PREFIX = 'order'; // префикс параметра /start

// Подсказка в анкете
const WEBAPP_HINT =
  'Заполните необходимые поля и приложите фото или нажмите «Подобрать памятник» — так мы быстрее согласуем детали и начнём изготовление.';

// CHANNEL_ID может быть -100… (число) или @username (строка)
function getChannelId() {
  if (!CHANNEL_ID_RAW) return null;
  if (CHANNEL_ID_RAW.startsWith('@')) return CHANNEL_ID_RAW;
  const n = Number(CHANNEL_ID_RAW);
  return Number.isFinite(n) ? n : null;
}

// ---------------- Optional Redis (Upstash) для устойчивых сессий ----------------
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

// ---------------- Helpers ----------------
const phoneOk = (s) => {
  if (!s) return false;
  const only = String(s).replace(/[^\d+]/g, '');
  return only.length >= 6 && /^[+]?[\d\s\-()]{6,}$/.test(String(s));
};

// Токен-источник, который встраиваем в deep-link и в callback (чтобы знать пост)
function makeSourceToken(messageId) {
  if (CHANNEL_ID_RAW.startsWith('@')) {
    const uname = CHANNEL_ID_RAW.slice(1);
    return `u_${uname}_${messageId}`;
  }
  const absId = String(Math.abs(Number(getChannelId() || 0)));
  return `i_${absId}_${messageId}`;
}

function parseSourceToken(token) {
  // u_username_msgId  или  i_absId_msgId
  const mU = /^u_([A-Za-z0-9_]{3,32})_(\d+)$/.exec(token);
  if (mU) return { kind: 'u', username: mU[1], messageId: Number(mU[2]) };
  const mI = /^i_(\d{6,})_(\d+)$/.exec(token);
  if (mI) return { kind: 'i', absId: mI[1], messageId: Number(mI[2]) };
  return null;
}

function makePostLinkFromToken(token) {
  const parsed = parseSourceToken(token);
  if (!parsed) return null;
  if (parsed.kind === 'u') {
    return `https://t.me/${parsed.username}/${parsed.messageId}`;
  }
  // kind === 'i' → приватный/непубличный канал: t.me/c/<internal>/<message_id>, internal = absId без начальных "100"
  const internal = parsed.absId.startsWith('100') ? parsed.absId.slice(3) : parsed.absId;
  return `https://t.me/c/${internal}/${parsed.messageId}`;
}

function buildSummary(s) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';
  const lines = [
    'Новая заявка:',
    '',
    `Представьтесь: ${s.name || '—'}`,
    `Телефон: ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];
  if (s.sourceToken) {
    const link = makePostLinkFromToken(s.sourceToken);
    if (link) lines.push(`Источник поста: ${link}`);
  }
  return lines.join('\n');
}

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

// Инлайн-клавиатура "начальная" под постом канала: Заказать + Подобрать памятник (как callback)
function initialChannelKb(botUsername, sourceToken) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  return Markup.inlineKeyboard([
    [
      Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
      Markup.button.callback('Подобрать памятник', `catalog_options:${sourceToken}`),
    ],
  ]);
}

// Инлайн-клавиатура "варианты каталога": открыть в Telegram (web_app) или в браузере + Назад
function catalogOptionsKb(sourceToken) {
  const urlWithRef = addUrlParam(WEBAPP_URL, 'from', sourceToken);
  return Markup.inlineKeyboard([
    [Markup.button.webApp('Открыть в Telegram', urlWithRef)],
    [Markup.button.url('Открыть в браузере', urlWithRef)],
    [Markup.button.callback('◀️ Назад', `catalog_back:${sourceToken}`)],
  ]);
}

function catalogOptionsKbFallback(sourceToken) {
  const urlWithRef = addUrlParam(WEBAPP_URL, 'from', sourceToken);
  return Markup.inlineKeyboard([
    [Markup.button.url('Открыть в Telegram', urlWithRef)], // фолбэк: обычная ссылка
    [Markup.button.url('Открыть в браузере', urlWithRef)],
    [Markup.button.callback('◀️ Назад', `catalog_back:${sourceToken}`)],
  ]);
}

function addUrlParam(url, key, value) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

// Отправка поста в канал (с добавлением клавиатуры ПОСЛЕ отправки, чтобы вложить message_id в deep-link)
async function postToChannelWithKb(ctx, kind, payload) {
  const chatId = getChannelId();
  if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');
  const me = ctx.botInfo || (await ctx.telegram.getMe());
  const botUsername = me.username;

  const sendHtml = async () => {
    if (kind === 'text') {
      return await ctx.telegram.sendMessage(chatId, payload.text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
    if (kind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, payload.fileId, {
        caption: (payload.caption || '').slice(0, 1024),
        parse_mode: 'HTML',
      });
    }
    if (kind === 'video') {
      return await ctx.telegram.sendVideo(chatId, payload.fileId, {
        caption: (payload.caption || '').slice(0, 1024),
        parse_mode: 'HTML',
      });
    }
    if (kind === 'document') {
      const canCaption = (payload.caption || '').length <= 1024 ? payload.caption : undefined;
      return await ctx.telegram.sendDocument(chatId, payload.fileId, {
        caption: canCaption,
        parse_mode: 'HTML',
      });
    }
    throw new Error('Unknown kind');
  };

  const sendPlain = async () => {
    if (kind === 'text') {
      return await ctx.telegram.sendMessage(chatId, payload.text, {
        disable_web_page_preview: true,
      });
    }
    if (kind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, payload.fileId, {
        caption: (payload.caption || '').slice(0, 1024),
      });
    }
    if (kind === 'video') {
      return await ctx.telegram.sendVideo(chatId, payload.fileId, {
        caption: (payload.caption || '').slice(0, 1024),
      });
    }
    if (kind === 'document') {
      const canCaption = (payload.caption || '').length <= 1024 ? payload.caption : undefined;
      return await ctx.telegram.sendDocument(chatId, payload.fileId, {
        caption: canCaption,
      });
    }
    throw new Error('Unknown kind');
  };

  let msg;
  try {
    msg = await sendHtml();
  } catch (e) {
    const desc = e?.response?.description || e?.message || '';
    if (/parse entities|can't parse entities|entity|wrong entity/i.test(desc)) {
      msg = await sendPlain();
    } else {
      throw e;
    }
  }

  // Добавляем инлайн-клавиатуру с deep-link, включающим message_id
  const token = makeSourceToken(msg.message_id);
  const kb = initialChannelKb(botUsername, token);
  try {
    await ctx.telegram.editMessageReplyMarkup(msg.chat.id, msg.message_id, undefined, kb.reply_markup);
  } catch (e) {
    console.error('[bot] editMessageReplyMarkup failed:', e?.response?.description || e?.message || e);
  }

  // Если у документа подпись была слишком длинной и мы отправляли текст отдельным сообщением — клавиатуру оставляем на основном (медиа) сообщении.
  if (kind === 'document' && (payload.caption || '').length > 1024) {
    const txt = await ctx.telegram.sendMessage(msg.chat.id, payload.caption, {
      disable_web_page_preview: true,
    });
    // клавиатуру на дополнительный текст не добавляем, чтобы не дублировать кнопки
    return { primary: msg, secondary: txt };
  }

  return { primary: msg };
}

// ---------------- BOT ----------------
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

  // /start — начинаем анкету сразу; если есть deep-link с источником — запомним его
  bot.start(async (ctx) => {
    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();
    let sourceToken = null;
    // Ожидаем форматы: order, order_token
    if (arg.startsWith(DEEPLINK_PREFIX)) {
      const parts = arg.split('_');
      if (parts.length >= 2) {
        sourceToken = parts.slice(1).join('_'); // всё после префикса
      }
    }
    await startOrder(ctx, sourceToken || undefined);
  });

  // Команды администрирования и диагностика
  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Анкета отменена.'));
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
      return ctx.reply(`CHANNEL_ID: ${fwd.id}\nusername: ${fwd.username || '—'}\ntitle: ${fwd.title || '—'}`);
    }
    return ctx.reply('Перешлите мне пост канала и повторите /id — пришлю CHANNEL_ID.');
  });

  // Публикация постов в канал с кнопками
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
        await postToChannelWithKb(ctx, 'photo', { fileId, caption: finalText });
        return ctx.reply('Фото‑пост опубликован в канал.');
      }
      if (r?.video) {
        await postToChannelWithKb(ctx, 'video', { fileId: r.video.file_id, caption: finalText });
        return ctx.reply('Видео‑пост опубликован в канал.');
      }
      if (r?.document) {
        await postToChannelWithKb(ctx, 'document', { fileId: r.document.file_id, caption: finalText });
        return ctx.reply('Документ‑пост опубликован в канал.');
      }
      if (!base) {
        return ctx.reply('Добавьте текст после /post или ответьте командой /post на фото/видео/документ.');
      }
      await postToChannelWithKb(ctx, 'text', { text: finalText });
      return ctx.reply('Текстовый пост опубликован в канал.');
    } catch (e) {
      console.error('[bot]/post error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(`Ошибка публикации: ${desc}\nПроверьте права бота и CHANNEL_ID.`);
    }
  });

  // --------- Кнопки под постом канала: варианты каталога ---------
  bot.action(/^catalog_options:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const token = ctx.match[1];
      // Пробуем с web_app
      try {
        await ctx.editMessageReplyMarkup(catalogOptionsKb(token).reply_markup);
      } catch (e) {
        const desc = e?.response?.description || e?.message || '';
        if (/webapp|web_app|button.*invalid/i.test(desc)) {
          // Фолбэк: обе ссылки обычные URL
          await ctx.editMessageReplyMarkup(catalogOptionsKbFallback(token).reply_markup);
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.error('[bot] catalog_options error:', e?.response?.description || e?.message || e);
    }
  });

  bot.action(/^catalog_back:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const token = ctx.match[1];
      const me = ctx.botInfo || (await ctx.telegram.getMe());
      const kb = initialChannelKb(me.username, token);
      await ctx.editMessageReplyMarkup(kb.reply_markup);
    } catch (e) {
      console.error('[bot] catalog_back error:', e?.response?.description || e?.message || e);
    }
  });

  // --------- Анкета: действия-клавиши (reply-клавиатура) ---------
  bot.hears('Отменить', async (ctx) => {
    if (ctx.session?.order) return cancelOrder(ctx, 'Анкета отменена.');
  });
  bot.hears('Далее', async (ctx) => {
    if (ctx.session?.order?.step === 'photos') return stepReview(ctx);
  });
  bot.hears('Отправить', async (ctx) => {
    if (ctx.session?.order?.step === 'review') return submitOrder(ctx);
  });

  // Обработка сообщений по шагам анкеты
  bot.on('message', async (ctx) => {
    const st = ctx.session?.order?.step;
    if (!st) return;

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();
      if (st === 'name') {
        ctx.session.order.name = text;
        return stepPhone(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply('Введите корректный номер телефона (минимум 6 цифр, можно с +).', kbInput());
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
      const file = ctx.message.photo.at(-1);
      const fileId = file?.file_id;
      if (ctx.session?.order?.step === 'photos' && fileId) {
        ctx.session.order.photos = ctx.session.order.photos || [];
        ctx.session.order.photos.push(fileId);
        return ctx.reply('Фото добавлено. Отправьте ещё или нажмите «Далее».', kbPhotos());
      }
    }
  });

  bot.catch((err) => console.error('[bot] error:', err));
} else {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
}

// ---------------- Анкета: шаги (reply-клавиатура над полем ввода) ----------------
function kbInput() {
  return Markup.keyboard([['Отменить']]).resize();
}
function kbPhotos() {
  return Markup.keyboard([['Далее'], ['Отменить']]).resize();
}
function kbReview() {
  return Markup.keyboard([['Отправить'], ['Отменить']]).resize();
}
function kbRemove() {
  return Markup.removeKeyboard();
}

async function startOrder(ctx, sourceToken) {
  ctx.session.order = { step: 'name', photos: [], ...(sourceToken ? { sourceToken } : {}) };
  await ctx.reply(`${WEBAPP_HINT}\n\nШаг 1/5. Представьтесь (ФИО/имя):`, kbInput());
}
async function stepPhone(ctx) {
  ctx.session.order.step = 'phone';
  await ctx.reply('Шаг 2/5. Номер телефона:', kbInput());
}
async function stepFio(ctx) {
  ctx.session.order.step = 'fio';
  await ctx.reply('Шаг 3/5. Фамилия/Имя/Отчество усопшего:', kbInput());
}
async function stepDates(ctx) {
  ctx.session.order.step = 'dates';
  await ctx.reply('Шаг 4/5. Дата рождения — Дата смерти (в свободном формате):', kbInput());
}
async function stepPhotos(ctx) {
  ctx.session.order.step = 'photos';
  await ctx.reply('Шаг 5/5. Прикрепите фото (по одному или альбомом). Когда закончите — нажмите «Далее».', kbPhotos());
}
async function stepReview(ctx) {
  ctx.session.order.step = 'review';
  const s = ctx.session.order;
  const text = buildSummary(s);
  await ctx.reply(text, kbReview());
}
async function submitOrder(ctx) {
  const s = ctx.session.order || {};
  if (!s.name || !s.phone || !phoneOk(s.phone)) {
    return ctx.reply('Обязательные поля не заполнены: «Представьтесь» и/или «Номер телефона». Вернитесь и исправьте.', kbInput());
  }
  try {
    await sendOrderToManager(ctx, s);
    await ctx.reply('Заявка отправлена. Спасибо! Наш менеджер свяжется с вами.', kbRemove());
  } catch (e) {
    console.error('submitOrder error', e);
    await ctx.reply('Не удалось отправить заявку. Попробуйте позже.', kbRemove());
  } finally {
    ctx.session.order = null;
  }
}
async function cancelOrder(ctx, msg = 'Отменено.') {
  ctx.session.order = null;
  return ctx.reply(msg, kbRemove());
}

// ---------------- MODE ----------------
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
