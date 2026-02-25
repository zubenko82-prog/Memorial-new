# fix-subject-simple.ps1
# Бэкап + правит ТОЛЬКО простую причину: "subject: subject" -> явная строка.
# Никаких сложных regex с `${}` и т.п., чтобы не ломать PowerShell парсер.

$ErrorActionPreference = "Stop"

$File = "apps/web/src/screens/ReviewAndSendStep.tsx"
if (!(Test-Path $File)) { throw "File not found: $File" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$File.bak.$stamp"
Copy-Item $File $backup -Force
Write-Host "Backup created: $backup"

$src = Get-Content $File -Raw -Encoding UTF8

# заменяем любые варианты "subject: subject" (с пробелами/переносами)
$pattern = '(?m)subject\s*:\s*subject\b'
$replacement = 'subject: `Заявка №${orderNoCur || "—"} (PDF)`'

$src2 = [regex]::Replace($src, $pattern, $replacement)

if ($src2 -eq $src) {
  Write-Host "No occurrences of 'subject: subject' found. Need exact code around the email call." -ForegroundColor Yellow
  Write-Host "Run this and paste output:" -ForegroundColor Yellow
  Write-Host '  Select-String -Path apps/web/src/screens/ReviewAndSendStep.tsx -Pattern "sendPdfToEmailMultipart|/api/email|\bsubject\b" -Context 3,3'
  exit 1
}

Set-Content -Path $File -Value $src2 -Encoding UTF8
Write-Host "Patched: $File"
Write-Host "Done."