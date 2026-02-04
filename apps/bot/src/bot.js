// apps/bot/src/bot.js
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';
import ExcelJS from 'exceljs';

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

// Excel: /Memorial/apps/bot/catalog.xlsx
const CATALOG_XLSX_PATH = resolve(__dirname, '../catalog.xlsx');

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
const memPosts = new Map(); // фолбэк для пост-меты (sourceToken->meta)
const memCatalogPosts = new Map(); // message_id -> meta (selected, baseText, last_total_price)

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

// ---- Публикации памятников: messageId -> meta (для обновления цены) ----
async function setCatalogPostMeta(messageId, meta) {
  const key = `catalogpost:${messageId}`;
  const r = await getRedis();
  if (r) {
    await r.set(key, meta, { ex: 60 * 60 * 24 * 365 });
  } else {
    memCatalogPosts.set(key, meta);
  }
}
async function getCatalogPostMeta(messageId) {
  const key = `catalogpost:${messageId}`;
  const r = await getRedis();
  if (r) {
    return (await r.get(key)) || null;
  }
  return memCatalogPosts.get(key) || null;
}
async function getAllCatalogPostKeys() {
  const r = await getRedis();
  if (r) {
    try {
      const keys = await r.keys('catalogpost:*');
      return Array.isArray(keys) ? keys : [];
    } catch {
      return [];
    }
  }
  return Array.from(memCatalogPosts.keys());
}
async function getCatalogPostMetaByKey(key) {
  const r = await getRedis();
  if (r) return (await r.get(key)) || null;
  return memCatalogPosts.get(key) || null;
}
async function setCatalogPostMetaByKey(key, meta) {
  const r = await getRedis();
  if (r) {
    await r.set(key, meta, { ex: 60 * 60 * 24 * 365 });
  } else {
    memCatalogPosts.set(key, meta);
  }
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

// Инлайн-клавиатуры под постом канала (как было)
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

  let msg = null;
  try {
    msg = await trySend({ useHtml: true, replyMarkup: kbFull });
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);

    if (isHtmlIssue(desc)) {
      try {
        msg = await trySend({ useHtml: false, replyMarkup: kbFull });
      } catch (e2) {
        const desc2 = e2?.response?.description || e2?.message || String(e2);
        if (isWebAppIssue(desc2)) {
          msg = await trySend({ useHtml: false, replyMarkup: kbFallback });
        } else {
          throw e2;
        }
      }
    } else if (isWebAppIssue(desc)) {
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

  const abs = Math.abs(Number(msg.chat.id));
  const meta = {
    text: baseTextNoHint || '',
    absChatId: abs,
    messageId: msg.message_id,
  };
  await setPostMeta(sourceToken, meta);

  return { primary: msg, sourceToken };
}

// ---------------- Catalog (Excel) helpers ----------------
async function loadCatalogFromXlsx() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CATALOG_XLSX_PATH);

  const wsCat = wb.getWorksheet('Каталог');
  if (!wsCat) throw new Error('В catalog.xlsx отсутствует лист "Каталог".');

  const header = wsCat.getRow(1).values;
  const colIndex = (name) => header.findIndex((v) => String(v || '').trim() === name);

  const idxSku = colIndex('sku');
  const idxGroup = colIndex('group');
  const idxLabel = colIndex('label');
  const idxPrice = colIndex('price');
  const idxActive = colIndex('active');
  const idxTag = colIndex('tag_ru');

  if ([idxSku, idxGroup, idxLabel, idxPrice, idxActive].some((i) => i < 1)) {
    throw new Error('Лист "Каталог" должен содержать колонки: sku, group, label, price, active, tag_ru');
  }

  const items = [];
  wsCat.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sku = String(row.getCell(idxSku).value || '').trim();
    if (!sku) return;
    const active = row.getCell(idxActive).value;
    const isActive = String(active).trim() === '1' || active === 1 || active === true;
    if (!isActive) return;

    items.push({
      sku,
      group: String(row.getCell(idxGroup).value || '').trim().toUpperCase(),
      label: String(row.getCell(idxLabel).value || '').trim(),
      price: Number(row.getCell(idxPrice).value || 0),
      tag_ru: String(row.getCell(idxTag)?.value || '').trim(),
    });
  });

  const wsBands = wb.getWorksheet('PriceBands');
  if (!wsBands) throw new Error('В catalog.xlsx отсутствует лист "PriceBands".');

  const headerB = wsBands.getRow(1).values;
  const bMin = headerB.findIndex((v) => String(v || '').trim() === 'min');
  const bMax = headerB.findIndex((v) => String(v || '').trim() === 'max');
  const bTag = headerB.findIndex((v) => String(v || '').trim() === 'tag_ru');
  if ([bMin, bMax, bTag].some((i) => i < 1)) {
    throw new Error('Лист "PriceBands" должен содержать колонки: min, max, tag_ru');
  }

  const bands = [];
  wsBands.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const min = Number(row.getCell(bMin).value);
    const max = Number(row.getCell(bMax).value);
    const tag = String(row.getCell(bTag).value || '').trim();
    if (!Number.isFinite(min) || !Number.isFinite(max) || !tag) return;
    bands.push({ min, max, tag });
  });

  return { items, bands };
}

