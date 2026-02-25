# apply-email-clean.ps1
$ErrorActionPreference = "Stop"

$file = "apps/web/src/screens/ReviewAndSendStep.tsx"
if (!(Test-Path $file)) { throw "File not found: $file" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$file.bak.$stamp"
Copy-Item $file $backup -Force
Write-Host "Backup created: $backup"

$src = Get-Content $file -Raw -Encoding UTF8

# 0) remove any previous EMAIL blocks by markers
$src = [regex]::Replace(
  $src,
  "(?s)\r?\n\s*//\s*===\s*EMAIL:.*?\r?\n\s*//\s*===\s*EMAIL END\s*===\s*\r?\n",
  "`r`n"
)

# 1) ensure helper exists
if ($src -notmatch "async function sendPdfToEmailMultipart") {
  $needle = "async function sendManagerPhoto"
  $idx = $src.IndexOf($needle)
  if ($idx -lt 0) { throw "Cannot find insertion point near: $needle" }

  $helper = @'
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
      try { json = raw ? JSON.parse(raw) : null; } catch {}
      if (resp.ok && json?.ok) return { ok: true };
      return { ok: false, error: json?.error || raw || resp.statusText };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

'@

  $src = $src.Substring(0, $idx) + $helper + $src.Substring($idx)
  Write-Host "Inserted helper sendPdfToEmailMultipart()."
}

# 2) insert email block after end marker
$endMarker = "await sendManagerMessage(endMarkerText(orderNoCur));"
$pos = $src.IndexOf($endMarker)
if ($pos -lt 0) { throw "Cannot find: $endMarker" }
$insertPos = $pos + $endMarker.Length

$emailBlock = @'
      // === EMAIL: отправляем PDF на почту менеджеров ===
      // лёгкий PDF (без фото), чтобы не упираться в лимиты Vercel
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
          includeAttachedPhotos: false
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
      // === EMAIL END ===

'@

$src = $src.Substring(0, $insertPos) + "`r`n`r`n" + $emailBlock + $src.Substring($insertPos)

# 3) sanity: ensure only one call remains
$c = [regex]::Matches($src, "const\s+mailRes\s*=\s*await\s+sendPdfToEmailMultipart").Count
Write-Host "mailRes calls after patch: $c"

Set-Content -Path $file -Value $src -Encoding UTF8
Write-Host "Patched: $file"
Write-Host "Done."