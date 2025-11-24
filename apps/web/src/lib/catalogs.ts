export async function loadCatalog<T = unknown>(name: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}catalogs/${name}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load catalog: ${name}`);
  return res.json();
}
