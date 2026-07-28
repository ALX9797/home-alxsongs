# =====================================================================
#  serve.ps1 — zero-dependency static server for the preview build.
#  ---------------------------------------------------------------------
#  Port 8000 on purpose: that origin is already on the Cloudflare
#  Worker's allow-list, so news, esports and the daily word all work
#  locally exactly as they do on the live site.
#
#  Run:   powershell -ExecutionPolicy Bypass -File preview\serve.ps1
#  Stop:  Ctrl+C
# =====================================================================

param(
  [int]$Port = 8000,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path

$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'
  '.css' ='text/css; charset=utf-8';  '.js' ='application/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'
  '.png' ='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'
  '.ico' ='image/x-icon'; '.webp'='image/webp'; '.woff'='font/woff'; '.woff2'='font/woff2'
  '.txt' ='text/plain; charset=utf-8'; '.map'='application/json'; '.sql'='text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host ""
Write-Host "  preview  ->  http://localhost:$Port/" -ForegroundColor Green
Write-Host "  serving  ->  $Root"
Write-Host "  stop     ->  Ctrl+C"
Write-Host ""

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $path = Join-Path $Root $rel

      # keep requests inside the preview folder
      $full = [System.IO.Path]::GetFullPath($path)
      if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
        $res.Close()
        continue
      }

      if ((Test-Path $full) -and (Get-Item $full).PSIsContainer) {
        $full = Join-Path $full 'index.html'
      }

      if (Test-Path $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        # always fresh, so edits show up on reload
        $res.Headers.Add('Cache-Control', 'no-store, must-revalidate')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host ("  200  " + $rel)
      } else {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel not found")
        $res.StatusCode = 404
        $res.ContentType = 'text/plain; charset=utf-8'
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
        Write-Host ("  404  " + $rel) -ForegroundColor DarkYellow
      }
    } catch {
      Write-Host ("  500  " + $_.Exception.Message) -ForegroundColor Red
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
