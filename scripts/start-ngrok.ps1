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
