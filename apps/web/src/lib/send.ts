// src/lib/send.ts
// Надёжная отправка заказа: выбираем корректный эндпойнт и даём понятные ошибки.

export type Extras = Record<string, any>;

type SendResult = { ok: boolean; id?: string; message?: string };

function pickBaseOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  // Fallback для SSR
  return "";
}

/**
 * Возвращает список кандидатов-эндпойнтов для отправки.
 * Приоритеты:
 * 1) NEXT_PUBLIC_SEND_ENDPOINT (абсолютный URL или путь)
 * 2) NEXT_PUBLIC_API_BASE + /api/send-order
 * 3) origin + /api/send-order
 * 4) origin + /api/send
 * 5) origin + /api/order
 * 6) (для Netlify) origin + /.netlify/functions/send-order
 */
function resolveCandidateEndpoints(): string[] {
  const fromEnv = (process.env as any)?.NEXT_PUBLIC_SEND_ENDPOINT as string | undefined;
  const apiBase = (process.env as any)?.NEXT_PUBLIC_API_BASE as string | undefined;
  const origin = pickBaseOrigin();

  const list: string[] = [];

  if (fromEnv && fromEnv.trim()) {
    list.push(fromEnv.trim());
  }

  if (apiBase && apiBase.trim()) {
    const base = apiBase.replace(/\/+$/, "");
    list.push(`${base}/api/send-order`);
  }

  if (origin) {
    const base = origin.replace(/\/+$/, "");
    list.push(
      `${base}/api/send-order`,
      `${base}/api/send`,
      `${base}/api/order`,
      `${base}/.netlify/functions/send-order`
    );
  }

  // Уникализируем
  return Array.from(new Set(list));
}

async function postJson(url: string, payload: any): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Если бек ожидает ключ/токен — добавьте здесь:
      // "Authorization": `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN}`
    },
    body: JSON.stringify(payload),
    credentials: "same-origin",
  });
}

/**
 * Отправка заказа: пробуем несколько эндпойнтов до первого успешного.
 * Бросает Error с понятным сообщением при неуспехе.
 */
export async function sendOrderEmailAndNotifyTg(extras: Extras): Promise<void> {
  const candidates = resolveCandidateEndpoints();
  if (candidates.length === 0) {
    throw new Error("Не настроен URL для отправки заказа (NEXT_PUBLIC_SEND_ENDPOINT или API route).");
  }

  // Минимальная валидация — можно расширить по требованиям бэка
  const payload = {
    type: "memorial-order",
    createdAt: Date.now(),
    extras, // весь объект, как есть
  };

  let lastErr: unknown = null;

  for (const endpoint of candidates) {
    try {
      const res = await postJson(endpoint, payload);
      const text = await res.text().catch(() => "");
      const contentType = res.headers.get("content-type") || "";
      const maybeJson = contentType.includes("application/json");
      const data: SendResult | null = maybeJson ? (safeParseJSON(text) as any) : null;

      if (res.ok) {
        // Успех — выходим
        return;
      }

      // Неуспех — сформируем понятную ошибку
      const label = `[${res.status}] ${res.statusText || ""}`.trim();
      const details = (data?.message || text || "").toString().slice(0, 500);
      throw new Error(`Запрос на ${endpoint} завершился с ошибкой ${label}${details ? `: ${details}` : ""}`);
    } catch (e) {
      lastErr = e;
      // Пробуем следующий эндпойнт
      continue;
    }
  }

  // Если ни один не сработал — бросаем последнюю ошибку
  const msg =
    (lastErr as any)?.message ||
    "Не удалось отправить заказ: все доступные эндпойнты недоступны или отвечают ошибкой.";
  throw new Error(msg);
}

function safeParseJSON(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
