// src/api.ts
export type CatalogItem = { id?: string; name: string; url: string; relPath?: string; [k: string]: any };
export type CatalogCategory = { name: string; slug?: string; items: CatalogItem[] };

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "/");

// Если есть внешний API — используем его (/api/catalogs/:kind).
// Иначе читаем статический JSON из public (/catalogs/:kind.json).
function buildCatalogUrl(kind: string): string {
  const safe = encodeURIComponent(kind);
  return API_BASE
    ? `${API_BASE}/api/catalogs/${safe}`
    : `${BASE_URL}catalogs/${safe}.json`;
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`GET ${url} ${res.status}`);
  return res.json();
}

export async function fetchCatalog(kind: string): Promise<{ categories: CatalogCategory[] }> {
  const d = await apiGet<any>(buildCatalogUrl(kind));
  // Поддерживаем оба формата
  if (Array.isArray(d?.categories)) return { categories: d.categories as CatalogCategory[] };
  if (Array.isArray(d?.items)) {
    return { categories: [{ name: "Каталог", slug: kind, items: d.items as CatalogItem[] }] };
  }
  return { categories: [] };
}
