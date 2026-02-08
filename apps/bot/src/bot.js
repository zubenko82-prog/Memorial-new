// apps/bot/src/bot.js
import { Telegraf, session } from 'telegraf';
import { kv } from '@vercel/kv';

import { registerOrders } from './modules/orders.js';
import { registerPostWizard, loadCatalogFromXlsx } from './modules/postWizard.js';

// --------- ENV ---------
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID_RAW = process.env.CHANNEL_ID;
const MANAGER_CHAT_ID_RAW = process.env.MANAGER_CHAT_ID;
const WEBAPP_URL = process.env.WEBAPP_URL;
const DEEPLINK_PREFIX = process.env.DEEPLINK_PREFIX || 'src';
const CATALOG_XLSX_PATH = process.env.CATALOG_XLSX_PATH || './catalog.xlsx';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '';

// логируем MANAGER_CHAT_ID
console.log('[env] MANAGER_CHAT_ID raw =', MANAGER_CHAT_ID_RAW);
const MANAGER_CHAT_ID = MANAGER_CHAT_ID_RAW ? Number(MANAGER_CHAT_ID_RAW) : null;
console.log('[env] MANAGER_CHAT_ID parsed =', MANAGER_CHAT_ID);

// канал
const getChannelId = () => {
  if (!CHANNEL_ID_RAW) return null;
  const n = Number(CHANNEL_ID_RAW);
  return Number.isFinite(n) ? n : CHANNEL_ID_RAW;
};

// простая проверка админа
function isAdmin(ctx) {
  const adminIdRaw = process.env.ADMIN_TG_ID;
  if (!adminIdRaw) return false;
  const adminId = Number(adminIdRaw);
  return ctx.from && Number(ctx.from.id) === adminId;
}

// ---------- KV helper-ы (на базе @vercel/kv) ----------
// Важно: больше НЕ импортируем @upstash/redis, всё через kv.*

const memPostMeta = new Map();
const memCatalogPosts = new Map();

// postmeta:<sourceToken>
async function setPostMeta(sourceToken, meta) {
  const key = `postmeta:${sourceToken}`;
  try {
    await kv.set(key, meta);
  } catch (e) {
    console.warn('[bot] setPostMeta kv error, fallback to memory:', e?.message || e);
    memPostMeta.set(key, meta);
  }
}

async function getPostMeta(sourceToken) {
  const key = `postmeta:${sourceToken}`;
  try {
    const v = await kv.get(key);
    if (v) return v;
  } catch (e) {
    console.warn('[bot] getPostMeta kv error, fallback to memory:', e?.message || e);
  }
  return memPostMeta.get(key) || null;
}

// catalogpost:<messageId>
async function setCatalogPostMeta(messageId, meta) {
  const key = `catalogpost:${messageId}`;
  try {
    await kv.set(key, meta);
  } catch (e) {
    console.warn('[bot] setCatalogPostMeta kv error, fallback to memory:', e?.message || e);
    memCatalogPosts.set(key, meta);
  }
}

async function getCatalogPostMeta(messageId) {
  const key = `catalogpost:${messageId}`;
  try {
    const v = await kv.get(key);
    if (v) return v;
  } catch (e) {
    console.warn('[bot] getCatalogPostMeta kv error, fallback to memory:', e?.message || e);
  }
  return memCatalogPosts.get(key) || null;
}

async function setCatalogPostMetaByKey(key, meta) {
  try {
    await kv.set(key, meta);
  } catch (e) {
    console.warn('[bot] setCatalogPostMetaByKey kv error, fallback to memory:', e?.message || e);
    memCatalogPosts.set(key, meta);
  }
}

async function getCatalogPostMetaByKey(key) {
  try {
    const v = await kv.get(key);
    if (v) return v;
  } catch (e) {
    console.warn('[bot] getCatalogPostMetaByKey kv error, fallback to memory:', e?.message || e);
  }
  return memCatalogPosts.get(key) || null;
}

async function getAllCatalogPostKeys() {
  try {
    // Vercel KV (Upstash Redis) поддерживает KEYS, но лучше использовать scan
    const keys = await kv.keys('catalogpost:*');
    return Array.isArray(keys) ? keys : [];
  } catch (e) {
    console.warn('[bot] getAllCatalogPostKeys kv error, fallback to memory:', e?.message || e);
    return Array.from(memCatalogPosts.keys());
  }
}

// ---------- прочие утилиты ----------

const HINT_TEXT =
  'Для заказа нажмите кнопку «Заказать» под постом или напишите нам в личные сообщения.';

function phoneOk(v) {
  const s = String(v || '').replace(/[^\d+]/g, '');
  const digits = s.replace(/[^\d]/g, '');
  return digits.length >= 6;
}

function makeOrderNo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rnd = Math.floor(Math.random() * 90 + 10);
  return `${date}-${time}-${rnd}`;
}

// absChatId (положительный) и messageId → permalink
function makePostLink(absChatId, messageId) {
  if (!CHANNEL_USERNAME || !messageId) return '';
  return `https://t.me/${CHANNEL_USERNAME}/${messageId}`;
}

// ---------- запуск бота ----------

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не задан');
  throw new Error('BOT_TOKEN not set');
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

registerOrders(bot, {
  HINT_TEXT,
  DEEPLINK_PREFIX,
  phoneOk,
  makeOrderNo,
  MANAGER_CHAT_ID,
  CHANNEL_USERNAME,
  WEBAPP_URL,
  getPostMeta,
  makePostLink,
});

registerPostWizard(bot, {
  HINT_TEXT,
  WEBAPP_URL,
  DEEPLINK_PREFIX,
  CATALOG_XLSX_PATH,
  getChannelId,
  isAdmin,
  setPostMeta,
  CHANNEL_USERNAME,
  setCatalogPostMeta,
  getCatalogPostKeys: getAllCatalogPostKeys, // если где-то нужно именно под этим именем
  getAllCatalogPostKeys,
  getCatalogPostMeta,
  getCatalogPostMetaByKey,
  setCatalogPostMetaByKey,
});

// глобальный лог обновлений (для отладки)
bot.on('message', (ctx, next) => {
  const msg = ctx.message || {};
  const fromId = msg.from?.id;
  const chatId = msg.chat?.id;
  const text = 'text' in msg ? msg.text : undefined;
  const hasPhoto = !!msg.photo?.length;
  console.log('[GLOBAL] update:', JSON.stringify({ text, hasPhoto, fromId, chatId }));
  return next();
});

export default async function handler(req, res) {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[bot] handler error', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