function formatRub(n) {
  const s = Math.round(Number(n) || 0).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function pickBandTag(bands, total) {
  for (const b of bands) {
    if (total >= b.min && total <= b.max) return b.tag;
  }
  return '';
}

function normalizeSelectedToSkuList(selected) {
  const res = [];
  for (const v of Object.values(selected || {})) {
    if (!v) continue;
    if (Array.isArray(v)) res.push(...v);
    else res.push(v);
  }
  const seen = new Set();
  const out = [];
  for (const sku of res) {
    if (!seen.has(sku)) {
      seen.add(sku);
      out.push(sku);
    }
  }
  return out;
}

function calcCaptionAndTags({ items, bands }, selected) {
  const skuList = normalizeSelectedToSkuList(selected);
  const bySku = new Map(items.map((it) => [it.sku, it]));
  let total = 0;

  let stelaTag = '';
  let plitaTag = '';
  let workTag = '';
  let hasPlita = false;
  let hasCvetnik = false;

  for (const sku of skuList) {
    const it = bySku.get(sku);
    if (!it) continue;
    total += Number(it.price || 0);

    if (it.group === 'STELA' && it.tag_ru) stelaTag = it.tag_ru;
    if (it.group === 'PLITA') {
      hasPlita = true;
      if (it.tag_ru) plitaTag = it.tag_ru;
    }
    if (it.group === 'CVETNIK') hasCvetnik = true;
    if (it.group === 'WORK' && it.tag_ru) workTag = it.tag_ru;
  }

  const tags = [];
  if (stelaTag) tags.push(stelaTag);
  if (hasPlita) {
    if (plitaTag) tags.push(plitaTag);
  } else {
    tags.push('#без_плиты');
  }
  if (!hasCvetnik) tags.push('#без_цветника');
  if (workTag) tags.push(workTag);

  const bandTag = pickBandTag(bands, total);
  if (bandTag) tags.push(bandTag);

  const seen = new Set();
  const uniqTags = [];
  for (const t of tags) {
    if (!t) continue;
    if (!seen.has(t)) {
      seen.add(t);
      uniqTags.push(t);
    }
  }

  const caption = `Цена: ${formatRub(total)} ₽\n${uniqTags.join(' ')}`.trim();
  return { total, tags: uniqTags, caption };
}

function isAdmin(ctx) {
  const uid = ctx.from?.id;
  return uid && BOT_ADMINS.includes(uid);
}

// ---------- UI helpers for /post wizard ----------
function fmtBtn(label, price) {
  // Вы просили: "на кнопках пишем цену"
  // Формат: "<label> — <price>₽"
  if (price && Number(price) > 0) return `${label} — ${formatRub(price)}₽`;
  return label;
}

function splitTwoColumns(arr) {
  const rows = [];
  for (let i = 0; i < arr.length; i += 2) rows.push(arr.slice(i, i + 2));
  return rows;
}

// --- Wizard message cleanup: стараемся не плодить сообщения ---
// Мы будем использовать один "экран" и редактировать его, если возможно.
// Если редактирование не удалось — отправим новое и запомним его id, затем при следующем шаге будем удалять старое.
async function wizShow(ctx, text, keyboard) {
  const wiz = ctx.session?.postWizard;
  if (!wiz) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const prevMsgId = wiz.ui?.msgId;

  // 1) пробуем edit, если есть prevMsgId
  if (prevMsgId) {
    try {
      await ctx.telegram.editMessageText(chatId, prevMsgId, undefined, text, {
        ...keyboard,
        disable_web_page_preview: true,
      });
      return;
    } catch {
      // ignore
    }
  }

  // 2) если edit не вышло — отправляем новое, и удаляем старое
  const sent = await ctx.reply(text, keyboard);
  wiz.ui = wiz.ui || {};
  wiz.ui.msgId = sent.message_id;

  if (prevMsgId) {
    try {
      await ctx.telegram.deleteMessage(chatId, prevMsgId);
    } catch {
      // ignore
    }
  }
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
    const info = [`chat_id = ${chat.id}`, `chat_type = ${chat.type}`, `user_id = ${from.id}`, `username = ${me.username}`].join(
      '\n'
    );
    return ctx.reply('DEBUG:\n' + info);
  });
  bot.command('id', async (ctx) => {
    const fwd = ctx.message?.forward_from_chat;
    if (fwd) {
      return ctx.reply(`CHANNEL_ID: ${fwd.id}\nusername: ${fwd.username || '—'}\ntitle: ${fwd.title || '—'}`);
    }
    return ctx.reply('Перешлите мне пост канала и повторите /id — пришлю CHANNEL_ID.');
  });

  // ======================= /post (АДМИН) =======================
  // Обновления по вашему ТЗ:
  // - портрет и метрика => мультивыбор, но мы переносим их "в меню графики"
  //   т.е. на шаге "Графика" показываем: Портрет, Метрика, Графика 1..4
  // - не плодим сообщения: один экран редактируется/пересоздается с удалением
  // - кнопка Назад на каждом шаге
  bot.command('post', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
      if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав.');

      // Чтобы не мешать клиентской анкете
      if (ctx.session?.order) {
        return ctx.reply('Сейчас активна анкета. Завершите или отмените её командой /cancel, затем используйте /post.');
      }

      const raw = ctx.message?.text || '';
      const baseTextNoHint = raw.replace(/^\/post(@\S+)?\s*/i, '').trim();

      const r = ctx.message?.reply_to_message;
      const mediaPayload = {};
      if (r?.photo?.length) {
        mediaPayload.kind = 'photo';
        mediaPayload.fileId = r.photo.at(-1).file_id;
      } else if (r?.video) {
        mediaPayload.kind = 'video';
        mediaPayload.fileId = r.video.file_id;
      } else if (r?.document) {
        mediaPayload.kind = 'document';
        mediaPayload.fileId = r.document.file_id;
      } else {
        mediaPayload.kind = 'text';
      }

      ctx.session.postWizard = {
        step: 'menu',
        prevStack: [],
        baseTextNoHint,
        mediaPayload,
        selected: {
          STELA: null,
          TUMBA: null,
          CVETNIK: null,
          PLITA: null,
          WORK: null,
          // OPTION и GRAFIKA объединяем в один список на шаге "GRAPHICS"
          EXTRA: [], // сюда будут попадать OPT_PORTRAIT/OPT_METRICA и GRAFIKA_1..4
        },
        ui: { msgId: null },
      };

      await wizShow(ctx, 'Меню /post:', kbPostMenu());
    } catch (e) {
      console.error('[bot]/post wizard menu error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(`Ошибка /post: ${desc}`);
    }
  });

  function kbPostMenu() {
    return Markup.keyboard([['♻️ Обновить цены'], ['▶️ Новая публикация'], ['Отменить']]).resize();
  }

  function kbUpdateMenu() {
    return Markup.keyboard([['🧾 Обновить по пересланному посту'], ['🔁 Обновить все'], ['⬅️ Назад'], ['Отменить']]).resize();
  }

  function kbBackCancel() {
    return Markup.keyboard([['⬅️ Назад'], ['Отменить']]).resize();
  }

  // --- update prices menu
  bot.hears('♻️ Обновить цены', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.prevStack = ['menu'];
    ctx.session.postWizard.step = 'update_prices';
    await wizShow(
      ctx,
      'Обновление цен постов:\n\n• Обновить один пост: перешлите сюда сообщение из канала.\n• Обновить все: обновит только посты, которые публиковались через этот /post (чтобы бот знал состав).',
      kbUpdateMenu()
    );
  });

  bot.hears('🧾 Обновить по пересланному посту', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices') return;

    ctx.session.postWizard.prevStack.push('update_prices');
    ctx.session.postWizard.step = 'update_wait_forward';
    await wizShow(ctx, 'Перешлите сюда пост из канала.', kbBackCancel());
  });

  bot.hears('🔁 Обновить все', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices') return;

    const channelId = getChannelId();
    if (!channelId) return ctx.reply('CHANNEL_ID не задан.');

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const keys = await getAllCatalogPostKeys();
    if (!keys.length) {
      ctx.session.postWizard.step = 'menu';
      return wizShow(
        ctx,
        'Нет сохраненных данных о постах для обновления.\n\nВажно: массовое обновление работает только для постов, которые публиковались через этот /post.',
        kbPostMenu()
      );
    }

    const catalog = await loadCatalogFromXlsx();

    for (const key of keys) {
      try {
        const meta = await getCatalogPostMetaByKey(key);
        if (!meta?.selected) {
          skipped++;
          continue;
        }
        const messageId = Number(String(key).split(':').at(-1));
        if (!messageId) {
          skipped++;
          continue;
        }

        const { caption, total } = calcCaptionAndTags(catalog, meta.selected);
        const baseText = (meta.baseTextNoHint || '').trim();
        const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

        if (Number(meta.last_total_price) === Number(total)) {
          skipped++;
          continue;
        }

        await ctx.telegram.editMessageCaption(channelId, messageId, undefined, newCaption);
        await setCatalogPostMetaByKey(key, { ...meta, last_total_price: total, updatedAt: Date.now() });
        updated++;
      } catch {
        errors++;
      }
    }

    ctx.session.postWizard.step = 'menu';
    await wizShow(ctx, `Готово.\nОбновлено: ${updated}\nБез изменений: ${skipped}\nОшибок: ${errors}`, kbPostMenu());
  });

  // --- publish flow start
  bot.hears('▶️ Новая публикация', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.prevStack = ['menu'];
    ctx.session.postWizard.step = 'STELA';
    await showStep(ctx, 'STELA');
  });

  // --- back
  bot.hears('⬅️ Назад', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const wiz = ctx.session?.postWizard;
    if (!wiz) return;

    const prev = wiz.prevStack?.pop();
    if (!prev) {
      wiz.step = 'menu';
      return wizShow(ctx, 'Меню /post:', kbPostMenu());
    }

    wiz.step = prev;

    if (prev === 'menu') return wizShow(ctx, 'Меню /post:', kbPostMenu());
    if (prev === 'update_prices') return wizShow(ctx, 'Обновление цен постов:', kbUpdateMenu());
    if (prev === 'update_wait_forward') return wizShow(ctx, 'Перешлите сюда пост из канала.', kbBackCancel());

    return showStep(ctx, prev);
  });

  async function showStep(ctx, step) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const { items } = await loadCatalogFromXlsx();

    const titleMap = {
      STELA: 'Выберите стелу:',
      TUMBA: 'Выберите тумбу:',
      CVETNIK: 'Цветник (или — Нет —):',
      PLITA: 'Плита (или — Нет —):',
      WORK: 'Резная/Фрезерная (выберите вариант или — Нет —):',
      GRAPHICS: 'Портрет / Метрика / Графика (можно несколько). Нажмите «Далее» когда закончите:',
    };

    // single groups
    if (['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'].includes(step)) {
      let list = items.filter((it) => it.group === step);

      // по 4 варианта на WORK (лучше ограничивать через active в Excel, но держим ограничение)
      if (step === 'WORK') list = list.slice(0, 4);

      const optional = ['CVETNIK', 'PLITA', 'WORK'].includes(step);

      const btns = list.map((it) => fmtBtn(it.label, it.price));
      const rows = splitTwoColumns(btns);
      if (optional) rows.push(['— Нет —']);
      rows.push(['⬅️ Назад']);
      rows.push(['Отменить']);

      return wizShow(ctx, titleMap[step] || `Выберите ${step}:`, Markup.keyboard(rows).resize());
    }

    if (step === 'GRAPHICS') {
      // объединяем OPTION + GRAFIKA
      // по вашему ТЗ: Портрет, Метрика, Графика 1, ... и графики всего 4
      const options = items.filter((it) => it.group === 'OPTION');
      const graf = items.filter((it) => it.group === 'GRAFIKA').slice(0, 4);
      const list = [...options, ...graf];

      const rows = [];
      rows.push(['Далее', 'Сбросить']);
      rows.push(...splitTwoColumns(list.map((it) => fmtBtn(it.label, it.price))));
      rows.push(['⬅️ Назад']);
      rows.push(['Отменить']);

      return wizShow(ctx, titleMap[step], Markup.keyboard(rows).resize());
    }
  }

  async function advance(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const order = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK', 'GRAPHICS', 'PREVIEW'];
    const idx = order.indexOf(wiz.step);
    const next = order[idx + 1] || 'PREVIEW';

    wiz.prevStack.push(wiz.step);
    wiz.step = next;

    if (next === 'PREVIEW') return showPreview(ctx);
    return showStep(ctx, next);
  }

  async function showPreview(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const catalog = await loadCatalogFromXlsx();
    const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

    const baseText = (wiz.baseTextNoHint || '').trim();
    const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

    wiz.prevStack.push('GRAPHICS');
    wiz.step = 'CONFIRM';
    wiz._computed = { total, captionOnly: caption, fullCaption: fullCaption.slice(0, 1024) };

    return wizShow(
      ctx,
      `Предпросмотр:\n\n${fullCaption}\n\nЕсли всё верно — нажмите «Опубликовать».`,
      Markup.keyboard([['Опубликовать'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  }

  async function cleanupWizardUI(ctx) {
    const wiz = ctx.session?.postWizard;
    if (!wiz?.ui?.msgId) return;
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, wiz.ui.msgId);
    } catch {}
    wiz.ui.msgId = null;
  }

  // Универсальный обработчик сообщений (и для апдейта по forward, и для выбора в мастере)
  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();

    // если прилетело не текстом — пускай дальше (в анкете)
    if (!('text' in ctx.message) || !ctx.message.text) return next();

    const text = ctx.message.text.trim();

    // Отменить: удаляем экран и убираем клавиатуру
    if (text === 'Отменить') {
      await cleanupWizardUI(ctx);
      ctx.session.postWizard = null;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return;
    }

    // update forward
    if (wiz.step === 'update_wait_forward') {
      // ждём пересланный пост (это не text-only сценарий, но Telegram всё равно присылает text/caption)
      const fwd = ctx.message?.forward_from_chat;
      const messageId = ctx.message?.forward_from_message_id;

      if (!fwd || !messageId) {
        await wizShow(ctx, 'Это не пересланный пост из канала. Перешлите именно сообщение из канала.', kbBackCancel());
        return;
      }

      const channelId = getChannelId();
      if (!channelId) {
        wiz.step = 'menu';
        return wizShow(ctx, 'CHANNEL_ID не задан.', kbPostMenu());
      }

      if (String(fwd.id) !== String(channelId)) {
        await wizShow(ctx, 'Пост переслан не из того канала.', kbBackCancel());
        return;
      }

      const meta = await getCatalogPostMeta(messageId);
      if (!meta?.selected) {
        wiz.step = 'menu';
        return wizShow(
          ctx,
          'У меня нет сохранённого состава для этого поста.\nОн должен быть опубликован через новый /post.',
          kbPostMenu()
        );
      }

      const catalog = await loadCatalogFromXlsx();
      const { caption, total } = calcCaptionAndTags(catalog, meta.selected);
      const baseText = (meta.baseTextNoHint || '').trim();
      const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

      await ctx.telegram.editMessageCaption(channelId, messageId, undefined, newCaption);
      await setCatalogPostMeta(messageId, { ...meta, last_total_price: total, updatedAt: Date.now() });

      wiz.step = 'menu';
      return wizShow(ctx, `Обновлено.\nmessage_id: ${messageId}`, kbPostMenu());
    }

    // confirm publish
    if (wiz.step === 'CONFIRM') {
      if (text !== 'Опубликовать') return;

      try {
        const channelId = getChannelId();
        if (!channelId) {
          wiz.step = 'menu';
          return wizShow(ctx, 'CHANNEL_ID не задан.', kbPostMenu());
        }

        if (!wiz.selected.STELA || !wiz.selected.TUMBA) {
          wiz.step = 'menu';
          return wizShow(ctx, 'Нужно выбрать стелу и тумбу.', kbPostMenu());
        }

        const catalog = await loadCatalogFromXlsx();
        const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

        const baseText = (wiz.baseTextNoHint || '').trim();
        const finalCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

        const payload = wiz.mediaPayload || { kind: 'text' };
        const kind = payload.kind;

        let published;
        if (kind === 'photo') {
          const { primary } = await postToChannelWithKb(ctx, 'photo', { fileId: payload.fileId, caption: finalCaption }, baseText);
          published = primary;
        } else if (kind === 'video') {
          const { primary } = await postToChannelWithKb(ctx, 'video', { fileId: payload.fileId, caption: finalCaption }, baseText);
          published = primary;
        } else if (kind === 'document') {
          const { primary } = await postToChannelWithKb(ctx, 'document', { fileId: payload.fileId, caption: finalCaption }, baseText);
          published = primary;
        } else {
          const { primary } = await postToChannelWithKb(ctx, 'text', { text: finalCaption }, baseText);
          published = primary;
        }

        // сохраняем для обновления
        await setCatalogPostMeta(published.message_id, {
          selected: wiz.selected,
          baseTextNoHint: baseText,
          last_total_price: total,
          createdAt: Date.now(),
        });

        // чистим UI мастера
        await cleanupWizardUI(ctx);
        ctx.session.postWizard = null;

        await ctx.reply(`Опубликовано.\nmessage_id: ${published.message_id}`, Markup.removeKeyboard());
        return;
      } catch (e) {
        console.error('[bot] publish error:', e);
        const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
        wiz.step = 'menu';
        return wizShow(ctx, `Ошибка публикации: ${desc}`, kbPostMenu());
      }
    }

    // Step handlers
    if (wiz.step === 'menu') return;
    if (wiz.step === 'update_prices') return;
    if (wiz.step === 'update_wait_forward') return;

    // GRAPHICS multi
    if (wiz.step === 'GRAPHICS') {
      if (text === 'Далее') return advance(ctx);
      if (text === 'Сбросить') {
        wiz.selected.EXTRA = [];
        return showStep(ctx, 'GRAPHICS');
      }

      // toggle by matching button text
      const { items } = await loadCatalogFromXlsx();
      const options = items.filter((it) => it.group === 'OPTION');
      const graf = items.filter((it) => it.group === 'GRAFIKA').slice(0, 4);
      const list = [...options, ...graf];

      const it = list.find((x) => fmtBtn(x.label, x.price) === text);
      if (!it) return;

      const arr = Array.isArray(wiz.selected.EXTRA) ? wiz.selected.EXTRA : [];
      const idx = arr.indexOf(it.sku);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(it.sku);
      wiz.selected.EXTRA = arr;
      return;
    }

    // single steps
    const singleGroups = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'];
    if (singleGroups.includes(wiz.step)) {
      if (text === '— Нет —') {
        wiz.selected[wiz.step] = null;
        return advance(ctx);
      }

      const { items } = await loadCatalogFromXlsx();
      let list = items.filter((it) => it.group === wiz.step);
      if (wiz.step === 'WORK') list = list.slice(0, 4);

      const it = list.find((x) => fmtBtn(x.label, x.price) === text);
      if (!it) return;

      wiz.selected[wiz.step] = it.sku;
      return advance(ctx);
    }

    return;
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
