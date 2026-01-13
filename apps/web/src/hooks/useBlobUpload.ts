// src/hooks/useBlobUpload.ts
// Готовый React‑хук для загрузки файла в Vercel Blob с прогрессом (через XHR) и возможностью отмены.
// Предполагается, что на бэкенде есть роут /api/blob-upload-url (см. предыдущую инструкцию),
// который возвращает { ok: true, uploadUrl, url, pathname }.
//
// Применение:
// const { upload, abort, progress, status, error, uploadedUrl } = useBlobUpload();
// await upload(file, { name: "orders/123.pdf", access: "public" });
//
// Если нужен свой способ получения uploadUrl — передайте getUploadUrl в опции хука.

import { useCallback, useMemo, useRef, useState } from "react";

export type UploadStatus = "idle" | "requestingUrl" | "uploading" | "done" | "error" | "aborted";

export type BlobUploadResult = {
  url: string;        // финальный CDN‑URL (публичный, если access=public)
  pathname?: string;  // путь в Blob (может понадобиться для удаления/метаданных)
};

export type GetUploadUrl = (params: {
  name?: string;
  access?: "public" | "private";
  contentType?: string;
  addRandomSuffix?: boolean;
}) => Promise<{ uploadUrl: string; url: string; pathname?: string }>;

export type UseBlobUploadOptions = {
  getUploadUrl?: GetUploadUrl;
  defaultAccess?: "public" | "private";
  defaultAddRandomSuffix?: boolean;
  // Таймаут XHR в мс (0 — без таймаута)
  xhrTimeoutMs?: number;
  // Доп. заголовки для XHR PUT (обычно не нужны)
  putHeaders?: Record<string, string>;
};

export function useBlobUpload(opts: UseBlobUploadOptions = {}) {
  const {
    getUploadUrl = defaultGetUploadUrl,
    defaultAccess = "public",
    defaultAddRandomSuffix = true,
    xhrTimeoutMs = 0,
    putHeaders = {}
  } = opts;

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [bytesSent, setBytesSent] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedPathname, setUploadedPathname] = useState<string | null>(null);

  const abort = useCallback(() => {
    if (xhrRef.current && (status === "uploading" || status === "requestingUrl")) {
      try { xhrRef.current.abort(); } catch {}
      xhrRef.current = null;
      setStatus("aborted");
    }
  }, [status]);

  const upload = useCallback(async (file: File | Blob, params?: {
    name?: string;
    access?: "public" | "private";
    addRandomSuffix?: boolean;
    // Можно принудительно указать content-type; по умолчанию берётся file.type
    contentType?: string;
  }): Promise<BlobUploadResult> => {
    setError(null);
    setUploadedUrl(null);
    setUploadedPathname(null);
    setProgress(0);
    setBytesSent(0);
    setTotalBytes(0);

    try {
      setStatus("requestingUrl");
      const contentType = params?.contentType || (file as File).type || "application/octet-stream";
      const { uploadUrl, url, pathname } = await getUploadUrl({
        name: params?.name,
        access: params?.access ?? defaultAccess,
        contentType,
        addRandomSuffix: params?.addRandomSuffix ?? defaultAddRandomSuffix
      });

      // XHR для прогресса
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      const result = await new Promise<BlobUploadResult>((resolve, reject) => {
        xhr.open("PUT", uploadUrl, true);
        // Устанавливаем content-type файла:
        xhr.setRequestHeader("Content-Type", contentType);
        // Доп. заголовки, если нужны:
        for (const [k, v] of Object.entries(putHeaders || {})) {
          try { xhr.setRequestHeader(k, v); } catch {}
        }
        if (xhrTimeoutMs > 0) xhr.timeout = xhrTimeoutMs;

        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          setStatus("uploading");
          setTotalBytes(ev.total);
          setBytesSent(ev.loaded);
          const pct = Math.max(0, Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
          setProgress(pct);
        };

        xhr.onerror = () => {
          const msg = "Ошибка сети при загрузке в Blob";
          setError(msg);
          setStatus("error");
          reject(new Error(msg));
        };
        xhr.ontimeout = () => {
          const msg = "Время ожидания загрузки истекло";
          setError(msg);
          setStatus("error");
          reject(new Error(msg));
        };
        xhr.onabort = () => {
          setStatus("aborted");
          reject(new Error("aborted"));
        };
        xhr.onreadystatechange = () => {
          if (xhr.readyState === XMLHttpRequest.DONE) {
            // Vercel Blob обычно отвечает 200 OK или 204 No Content
            if (xhr.status >= 200 && xhr.status < 300) {
              setProgress(100);
              setStatus("done");
              setUploadedUrl(url);
              if (pathname) setUploadedPathname(pathname);
              resolve({ url, pathname });
            } else {
              const text = xhr.responseText || xhr.statusText || String(xhr.status);
              const msg = `Upload failed: ${xhr.status} ${text}`;
              setError(msg);
              setStatus("error");
              reject(new Error(msg));
            }
          }
        };

        // Важно: передавать именно Blob/File
        try {
          xhr.send(file);
        } catch (e: any) {
          const msg = e?.message || "Не удалось начать загрузку";
          setError(msg);
          setStatus("error");
          reject(new Error(msg));
        }
      });

      return result;
    } finally {
      xhrRef.current = null;
    }
  }, [getUploadUrl, defaultAccess, defaultAddRandomSuffix, putHeaders, xhrTimeoutMs]);

  const state = useMemo(() => ({
    status, progress, bytesSent, totalBytes, error, uploadedUrl, uploadedPathname
  }), [status, progress, bytesSent, totalBytes, error, uploadedUrl, uploadedPathname]);

  return { upload, abort, ...state };
}

// Стандартный запрос uploadUrl к вашему API.
// Формат ответа: { ok: true, uploadUrl, url, pathname }
async function defaultGetUploadUrl(params: {
  name?: string;
  access?: "public" | "private";
  contentType?: string;
  addRandomSuffix?: boolean;
}): Promise<{ uploadUrl: string; url: string; pathname?: string }> {
  const resp = await fetch("/api/blob-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params || {})
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.ok) {
    const msg = (data && (data.error || JSON.stringify(data))) || resp.statusText || "Failed to get upload URL";
    throw new Error(msg);
  }
  return { uploadUrl: data.uploadUrl, url: data.url, pathname: data.pathname };
}
