// client/uploadMultipart.ts
// Клиентская загрузка файла в Vercel Blob через multipart API.
// Требуются серверные роуты:
//  - POST /api/blob-upload-url (инициализация multipart; возвращает partUrls, uploadId, pathname, partSize)
//  - POST /api/blob-upload-complete (завершение multipart; принимает { uploadId, pathname, parts[] })
//
// Использование:
//   const { url, pathname } = await uploadFileMultipart(file, {
//     name: `uploads/${Date.now()}-${file.name}`,
//     access: "public",
//     onProgress: ({ uploadedBytes, totalBytes }) => console.log(uploadedBytes, "/", totalBytes)
//   });
//   // url — публичная ссылка, готовая для отправки в Telegram
//
// Важно:
// - На сервер INIT должен требовать и получать: name, contentType (file.type), sizeBytes (file.size).

export type AccessMode = "public" | "private";

export type InitResponse = {
  ok: true;
  version: string;
  mode: "multipart";
  uploadId: string;
  pathname: string;
  partUrls: string[];
  partSize?: number;
  url: string | null;
} | {
  ok: false;
  version?: string;
  error: string;
  [k: string]: any;
};

export type CompleteResponse = {
  ok: true;
  version: string;
  url: string;
  pathname: string;
} | {
  ok: false;
  version?: string;
  error: string;
  [k: string]: any;
};

export type UploadMultipartOptions = {
  // Как будет называться файл в Blob-хранилище (путь):
  name?: string; // пример: "uploads/123.pdf"
  // Доступ к файлу. Для Telegram нужен "public":
  access?: AccessMode; // по умолчанию "public"
  // MIME файла. Обычно file.type
  contentType?: string;
  // Пользовательские endpoint'ы (если отличны от дефолтных):
  endpointInit?: string;      // по умолчанию "/api/blob-upload-url"
  endpointComplete?: string;  // по умолчанию "/api/blob-upload-complete"
  // Прогресс-колбэк: вызывается после загрузки каждой части
  onProgress?: (info: {
    uploadedBytes: number;
    totalBytes: number;
    partIndex: number;   // 0-based
    partsTotal: number;
  }) => void;
  // Возможность отмены
  signal?: AbortSignal;
  // Доп. заголовки к INIT/COMPLETE (если нужны аутентификация и т.п.)
  initHeaders?: Record<string, string>;
  completeHeaders?: Record<string, string>;
};

export type UploadResult = {
  url: string;          // финальный публичный URL
  pathname: string;     // путь в Blob
  uploadedBytes: number;
  totalBytes: number;
};

function sanitizePathName(input: string): string {
  // Убираем управ. символы и защищаем от случайных двойных слэшей
  const normalized = input.replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\\+/g, "/");
  // Запрещаем абсолютные пути
  return normalized.replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
}

async function fetchJson<T = any>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let txt = "";
  try { txt = await res.text(); } catch {}
  try {
    const json = txt ? JSON.parse(txt) : {};
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || res.statusText || "Request failed";
      throw new Error(`${msg} (${res.status})`);
    }
    return json as T;
  } catch (e) {
    if (!res.ok) {
      throw new Error(`${txt || res.statusText} (${res.status})`);
    }
    throw e;
  }
}

function getHeaderETag(headers: Headers): string {
  // Заголовки в fetch case-insensitive, но обойдём разные варианты
  return headers.get("etag") || headers.get("ETag") || headers.get("x-amz-etag") || "";
}

/**
 * Загружает файл в Vercel Blob через multipart:
 * 1) INIT — получает partUrls, uploadId, pathname, partSize
 * 2) PUT всех частей на pre-signed URLs
 * 3) COMPLETE — завершает multipart, возвращает финальный URL
 */
export async function uploadFileMultipart(file: File, opts: UploadMultipartOptions = {}): Promise<UploadResult> {
  const {
    name,
    access = "public",
    contentType = file.type || "application/octet-stream",
    endpointInit = "/api/blob-upload-url",
    endpointComplete = "/api/blob-upload-complete",
    onProgress,
    signal,
    initHeaders,
    completeHeaders
  } = opts;

  const safeName = sanitizePathName(name || `uploads/${Date.now()}-${file.name || "file.bin"}`);

  // 1) INIT
  const initPayload = {
    name: safeName,
    access,
    contentType,
    sizeBytes: file.size
  };

  const initResp = await fetchJson<InitResponse>(endpointInit, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(initHeaders || {})
    },
    body: JSON.stringify(initPayload),
    signal
  });

  if (!("ok" in initResp) || !initResp.ok) {
    const errorMsg = (initResp as any)?.error || "INIT failed";
    throw new Error(errorMsg);
  }

  const { uploadId, pathname, partUrls, partSize } = initResp as Extract<InitResponse, { ok: true }>;

  if (!Array.isArray(partUrls) || partUrls.length === 0) {
    throw new Error("INIT did not return part URLs");
  }

  // 2) PUT parts
  const parts: { partNumber: number; etag: string }[] = [];
  const totalParts = partUrls.length;
  const totalBytes = file.size;

  // Определяем размеры частей: при наличии partSize режем по нему; иначе делим равномерно
  const approxSize = !partSize || partSize <= 0 ? Math.ceil(totalBytes / totalParts) : partSize;

  let uploadedBytes = 0;

  for (let i = 0; i < totalParts; i++) {
    const start = i * approxSize;
    const end = Math.min(start + approxSize, totalBytes);
    const chunk = file.slice(start, end);

    const resp = await fetch(partUrls[i], {
      method: "PUT",
      headers: {
        "Content-Type": contentType
      },
      body: chunk,
      signal
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Ошибка загрузки части ${i + 1}/${totalParts}: ${resp.status} ${resp.statusText} ${t}`);
    }

    const etag = getHeaderETag(resp.headers);
    if (!etag) {
      // Некоторые окружения могут возвращать ETag в теле/без кавычек — но для S3-пресайна обязателен ETag в заголовке
      // Пробуем получить из тела, если вдруг API так настроен
      let bodyText = "";
      try { bodyText = await resp.text(); } catch {}
      const m = /"etag"\s*:\s*"([^"]+)"/i.exec(bodyText);
      const recovered = m ? m[1] : "";
      if (!recovered) {
        throw new Error(`Не получен ETag для части ${i + 1}. Невозможно завершить multipart.`);
      }
      parts.push({ partNumber: i + 1, etag: recovered });
    } else {
      parts.push({ partNumber: i + 1, etag });
    }

    uploadedBytes = end;
    onProgress?.({ uploadedBytes, totalBytes, partIndex: i, partsTotal: totalParts });
  }

  // 3) COMPLETE
  const completeResp = await fetchJson<CompleteResponse>(endpointComplete, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(completeHeaders || {})
    },
    body: JSON.stringify({ uploadId, pathname, parts }),
    signal
  });

  if (!("ok" in completeResp) || !completeResp.ok) {
    const errorMsg = (completeResp as any)?.error || "COMPLETE failed";
    throw new Error(errorMsg);
  }

  return {
    url: completeResp.url,
    pathname: completeResp.pathname,
    uploadedBytes,
    totalBytes
  };
}

export default uploadFileMultipart;
