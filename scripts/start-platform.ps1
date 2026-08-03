# Starts backend + exchange + admin (the apps with latest market/catalog changes).
# Do NOT use frontend/ (port 3000) — that is the old token marketing site only.

$Root = Split-Path $PSScriptRoot -Parent

Write-Host "IBO platform dev servers" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:8000"
Write-Host "  Exchange: http://localhost:5173  (ibo-exchange)"
Write-Host "  Admin:    http://localhost:5174  (ibo-admin)"
Write-Host ""

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$Root\backend'; Write-Host 'Backend API :8000' -ForegroundColor Green; uvicorn server:app --reload --host 0.0.0.0 --port 8000"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$Root\ibo-exchange'; Write-Host 'Exchange UI :5173' -ForegroundColor Green; npm run dev"
)

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$Root\ibo-admin'; Write-Host 'Admin UI :5174' -ForegroundColor Green; npm run dev"
)

Write-Host "Opened 3 terminals. Wait ~10s, then open the URLs above." -ForegroundColor Yellow
