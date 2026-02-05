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
const memCatalogPosts = new Map(); // фолбэк для message_id -> meta

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
    await r.set(`sess:${userId}`, data, { ex: 60 * 60 * 24 });
  } else {
    mem.set(userId, data);
  }
}

// ---- Посты: храним по sourceToken => {text, absChatId, messageId} ----
async function setPostMeta(sourceToken, meta) {
  const key = `post:${sourceToken}`;
  const r = await getRedis();
  if (r) {
    await r.set(key, meta, { ex: 60 * 60 * 24 * 14 });
  } else {
    memPosts.set(key, meta);
  }
}
async function getPostMeta(sourceToken) {
  const key = `post:${sourceToken}`;
  const r = await getRedis();
  if (r) return (await r.get(key)) || null;
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
  if (r) return (await r.get(key)) || null;
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

function makeSourceToken() {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makePostLink(absChatId, messageId) {
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
      await ctx.telegram.sendMessage(MANAGER_CHAT_ID, `Дополнительные фото (${photos.length - 10} шт.) пользователь отправит отдельно.`);
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

// Отправка поста в канал: сначала без клавиатуры (чтобы появился "Прокомментировать"),
// потом добавляем reply_markup editMessageReplyMarkup.
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
    /BUTTON_TYPE_INVALID/i.test(desc) ||
    /web_app/i.test(desc) ||
    /domain/i.test(desc) ||
    /not allowed/i.test(desc) ||
    /BUTTON_URL_INVALID/i.test(desc);

  const trySendNoKb = async ({ useHtml }) => {
    const common = {
      ...(useHtml ? { parse_mode: 'HTML' } : {}),
    };
    if (kind === 'text') {
      return await ctx.telegram.sendMessage(chatId, payload.text, { ...common, disable_web_page_preview: true });
    }
    if (kind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, payload.fileId, { ...common, caption: (payload.caption || '').slice(0, 1024) });
    }
    if (kind === 'video') {
      return await ctx.telegram.sendVideo(chatId, payload.fileId, { ...common, caption: (payload.caption || '').slice(0, 1024) });
    }
    if (kind === 'document') {
      const canCaption = (payload.caption || '').length <= 1024 ? payload.caption : undefined;
      return await ctx.telegram.sendDocument(chatId, payload.fileId, { ...common, caption: canCaption });
    }
    throw new Error('Unknown kind');
  };

  let msg;
  try {
    msg = await trySendNoKb({ useHtml: true });
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);
    if (isHtmlIssue(desc)) msg = await trySendNoKb({ useHtml: false });
    else throw e;
  }

  // ставим клавиатуру отдельным edit (fallback если web_app запрещен)
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
  await setPostMeta(sourceToken, { text: baseTextNoHint || '', absChatId: abs, messageId: msg.message_id });

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

  return { items };
}

