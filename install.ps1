param(
  [string]$Root = "C:\Users\BIG-HALL\VSCode\Memorial"
)

# -----------------------------
# Преднастройка UTF-8 и утилиты
# -----------------------------
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Error "Требуется PowerShell 7+. Текущая версия: $($PSVersionTable.PSVersion.ToString())"
  exit 1
}

function Ensure-Dir($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Write-Utf8File([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $Content | Set-Content -LiteralPath $Path -Encoding utf8
}

function Tool-Exists([string]$exe) {
  $null -ne (Get-Command $exe -ErrorAction SilentlyContinue)
}

function Winget-Install($id) {
  Write-Host "Установка через winget: $id ..."
  winget install -e --id $id --accept-source-agreements --accept-package-agreements | Out-Null
}

# -----------------------------
# Установка Node, Git, ngrok (если нет)
# -----------------------------
if (-not (Tool-Exists "git")) {
  try { Winget-Install "Git.Git" } catch { Write-Warning "Не удалось установить Git через winget. Поставьте вручную: https://git-scm.com/download/win" }
}

if (-not (Tool-Exists "node")) {
  try { Winget-Install "OpenJS.NodeJS.LTS" } catch { Write-Warning "Не удалось установить Node.js через winget. Поставьте вручную: https://nodejs.org/en/download" }
}

if (-not (Tool-Exists "ngrok")) {
  try { Winget-Install "Ngrok.Ngrok" } catch { Write-Warning "Не удалось установить ngrok через winget. Поставьте вручную: https://ngrok.com/download" }
}

# -----------------------------
# Создание структуры проекта
# -----------------------------
Ensure-Dir $Root
Set-Location $Root

$folders = @(
  ".vscode",
  "apps/bot/src",
  "apps/server/src",
  "apps/web/src",
  "packages/shared",
  "data/catalogs/carvings",
  "data/catalogs/graphics",
  "storage/uploads",
  "storage/projects",
  "scripts"
)
$folders | ForEach-Object { Ensure-Dir (Join-Path $Root $_) }

# .gitignore
Write-Utf8File (Join-Path $Root ".gitignore") @'
# Dependencies
node_modules/
# Build
dist/
build/
# Env
.env
.env.local
# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
# Misc
.DS_Store
Thumbs.db
.vscode/.history/
'@

# .editorconfig
Write-Utf8File (Join-Path $Root ".editorconfig") @'
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
'@

# VSCode settings
Write-Utf8File (Join-Path $Root ".vscode/settings.json") @'
{
  "files.encoding": "utf8",
  "files.eol": "\n",
  "terminal.integrated.defaultProfile.windows": "PowerShell",
  "editor.formatOnSave": true,
  "typescript.tsdk": "node_modules\\typescript\\lib"
}
'@

# README
Write-Utf8File (Join-Path $Root "README.md") @'
# Memorial

Локальная разработка Telegram мини-приложения (Web App + бот) для эскизов памятников.
- Стек: Node.js, TypeScript, Express, Telegraf, Vite (React)
- Дев-сервер: Vite на 5173, сервер API на 3000, бот с long-polling
- ngrok публикует Vite (5173), прокси /api -> http://localhost:3000 (Vite proxy)
'@

# Общая базовая tsconfig
Write-Utf8File (Join-Path $Root "tsconfig.base.json") @'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "sourceMap": true
  }
}
'@

