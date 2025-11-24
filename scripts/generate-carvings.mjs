// scripts/generate-carvings.mjs
import { promises as fs } from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const DATA_DIR = path.resolve(__dirname, "..", "data", "catalogs", "carvings");
const PUB_IMG_DIR = path.resolve(__dirname, "..", "apps", "web", "public", "images", "carvings");
const OUT_JSON = path.resolve(__dirname, "..", "apps", "web", "public", "catalogs", "carvings.json");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"]);

// Простейшая транслитерация RU->EN для slug
const RU_MAP = Object.fromEntries([
  ["а","a"],["б","b"],["в","v"],["г","g"],["д","d"],["е","e"],["ё","e"],["ж","zh"],["з","z"],["и","i"],["й","j"],
  ["к","k"],["л","l"],["м","m"],["н","n"],["о","o"],["п","p"],["р","r"],["с","s"],["т","t"],["у","u"],["ф","f"],
  ["х","h"],["ц","c"],["ч","ch"],["ш","sh"],["щ","sch"],["ъ",""],["ы","y"],["ь",""],["э","e"],["ю","yu"],["я","ya"]
]);
function translitRu(s) {
  return s.split("").map(ch => {
    const low = ch.toLowerCase();
    const t = RU_MAP[low];
    if (!t) return /[a-z0-9]/i.test(ch) ? ch : " ";
    return (ch === low) ? t : t.toUpperCase();
  }).join("");
}
function slugifyPath(relDir) {
  const parts = relDir.split(path.sep).filter(Boolean);
  const segs = parts.map(p =>
    translitRu(p).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cat"
  );
  return segs.join("-");
}
function titleize(name) {
  const words = name.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function urlFromRel(relPath) {
  const parts = relPath.split(path.sep).map(encodeURIComponent);
  return "/images/carvings/" + parts.join("/");
}

async function ensureDir(d) { await fs.mkdir(d, { recursive: true }); }
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function readDir(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function collectTree(root) {
  // Вернём список { dirRel, files:[rel-to-root], subdirs:[...same] }
  async function walk(abs, rel="") {
    const entries = await readDir(abs);
    const files = [];
    const subdirs = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const absChild = path.join(abs, e.name);
      const relChild = path.join(rel, e.name);
      if (e.isDirectory()) {
        subdirs.push(await walk(absChild, relChild));
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (IMG_EXTS.has(ext)) files.push(relChild);
      }
    }
    return { dirRel: rel, files, subdirs };
  }
  return await walk(root, "");
}

function flattenDirsWithImages(node) {
  // Соберём все директории, где есть картинки (не включаем вложенные картинки в родителя)
  const out = [];
  function visit(n) {
    if (n.files.length > 0) out.push(n);
    n.subdirs.forEach(visit);
  }
  visit(node);
  return out;
}

async function copyFromDataToPublic(filesRel) {
  let copied = 0;
  for (const rel of filesRel) {
    const src = path.join(DATA_DIR, rel);
    const dst = path.join(PUB_IMG_DIR, rel);
    await ensureDir(path.dirname(dst));
    // простая эвристика — копируем всегда; можно оптимизировать по размеру/времени
    await fs.copyFile(src, dst);
    copied++;
  }
  return copied;
}

async function collectFromPublic() {
  // Fallback: если в data нет картинок — читаем уже лежащие в public
  const root = PUB_IMG_DIR;
  async function walk(abs, rel="") {
    const entries = await readDir(abs);
    const files = [];
    const subdirs = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const absChild = path.join(abs, e.name);
      const relChild = path.join(rel, e.name);
      if (e.isDirectory()) subdirs.push(await walk(absChild, relChild));
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (IMG_EXTS.has(ext)) files.push(relChild);
      }
    }
    return { dirRel: rel, files, subdirs };
  }
  return await walk(root, "");
}

async function generate() {
  console.log("Carvings generator: categories = folders (any depth)");
  console.log("DATA_DIR:", DATA_DIR);
  console.log("PUB_IMG_DIR:", PUB_IMG_DIR);
  console.log("OUT_JSON:", OUT_JSON);

  const hasData = await exists(DATA_DIR);
  let tree;
  if (hasData) {
    tree = await collectTree(DATA_DIR);
    const allFiles = [];
    (function collect(n){ allFiles.push(...n.files); n.subdirs.forEach(collect); })(tree);
    console.log(`Found in data: ${allFiles.length} image(s)`);
    if (allFiles.length > 0) {
      const copied = await copyFromDataToPublic(allFiles);
      console.log(`Copied ${copied} file(s) to public`);
    }
  }

  // Читаем структуру из public (гарантированно актуальная для выдачи)
  const pubTree = await collectFromPublic();
  const dirsWithImages = flattenDirsWithImages(pubTree);

  // Категория для картинок в корне (если есть)
  const categories = [];
  if (pubTree.files.length > 0) {
    categories.push({
      name: "Каталог",
      slug: "carvings",
      items: pubTree.files.map(relFile => ({
        id: slugifyPath(path.dirname(relFile) || "carvings") + "-" +
            slugifyPath(path.basename(relFile, path.extname(relFile))),
        name: titleize(path.basename(relFile, path.extname(relFile))),
        url: urlFromRel(relFile),
        relPath: `carvings/${relFile.replace(/\\/g, "/")}`
      }))
    });
  }

  // Категории для каждой папки с изображениями
  for (const dir of dirsWithImages) {
    if (!dir.dirRel) continue; // корень уже обработали выше
    const parts = dir.dirRel.split(path.sep);
    const display = parts.map(titleize).join(" / ");       // Человекочитаемое имя категории
    const slug = slugifyPath(dir.dirRel);                  // URL-friendly slug (с транслитом)
    const items = dir.files.map(relFile => ({
      id: slug + "-" + slugifyPath(path.basename(relFile, path.extname(relFile))),
      name: titleize(path.basename(relFile, path.extname(relFile))),
      url: urlFromRel(relFile),
      relPath: `carvings/${relFile.replace(/\\/g, "/")}`
    }));
    categories.push({ name: display, slug, items });
  }

  await ensureDir(path.dirname(OUT_JSON));
  await fs.writeFile(OUT_JSON, JSON.stringify({ categories }, null, 2), "utf8");

  const total = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`Generated ${OUT_JSON} with ${total} items in ${categories.length} categories`);
}

generate().catch((e) => { console.error(e); process.exit(1); });