function formatRub(n) {
  const s = Math.round(Number(n) || 0).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

// Хештеги в посте УБРАНЫ: только цена
function calcCaptionAndTags({ items }, selected) {
  const skuList = normalizeSelectedToSkuList(selected);
  const bySku = new Map(items.map((it) => [it.sku, it]));
  let total = 0;
  for (const sku of skuList) total += Number(bySku.get(sku)?.price || 0);
  return { total, caption: `Цена: ${formatRub(total)} ₽` };
}

function isAdmin(ctx) {
  const uid = ctx.from?.id;
  return uid && BOT_ADMINS.includes(uid);
}

// ---------------- BOT ----------------
let bot = null;

if (token) {
  bot = new Telegraf(token);

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
          WORK: null, // на этом шаге будут "Резная/Фрезерная (цена)"
          OPTION: [], // портрет/метрика (мульти)
          GRAFIKA: [], // графика (мульти), 4 варианта
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

  bot.hears('♻️ Обновить цены', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'update_prices';
    await ctx.reply(
      'Обновление цен постов:\n\n1) Перешлите сюда пост из канала, который нужно обновить, и я обновлю цену.\n\nИли нажмите «Обновить все».',
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
      return ctx.reply('Нет сохраненных данных о постах для обновления.');
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

    await ctx.reply(`Готово.\nОбновлено: ${updated}\nБез изменений: ${skipped}\nОшибок: ${errors}`, kbPostMenu());
    ctx.session.postWizard.step = 'menu';
  });

  bot.hears('🧾 Обновить по пересланному посту', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices') return;

    ctx.session.postWizard.step = 'update_wait_forward';
    await ctx.reply('Перешлите сюда сообщение из канала (тот самый пост).', kbPostCancelOnly());
  });

  bot.hears('▶️ Новая публикация', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'STELA';
    await askPostWizardStep(ctx, 'STELA');
  });

  // ---------- ВАШЕ ТЗ ПО КНОПКАМ С ЦЕНОЙ ----------
  // На кнопках показываем только:
  // - для WORK: "Резная (цена)" / "Фрезерная (цена)" (по 4 каждой)
  // - для GRAFIKA: "Графика (цена)" (4 шт)
  // - для остальных: "<label> (цена)"
  function btnTextFor(it) {
    const p = formatRub(it.price);
    if (it.group === 'WORK') {
      const isRez = /резн/i.test(it.label);
      const isFrez = /фрез/i.test(it.label);
      if (isRez) return `Резная (${p}₽)`;
      if (isFrez) return `Фрезерная (${p}₽)`;
      return `${it.label} (${p}₽)`;
    }
    if (it.group === 'GRAFIKA') return `Графика (${p}₽)`;
    return `${it.label} (${p}₽)`;
  }

  async function askPostWizardStep(ctx, group) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const { items } = await loadCatalogFromXlsx();

    let list = items.filter((it) => it.group === group);

    // WORK: по 4 резных и 4 фрезерных
    if (group === 'WORK') {
      const rez = list.filter((x) => /резн/i.test(x.label)).slice(0, 4);
      const frez = list.filter((x) => /фрез/i.test(x.label)).slice(0, 4);
      const other = list.filter((x) => !/резн/i.test(x.label) && !/фрез/i.test(x.label));
      list = [...rez, ...frez, ...other].slice(0, 8); // строго 8 (4+4), остальные режем
    }

    // GRAFIKA: 4
    if (group === 'GRAFIKA') list = list.slice(0, 4);

    if (!list.length) return advancePostWizard(ctx);

    const buttons = list.map((it) => btnTextFor(it));

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    const optional = ['CVETNIK', 'PLITA', 'WORK'];
    if (optional.includes(group)) rows.push(['— Нет —']);

    rows.push(['⬅️ Назад']);
    rows.push(['Отменить']);

    const titleMap = {
      STELA: 'Выберите стелу:',
      TUMBA: 'Выберите тумбу:',
      CVETNIK: 'Цветник (или — Нет —):',
      PLITA: 'Плита (или — Нет —):',
      WORK: 'Работа (резная/фрезерная):',
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
    const fullCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

    wiz.step = 'CONFIRM';
    await ctx.reply(
      `Предпросмотр:\n\n${fullCaption}\n\nИтого: ${formatRub(total)}₽\n\nЕсли всё верно — нажмите «Опубликовать».`,
      Markup.keyboard([['Опубликовать'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  }

  // ---------- обработка сообщений мастера /post ----------
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
        await ctx.reply('Нет сохранённого состава для этого поста. Он должен быть опубликован через /post.', kbPostMenu());
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

    if (text === '⬅️ Назад') {
      // простой "назад": в меню
      ctx.session.postWizard.step = 'menu';
      await ctx.reply('Меню /post:', kbPostMenu());
      return;
    }

    if (wiz.step === 'menu') return;

    if (wiz.step === 'CONFIRM') {
      if (text !== 'Опубликовать') return;

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

        let primary;
        if (kind === 'photo') ({ primary } = await postToChannelWithKb(ctx, 'photo', { fileId: payload.fileId, caption: finalCaption }, baseText));
        else if (kind === 'video') ({ primary } = await postToChannelWithKb(ctx, 'video', { fileId: payload.fileId, caption: finalCaption }, baseText));
        else if (kind === 'document')
          ({ primary } = await postToChannelWithKb(ctx, 'document', { fileId: payload.fileId, caption: finalCaption }, baseText));
        else ({ primary } = await postToChannelWithKb(ctx, 'text', { text: finalCaption }, baseText));

        await setCatalogPostMeta(primary.message_id, {
          selected: wiz.selected,
          baseTextNoHint: baseText,
          last_total_price: total,
          createdAt: Date.now(),
        });

        ctx.session.postWizard = null;
        await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
        return;
      } catch (e) {
        console.error('[bot] publish error:', e);
        const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
        await ctx.reply(`Ошибка публикации: ${desc}`, kbPostMenu());
        ctx.session.postWizard.step = 'menu';
        return;
      }
    }

    if (wiz.step === 'OPTION' || wiz.step === 'GRAFIKA') {
      if (text === 'Далее') return advancePostWizard(ctx);
      if (text === 'Сбросить') {
        wiz.selected[wiz.step] = [];
        return askPostWizardStep(ctx, wiz.step);
      }

      const { items } = await loadCatalogFromXlsx();
      let list = items.filter((x) => x.group === wiz.step);
      if (wiz.step === 'GRAFIKA') list = list.slice(0, 4);

      const it = list.find((x) => btnTextFor(x) === text);
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
      let list = items.filter((x) => x.group === wiz.step);

      if (wiz.step === 'WORK') {
        const rez = list.filter((x) => /резн/i.test(x.label)).slice(0, 4);
        const frez = list.filter((x) => /фрез/i.test(x.label)).slice(0, 4);
        const other = list.filter((x) => !/резн/i.test(x.label) && !/фрез/i.test(x.label));
        list = [...rez, ...frez, ...other].slice(0, 8);
      }

      const it = list.find((x) => btnTextFor(x) === text);
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
  bot.hears('Далее', async (ctx) => {
    if (ctx.session?.order?.step === 'photos') return stepComment(ctx);
  });
  bot.hears('Продолжить', async (ctx) => {
    if (ctx.session?.order?.step === 'comment') return stepReview(ctx);
  });
  bot.hears('Отправить', async (ctx) => {
    if (ctx.session?.order?.step === 'review') return submitOrder(ctx);
  });

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
        if (!phoneOk(text)) return ctx.reply('Введите корректный номер телефона (минимум 6 цифр, можно с +).', kbInput());
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
