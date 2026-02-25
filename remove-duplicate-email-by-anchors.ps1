# remove-duplicate-email-by-anchors.ps1
$ErrorActionPreference = "Stop"

$file = "apps/web/src/screens/ReviewAndSendStep.tsx"
if (!(Test-Path $file)) { throw "File not found: $file" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$file.bak.$stamp"
Copy-Item $file $backup -Force
Write-Host "Backup created: $backup"

$src = Get-Content $file -Raw -Encoding UTF8

$anchorPdf = "const pdfBlob = await generateOrderPdfShots({"
$idx1 = $src.IndexOf($anchorPdf)
if ($idx1 -lt 0) { throw "Anchor not found: $anchorPdf" }

$idx2 = $src.IndexOf($anchorPdf, $idx1 + $anchorPdf.Length)
if ($idx2 -lt 0) {
  Write-Host "Second email/pdf block not found. Nothing to remove."
  exit 0
}

# Prefer explicit marker end
$endMarker = "// === EMAIL END ==="
$endIdx = $src.IndexOf($endMarker, $idx2)
if ($endIdx -ge 0) {
  # remove including marker line
  $endIdx2 = $src.IndexOf("`n", $endIdx)
  if ($endIdx2 -lt 0) { $endIdx2 = $endIdx + $endMarker.Length }
  $len = ($endIdx2 - $idx2)
  $src = $src.Remove($idx2, $len)
  Write-Host "Removed duplicate email block using EMAIL END marker."
} else {
  # fallback: remove until notifyUserAfterSend
  $fallback = "await notifyUserAfterSend(orderNoCur);"
  $fIdx = $src.IndexOf($fallback, $idx2)
  if ($fIdx -lt 0) { throw "Cannot find fallback anchor after second block: $fallback" }
  $src = $src.Remove($idx2, $fIdx - $idx2)
  Write-Host "Removed duplicate email block using fallback anchor."
}

Set-Content -Path $file -Value $src -Encoding UTF8
Write-Host "Patched: $file"
Write-Host "Done."

Write-Host "Check remaining calls:"
Select-String -Path $file -Pattern "const mailRes = await sendPdfToEmailMultipart" -Context 1,1