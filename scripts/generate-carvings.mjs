// scripts/generate-carvings.mjs
import { promises as fs } from "fs";
import path from "path";

const SRC_DIR = path.resolve("data/catalogs/carvings");
const PUB_IMG_DIR = path.resolve("apps/web/public/images/carvings");
const OUT_JSON = path.resolve("apps/web/public/catalogs/carvings.json");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"]);

function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function niceNameFromFile(filename) {
  return path
    .basename(filename, path.extname(filename))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function listDirOnly(dir) {
  const out = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) out.push(e.name);
    }
  } catch {}
  return out;
}

async function listFiles(dir) {
  const out = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase())) {
        out.push(e.name);
      }
    }
  } catch {}
  return out;
}

async function copyFileIfChanged(src, dst) {
  try {
    const [sa, da] = await Promise.all([fs.stat(src), fs.stat(dst).catch(() => null)]);
    if (da && da.size === sa.size) return; // простая эвристика
  } catch {}
  await ensureDir(path.dirname(dst));
  await fs.copyFile(src, dst);
}

async function generate() {
  await ensureDir(PUB_IMG_DIR);
  await ensureDir(path.dirname(OUT_JSON));

  const categories = [];
  const subdirs = await listDirOnly(SRC_DIR);

  if (subdirs.length === 0) {
    // без подкатегорий — все изображения одной категорией
    const files = await listFiles(SRC_DIR);
    const items = [];
    for (const file of files) {
      const src = path.join(SRC_DIR, file);
      const dst = path.join(PUB_IMG_DIR, file);
      await copyFileIfChanged(src, dst);
      items.push({
        id: slugify(path.basename(file, path.extname(file))),
        name: niceNameFromFile(file),
        url: `/images/carvings/${encodeURIComponent(file)}`,
        relPath: `carvings/${file}`,
      });
    }
    categories.push({ name: "Каталог", slug: "carvings", items });
  } else {
    // каждая подпапка — категория
    for (const sub of subdirs) {
      const catSrc = path.join(SRC_DIR, sub);
      const catDst = path.join(PUB_IMG_DIR, sub);
      const files = await listFiles(catSrc);
      const items = [];
      for (const file of files) {
        const src = path.join(catSrc, file);
        const dst = path.join(catDst, file);
        await copyFileIfChanged(src, dst);
        items.push({
          id: `${slugify(sub)}-${slugify(path.basename(file, path.extname(file)))}`,
          name: niceNameFromFile(file),
          url: `/images/carvings/${encodeURIComponent(sub)}/${encodeURIComponent(file)}`,
          relPath: `carvings/${sub}/${file}`,
        });
      }
      categories.push({ name: niceNameFromFile(sub), slug: slugify(sub), items });
    }
  }

  const json = JSON.stringify({ categories }, null, 2);
  await fs.writeFile(OUT_JSON, json, "utf8");
  console.log(`Generated ${OUT_JSON} with ${categories.reduce((n, c) => n + c.items.length, 0)} items`);
}

generate().catch((e) => {
  console.error(e);
  process.exit(1);
});
