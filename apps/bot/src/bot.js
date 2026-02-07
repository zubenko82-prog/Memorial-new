// apps/bot/src/bot.js
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf } from 'telegraf';

import { registerOrders } from './modules/orders.js';
import { registerPostWizard } from './modules/postWizard.js';

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
const DEEPLINK_PREFIX = process.env.DEEPLINK_PREFIX || 'order'; // /start order_<token>

const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'memorialDNR'; // публичный канал @memorialDNR

const HINT_TEXT =
  'Заполните необходимые поля и приложите фото — так мы быстрее согласуем детали и начнём изготовление.';

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
const mem = new Map(); // sessions fallback
const memCatalogPosts = new Map(); // fallback storage for catalogpost:<messageId> -> meta
const memPostMeta = new Map(); // fallback storage for postmeta:<sourceToken> -> meta

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

// ---------- sessions ----------
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

// ---------- post meta (sourceToken -> {text, messageId}) ----------
async function setPostMeta(sourceToken, meta) {
  const key = `postmeta:${sourceToken}`;
  const r = await getRedis();
  if (r) {
    await r.set(key, meta, { ex: 60 * 60 * 24 * 14 }); // 14 дней
  } else {
    memPostMeta.set(key, meta);
  }
}
async function getPostMeta(sourceToken) {
  const key = `postmeta:${sourceToken}`;
  const r = await getRedis();
  if (r) return (await r.get(key)) || null;
  return memPostMeta.get(key) || null;
}

// ---------- catalog post meta (for price update) ----------
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

// Публичный канал: ссылка вида https://t.me/<username>/<message_id>
function makePostLink(_absChatId, messageId) {
  if (!messageId) return '';
  return `https://t.me/${CHANNEL_USERNAME}/${messageId}`;
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

  registerOrders(bot, {
    HINT_TEXT,
    DEEPLINK_PREFIX,
    phoneOk,
    makeOrderNo,
    makePostLink,
    MANAGER_CHAT_ID,
    CHANNEL_USERNAME,
    WEBAPP_URL,
    getPostMeta,
  });

  registerPostWizard(bot, {
    HINT_TEXT,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    CATALOG_XLSX_PATH,
    getChannelId,
    isAdmin,

    // meta for deep-link -> post url/text
    setPostMeta,
    CHANNEL_USERNAME,

    // storage for update prices:
    setCatalogPostMeta,
    getCatalogPostMeta,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    setCatalogPostMetaByKey,
  });

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

  bot.catch((err) => console.error('[bot] error:', err));
} else {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
}

export default bot;