# Корневой package.json (npm workspaces + dev скрипты)
Write-Utf8File (Join-Path $Root "package.json") @'
{
  "name": "memorial",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "concurrently -k -n \"server,web,bot,ngrok\" -c \"green,cyan,magenta,yellow\" \"npm:dev:server\" \"npm:dev:web\" \"npm:dev:bot\" \"pwsh ./scripts/start-ngrok.ps1 -Port 5173 -UpdateEnv\"",
    "dev:server": "npm --workspace=@memorial/server run dev",
    "dev:web": "npm --workspace=@memorial/web run dev",
    "dev:bot": "npm --workspace=@memorial/bot run dev",
    "build": "npm run build -ws --if-present",
    "lint": "echo \"(lint placeholder)\"",
    "postinstall": "npm run build -ws --if-present"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
'@

# -----------------------------
# apps/server
# -----------------------------
Write-Utf8File (Join-Path $Root "apps/server/package.json") @'
{
  "name": "@memorial/server",
  "version": "0.1.0",
  "main": "dist/index.js",
  "license": "MIT",
  "scripts": {
    "dev": "nodemon --watch src --ext ts --exec ts-node src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.12",
    "@types/multer": "^1.4.11",
    "nodemon": "^3.0.3",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
'@

Write-Utf8File (Join-Path $Root "apps/server/tsconfig.json") @'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
'@

Write-Utf8File (Join-Path $Root "apps/server/src/index.ts") @'
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT_SERVER || 3000);

// Middlewares
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Simple API route
app.get("/api/ping", (_req, res) => res.json({ pong: true, ts: Date.now() }));

// Static (for future production build of Web)
// app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
'@

# -----------------------------
# apps/bot
# -----------------------------
Write-Utf8File (Join-Path $Root "apps/bot/package.json") @'
{
  "name": "@memorial/bot",
  "version": "0.1.0",
  "main": "dist/bot.js",
  "license": "MIT",
  "scripts": {
    "dev": "nodemon --watch src --ext ts --exec ts-node src/bot.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/bot.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "telegraf": "^4.16.3"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "nodemon": "^3.0.3",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
'@

Write-Utf8File (Join-Path $Root "apps/bot/tsconfig.json") @'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
'@

Write-Utf8File (Join-Path $Root "apps/bot/src/bot.ts") @'
import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

const token = process.env.TGBOT_TOKEN;
if (!token) {
  console.error("[bot] Missing TGBOT_TOKEN in .env");
  process.exit(1);
}

const WEBAPP_URL = process.env.WEBAPP_URL || "https://example.com";
const bot = new Telegraf(token);

bot.start((ctx) => {
  const kb = Markup.keyboard([
    [Markup.button.webApp("Открыть редактор", WEBAPP_URL)]
  ]).resize();
  ctx.reply("Добро пожаловать в Memorial! Откройте редактор:", kb);
});

bot.command("web", (ctx) => {
  const kb = Markup.inlineKeyboard([
    Markup.button.webApp("Открыть редактор", WEBAPP_URL)
  ]);
  ctx.reply("Откройте мини‑приложение:", kb);
});

bot.on("message", (ctx) => {
  ctx.reply("Я бот проекта Memorial. Используйте /start или кнопку WebApp.");
});

bot.launch().then(() => {
  console.log("[bot] Launched. Press Ctrl+C to stop.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
'@

# -----------------------------
# apps/web (Vite + React + TS)
# -----------------------------
Write-Utf8File (Join-Path $Root "apps/web/package.json") @'
{
  "name": "@memorial/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite --port 5173 --strictPort",
    "build": "vite build",
    "preview": "vite preview --port 5173 --strictPort"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.2.74",
    "@types/react-dom": "^18.2.24",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.2.10"
  }
}
'@

Write-Utf8File (Join-Path $Root "apps/web/tsconfig.json") @'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "allowJs": false,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
'@

Write-Utf8File (Join-Path $Root "apps/web/vite.config.ts") @'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
});
'@

Write-Utf8File (Join-Path $Root "apps/web/index.html") @'
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Memorial</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
'@

Write-Utf8File (Join-Path $Root "apps/web/src/main.tsx") @'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
'@

Write-Utf8File (Join-Path $Root "apps/web/src/App.tsx") @'
import React, { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram: any;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [ping, setPing] = useState<string>("");

  useEffect(() => {
    try {
      window.Telegram?.WebApp?.ready();
      setReady(true);
    } catch (e) {
      console.warn("Telegram WebApp SDK not available in this context.");
    }
  }, []);

  const fetchPing = async () => {
    const res = await fetch("/api/ping");
    const json = await res.json();
    setPing(JSON.stringify(json, null, 2));
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, Arial", padding: 16 }}>
      <h1>Memorial</h1>
      <p>Мини‑приложение Telegram (черновой каркас редактора).</p>
      <p>WebApp SDK: {ready ? "готов" : "не обнаружен"}</p>
      <button onClick={fetchPing}>Проверить API (/api/ping)</button>
      {ping && <pre style={{ background: "#111", color: "#0f0", padding: 12 }}>{ping}</pre>}
    </div>
  );
}
'@

# -----------------------------
# .env и пример
# -----------------------------
Write-Utf8File (Join-Path $Root ".env.example") @'
# Бот
TGBOT_TOKEN=your_telegram_bot_token_here
# Менеджерский чат (через запятую, числа)
MANAGER_CHAT_IDS=
# URL WebApp (ngrok https URL на порт 5173)
WEBAPP_URL=
# Порты
PORT_SERVER=3000
PORT_WEB=5173
NODE_ENV=development
# NGROK
NGROK_AUTHTOKEN=
'@

if (-not (Test-Path -LiteralPath (Join-Path $Root ".env"))) {
  Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
}

# -----------------------------
# ngrok helper script
# -----------------------------
Write-Utf8File (Join-Path $Root "scripts/start-ngrok.ps1") @'
param(
  [int]$Port = 5173,
  [switch]$UpdateEnv
)

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Update-Env-Var([string]$File, [string]$Key, [string]$Value) {
  if (-not (Test-Path -LiteralPath $File)) {
    "" | Set-Content -LiteralPath $File -Encoding utf8
  }
  $content = Get-Content -LiteralPath $File -Raw
  if ($content -match "^\s*${Key}\s*=") {
    $content = [System.Text.RegularExpressions.Regex]::Replace($content, "^\s*${Key}\s*=.*$", "${Key}=$Value", "Multiline")
  } else {
    if ($content -and -not $content.EndsWith("`n")) { $content += "`n" }
    $content += "${Key}=$Value`n"
  }
  $content | Set-Content -LiteralPath $File -Encoding utf8
}

if (-not (Get-Command "ngrok" -ErrorAction SilentlyContinue)) {
  Write-Warning "ngrok не найден в PATH."
  exit 0
}

# Если указан токен в .env — добавить в конфиг ngrok
$envPath = Resolve-Path -LiteralPath ".\.env"
$envText = (Test-Path $envPath) ? (Get-Content -LiteralPath $envPath -Raw) : ""
$token = ""
if ($envText -match "NGROK_AUTHTOKEN\s*=\s*(.+)") {
  $token = $Matches[1].Trim()
}
if ($token) {
  try {
    ngrok config add-authtoken $token | Out-Null
  } catch {
    Write-Warning "Не удалось применить NGROK_AUTHTOKEN."
  }
}

# Проверка, запущен ли уже локальный API ngrok
$apiUrl = "http://127.0.0.1:4040/api/tunnels"

function Get-PublicUrl {
  try {
    $resp = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 2
    foreach ($t in $resp.tunnels) {
      if ($t.public_url -like "https://*") { return $t.public_url }
    }
  } catch { }
  return $null
}

$publicUrl = Get-PublicUrl
if (-not $publicUrl) {
  Write-Host "Запуск ngrok на порту $Port ..."
  Start-Process -WindowStyle Minimized -FilePath "ngrok" -ArgumentList "http $Port" | Out-Null
  # Ждём поднятия API ngrok
  $retries = 30
  do {
    Start-Sleep -Milliseconds 500
    $publicUrl = Get-PublicUrl
    $retries--
  } while (-not $publicUrl -and $retries -gt 0)
}

if ($publicUrl) {
  Write-Host "ngrok URL: $publicUrl"
  if ($UpdateEnv) {
    Update-Env-Var -File ".\.env" -Key "WEBAPP_URL" -Value $publicUrl
    Write-Host "Обновлён .env -> WEBAPP_URL=$publicUrl"
  }
} else {
  Write-Warning "Не удалось получить публичный URL от ngrok."
}
'@

# -----------------------------
# Git init
# -----------------------------
if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
  if (Tool-Exists "git") {
    git init | Out-Null
  }
}

# -----------------------------
# Установка npm-зависимостей
# -----------------------------
if (Tool-Exists "node") {
  Write-Host "Установка npm-зависимостей (workspaces) ..."
  npm install
} else {
  Write-Warning "Node.js не обнаружен — пропуск npm install."
}

# -----------------------------
# NGROK токен (опционально)
# -----------------------------
if (Tool-Exists "ngrok") {
  $userToken = Read-Host "Введите NGROK_AUTHTOKEN (или оставьте пустым, чтобы пропустить)"
  if ($userToken) {
    try {
      ngrok config add-authtoken $userToken | Out-Null
      Write-Host "ngrok токен применён."
      # Обновим .env
      $envPath2 = Join-Path $Root ".env"
      $envText2 = Get-Content -LiteralPath $envPath2 -Raw
      if ($envText2 -notmatch "NGROK_AUTHTOKEN") {
        Add-Content -LiteralPath $envPath2 -Encoding utf8 "NGROK_AUTHTOKEN=$userToken"
      } else {
        # заменить значение
        $envText2 = [System.Text.RegularExpressions.Regex]::Replace($envText2, "^\s*NGROK_AUTHTOKEN\s*=.*$", "NGROK_AUTHTOKEN=$userToken", "Multiline")
        $envText2 | Set-Content -LiteralPath $envPath2 -Encoding utf8
      }
    } catch {
      Write-Warning "Не удалось применить токен ngrok."
    }
  }
}

# -----------------------------
# Первый коммит
# -----------------------------
if (Tool-Exists "git") {
  git add -A | Out-Null
  try {
    git commit -m "chore: initial scaffold for Memorial" | Out-Null
  } catch { }
}

Write-Host ""
Write-Host "Готово! Дальше:"
Write-Host "1) Заполните .env (TGBOT_TOKEN обязательно)."
Write-Host "2) Запустите дев-среду: npm run dev"
Write-Host "   - В консоли появится ngrok https URL; он автоматически попадёт в .env как WEBAPP_URL."
Write-Host "3) В Telegram отправьте /start боту — кнопка откроет мини-приложение."
Write-Host ""
Write-Host "Пути:"
Write-Host "  Сервер API: http://localhost:3000 (через Vite доступен как /api)"
Write-Host "  Веб (Vite): http://localhost:5173 (публикуется через ngrok)"
Write-Host ""