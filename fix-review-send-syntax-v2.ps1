# fix-review-send-syntax-v2.ps1
# Бэкап + фиксирует ровно "}};" -> "};" (первое вхождение после setUploading(false);)
# Без 3-го аргумента у -replace (в Windows PowerShell так нельзя).

$ErrorActionPreference = "Stop"

$file = "apps/web/src/screens/ReviewAndSendStep.tsx"
if (!(Test-Path $file)) { throw "File not found: $file" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$file.bak.$stamp"
Copy-Item $file $backup -Force
Write-Host "Backup created: $backup"

$src = Get-Content $file -Raw -Encoding UTF8

$anchor = "setUploading(false);"
$pos = $src.IndexOf($anchor)
if ($pos -lt 0) { throw "Anchor not found: $anchor" }

$before = $src.Substring(0, $pos)
$after  = $src.Substring($pos)

$bad = "}};"
$badPos = $after.IndexOf($bad)
if ($badPos -lt 0) {
  Write-Host "No '}};' found after anchor. Nothing changed." -ForegroundColor Yellow
} else {
  # replace only the first occurrence by slicing
  $after = $after.Substring(0, $badPos) + "};" + $after.Substring($badPos + $bad.Length)
  $src = $before + $after
  Write-Host "Fixed first '}};' after setUploading(false); -> '};'"
}

Set-Content -Path $file -Value $src -Encoding UTF8
Write-Host "Patched: $file"
Write-Host "Done."

Write-Host "`nCheck around the end of sendOrderDirect:"
Select-String -Path $file -Pattern "setUploading$false$;" -Context 5,5