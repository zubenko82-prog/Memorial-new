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
    // Upstash REST: KEYS может быть запрещен/нежелателен.
    // Поэтому делаем мягко: если keys недоступен — вернем пусто.
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

// Менеджеру: максимум telegram-данных + телефон ИЗ КОНТАКТА (если пользователь поделился),
// плюс ссылка на пост внизу (без "—")
function buildManagerSummary(s, orderNo, user, postText, postLink) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';

  const u = user || {};
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—';
  const username = u.username ? `@${u.username}` : '—';
  const lang = u.language_code || '—';
  const isPremium = u.is_premium ? 'да' : 'нет';

  // Telegram phone: только если человек прислал contact (request_contact)
  const tgPhone = s.tg_phone ? s.tg_phone : null;

  const lines = [
    `Новая заявка №${orderNo}`,
    '',
    'Данные Telegram:',
    `ID: ${u.id ?? '—'}`,
    `Имя: ${fullName}`,
    `Username: ${username}`,
    `Язык: ${lang}`,
    `Premium: ${isPremium}`,
    ...(tgPhone ? [`Телефон профиля (контакт): ${tgPhone}`] : []),
    '',
    'Данные анкеты:',
    `Заказчик: ${s.name || '—'}`,
    `Телефон (в анкете): ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];

  if (s.comment?.trim()) lines.push(`Комментарий/связь: ${s.comment.trim()}`);

  if (postText) {
    lines.push('', 'Текст поста:', postText);
  }

  if (postLink) {
    lines.push('', `Ссылка на пост: ${postLink}`);
  }

  return lines.join('\n');
}

console.log('[order] sourceToken=', s.sourceToken, 'postMeta=', await getPostMeta(s.sourceToken));


async function sendOrderToManager(ctx, state, orderNo, postText, postLink) {
  const managerText = buildManagerSummary(state, orderNo, ctx.from, postText, postLink);
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

// ИЗМЕНЕНО: чтобы появлялось "Прокомментировать" — сначала отправляем без reply_markup,
// затем добавляем кнопки через editMessageReplyMarkup
async function postToChannelWithKb(ctx, kind, payload, baseTextNoHint) {
  const chatId = getChannelId();
  if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');
  const me = ctx.botInfo || (await ctx.telegram.getMe());
  const botUsername = me.username;

  const sourceToken = makeSourceToken();
  const kbFull = channelPostKbFull(botUsername, sourceToken).reply_markup;
  const kbFallback = channelPostKbFallback(botUsername, sourceToken).reply_markup;

  const isHtmlIssue = (desc) => /parse entities|can't parse entities|entity|wrong entity/i.test(desc);
  const isWebAppIssue = (desc) =>
    /BUTTON_TYPE_INVALID/i.test(desc) || /web_app/i.test(desc) || /domain/i.test(desc) || /not allowed/i.test(desc);

  const trySendNoKb = async ({ useHtml }) => {
    const common = {
      ...(useHtml ? { parse_mode: 'HTML' } : {}),
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

  let msg = null;
  try {
    msg = await trySendNoKb({ useHtml: true });
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);
    if (isHtmlIssue(desc)) {
      msg = await trySendNoKb({ useHtml: false });
    } else {
      throw e;
    }
  }

  try {
    await ctx.telegram.editMessageReplyMarkup(chatId, msg.message_id, undefined, kbFull);
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);
    if (isWebAppIssue(desc)) {
      await ctx.telegram.editMessageReplyMarkup(chatId, msg.message_id, undefined, kbFallback);
    } else {
      console.warn('[bot] cannot set reply_markup:', desc);
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
  // (оставлено как было в вашем коде)
  bot.command('post', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
      if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав.');

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
        baseTextNoHint,
        mediaPayload,
        selected: {
          STELA: null,
          TUMBA: null,
          CVETNIK: null,
          PLITA: null,
          WORK: null,
          OPTION: [],
          GRAFIKA: [],
        },
      };

      await ctx.reply('Меню /post:', kbPostMenu());
    } catch (e) {
      console.error('[bot]/post wizard menu error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(`Ошибка /post: ${desc}`);
    }
  });

  function kbPostMenu() {
    return Markup.keyboard([['♻️ Обновить цены'], ['▶️ Новая публикация'], ['Отменить']]).resize();
  }
  function kbPostCancelOnly() {
    return Markup.keyboard([['Отменить']]).resize();
  }
  function kbPostNextCancel() {
    return Markup.keyboard([['Отменить']]).resize();
  }

  bot.hears('♻️ Обновить цены', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'update_prices';
    await ctx.reply(
      'Обновление цен постов:\n\n1) Перешлите сюда пост из канала, который нужно обновить, и я обновлю цену.\n\nИли нажмите «Обновить все» (если хранение меты включено и доступно).',
      Markup.keyboard([['🧾 Обновить по пересланному посту'], ['🔁 Обновить все'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  });

  bot.hears('⬅️ Назад', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard) return;
    ctx.session.postWizard.step = 'menu';
    await ctx.reply('Меню /post:', kbPostMenu());
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
      return ctx.reply(
        'Нет сохраненных данных о постах для обновления.\n\nВажно: массовое обновление работает только для постов, которые публиковались через новый мастер /post (чтобы бот сохранил состав).'
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
      } catch (e) {
        errors++;
      }
    }

    await ctx.reply(`Готово.\nОбновлено: ${updated}\nБез изменений: ${skipped}\nОшибок: ${errors}`, kbPostMenu());
    ctx.session.postWizard.step = 'menu';
  });

  bot.hears('🧾 Обновить по пересланному посту', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices') return;

    ctx.session.postWizard.step = 'update_wait_forward';
    await ctx.reply(
      'Перешлите сюда сообщение из канала (тот самый пост). Я попробую обновить цену.\n\nВажно: пост должен быть опубликован через новый мастер /post, иначе у бота нет состава для пересчёта.',
      kbPostCancelOnly()
    );
  });

  bot.hears('▶️ Новая публикация', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'STELA';
    await askPostWizardStep(ctx, 'STELA');
  });

  async function askPostWizardStep(ctx, group) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const { items } = await loadCatalogFromXlsx();

    const list = items.filter((it) => it.group === group);
    if (!list.length) {
      return advancePostWizard(ctx);
    }

    const buttons = [];
    for (const it of list) buttons.push(it.label);

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    const optional = ['CVETNIK', 'PLITA', 'WORK'];
    if (optional.includes(group)) rows.push(['— Нет —']);

    rows.push(['Отменить']);

    const titleMap = {
      STELA: 'Выберите стелу:',
      TUMBA: 'Выберите тумбу:',
      CVETNIK: 'Цветник (или — Нет —):',
      PLITA: 'Плита (или — Нет —):',
      WORK: 'Работа (или — Нет —):',
      OPTION: 'Опции (можно несколько):',
      GRAFIKA: 'Графика (можно несколько). Нажмите «Далее» когда закончите:',
    };

    if (group === 'OPTION' || group === 'GRAFIKA') {
      rows.unshift(['Далее', 'Сбросить']);
      await ctx.reply(titleMap[group] || `Выберите ${group}:`, Markup.keyboard(rows).resize());
      return;
    }

    await ctx.reply(titleMap[group] || `Выберите ${group}:`, Markup.keyboard(rows).resize());
  }

  async function advancePostWizard(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const order = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK', 'OPTION', 'GRAFIKA', 'PREVIEW'];
    const idx = order.indexOf(wiz.step);
    const next = order[idx + 1] || 'PREVIEW';
    wiz.step = next;

    if (next === 'PREVIEW') return showPostWizardPreview(ctx);
    return askPostWizardStep(ctx, next);
  }

  async function showPostWizardPreview(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const catalog = await loadCatalogFromXlsx();
    const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

    const baseText = (wiz.baseTextNoHint || '').trim();
    const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

    wiz.step = 'CONFIRM';
    await ctx.reply(
      `Предпросмотр:\n\n${fullCaption}\n\nЕсли всё верно — нажмите «Опубликовать».`,
      Markup.keyboard([['Опубликовать'], ['Отменить']]).resize()
    );
  }

  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();

    if ('text' in ctx.message && ctx.message.text?.trim() === 'Отменить') {
      ctx.session.postWizard = null;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return;
    }

    if (wiz.step === 'update_wait_forward') {
      const fwd = ctx.message?.forward_from_chat;
      const messageId = ctx.message?.forward_from_message_id;

      if (!fwd || !messageId) {
        await ctx.reply('Это не пересланный пост из канала. Перешлите именно сообщение из канала.', kbPostCancelOnly());
        return;
      }

      const channelId = getChannelId();
      if (!channelId) {
        await ctx.reply('CHANNEL_ID не задан.', kbPostMenu());
        ctx.session.postWizard.step = 'menu';
        return;
      }

      if (String(fwd.id) !== String(channelId)) {
        await ctx.reply('Пост переслан не из того канала.', kbPostCancelOnly());
        return;
      }

      const meta = await getCatalogPostMeta(messageId);
      if (!meta?.selected) {
        await ctx.reply(
          'У меня нет сохранённого состава для этого поста.\nОн должен быть опубликован через новый мастер /post.',
          kbPostMenu()
        );
        ctx.session.postWizard.step = 'menu';
        return;
      }

      const catalog = await loadCatalogFromXlsx();
      const { caption, total } = calcCaptionAndTags(catalog, meta.selected);
      const baseText = (meta.baseTextNoHint || '').trim();
      const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

      await ctx.telegram.editMessageCaption(channelId, messageId, undefined, newCaption);
      await setCatalogPostMeta(messageId, { ...meta, last_total_price: total, updatedAt: Date.now() });

      await ctx.reply(`Обновлено.\nmessage_id: ${messageId}`, kbPostMenu());
      ctx.session.postWizard.step = 'menu';
      return;
    }

    if (!('text' in ctx.message) || !ctx.message.text) return;
    const text = ctx.message.text.trim();

    if (wiz.step === 'menu') return;

    if (wiz.step === 'CONFIRM') {
      if (text === 'Опубликовать') {
        try {
          const channelId = getChannelId();
          if (!channelId) return ctx.reply('CHANNEL_ID не задан.', kbPostMenu());

          if (!wiz.selected.STELA || !wiz.selected.TUMBA) {
            await ctx.reply('Нужно выбрать стелу и тумбу.', kbPostMenu());
            ctx.session.postWizard.step = 'menu';
            return;
          }

          const catalog = await loadCatalogFromXlsx();
          const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

          const baseText = (wiz.baseTextNoHint || '').trim();
          const finalCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

          const payload = wiz.mediaPayload || { kind: 'text' };
          const kind = payload.kind;

          if (kind === 'photo') {
            const { primary } = await postToChannelWithKb(ctx, 'photo', { fileId: payload.fileId, caption: finalCaption }, baseText);
            await setCatalogPostMeta(primary.message_id, {
              selected: wiz.selected,
              baseTextNoHint: baseText,
              last_total_price: total,
              createdAt: Date.now(),
            });
            await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
          } else if (kind === 'video') {
            const { primary } = await postToChannelWithKb(ctx, 'video', { fileId: payload.fileId, caption: finalCaption }, baseText);
            await setCatalogPostMeta(primary.message_id, {
              selected: wiz.selected,
              baseTextNoHint: baseText,
              last_total_price: total,
              createdAt: Date.now(),
            });
            await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
          } else if (kind === 'document') {
            const { primary } = await postToChannelWithKb(
              ctx,
              'document',
              { fileId: payload.fileId, caption: finalCaption },
              baseText
            );
            await setCatalogPostMeta(primary.message_id, {
              selected: wiz.selected,
              baseTextNoHint: baseText,
              last_total_price: total,
              createdAt: Date.now(),
            });
            await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
          } else {
            const { primary } = await postToChannelWithKb(ctx, 'text', { text: finalCaption }, baseText);
            await setCatalogPostMeta(primary.message_id, {
              selected: wiz.selected,
              baseTextNoHint: baseText,
              last_total_price: total,
              createdAt: Date.now(),
            });
            await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
          }

          ctx.session.postWizard = null;
          return;
        } catch (e) {
          console.error('[bot] publish error:', e);
          const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
          await ctx.reply(`Ошибка публикации: ${desc}`, kbPostMenu());
          ctx.session.postWizard.step = 'menu';
          return;
        }
      }
      return;
    }

    if (wiz.step === 'OPTION' || wiz.step === 'GRAFIKA') {
      if (text === 'Далее') {
        return advancePostWizard(ctx);
      }
      if (text === 'Сбросить') {
        wiz.selected[wiz.step] = [];
        return askPostWizardStep(ctx, wiz.step);
      }

      const { items } = await loadCatalogFromXlsx();
      const it = items.find((x) => x.group === wiz.step && x.label === text);
      if (!it) return;

      const arr = Array.isArray(wiz.selected[wiz.step]) ? wiz.selected[wiz.step] : [];
      const idx = arr.indexOf(it.sku);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(it.sku);
      wiz.selected[wiz.step] = arr;
      return;
    }

    const singleGroups = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'];
    if (singleGroups.includes(wiz.step)) {
      if (text === '— Нет —') {
        wiz.selected[wiz.step] = null;
        return advancePostWizard(ctx);
      }

      const { items } = await loadCatalogFromXlsx();
      const it = items.find((x) => x.group === wiz.step && x.label === text);
      if (!it) return;

      wiz.selected[wiz.step] = it.sku;
      return advancePostWizard(ctx);
    }

    return;
  });

  // --------- Анкета: клавиши (reply‑клавиатура) ---------
  bot.hears('Отменить', async (ctx) => {
    if (ctx.session?.order) return cancelOrder(ctx, 'Анкета отменена.');
  });
    bot.hears('⬅️ Назад', async (ctx) => {
    if (ctx.session?.order) return stepBack(ctx);
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

    // контакт (телефон профиля), только на шаге phone
    if (st === 'phone' && 'contact' in ctx.message && ctx.message.contact) {
      const c = ctx.message.contact;
      // Telegram даёт номер только если пользователь согласился
      if (c.phone_number) {
        ctx.session.order.tg_phone = c.phone_number;
        ctx.session.order.phone = c.phone_number;
        return stepFio(ctx);
      }
    }

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();
      if (st === 'name') {
        ctx.session.order.name = text;
        return stepPhone(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply(
            'Введите корректный номер телефона (минимум 6 цифр, можно с +) или нажмите «📱 Отправить мой контакт».',
            kbPhone()
          );
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
function kbName() {
  return Markup.keyboard([['Отменить']]).resize(); // назад на первом шаге не нужен
}

function kbPhone() {
  return Markup.keyboard([[Markup.button.contactRequest('📱 Отправить мой контакт')], ['⬅️ Назад'], ['Отменить']]).resize();
}

function kbDefaultWithBack() {
  return Markup.keyboard([['⬅️ Назад'], ['Отменить']]).resize();
}

function kbPhotos() {
  return Markup.keyboard([['Далее'], ['⬅️ Назад'], ['Отменить']]).resize();
}

function kbComment() {
  return Markup.keyboard([['Продолжить'], ['⬅️ Назад'], ['Отменить']]).resize();
}

function kbReview() {
  return Markup.keyboard([['Отправить'], ['⬅️ Назад'], ['Отменить']]).resize();
}

function kbRemove() {
  return Markup.removeKeyboard();
}

function getOrderStepOrder() {
  return ['name', 'phone', 'fio', 'dates', 'photos', 'comment', 'review'];
}

async function renderOrderStep(ctx) {
  const st = ctx.session?.order?.step;

  if (st === 'name') {
    return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbName());
  }
  if (st === 'phone') {
    return ctx.reply('Шаг 2/6. Номер телефона (или нажмите «📱 Отправить мой контакт»):', kbPhone());
  }
  if (st === 'fio') {
    return ctx.reply('Шаг 3/6. Фамилия/Имя/Отчество усопшего:', kbDefaultWithBack());
  }
  if (st === 'dates') {
    return ctx.reply(
      'Шаг 4/6. Дата рождения — Дата смерти (в формате DD.MM.YYYY - DD.MM.YYYY). Например: 12.03.1950 - 05.11.2020',
      kbDefaultWithBack()
    );
  }
  if (st === 'photos') {
    return ctx.reply('Шаг 5/6. Прикрепите фото. Когда закончите — нажмите «Далее».', kbPhotos());
  }
  if (st === 'comment') {
    return ctx.reply('Шаг 6/6. Комментарий или дополнительный способ связи (по желанию):', kbComment());
  }
  if (st === 'review') {
    // review рендерится отдельной функцией stepReview()
    return stepReview(ctx);
  }

  // fallback
  ctx.session.order.step = 'name';
  return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbName());
}

async function stepBack(ctx) {
  const s = ctx.session?.order;
  if (!s?.step) return;

  const order = getOrderStepOrder();
  const idx = order.indexOf(s.step);
  if (idx <= 0) {
    s.step = 'name';
    return renderOrderStep(ctx);
  }

  s.step = order[idx - 1];
  return renderOrderStep(ctx);
}


async function startOrder(ctx, sourceToken) {
  ctx.session.order = { step: 'name', photos: [], ...(sourceToken ? { sourceToken } : {}) };
  return renderOrderStep(ctx);
}

async function stepPhone(ctx) {
  ctx.session.order.step = 'phone';
  return renderOrderStep(ctx);
}

async function stepFio(ctx) {
  ctx.session.order.step = 'fio';
  return renderOrderStep(ctx);
}

async function stepDates(ctx) {
  ctx.session.order.step = 'dates';
  return renderOrderStep(ctx);
}

async function stepPhotos(ctx) {
  ctx.session.order.step = 'photos';
  return renderOrderStep(ctx);
}

async function stepComment(ctx) {
  ctx.session.order.step = 'comment';
  return renderOrderStep(ctx);
}


  s.step = prev;

  if (prev === 'name') return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbInput());
  if (prev === 'phone') return ctx.reply('Шаг 2/6. Номер телефона (или нажмите «📱 Отправить мой контакт»):', kbPhone());
  if (prev === 'fio') return ctx.reply('Шаг 3/6. Фамилия/Имя/Отчество усопшего:', kbInput());
  if (prev === 'dates')
    return ctx.reply(
      'Шаг 4/6. Дата рождения — Дата смерти (в формате DD.MM.YYYY - DD.MM.YYYY). Например: 12.03.1950 - 05.11.2020',
      kbInput()
    );
  if (prev === 'photos') return ctx.reply('Шаг 5/6. Прикрепите фото. Когда закончите — нажмите «Далее».', kbPhotos());
  if (prev === 'comment') return ctx.reply('Шаг 6/6. Комментарий или дополнительный способ связи (по желанию):', kbComment());
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
