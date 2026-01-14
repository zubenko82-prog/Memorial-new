// client/uploadMultipart.ts
// Клиентская загрузка файла в Vercel Blob через multipart API.
// Требуются серверные роуты:
//  - POST /api/blob-upload-url (инициализация multipart; возвращает partUrls, uploadId, pathname, partSize)
//  - POST /api/blob-upload-complete (завершение multipart; принимает { uploadId, pathname, parts[] })

export type AccessMode = "public" | "private";

export type InitResponse =
  | {
      ok: true;
      version: string;
      mode: "multipart";
      uploadId: string;
      pathname: string;
      partUrls: string[];
      partSize?: number;
      url: string | null;
    }
  | {
      ok: false;
      version?: string;
      error: string;
      [k: string]: any;
    };

export type CompleteResponse =
  | {
      ok: true;
      version: string;
      url: string;
      pathname: string;
    }
  | {
      ok: false;
      version?: string;
      error: string;
      [k: string]: any;
    };

export type UploadMultipartOptions = {
  name?: string; // пример: "uploads/123.pdf"
  access?: AccessMode; // по умолчанию "public"
  contentType?: string; // обычно file.type
  endpointInit?: string; // "/api/blob-upload-url"
  endpointComplete?: string; // "/api/blob-upload-complete"
  onProgress?: (info: {
    uploadedBytes: number;
    totalBytes: number;
    partIndex: number; // 0-based
    partsTotal: number;
  }) => void;
  signal?: AbortSignal;
  initHeaders?: Record<string, string>;
  completeHeaders?: Record<string, string>;
};

export type UploadResult = {
  url: string;
  pathname: string;
  uploadedBytes: number;
  totalBytes: number;
};

function sanitizePathName(input: string): string {
  const normalized = input.replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\\+/g, "/");
  return normalized.replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
}

async function fetchJson<T = any>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text().catch(() => "");
  try {
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || res.statusText || "Request failed";
      throw new Error(`${msg} (${res.status})`);
    }
    return json as T;
  } catch (e) {
    if (!res.ok) throw new Error(`${text || res.statusText} (${res.status})`);
    throw e;
  }
}

function getHeaderETag(headers: Headers): string {
  return headers.get("etag") || headers.get("ETag") || headers.get("x-amz-etag") || "";
}

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

  // 2) PUT каждый кусок
  const parts: { partNumber: number; etag: string }[] = [];
  const totalParts = partUrls.length;
  const totalBytes = file.size;
  const sizePerPart = !partSize || partSize <= 0 ? Math.ceil(totalBytes / totalParts) : partSize;

  let uploadedBytes = 0;

  for (let i = 0; i < totalParts; i++) {
    const start = i * sizePerPart;
    const end = Math.min(start + sizePerPart, totalBytes);
    const chunk = file.slice(start, end);

    const resp = await fetch(partUrls[i], {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: chunk,
      signal
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Ошибка загрузки части ${i + 1}/${totalParts}: ${resp.status} ${resp.statusText} ${t}`);
    }

    const etag = getHeaderETag(resp.headers);
    if (!etag) {
      // Если по какой-то причине ETag не вернулся заголовком — попробуем из тела
      const t = await resp.text().catch(() => "");
      const m = /"etag"\s*:\s*"([^"]+)"/i.exec(t);
      const recovered = m ? m[1] : "";
      if (!recovered) throw new Error(`Не получен ETag для части ${i + 1}`);
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
