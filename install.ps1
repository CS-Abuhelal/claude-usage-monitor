# Claude Usage Monitor - install / update.
#
#   powershell -ExecutionPolicy Bypass -File "$HOME\.claude\usage-monitor\install.ps1"
#
# Safe to run again at any time (it is also how you apply an update):
#   1. copies the shared core (core\) into the plugin and the browser extension
#   2. adds the status line and the plugin folder to Claude Code's user settings
#      (~\.claude\settings.json), leaving every other setting untouched
#   3. runs the tests
#   4. tells you how to load the browser extension (a one-time click in Chrome)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($text) { Write-Host "`n> $text" -ForegroundColor Cyan }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required (the status line runs on it). Install Node 18+ and run this again.'
}

Step 'Syncing the shared core into the plugin and the extension'
$core = Join-Path $Root 'core'
$pluginCore = Join-Path $Root 'claude-code-plugin\hooks\core'
$extCore = Join-Path $Root 'browser-extension\src\core'
New-Item -ItemType Directory -Force $pluginCore, $extCore | Out-Null
Copy-Item (Join-Path $core '*.mjs'), (Join-Path $core '*.d.mts') $pluginCore -Force
Copy-Item (Join-Path $core '*.mjs') $extCore -Force
Write-Host '  core -> claude-code-plugin\hooks\core, browser-extension\src\core'

Step 'Configuring Claude Code (user settings)'
node (Join-Path $Root 'scripts\configure.mjs') install
if ($LASTEXITCODE -ne 0) { throw 'Could not update Claude Code settings (see above). Nothing was changed.' }

Step 'Running tests'
Push-Location $Root
try {
  node --test tests/core.test.mjs tests/statusline.test.mjs tests/configure.test.mjs 2>&1 | Select-String -Pattern '\b(tests|pass|fail) \d+\s*$' | ForEach-Object { "  $_" }
} finally { Pop-Location }

$ext = Join-Path $Root 'browser-extension'
Step 'Browser extension (claude.ai in Chrome, Edge or Brave): one-time step'
Write-Host "  1. Open chrome://extensions (edge://extensions, brave://extensions)"
Write-Host "  2. Turn on 'Developer mode' (top right)"
Write-Host "  3. Click 'Load unpacked' and choose:"
Write-Host "       $ext" -ForegroundColor Yellow
Write-Host "  (The folder path is on your clipboard.) After an update, click the extension's reload arrow."
try { Set-Clipboard -Value $ext } catch {}

Write-Host "`nDone. Claude Code: new terminal sessions show the status line; new Code sessions in Claude Desktop show the usage band above the prompt." -ForegroundColor Green
