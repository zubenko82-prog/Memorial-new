// src/api.ts
export type CatalogItem = { id?: string; name: string; url: string; relPath?: string; [k: string]: any };
export type CatalogCategory = { name: string; slug?: string; items: CatalogItem[] };

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function apiGet<T>(path: string): Promise<T> {
  const url = API_BASE ? `${API_BASE}${path}` : path;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return res.json();
}

export async function fetchCatalog(kind: string): Promise<{ categories: CatalogCategory[] }> {
  const d = await apiGet<any>(`/api/catalogs/${kind}`);
  // Поддерживаем оба формата
  if (Array.isArray(d?.categories)) return { categories: d.categories as CatalogCategory[] };
  if (Array.isArray(d?.items)) {
    return { categories: [{ name: "Каталог", slug: kind, items: d.items as CatalogItem[] }] };
  }
  return { categories: [] };
}
