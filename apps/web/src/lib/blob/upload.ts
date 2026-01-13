// src/lib/blob/upload.ts
export async function getUploadUrl(params: { name?: string; access?: "public" | "private"; contentType?: string } = {}) {
  const resp = await fetch("/api/blob-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || "Не удалось получить upload URL");
  }
  return data as { uploadUrl: string; url: string; name: string; access: string; pathname: string };
}

export async function uploadFileToBlob(file: File, uploadUrl: string): Promise<void> {
  const resp = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Upload failed: ${resp.status} ${text || resp.statusText}`);
  }
}
