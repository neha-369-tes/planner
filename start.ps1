# start.ps1 — Launch FlowState dev server
# Run with:  .\start.ps1

Write-Host "`n FlowState Dev Server" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor DarkGray

# Prefer bundled portable Node (no admin install needed)
$portableNode = Join-Path $PSScriptRoot ".tools\node-v24.14.0-win-x64"
if (Test-Path (Join-Path $portableNode "npm.cmd")) {
    $env:Path = "$portableNode;$env:Path"
    if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
        Write-Host " Installing dependencies with bundled Node..." -ForegroundColor Yellow
        & (Join-Path $portableNode "npm.cmd") install
    }

    Write-Host " Starting API on http://localhost:8787 ..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; `$env:Path='$portableNode;'+`$env:Path; & '$portableNode\npm.cmd' run api"

    Write-Host " Starting UI on http://localhost:3000 ..." -ForegroundColor Green
    & (Join-Path $portableNode "npm.cmd") run dev
}
# Try system Node fallback
elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host " Node found — starting API and live-server ..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run api"
    npm run dev
}
# Fallback: Python http.server
elseif (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host " Python found — starting http.server on http://localhost:3000 ..." -ForegroundColor Yellow
    Start-Process "http://localhost:3000"
    python -m http.server 3000
}
else {
    Write-Host " Neither Node nor Python found. Opening file directly..." -ForegroundColor Red
    Start-Process "$PSScriptRoot\index.html"
}
