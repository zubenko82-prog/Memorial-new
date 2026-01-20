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

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://memorial-web-five.vercel.app/';
const DEEPLINK_PREFIX = 'order'; // /start order_<token>

// Подсказка, отдельным сообщением перед первым шагом (в ЛС)
const HINT_TEXT =
  'Заполните необходимые поля и приложите фото — так мы быстрее согласуем детали и начнём изготовление.';

// CHANNEL_ID может быть -100… (число) или @username (строка)
function getChannelId() {
  if (!CHANNEL_ID_RAW) return null;
  if (CHANNEL_ID_RAW.startsWith('@')) return CHANNEL_ID_RAW;
  const n = Number(CHANNEL_ID_RAW);
  return Number.isFinite(n) ? n : null;
}

// ---------------- Optional Redis (Upstash) ----------------
let redisInstance; // undefined = не инициализирован, null = нет Redis, object = клиент
const mem = new Map(); // фолбэк для сессий
const memPosts = new Map(); // фолбэк для пост-меты

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
    console.warn('[bot] Upstash Redis недоступен, используется in-memory:', e?.message || e);
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

// ---- Посты: храним по sourceToken => {text, absChatId, messageId} ----
async function setPostMeta(sourceToken, meta) {
  const key = `post:${sourceToken}`;
  const r = await getRedis();
  if (r) {
    await r.set(key, meta, { ex: 60 * 60 * 24 * 14 }); // 14 дней
  } else {
    memPosts.set(key, meta);
  }
}
async function getPostMeta(sourceToken) {
  const key = `post:${sourceToken}`;
  const r = await getRedis();
  if (r) {
    return (await r.get(key)) || null;
  }
  return memPosts.get(key) || null;
}

// ---------------- Helpers ----------------
const phoneOk = (s) => {
  if (!s) return false;
  const only = String(s).replace(/[^\d+]/g, '');
  return only.length >= 6 && /^[+]?[\d\s\-()]{6,}$/.test(String(s));
};

function makeOrderNo(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const DD = pad(d.getDate());
  const MM = pad(d.getMonth() + 1);
  const YYYY = d.getFullYear();
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${DD}.${MM}.${YYYY}-${HH}.${mm}.${ss}`;
}

// sourceToken (для deep-link): p_<ts>_<rand>
function makeSourceToken() {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makePostLink(absChatId, messageId) {
  // t.me/c/<internal>/<message_id>, где internal = absChatId без начальных "100"
  const s = String(absChatId);
  const internal = s.startsWith('100') ? s.slice(3) : s;
  return `https://t.me/c/${internal}/${messageId}`;
}

function buildUserSummary(s, orderNo, postText, postLink) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';
  const comment = s.comment?.trim();
  const lines = [
    `Заявка №${orderNo}:`,
    '',
    `Заказчик: ${s.name || '—'}`,
    `Телефон: ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];
  if (comment) lines.push(`Комментарий/связь: ${comment}`);
  if (postText) {
    lines.push('', 'Текст поста:', postText);
  }
  if (postLink) {
    lines.push(`Ссылка на пост: ${postLink}`);
  }
  return lines.join('\n');
}

function buildManagerSummary(s, orderNo, userId, postText, postLink) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';
  const lines = [
    `Новая заявка №${orderNo}`,
    `ID клиента: ${userId}`,
    '',
    `Заказчик: ${s.name || '—'}`,
    `Телефон: ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];
  if (s.comment?.trim()) lines.push(`Комментарий/связь: ${s.comment.trim()}`);
  if (postText || postLink) {
    lines.push('');
    if (postText) lines.push('Текст поста:', postText);
    if (postLink) lines.push(`Ссылка на пост: ${postLink}`);
  }
  return lines.join('\n');
}

async function sendOrderToManager(ctx, state, orderNo, postText, postLink) {
  const managerText = buildManagerSummary(state, orderNo, ctx.from?.id, postText, postLink);
  const photos = Array.isArray(state.photos) ? state.photos : [];
  if (photos.length > 0) {
    const media = photos.slice(0, 10).map((fileId, i) => ({
      type: 'photo',
      media: fileId,
      ...(i === 0 ? { caption: managerText } : {}),
    }));
    await ctx.telegram.sendMediaGroup(MANAGER_CHAT_ID, media);
    if (photos.length > 10) {
      await ctx.telegram.sendMessage(
        MANAGER_CHAT_ID,
        `Дополнительные фото (${photos.length - 10} шт.) пользователь отправит отдельно.`
      );
    }
  } else {
    await ctx.telegram.sendMessage(MANAGER_CHAT_ID, managerText);
  }
}

// Инлайн-клавиатуры под постом канала
function channelPostKbFull(botUsername, sourceToken) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = new URL(WEBAPP_URL).toString();
  return Markup.inlineKeyboard([
    [
      Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
      Markup.button.webApp('Подобрать памятник', webAppUrl),
    ],
  ]);
}

