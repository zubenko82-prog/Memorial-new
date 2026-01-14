// pages/api/blob-upload-url.ts
// Works with @vercel/blob 0.24.x (unstable_generateUploadUrl) and 2.x if present.
// Uses dynamic require and introspection to avoid import issues.
// Env:
//   - BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
//   - BLOB_PUBLIC_BASE_URL=https://jqsjh7yt6zfkuqwf.public.blob.vercel-storage.com

import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "blob-upload-url@auto-introspect";

function cors(res: NextApiResponse, json = false) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (json) res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function buildPublicUrl(base: string, pathname?: string | null) {
  if (!base || !pathname) return null;
  const b = base.replace(/\/+$/, "");
  const p = String(pathname).replace(/^\/+/, "");
  return `${b}/${p.split("/").map(encodeURIComponent).join("/")}`;
}

function pickGenerator(mod: any) {
  if (!mod || typeof mod !== "object") return { fn: null, key: null, keys: [] as string[] };
  const keys = Object.keys(mod);
  // try common names (covering 0.24.x and various 2.x variants)
  const candidates = [
    "generateUploadUrl",
    "unstable_generateUploadUrl",
    "createUploadUrl",
    "createUploadURL",
    "generateUploadURL",
  ];
  for (const k of candidates) {
    const fn = mod[k];
    if (typeof fn === "function") return { fn, key: k, keys };
  }
  // sometimes default export contains the fns
  if (mod.default && typeof mod.default === "object") {
    const dkeys = Object.keys(mod.default);
    for (const k of candidates) {
      const fn = mod.default[k];
      if (typeof fn === "function") return { fn, key: `default.${k}`, keys: [...keys, ...dkeys.map(x => `default.${x}`)] };
    }
    return { fn: null, key: null, keys: [...keys, ...dkeys.map(x => `default.${x}`)] };
  }
  return { fn: null, key: null, keys };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    cors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method === "HEAD") return res.status(200).end();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST,OPTIONS,HEAD");
      return res.status(405).end("Method Not Allowed");
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN || "";
    const baseUrl = process.env.BLOB_PUBLIC_BASE_URL || "";
    const debug = String((req.query.debug ?? "") || "").trim() === "1";

    if (!token) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_READ_WRITE_TOKEN" });
    }
    if (!baseUrl) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "Missing BLOB_PUBLIC_BASE_URL" });
    }

    // dynamic require to avoid ESM named export pitfalls
    let VBlob: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      VBlob = require("@vercel/blob");
    } catch (_e) {
      try {
        VBlob = await import("@vercel/blob");
      } catch (e2: any) {
        cors(res, true);
        return res.status(500).json({ ok: false, version: VERSION, error: `Failed to import @vercel/blob: ${String(e2?.message || e2)}` });
      }
    }

    const { fn: genFn, key: pickedKey, keys: exportedKeys } = pickGenerator(VBlob);
    if (!genFn) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: "@vercel/blob SDK does not expose a generateUploadUrl function.",
        exportedKeys,
      });
    }

    const { name, access = "public", contentType = "application/octet-stream", addRandomSuffix = true } =
      (req.body || {}) as {
        name?: string;
        access?: "public" | "private";
        contentType?: string;
        addRandomSuffix?: boolean;
      };

    const blobName = name || `uploads/${Date.now()}.bin`;

    // Try multiple option shapes to satisfy different SDKs
    const attempts = [
      { access, contentType, token, addRandomSuffix, name: blobName },
      { access, contentType, token, name: blobName },
      { access, contentType, token },
    ];

    let out: any = null;
    let lastErr: any = null;
    for (const opts of attempts) {
      try {
        const r = await genFn(opts);
        if (r) { out = r; break; }
      } catch (e) {
        lastErr = e;
      }
    }

    if (!out) {
      cors(res, true);
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: `Failed to generate upload URL via ${pickedKey || "unknown"}${lastErr ? `: ${String(lastErr?.message || lastErr)}` : ""}`,
        exportedKeys,
      });
    }

    const uploadUrl: string = out.uploadUrl || out.url;
    const pathname: string | null = out.pathname || out.key || null;
    const finalUrl: string | null = (out.url && out.uploadUrl ? out.url : null) || buildPublicUrl(baseUrl, pathname);

    if (!uploadUrl) {
      cors(res, true);
      return res.status(500).json({ ok: false, version: VERSION, error: "SDK returned empty uploadUrl", exportedKeys });
    }

    cors(res, true);
    return res.status(200).json({
      ok: true,
      version: VERSION,
      pickedKey,
      uploadUrl,
      url: finalUrl,
      pathname,
      access,
      name: blobName,
      ...(debug ? { exportedKeys } : {})
    });
  } catch (e: any) {
    cors(res, true);
    return res.status(500).json({ ok: false, version: VERSION, error: e?.message || "Internal error" });
  }
}
