# patch-review-send-email.ps1
# Делает бэкап ReviewAndSendStep.tsx и патчит: после Telegram-отправки отправляет PDF на почту через /api/email (multipart).
# Запускать из корня репозитория (где есть папка apps).

$ErrorActionPreference = "Stop"

$File = "apps/web/src/screens/ReviewAndSendStep.tsx"
if (!(Test-Path $File)) {
  throw "File not found: $File"
}

# --- backup ---
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$File.bak.$stamp"
Copy-Item $File $backup -Force
Write-Host "Backup created: $backup"

# --- read ---
$src = Get-Content $File -Raw -Encoding UTF8

# --- 1) insert helper function sendPdfToEmailMultipart (only if absent) ---
if ($src -notmatch "sendPdfToEmailMultipart") {

  $needle = "async function sendManagerPhoto"
  $idx = $src.IndexOf($needle)
  if ($idx -lt 0) { throw "Cannot find insertion point near: $needle" }

  $insertBlock = @'
  async function sendPdfToEmailMultipart(pdfBlob: Blob, meta: { orderNo: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      const fd = new FormData();
      fd.append("action", "send_pdf");
      fd.append("orderNo", meta.orderNo || "");
      fd.append("subject", meta.subject || "");
      fd.append("text", meta.text || "");
      fd.append("filename", `order-${meta.orderNo || Date.now()}.pdf`);
      fd.append("file", new File([pdfBlob], `order-${meta.orderNo || Date.now()}.pdf`, { type: "application/pdf" }));

      const resp = await fetch("/api/email", { method: "POST", body: fd });
      const raw = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {}
      if (resp.ok && json?.ok) return { ok: true };
      return { ok: false, error: json?.error || raw || resp.statusText };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

'@

  $src = $src.Substring(0, $idx) + $insertBlock + $src.Substring($idx)
  Write-Host "Inserted sendPdfToEmailMultipart() helper."
} else {
  Write-Host "sendPdfToEmailMultipart() already exists; skip insert."
}

# --- 2) insert email sending block after end marker (only if absent) ---
if ($src -notmatch "sendPdfToEmailMultipart\(") {
  throw "Unexpected: helper name not found after insert."
}

if ($src -notmatch "Email не отправлен") {
  $endMarker = 'await sendManagerMessage(endMarkerText(orderNoCur));'
  $idx2 = $src.IndexOf($endMarker)
  if ($idx2 -lt 0) { throw "Cannot find end marker line: $endMarker" }

  $emailBlock = @'
      // === EMAIL: отправляем PDF на почту менеджеров ===
      try {
        const orderText = buildOrderText();

        const plateNodesLocal = showPlate ? plateToShow.map((p) => document.getElementById(`pdf-plate-sketch-${p.index}`)) : [];
        const plateUrlFallbacksLocal = showPlate ? plateToShow.map((p) => p.url) : [];

        const pdfBlob = await generateOrderPdfShots({
          draft: loadOrderDraft(),
          intro: loadIntroState(),
          topbarNode: document.getElementById("topbar-shot-root"),

          frontNode: document.getElementById("pdf-front-sketch"),
          backNode: showBack ? (document.getElementById("pdf-back-sketch") as any) : null,
          backUrlFallback: showBack ? backCandidateUrl : null,

          plateNodes: plateNodesLocal,
          plateUrlFallbacks: plateUrlFallbacksLocal,

          orderText,
          includeAttachedPhotos: true
        } as any);

        const mailRes = await sendPdfToEmailMultipart(pdfBlob, {
          orderNo: orderNoCur,
          subject: `Заявка №${orderNoCur || "—"} (PDF)`,
          text: orderText
        });

        if (!mailRes.ok) warnings.push(`Email не отправлен: ${mailRes.error || "ошибка"}`);
      } catch (e: any) {
        warnings.push(`Email не отправлен: ${String(e?.message || e)}`);
      }

'@

  $insertPos = $idx2 + $endMarker.Length
  $src = $src.Substring(0, $insertPos) + "`r`n`r`n" + $emailBlock + $src.Substring($insertPos)
  Write-Host "Inserted email sending block after end marker."
} else {
  Write-Host "Email block seems already present (matched 'Email не отправлен'); skip insert."
}

# --- write back ---
Set-Content -Path $File -Value $src -Encoding UTF8
Write-Host "Patched: $File"
Write-Host "Done."