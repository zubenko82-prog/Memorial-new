// apps/bot/src/postMetaStore.js
import { kv } from '@vercel/kv';

// формируем ключ для хранения меты поста
function keyForPost(sourceToken) {
  return `post:${sourceToken}`;
}

/**
 * Сохранить мету поста по токену.
 *
 * sourceToken — строка из deeplink (`/start order_<sourceToken>`),
 * data — объект вида:
 * {
 *   text: string,          // текст поста без подсказки
 *   channelUsername: string | null,
 *   messageId: number,
 *   absChatId: number,
 *   mediaType: 'photo'|'video'|'document'|null,
 *   fileId: string | null
 * }
 */
export async function setPostMeta(sourceToken, data) {
  if (!sourceToken) throw new Error('setPostMeta: sourceToken is required');

  const key = keyForPost(sourceToken);
  // можно добавить TTL, например 365 дней:
  // await kv.set(key, data, { ex: 60 * 60 * 24 * 365 });
  await kv.set(key, data);
}

/**
 * Получить мету поста по токену.
 *
 * Возвращает тот же объект, который передавался в setPostMeta,
 * либо null, если ничего не найдено.
 */
export async function getPostMeta(sourceToken) {
  if (!sourceToken) return null;
  const key = keyForPost(sourceToken);
  const data = await kv.get(key);
  return data || null;
}
