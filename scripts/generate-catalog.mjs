// scripts/generate-catalog.mjs
import { promises as fs } from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const DEFAULT_KINDS = ["carvings", "graphics"];
const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"]);

// CLI: --kind graphics[,carvings] или позиционными аргументами
function parseKinds() {
  const kindsArg = process.argv.find((a) => a.startsWith("--kind="));
  if (kindsArg) return kindsArg.replace("--kind=", "").split(",").map((s) => s.trim()).filter(Boolean);
  const rest = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (rest.length) return rest;
  return DEFAULT_KINDS;
}

// Транслитерация для slug (RU->EN) + slugify пути
const RU_MAP = Object.fromEntries([
  ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["е", "e"], ["ё", "e"], ["ж", "zh"], ["з", "z"], ["и", "i"], ["й", "j"],
  ["к", "k"], ["л", "l"], ["м", "m"], ["н", "n"], ["о", "o"], ["п", "p"], ["р", "r"], ["с", "s"], ["т", "t"], ["у", "u"], ["ф", "f"],
  ["х", "h"], ["ц", "c"], ["ч", "ch"], ["ш", "sh"], ["щ", "sch"], ["ъ", ""], ["ы", "y"], ["ь", ""], ["э", "e"], ["ю", "yu"], ["я", "ya"]
]);
function translitRu(s) {
  return s
    .split("")
    .map((ch) => {
      const low = ch.toLowerCase();
      const t = RU_MAP[low];
      if (!t) return /[a-z0-9]/i.test(ch) ? ch : " ";
      return ch === low ? t : t.toUpperCase();
    })
    .join("");
}
function slugifyPath(rel) {
  const parts = rel.split(path.sep).filter(Boolean);
  const segs = parts.map(
    (p) => translitRu(p).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cat"
  );
  return segs.join("-");
}
function titleize(name) {
  const words = name.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function urlFromRel(kind, relPath) {
  const parts = relPath.split(path.sep).map(encodeURIComponent);
  return `/images/${kind}/` + parts.join("/");
}

async function ensureDir(d) {
  await fs.mkdir(d, { recursive: true });
}
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function readDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walkImages(rootDir) {
  const res = [];
  async function walk(abs, rel = "") {
    const entries = await readDir(abs);
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const absChild = path.join(abs, e.name);
      const relChild = path.join(rel, e.name);
      if (e.isDirectory()) await walk(absChild, relChild);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (IMG_EXTS.has(ext)) res.push({ abs: absChild, rel: relChild });
      }
    }
  }
  await walk(rootDir, "");
  return res;
}

async function copyFiles(files, srcRoot, dstRoot) {
  let copied = 0;
  for (const f of files) {
    const src = path.join(srcRoot, f.rel);
    const dst = path.join(dstRoot, f.rel);
    await ensureDir(path.dirname(dst));
    await fs.copyFile(src, dst);
    copied++;
  }
  return copied;
}

function flattenDirsWithImages(tree) {
  const out = [];
  function visit(n) {
    if (n.files.length > 0) out.push(n);
    n.subdirs.forEach(visit);
  }
  visit(tree);
  return out;
}

async function collectTree(root) {
  async function walk(abs, rel = "") {
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

async function generateKind(kind) {
  const DATA_DIR = path.resolve(__dirname, "..", "data", "catalogs", kind);
  const PUB_IMG_DIR = path.resolve(__dirname, "..", "apps", "web", "public", "images", kind);
  const OUT_JSON = path.resolve(__dirname, "..", "apps", "web", "public", "catalogs", `${kind}.json`);

  console.log(`\n=== Generate ${kind} ===`);
  console.log("DATA_DIR:", DATA_DIR);
  console.log("PUB_IMG_DIR:", PUB_IMG_DIR);
  console.log("OUT_JSON:", OUT_JSON);

  const hasData = await exists(DATA_DIR);
  if (hasData) {
    const dataFiles = await walkImages(DATA_DIR);
    console.log(`Found in data: ${dataFiles.length} image(s)`);
    if (dataFiles.length) {
      const copied = await copyFiles(dataFiles, DATA_DIR, PUB_IMG_DIR);
      console.log(`Copied to public: ${copied} file(s)`);
    }
  } else {
    console.log("No data dir, will use public only");
  }

  const pubExists = await exists(PUB_IMG_DIR);
  if (!pubExists) {
    await ensureDir(path.dirname(OUT_JSON));
    await fs.writeFile(OUT_JSON, JSON.stringify({ categories: [] }, null, 2), "utf8");
    console.warn(`Public images dir not found for ${kind}. Wrote empty categories.`);
    return;
  }

  const pubTree = await collectTree(PUB_IMG_DIR);
  const dirsWithImages = flattenDirsWithImages(pubTree);

  const categories = [];

  // Файлы в корне — общая категория
  if (pubTree.files.length > 0) {
    categories.push({
      name: "Каталог",
      slug: kind,
      items: pubTree.files.map((relFile) => ({
        id: `${slugifyPath(kind)}-${slugifyPath(path.basename(relFile, path.extname(relFile)))}`,
        name: titleize(path.basename(relFile, path.extname(relFile))),
        url: urlFromRel(kind, relFile),
        relPath: `${kind}/${relFile.replace(/\\/g, "/")}`
      }))
    });
  }

  // Категории по подпапкам (любой глубины)
  for (const dir of dirsWithImages) {
    if (!dir.dirRel) continue; // корень уже обработан
    const display = dir.dirRel.split(path.sep).map(titleize).join(" / ");
    const slug = slugifyPath(dir.dirRel);
    const items = dir.files.map((relFile) => ({
      id: `${slug}-${slugifyPath(path.basename(relFile, path.extname(relFile)))}`,
      name: titleize(path.basename(relFile, path.extname(relFile))),
      url: urlFromRel(kind, relFile),
      relPath: `${kind}/${relFile.replace(/\\/g, "/")}`
    }));
    categories.push({ name: display, slug, items });
  }

  await ensureDir(path.dirname(OUT_JSON));
  await fs.writeFile(OUT_JSON, JSON.stringify({ categories }, null, 2), "utf8");

  const total = categories.reduce((n, c) => n + c.items.length, 0);
  console.log(`Generated ${OUT_JSON} with ${total} item(s) in ${categories.length} categor(ies)`);
}

(async function main() {
  const kinds = parseKinds();
  for (const k of kinds) {
    await generateKind(k);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
