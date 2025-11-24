// src/api.ts
export type CatalogItem = { id?: string; name: string; url: string; relPath?: string; [k: string]: any };
export type CatalogCategory = { name: string; slug?: string; items: CatalogItem[] };

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "/");

function buildCatalogUrl(kind: string): string {
  const safe = encodeURIComponent(kind);
  return API_BASE
    ? `${API_BASE}/api/catalogs/${safe}`
    : `${BASE_URL}catalogs/${safe}.json`;
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${url} ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!text.trim()) {
    throw new Error(`GET ${url} 200 but empty body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const ct = res.headers.get("content-type") || "";
    throw new Error(
      `GET ${url} invalid JSON (${ct}): ${String(e)}; body starts: "${text.slice(0, 120)}"`
    );
  }
}

export async function fetchCatalog(kind: string): Promise<{ categories: CatalogCategory[] }> {
  const d = await apiGet<any>(buildCatalogUrl(kind));
  if (Array.isArray(d?.categories)) return { categories: d.categories as CatalogCategory[] };
  if (Array.isArray(d?.items)) {
    return { categories: [{ name: "Каталог", slug: kind, items: d.items as CatalogItem[] }] };
  }
  return { categories: [] };
}
