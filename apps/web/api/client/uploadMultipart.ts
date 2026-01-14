// client/uploadMultipart.ts
export async function uploadFileMultipart(file: File) {
  // 1) init
  const initResp = await fetch("/api/blob-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `uploads/${Date.now()}-${file.name}`,
      contentType: file.type || "application/octet-stream",
      access: "public",
      sizeBytes: file.size
    })
  }).then(r => r.json());

  if (!initResp?.ok || !Array.isArray(initResp.partUrls) || !initResp.uploadId) {
    throw new Error(initResp?.error || "Init failed");
  }

  const { partUrls, uploadId, pathname, partSize } = initResp as {
    partUrls: string[]; uploadId: string; pathname: string; partSize?: number;
  };

  // 2) upload parts (PUT)
  const etags: { partNumber: number; etag: string }[] = [];
  const totalParts = partUrls.length;

  for (let i = 0; i < totalParts; i++) {
    const url = partUrls[i];
    // slice chunk
    let chunk: Blob;
    if (partSize && partSize > 0) {
      const start = i * partSize;
      const end = Math.min(start + partSize, file.size);
      chunk = file.slice(start, end);
    } else {
      // fallback: split evenly by count
      const approx = Math.ceil(file.size / totalParts);
      const start = i * approx;
      const end = Math.min(start + approx, file.size);
      chunk = file.slice(start, end);
    }

    const resp = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: chunk
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Part ${i + 1} upload failed: ${resp.status} ${t}`);
    }
    const etag = resp.headers.get("etag") || resp.headers.get("ETag") || "";
    if (!etag) {
      // Some envs require quotes around ETag; if missing — try to parse body as JSON if it returns etag
      // but usually S3 presigned PUT returns ETag header.
    }
    etags.push({ partNumber: i + 1, etag });
  }

  // 3) complete
  const done = await fetch("/api/blob-upload-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, pathname, parts: etags })
  }).then(r => r.json());

  if (!done?.ok) throw new Error(done?.error || "Complete failed");

  // done.url is your final public URL to send to Telegram
  return { url: done.url as string, pathname };
}
