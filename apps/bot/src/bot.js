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

// Путь к Excel рядом с ботом
const CATALOG_XLSX_PATH = resolve(__dirname, '../catalog.xlsx'); // /Memorial/apps/bot/catalog.xlsx

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

// Публикации памятников: message_id -> { selected, last_total_price, channel_id }
const memCatalogPosts = new Map();

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
    await r.set(key, meta, { ex: 60 * 60 * 24 * 365 }); // 1 год (можно увеличить)
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

// Инлайн-клавиатура для админа (обновление цены/тегов) + стандартные кнопки
function channelPostKbAdmin(botUsername, sourceToken, messageId) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = new URL(WEBAPP_URL).toString();
  return Markup.inlineKeyboard([
    [
      Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
      Markup.button.webApp('Подобрать памятник', webAppUrl),
    ],
    [Markup.button.callback('♻️ Обновить цену', `cupd:${messageId}`)],
  ]);
}

function channelPostKbAdminFallback(botUsername, sourceToken, messageId) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = new URL(WEBAPP_URL).toString();
  return Markup.inlineKeyboard([
    [Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`)],
    [Markup.button.url('Подобрать памятник', webAppUrl)],
    [Markup.button.callback('♻️ Обновить цену', `cupd:${messageId}`)],
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

// ---------------- Catalog (Excel) helpers ----------------
async function loadCatalogFromXlsx() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CATALOG_XLSX_PATH);

  const wsCat = wb.getWorksheet('Каталог');
  if (!wsCat) throw new Error('В catalog.xlsx отсутствует лист "Каталог".');

  const header = wsCat.getRow(1).values; // 1-based
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
      group: String(row.getCell(idxGroup).value || '').trim(),
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
  // selected: { STELA: 'sku', TUMBA:'sku', CVETNIK?:'sku', PLITA?:'sku', WORK?:'sku', OPTION?:['sku'], GRAFIKA?:['sku'] }
  const res = [];
  for (const v of Object.values(selected || {})) {
    if (!v) continue;
    if (Array.isArray(v)) res.push(...v);
    else res.push(v);
  }
  // уникализация, но порядок сохраняем
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

  // Теги строго по вашим правилам:
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

  // Уникализация тегов (на всякий)
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

// ---------------- Publish wizard ----------------
const WZ = {
  // шаги мастера (соответствуют group в Excel)
  steps: [
    { key: 'STELA', title: 'Выберите стелу', mode: 'single', required: true },
    { key: 'TUMBA', title: 'Выберите тумбу', mode: 'single', required: true },
    { key: 'CVETNIK', title: 'Цветник (можно пропустить)', mode: 'single', required: false },
    { key: 'PLITA', title: 'Надгробная плита (можно пропустить)', mode: 'single', required: false },
    { key: 'WORK', title: 'Работа (резная/фрезерная, можно пропустить)', mode: 'single', required: false },
    { key: 'OPTION', title: 'Опции (портрет/метрика)', mode: 'multi', required: false },
    { key: 'GRAFIKA', title: 'Графика (можно несколько)', mode: 'multi', required: false },
  ],
};

function isAdmin(ctx) {
  const uid = ctx.from?.id;
  return uid && BOT_ADMINS.includes(uid);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildWizardKeyboard(items, step, selected) {
  const rows = [];

  if (step.mode === 'single') {
    const buttons = items.map((it) => {
      const picked = selected?.[step.key] === it.sku;
      const title = `${picked ? '✅ ' : ''}${it.label}${Number.isFinite(it.price) ? ` (${formatRub(it.price)}₽)` : ''}`;
      return Markup.button.callback(title, `wz:pick:${step.key}:${it.sku}`);
    });

    for (const r of chunk(buttons, 2)) rows.push(r);

    if (!step.required) {
      const nonePicked = !selected?.[step.key];
      rows.push([Markup.button.callback(`${nonePicked ? '✅ ' : ''}— Нет —`, `wz:none:${step.key}`)]);
    }
  } else {
    // multi
    const arr = Array.isArray(selected?.[step.key]) ? selected[step.key] : [];
    const set = new Set(arr);
    const buttons = items.map((it) => {
      const picked = set.has(it.sku);
      const title = `${picked ? '✅ ' : ''}${it.label}${Number.isFinite(it.price) ? ` (${formatRub(it.price)}₽)` : ''}`;
      return Markup.button.callback(title, `wz:toggle:${step.key}:${it.sku}`);
    });
    for (const r of chunk(buttons, 2)) rows.push(r);
  }

  // навигация
  const nav = [];
  nav.push(Markup.button.callback('⬅️ Назад', 'wz:back'));
  nav.push(Markup.button.callback('Далее ➡️', 'wz:next'));
  rows.push(nav);
  rows.push([Markup.button.callback('❌ Отмена', 'wz:cancel')]);

  return Markup.inlineKeyboard(rows);
}

async function wizardStart(ctx, baseTextNoHint, mediaPayload) {
  // mediaPayload: { kind:'photo'|'video'|'document'|'text', fileId?, text? }
  ctx.session.publish = {
    stepIndex: 0,
    selected: {},
    baseTextNoHint: baseTextNoHint || '',
    mediaPayload,
  };
  await wizardRenderStep(ctx);
}

async function wizardRenderStep(ctx) {
  const pub = ctx.session.publish;
  if (!pub) return;

  const { items } = await loadCatalogFromXlsx();
  const step = WZ.steps[pub.stepIndex];
  const stepItems = items.filter((it) => String(it.group).toUpperCase() === step.key);

  // отдельное сообщение, чтобы не конфликтовать с reply-клавиатурами анкеты
  const kb = buildWizardKeyboard(stepItems, step, pub.selected);
  const hint = pub.baseTextNoHint ? `Текст к посту:\n${pub.baseTextNoHint}\n\n` : '';
  await ctx.reply(`${hint}${step.title}:`, kb);
}

async function wizardPreview(ctx) {
  const pub = ctx.session.publish;
  if (!pub) return;

  const catalog = await loadCatalogFromXlsx();
  const { caption, total } = calcCaptionAndTags(catalog, pub.selected);

  const baseText = (pub.baseTextNoHint || '').trim();
  const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Опубликовать', 'wz:publish')],
    [Markup.button.callback('⬅️ Назад', 'wz:back')],
    [Markup.button.callback('❌ Отмена', 'wz:cancel')],
  ]);

  await ctx.reply(`Предпросмотр:\n\n${fullCaption}\n\n(Итог: ${formatRub(total)} ₽)`, kb);
}

async function wizardCancel(ctx, text = 'Публикация отменена.') {
  ctx.session.publish = null;
  await ctx.reply(text);
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

  // ========= /post (АДМИН): теперь запускает мастер (Excel) и публикует в канал =========
  bot.command('post', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
      if (!BOT_ADMINS.includes(ctx.from.id)) return ctx.reply('Недостаточно прав.');

      // блокируем пересечение с анкетой
      if (ctx.session?.order) {
        return ctx.reply('Сейчас у вас активна анкета. Завершите или отмените её командой /cancel, затем публикуйте /post.');
      }

      const raw = ctx.message?.text || '';
      const base = raw.replace(/^\/post(@\S+)?\s*/i, '').trim(); // исходный текст поста (без подсказки)

      const r = ctx.message?.reply_to_message;

      // Фото / видео / документ (поддержим, как было)
      if (r?.photo?.length) {
        const fileId = r.photo.at(-1).file_id;
        await wizardStart(ctx, base, { kind: 'photo', fileId });
        return;
      }
      if (r?.video) {
        await wizardStart(ctx, base, { kind: 'video', fileId: r.video.file_id });
        return;
      }
      if (r?.document) {
        await wizardStart(ctx, base, { kind: 'document', fileId: r.document.file_id });
        return;
      }

      // Текстовый пост без медиа — тоже можно, но мастер всё равно нужен (цена/теги)
      if (!base) {
        return ctx.reply('Ответьте /post на фото/видео/документ или добавьте текст после /post.');
      }
      await wizardStart(ctx, base, { kind: 'text', text: '' });
    } catch (e) {
      console.error('[bot]/post wizard start error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(`Ошибка запуска мастера публикации: ${desc}`);
    }
  });

  // ========= Wizard actions =========
  bot.action(/^wz:pick:(\w+):(.+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');
      const pub = ctx.session.publish;
      if (!pub) return ctx.answerCbQuery('Мастер не активен.');

      const [, stepKey, sku] = ctx.match;
      pub.selected[stepKey] = sku;

      await ctx.answerCbQuery('Выбрано');
      return wizardRenderStep(ctx);
    } catch (e) {
      console.error('[bot] wz:pick error:', e);
      return ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(/^wz:none:(\w+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');
      const pub = ctx.session.publish;
      if (!pub) return ctx.answerCbQuery('Мастер не активен.');
      const [, stepKey] = ctx.match;
      delete pub.selected[stepKey];
      await ctx.answerCbQuery('Ок');
      return wizardRenderStep(ctx);
    } catch (e) {
      console.error('[bot] wz:none error:', e);
      return ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action(/^wz:toggle:(\w+):(.+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');
      const pub = ctx.session.publish;
      if (!pub) return ctx.answerCbQuery('Мастер не активен.');

      const [, stepKey, sku] = ctx.match;
      const arr = Array.isArray(pub.selected[stepKey]) ? pub.selected[stepKey] : [];
      const idx = arr.indexOf(sku);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(sku);
      pub.selected[stepKey] = arr;

      await ctx.answerCbQuery('Ок');
      return wizardRenderStep(ctx);
    } catch (e) {
      console.error('[bot] wz:toggle error:', e);
      return ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action('wz:back', async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');
      const pub = ctx.session.publish;
      if (!pub) return ctx.answerCbQuery('Мастер не активен.');
      pub.stepIndex = Math.max(0, Number(pub.stepIndex || 0) - 1);
      await ctx.answerCbQuery('Назад');
      return wizardRenderStep(ctx);
    } catch (e) {
      console.error('[bot] wz:back error:', e);
      return ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action('wz:next', async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');
      const pub = ctx.session.publish;
      if (!pub) return ctx.answerCbQuery('Мастер не активен.');

      const step = WZ.steps[pub.stepIndex];

      // валидация обязательных
      if (step.required && !pub.selected[step.key]) {
        await ctx.answerCbQuery('Нужно выбрать вариант');
        return;
      }

      const nextIndex = Number(pub.stepIndex || 0) + 1;
      if (nextIndex >= WZ.steps.length) {
        await ctx.answerCbQuery('Ок');
        return wizardPreview(ctx);
      }
      pub.stepIndex = nextIndex;
      await ctx.answerCbQuery('Ок');
      return wizardRenderStep(ctx);
    } catch (e) {
      console.error('[bot] wz:next error:', e);
      return ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action('wz:cancel', async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');
      await ctx.answerCbQuery('Отмена');
      return wizardCancel(ctx);
    } catch (e) {
      console.error('[bot] wz:cancel error:', e);
      return ctx.answerCbQuery('Ошибка');
    }
  });

  bot.action('wz:publish', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.answerCbQuery('CHANNEL_ID не задан');
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');

      const pub = ctx.session.publish;
      if (!pub) return ctx.answerCbQuery('Мастер не активен.');

      // финальная валидация обязательных шагов
      for (const st of WZ.steps) {
        if (st.required && !pub.selected[st.key]) {
          await ctx.answerCbQuery(`Нужно выбрать: ${st.key}`);
          return;
        }
      }

      const catalog = await loadCatalogFromXlsx();
      const { caption, total } = calcCaptionAndTags(catalog, pub.selected);

      const baseText = (pub.baseTextNoHint || '').trim();
      const finalCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

      const me = ctx.botInfo || (await ctx.telegram.getMe());
      const botUsername = me.username;

      // Создаем sourceToken и отправляем пост так, чтобы сохранилась старая логика deep-link и webapp
      const sourceToken = makeSourceToken();

      // Пытаемся поставить клавиатуру с web_app; если нельзя — fallback
      const kbFull = channelPostKbAdmin(botUsername, sourceToken, 0).reply_markup; // messageId подставим после
      const kbFallback = channelPostKbAdminFallback(botUsername, sourceToken, 0).reply_markup;

      const sendCommon = async ({ reply_markup }) => {
        const kind = pub.mediaPayload?.kind;
        if (kind === 'photo') {
          return await ctx.telegram.sendPhoto(channelId, pub.mediaPayload.fileId, {
            caption: finalCaption.slice(0, 1024),
            reply_markup,
          });
        }
        if (kind === 'video') {
          return await ctx.telegram.sendVideo(channelId, pub.mediaPayload.fileId, {
            caption: finalCaption.slice(0, 1024),
            reply_markup,
          });
        }
        if (kind === 'document') {
          const canCaption = finalCaption.length <= 1024 ? finalCaption : undefined;
          return await ctx.telegram.sendDocument(channelId, pub.mediaPayload.fileId, {
            caption: canCaption,
            reply_markup,
          });
        }
        // text
        return await ctx.telegram.sendMessage(channelId, finalCaption, {
          reply_markup,
          disable_web_page_preview: true,
        });
      };

      const isWebAppIssue = (desc) =>
        /BUTTON_TYPE_INVALID/i.test(desc) || /web_app/i.test(desc) || /domain/i.test(desc) || /not allowed/i.test(desc);

      let msg;
      try {
        msg = await sendCommon({ reply_markup: kbFull });
      } catch (e) {
        const desc = e?.response?.description || e?.message || String(e);
        if (isWebAppIssue(desc)) msg = await sendCommon({ reply_markup: kbFallback });
        else throw e;
      }

      // ВАЖНО: теперь нужно поправить callback-data на реальный message_id
      // (проще — второй editMessageReplyMarkup с правильной клавиатурой)
      const kbFinalFull = channelPostKbAdmin(botUsername, sourceToken, msg.message_id).reply_markup;
      const kbFinalFallback = channelPostKbAdminFallback(botUsername, sourceToken, msg.message_id).reply_markup;

      try {
        await ctx.telegram.editMessageReplyMarkup(channelId, msg.message_id, undefined, kbFinalFull);
      } catch {
        try {
          await ctx.telegram.editMessageReplyMarkup(channelId, msg.message_id, undefined, kbFinalFallback);
        } catch {}
      }

      // сохраняем мету поста для анкеты (по sourceToken) как раньше
      const abs = Math.abs(Number(msg.chat.id));
      await setPostMeta(sourceToken, { text: baseText || '', absChatId: abs, messageId: msg.message_id });

      // сохраняем мету для обновления цены
      await setCatalogPostMeta(msg.message_id, {
        channel_id: channelId,
        selected: pub.selected,
        last_total_price: total,
        createdAt: Date.now(),
      });

      ctx.session.publish = null;

      await ctx.answerCbQuery('Опубликовано');
      return ctx.reply(`Пост опубликован.\nmessage_id: ${msg.message_id}`);
    } catch (e) {
      console.error('[bot] wz:publish error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      try {
        await ctx.answerCbQuery('Ошибка');
      } catch {}
      return ctx.reply(`Ошибка публикации: ${desc}`);
    }
  });

  // ========= Обновление цены/тегов (кнопка под постом канала) =========
  bot.action(/^cupd:(\d+)$/, async (ctx) => {
    try {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('Недостаточно прав.');

      const channelId = getChannelId();
      if (!channelId) return ctx.answerCbQuery('CHANNEL_ID не задан');

      const messageId = Number(ctx.match[1]);
      const meta = await getCatalogPostMeta(messageId);
      if (!meta?.selected) return ctx.answerCbQuery('Нет данных для обновления');

      const catalog = await loadCatalogFromXlsx();
      const { caption, total } = calcCaptionAndTags(catalog, meta.selected);

      // ВАЖНО: мы не знаем исходный baseText/HINT_TEXT внутри caption канального сообщения.
      // Поэтому обновляем только строку с ценой/тегами в простом формате:
      // Чтобы было стабильнее, будем заменять caption целиком на: "Цена...\nтеги\n\nHINT_TEXT"
      // (Если вы хотите сохранять baseText — его тоже нужно хранить в meta при публикации)
      const newCaption = `${caption}\n\n${HINT_TEXT}`.slice(0, 1024);

      await ctx.telegram.editMessageCaption(channelId, messageId, undefined, newCaption);

      await setCatalogPostMeta(messageId, {
        ...meta,
        last_total_price: total,
        updatedAt: Date.now(),
      });

      return ctx.answerCbQuery('Обновлено');
    } catch (e) {
      console.error('[bot] cupd error:', e);
      const desc = e?.response?.description || e?.message || 'Ошибка';
      try {
        return ctx.answerCbQuery(`Ошибка: ${desc}`.slice(0, 200));
      } catch {
        return;
      }
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
