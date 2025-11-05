// apps/server/src/index.ts
// Express-сервер для каталогов «Резьба» (carvings) и «Графика» (graphics)
// - /api/catalogs/:kind (kind = carvings | graphics) — сканирует папку и отдаёт категории/элементы
// - /static/:kind — раздача файлов каталога как статики
// - /api/debug/:kind-path — отладка путей
// - CORS для Vite (5173), health, приём превью редактора, автоподбор порта
// ENV:
//   PORT (3000 по умолчанию)
//   ALLOW_PORT_FALLBACK=1 — автоподбор свободного порта
//   CORS_ORIGINS — список через запятую
//   CARVINGS_DIR — абсолютный путь к data/catalogs/carvings
//   GRAPHICS_DIR — абсолютный путь к data/catalogs/graphics

import express from "express";
import http from "http";
import net from "net";
import path from "path";
import fs from "fs";

// .env (опционально)
try { require("dotenv").config(); } catch {}

const app = express();

/* ===== Настройки ===== */
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const ALLOW_PORT_FALLBACK = String(process.env.ALLOW_PORT_FALLBACK || "").trim() === "1";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ===== Middleware ===== */
app.use(express.json({ limit: "25mb" }));

// Простой CORS для dev
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Логи
app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.url}`);
  next();
});

/* ===== Health ===== */
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get("/api/health", (_req, res) => res.json({ ok: true, time: Date.now() })); // alias

/* ===== Каталоги: поиск корней и статика ===== */
function dirExists(p: string) {
  try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
}
function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

type CatalogKind = "carvings" | "graphics";

function resolveCatalogRoot(kind: CatalogKind): string | null {
  const envVar = kind === "carvings" ? "CARVINGS_DIR" : "GRAPHICS_DIR";
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (dirExists(abs)) return abs;
    console.warn(`[static] ${envVar} указан, но не найден: ${abs}`);
  }

  const CWD = process.cwd(); // напр.: .../Memorial/apps/server
  const HERE = __dirname;    // напр.: .../Memorial/apps/server/src

  const candidates = unique([
    // Внутри apps/server
    path.resolve(CWD, "data", "catalogs", kind),
    // На уровень выше (apps/)
    path.resolve(CWD, "..", "data", "catalogs", kind),
    // На два уровня — корень репозитория
    path.resolve(CWD, "..", "..", "data", "catalogs", kind),

    // Относительно __dirname (src)
    path.resolve(HERE, "..", "data", "catalogs", kind),
    path.resolve(HERE, "..", "..", "data", "catalogs", kind),
    path.resolve(HERE, "..", "..", "..", "data", "catalogs", kind)
  ]);

  console.log(`[static] resolve ${kind} root; cwd:`, CWD, " __dirname:", HERE);
  console.log("[static] candidates:"); candidates.forEach((c) => console.log(" -", c));

  for (const p of candidates) if (dirExists(p)) return p;
  return null;
}

const ROOTS: Record<CatalogKind, string | null> = {
  carvings: resolveCatalogRoot("carvings"),
  graphics: resolveCatalogRoot("graphics")
};

for (const kind of ["carvings", "graphics"] as CatalogKind[]) {
  const root = ROOTS[kind];
  if (root) {
    app.use(`/static/${kind}`, express.static(root));
    console.log(`[static] /static/${kind} ->`, root);
  } else {
    console.warn(`[static] data/catalogs/${kind} не найден. /api/catalogs/${kind} вернёт пусто.`);
  }
}

// Отладка путей
app.get("/api/debug/carvings-path", (_req, res) => {
  res.json({ cwd: process.cwd(), __dirname, env: process.env.CARVINGS_DIR || null, root: ROOTS.carvings });
});
app.get("/api/debug/graphics-path", (_req, res) => {
  res.json({ cwd: process.cwd(), __dirname, env: process.env.GRAPHICS_DIR || null, root: ROOTS.graphics });
});

/* ===== Сканирование каталога ===== */
type CatalogItem = { id: string; name: string; url: string; relPath: string; idx?: number; order?: number };
type CatalogCategory = { name: string; slug?: string; items: CatalogItem[] };

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function encodeUrlPath(rel: string) {
  return rel.split(path.sep).map(encodeURIComponent).join("/");
}

function scanCatalog(root: string, kind: CatalogKind): CatalogCategory[] {
  const dirents = fs.readdirSync(root, { withFileTypes: true });

  // Файлы в корне каталога
  const filesAtRoot = dirents
    .filter((d) => d.isFile() && IMG_EXT.has(path.extname(d.name).toLowerCase()))
    .sort((a, b) => collator.compare(a.name, b.name));

  const categories: CatalogCategory[] = [];

  if (filesAtRoot.length) {
    const items: CatalogItem[] = filesAtRoot.map((d, i) => {
      const rel = d.name;
      return {
        id: `${kind}-root-${i}`,
        name: d.name.replace(/\.[^/.]+$/, ""),
        url: `/static/${kind}/${encodeUrlPath(rel)}`,
        relPath: rel,
        idx: i,
        order: i
      };
    });
    categories.push({ name: "Разное", slug: "misc", items });
  }

  // Папки верхнего уровня
  const folders = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  folders.sort((a, b) => collator.compare(a, b));

  for (const folderName of folders) {
    const catDir = path.join(root, folderName);
    const fileEntries = fs
      .readdirSync(catDir, { withFileTypes: true })
      .filter((d) => d.isFile() && IMG_EXT.has(path.extname(d.name).toLowerCase()))
      .sort((a, b) => collator.compare(a.name, b.name));

    const items: CatalogItem[] = fileEntries.map((d, i) => {
      const rel = path.join(folderName, d.name);
      return {
        id: `${kind}-${folderName}-${i}`,
        name: d.name.replace(/\.[^/.]+$/, ""),
        url: `/static/${kind}/${encodeUrlPath(rel)}`,
        relPath: rel,
        idx: i,
        order: i
      };
    });

    if (items.length) categories.push({ name: folderName, slug: folderName, items });
  }

  return categories;
}

/* ===== API: обобщённый роут ===== */
app.get("/api/catalogs/:kind", (req, res) => {
  try {
    const kind = (req.params.kind || "") as CatalogKind;
    if (kind !== "carvings" && kind !== "graphics") {
      return res.status(404).json({ ok: false, error: "UNKNOWN_CATALOG" });
    }
    const root = ROOTS[kind];
    if (!root) return res.json({ ok: true, categories: [], updatedAt: Date.now() });

    const categories = scanCatalog(root, kind);
    return res.json({ ok: true, categories, updatedAt: Date.now() });
  } catch (e) {
    console.error("[/api/catalogs/:kind] error:", e);
    return res.status(500).json({ ok: false, categories: [] });
  }
});

/* ===== Приём превью редактора и статика ===== */
app.post("/api/send-editor-preview", (req, res) => {
  try {
    const { dataUrl, meta } = req.body as { dataUrl?: string; meta?: unknown };
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return res.status(400).json({ ok: false, error: "BAD_DATA_URL" });
    }
    const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, error: "PARSE_DATA_URL" });

    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const buf = Buffer.from(m[2], "base64");

    const outDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const file = `editor-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(outDir, file), buf);

    console.log("[editor-preview] saved:", path.join(outDir, file), meta ? "(meta present)" : "");
    return res.json({ ok: true, file: `/uploads/${file}` });
  } catch (e) {
    console.error("[/api/send-editor-preview] error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ===== Порт и запуск ===== */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => { tester.once("close", () => resolve(true)).close(); })
      .listen(port, HOST);
  });
}
async function findFreePort(start: number, maxAttempts = 50): Promise<number> {
  let port = start;
  for (let i = 0; i <= maxAttempts; i++, port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found starting from ${start} (+${maxAttempts})`);
}

async function start() {
  try {
    let portToUse = DEFAULT_PORT;

    if (ALLOW_PORT_FALLBACK) {
      portToUse = await findFreePort(DEFAULT_PORT, 50);
    } else {
      const free = await isPortFree(DEFAULT_PORT);
      if (!free) {
        console.error(`[server] Port ${DEFAULT_PORT} is busy. Set PORT or ALLOW_PORT_FALLBACK=1.`);
        process.exit(1);
      }
    }

    const server = http.createServer(app);
    server.listen(portToUse, HOST, () => {
      console.log(`[server] Listening on http://${HOST}:${portToUse}`);
      if (portToUse !== DEFAULT_PORT && ALLOW_PORT_FALLBACK) {
        console.log(`[server] Using fallback port ${portToUse}. Update Vite proxy or VITE_API_BASE_URL.`);
      }
    });

    server.on("error", (err: any) => {
      console.error("[server] Unexpected error:", err);
      process.exit(1);
    });

    const shutdown = () => {
      console.log("\n[server] Shutting down...");
      server.close(() => {
        console.log("[server] Closed.");
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  }
}
start();

export default app;
