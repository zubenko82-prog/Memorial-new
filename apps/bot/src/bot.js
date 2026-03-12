// apps/bot/src/bot.js
import { resolve, dirname as pathDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { Telegraf } from 'telegraf';

import { registerFilterMenu } from './modules/filterMenu.js';
import { registerOrders } from './modules/orders.js';
import { registerPostWizard, loadCatalogFromXlsx, calcCaptionAndTags } from './modules/postWizard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// .env локально; на Vercel переменные задаются в Settings
if (!process.env.VERCEL) {
  try {
    dotenv.config({ path: resolve(__dirname, '../../../.env') });
  } catch {}
}

// ---------------- ENV ----------------
console.log('[env] MANAGER_CHAT_ID raw =', process.env.MANAGER_CHAT_ID);

const token = process.env.TGBOT_TOKEN ?? '';
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID ? Number(process.env.MANAGER_CHAT_ID) : 0;
const CHANNEL_ID_RAW = process.env.CHANNEL_ID || ''; // -100… или @username
const BOT_ADMINS = (process.env.BOT_ADMINS || '')
  .split(',')
  .map((s) => Number(String(s).trim()))
  .filter(Boolean);

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://memorial-web-five.vercel.app/';
const DEEPLINK_PREFIX = process.env.DEEPLINK_PREFIX || 'order'; // /start order_<token>
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'memorialDNR';

console.log('[env] MANAGER_CHAT_ID parsed =', MANAGER_CHAT_ID);

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
let redisInstance;
const mem = new Map();
const memCatalogPosts = new Map();
const memPostMeta = new Map();

async function getRedis() {
  if (redisInstance !== undefined) return redisInstance;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[bot] UPSTASH_REDIS_* not set, using in-memory storage');
    redisInstance = null;
    return redisInstance;
  }
  try {
    const mod = await import('@upstash/redis');
    redisInstance = new mod.Redis({ url, token });
    console.log('[bot] Upstash Redis connected');
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
    await r.set(`sess:${userId}`, data, { ex: 60 * 60 * 24 });
  } else {
    mem.set(userId, data);
  }
}

// ---------- post meta ----------
async function setPostMeta(sourceToken, meta) {
  const key = `postmeta:${sourceToken}`;
  const r = await getRedis();
  if (r) await r.set(key, meta, { ex: 60 * 60 * 24 * 365 });
  else memPostMeta.set(key, meta);
}
async function getPostMeta(sourceToken) {
  const key = `postmeta:${sourceToken}`;
  const r = await getRedis();
  if (r) return (await r.get(key)) || null;
  return memPostMeta.get(key) || null;
}

// ---------- catalog post meta ----------
async function setCatalogPostMeta(messageId, meta) {
  const key = `catalogpost:${messageId}`;
  const r = await getRedis();
  if (r) await r.set(key, meta, { ex: 60 * 60 * 24 * 365 });
  else memCatalogPosts.set(key, meta);
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
  if (r) await r.set(key, meta, { ex: 60 * 60 * 24 * 365 });
  else memCatalogPosts.set(key, meta);
}
async function deleteCatalogPostMetaByKey(key) {
  const r = await getRedis();
  if (r) {
    if (typeof r.del === 'function') await r.del(key);
    else if (typeof r.delete === 'function') await r.delete(key);
    else await r.set(key, null, { ex: 1 });
  } else {
    memCatalogPosts.delete(key);
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

function makePostLink(absChatId, messageId) {
  if (!messageId) return '';
  if (CHANNEL_USERNAME) return `https://t.me/${CHANNEL_USERNAME}/${messageId}`;
  if (absChatId) return `https://t.me/c/${absChatId}/${messageId}`;
  return '';
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

  const filterApi = registerFilterMenu(bot, {
    CHANNEL_USERNAME,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    loadCatalogFromXlsx,
    CATALOG_XLSX_PATH,
    calcCaptionAndTags,
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
    loadCatalogFromXlsx,
    showFilterMenu: filterApi.showFilterMenu,
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
    getCatalogPostMeta,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    setCatalogPostMetaByKey,
    deleteCatalogPostMetaByKey,
  });

  bot.catch((err) => console.error('[bot] error:', err));
} else {
  console.error('[bot] Missing TGBOT_TOKEN in environment');
}

export default bot;