function channelPostKbFallback(botUsername, sourceToken) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = new URL(WEBAPP_URL).toString();
  return Markup.inlineKeyboard([
    [Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`)],
    [Markup.button.url('Подобрать памятник', webAppUrl)],
  ]);
}

// Отправка поста в канал сразу с reply_markup; если web_app не принимается — fallback (URL)
async function postToChannelWithKb(ctx, kind, payload, baseTextNoHint) {
  const chatId = getChannelId();
  if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');
  const me = ctx.botInfo || (await ctx.telegram.getMe());
  const botUsername = me.username;

  const sourceToken = makeSourceToken();
  const kbFull = channelPostKbFull(botUsername, sourceToken).reply_markup;
  const kbFallback = channelPostKbFallback(botUsername, sourceToken).reply_markup;

  // helper: отправка поста (в канал)
  const trySend = async ({ useHtml, replyMarkup }) => {
    const common = {
      ...(useHtml ? { parse_mode: 'HTML' } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    };

    if (kind === 'text') {
      return await ctx.telegram.sendMessage(chatId, payload.text, {
        ...common,
        disable_web_page_preview: true,
      });
    }
    if (kind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, payload.fileId, {
        ...common,
        caption: (payload.caption || '').slice(0, 1024),
      });
    }
    if (kind === 'video') {
      return await ctx.telegram.sendVideo(chatId, payload.fileId, {
        ...common,
        caption: (payload.caption || '').slice(0, 1024),
      });
    }
    if (kind === 'document') {
      const canCaption = (payload.caption || '').length <= 1024 ? payload.caption : undefined;
      return await ctx.telegram.sendDocument(chatId, payload.fileId, {
        ...common,
        caption: canCaption,
      });
    }
    throw new Error('Unknown kind');
  };

  const isHtmlIssue = (desc) => /parse entities|can't parse entities|entity|wrong entity/i.test(desc);
  const isWebAppIssue = (desc) =>
    /BUTTON_TYPE_INVALID/i.test(desc) || /web_app/i.test(desc) || /domain/i.test(desc) || /not allowed/i.test(desc);

  // 1) Пытаемся отправить с web_app + HTML
  let msg = null;
  try {
    msg = await trySend({ useHtml: true, replyMarkup: kbFull });
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);

    // 1a) Если проблема в HTML — повторяем без HTML (всё ещё с web_app)
    if (isHtmlIssue(desc)) {
      try {
        msg = await trySend({ useHtml: false, replyMarkup: kbFull });
      } catch (e2) {
        const desc2 = e2?.response?.description || e2?.message || String(e2);

        // 1b) Если web_app не принимается — отправляем fallback
        if (isWebAppIssue(desc2)) {
          msg = await trySend({ useHtml: false, replyMarkup: kbFallback });
        } else {
          throw e2;
        }
      }
    } else if (isWebAppIssue(desc)) {
      // 1c) web_app не принимается — отправляем fallback (попробуем с HTML, а если HTML сломается — уже без HTML)
      try {
        msg = await trySend({ useHtml: true, replyMarkup: kbFallback });
      } catch (e3) {
        const desc3 = e3?.response?.description || e3?.message || String(e3);
        if (isHtmlIssue(desc3)) {
          msg = await trySend({ useHtml: false, replyMarkup: kbFallback });
        } else {
          throw e3;
        }
      }
    } else {
      throw e;
    }
  }

  // 2) Сохраняем мету поста (текст + ссылка на пост) по sourceToken
  const abs = Math.abs(Number(msg.chat.id));
  const meta = {
    text: baseTextNoHint || '',
    absChatId: abs,
    messageId: msg.message_id,
  };
  await setPostMeta(sourceToken, meta);

  return { primary: msg, sourceToken };
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

  // /start — подсказка отдельным сообщением, затем сразу анкета
  bot.start(async (ctx) => {
    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();
    let sourceToken = null;
    if (arg.startsWith(DEEPLINK_PREFIX)) {
      const parts = arg.split('_');
      if (parts.length >= 2) sourceToken = parts.slice(1).join('_');
    }
    await ctx.reply(HINT_TEXT);
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

  // /post — публикует в канал пост с кнопками (web_app+fallback) и deep-link в ЛС
  bot.command('post', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
      if (!BOT_ADMINS.includes(ctx.from.id)) return ctx.reply('Недостаточно прав.');

      const raw = ctx.message?.text || '';
      const base = raw.replace(/^\/post(@\S+)?\s*/i, '').trim(); // исходный текст поста (без подсказки)
      const finalText = base ? `${base}\n\n${HINT_TEXT}` : HINT_TEXT;

      const r = ctx.message?.reply_to_message;
      if (r?.photo?.length) {
        const fileId = r.photo.at(-1).file_id;
        const { primary } = await postToChannelWithKb(ctx, 'photo', { fileId, caption: finalText }, base);
        return ctx.reply(`Фото‑пост опубликован в канал.\nmessage_id: ${primary.message_id}`);
      }
      if (r?.video) {
        const { primary } = await postToChannelWithKb(ctx, 'video', { fileId: r.video.file_id, caption: finalText }, base);
        return ctx.reply(`Видео‑пост опубликован в канал.\nmessage_id: ${primary.message_id}`);
      }
      if (r?.document) {
        const { primary } = await postToChannelWithKb(ctx, 'document', { fileId: r.document.file_id, caption: finalText }, base);
        return ctx.reply(`Документ‑пост опубликован в канал.\nmessage_id: ${primary.message_id}`);
      }
      if (!base) {
        return ctx.reply('Добавьте текст после /post или ответьте командой /post на фото/видео/документ.');
      }
      const { primary } = await postToChannelWithKb(ctx, 'text', { text: finalText }, base);
      return ctx.reply(`Текстовый пост опубликован в канал.\nmessage_id: ${primary.message_id}`);
    } catch (e) {
      console.error('[bot]/post error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(
        `Ошибка публикации: ${desc}\nПроверьте права бота, CHANNEL_ID и /setdomain у @BotFather (должен быть ${new URL(
          WEBAPP_URL
        ).origin}).`
      );
    }
  });

  // --------- Анкета: клавиши (reply‑клавиатура) ---------
  bot.hears('Отменить', async (ctx) => {
    if (ctx.session?.order) return cancelOrder(ctx, 'Анкета отменена.');
  });
  bot.hears('Далее', async (ctx) => {
    if (ctx.session?.order?.step === 'photos') return stepComment(ctx);
  });
  bot.hears('Продолжить', async (ctx) => {
    if (ctx.session?.order?.step === 'comment') return stepReview(ctx);
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
      if (st === 'comment') {
        if (text !== 'Продолжить' && text !== 'Отменить') {
          ctx.session.order.comment = text;
          return ctx.reply('Комментарий получен. Нажмите «Продолжить», чтобы перейти к сводке.', kbComment());
        }
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

// ---------------- Анкета: шаги и клавиатуры ----------------
function kbInput() {
  return Markup.keyboard([['Отменить']]).resize();
}
function kbPhotos() {
  return Markup.keyboard([['Далее'], ['Отменить']]).resize();
}
function kbComment() {
  return Markup.keyboard([['Продолжить'], ['Отменить']]).resize();
}
function kbReview() {
  return Markup.keyboard([['Отправить'], ['Отменить']]).resize();
}
function kbRemove() {
  return Markup.removeKeyboard();
}

async function startOrder(ctx, sourceToken) {
  ctx.session.order = { step: 'name', photos: [], ...(sourceToken ? { sourceToken } : {}) };
  await ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbInput());
}
async function stepPhone(ctx) {
  ctx.session.order.step = 'phone';
  await ctx.reply('Шаг 2/6. Номер телефона:', kbInput());
}
async function stepFio(ctx) {
  ctx.session.order.step = 'fio';
  await ctx.reply('Шаг 3/6. Фамилия/Имя/Отчество усопшего:', kbInput());
}
async function stepDates(ctx) {
  ctx.session.order.step = 'dates';
  await ctx.reply(
    'Шаг 4/6. Дата рождения — Дата смерти (в формате DD.MM.YYYY - DD.MM.YYYY). Например: 12.03.1950 - 05.11.2020',
    kbInput()
  );
}
async function stepPhotos(ctx) {
  ctx.session.order.step = 'photos';
  await ctx.reply('Шаг 5/6. Прикрепите фото. Когда закончите — нажмите «Далее».', kbPhotos());
}
async function stepComment(ctx) {
  ctx.session.order.step = 'comment';
  await ctx.reply('Шаг 6/6. Комментарий или дополнительный способ связи (по желанию):', kbComment());
}

async function stepReview(ctx) {
  ctx.session.order.step = 'review';
  const s = ctx.session.order;
  if (!s.orderNo) s.orderNo = makeOrderNo();

  let postText = '';
  let postLink = '';

  try {
    if (s.sourceToken) {
      const meta = await getPostMeta(s.sourceToken);
      if (meta?.text) postText = meta.text;
      if (meta?.absChatId && meta?.messageId) postLink = makePostLink(meta.absChatId, meta.messageId);
    }
  } catch (e) {
    console.error('[bot] get post meta error:', e?.message || e);
  }

  const text = buildUserSummary(s, s.orderNo, postText, postLink);
  await ctx.reply(text, kbReview());
}

async function submitOrder(ctx) {
  const s = ctx.session.order || {};
  if (!s.name || !s.phone || !phoneOk(s.phone)) {
    return ctx.reply('Обязательные поля не заполнены: «Заказчик» и/или «Номер телефона». Вернитесь и исправьте.', kbInput());
  }
  const orderNo = s.orderNo || makeOrderNo();

  let postText = '';
  let postLink = '';

  try {
    if (s.sourceToken) {
      const meta = await getPostMeta(s.sourceToken);
      if (meta?.text) postText = meta.text;
      if (meta?.absChatId && meta?.messageId) postLink = makePostLink(meta.absChatId, meta.messageId);
    }
  } catch (e) {
    console.error('[bot] get post meta error on submit:', e?.message || e);
  }

  try {
    await sendOrderToManager(ctx, s, orderNo, postText, postLink);
    await ctx.reply(
      `Заявка №${orderNo} отправлена. Спасибо, ${s.name}! Наш менеджер свяжется с вами по указанному номеру.`,
      kbRemove()
    );
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
