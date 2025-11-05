import path from "path";
import { promises as fs } from "fs";
import express, { Express, Request, Response } from "express";

type Kind = "carvings" | "graphics";
type CatalogItem = { name: string; slug: string; url: string; relPath: string };
type CatalogCategory = { name: string; slug: string; items: CatalogItem[] };
type CatalogResponse = { kind: Kind; baseUrl: string; categories: CatalogCategory[]; updatedAt: number };

const ALLOWED = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const cache = new Map<Kind, { ts: number; data: CatalogResponse }>();
const TTL_MS = 5000;

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_.]/g, "");
}

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function scanDir(dir: string, baseUrl: string): Promise<CatalogCategory[]> {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory());
  const categories: CatalogCategory[] = [];

  for (const f of folders) {
    const catDir = path.join(dir, f.name);
    let files: import("fs").Dirent[] = [];
    try {
      files = await fs.readdir(catDir, { withFileTypes: true });
    } catch (e) {
      console.warn("[server] skip category (read error):", catDir, e);
      continue;
    }
    const items: CatalogItem[] = [];
    for (const it of files) {
      if (!it.isFile()) continue;
      const ext = path.extname(it.name).toLowerCase();
      if (!ALLOWED.has(ext)) continue;
      const relPath = `${encodeURIComponent(f.name)}/${encodeURIComponent(it.name)}`;
      items.push({
        name: path.parse(it.name).name,
        slug: slugify(path.parse(it.name).name),
        url: `${baseUrl}/${relPath}`,
        relPath
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    categories.push({ name: f.name, slug: slugify(f.name), items });
  }

  categories.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return categories;
}

export function mountCatalogRoutes(app: Express, rootDir: string) {
  const carvingsDir = path.resolve(rootDir, "data/catalogs/carvings");
  const graphicsDir = path.resolve(rootDir, "data/catalogs/graphics");

  app.use("/static/carvings", express.static(carvingsDir));
  app.use("/static/graphics", express.static(graphicsDir));

  // Диагностика пути
  app.get("/api/catalogs/:kind/debug", async (req, res) => {
    const kind = req.params.kind as Kind;
    const dir = kind === "carvings" ? carvingsDir : graphicsDir;
    res.json({ kind, dir, exists: await exists(dir) });
  });

  app.get("/api/catalogs/:kind", async (req: Request, res: Response) => {
    const kind = req.params.kind as Kind;
    if (kind !== "carvings" && kind !== "graphics") {
      return res.status(400).json({ error: "Unknown kind" });
    }

    const nocache = req.query.nocache === "1";
    const cached = cache.get(kind);
    if (!nocache && cached && Date.now() - cached.ts < TTL_MS) {
      return res.json(cached.data);
    }

    const baseUrl = kind === "carvings" ? "/static/carvings" : "/static/graphics";
    const dir = kind === "carvings" ? carvingsDir : graphicsDir;

    try {
      const categories = await scanDir(dir, baseUrl);
      const data: CatalogResponse = { kind, baseUrl, categories, updatedAt: Date.now() };
      cache.set(kind, { ts: Date.now(), data });
      res.json(data);
    } catch (e) {
      console.error("[server] catalogs error:", e);
      res.status(200).json({ kind, baseUrl, categories: [], updatedAt: Date.now(), error: "scan_failed" } as any);
    }
  });
}
