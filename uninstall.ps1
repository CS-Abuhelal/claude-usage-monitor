# Claude Usage Monitor - complete removal.
#
#   powershell -ExecutionPolicy Bypass -File "$HOME\.claude\usage-monitor\uninstall.ps1"
#
# Removes its two entries from Claude Code's user settings (nothing else is
# touched), then deletes this whole folder (code, cache, backup). The browser
# extension is removed in the browser itself: chrome://extensions > Remove.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '> Removing the status line and plugin folder from Claude Code settings' -ForegroundColor Cyan
if (Get-Command node -ErrorAction SilentlyContinue) {
  node (Join-Path $Root 'scripts\configure.mjs') uninstall
  if ($LASTEXITCODE -ne 0) { throw 'Could not edit Claude Code settings; nothing was deleted. Remove "statusLine" and the usage-monitor entry of env.CLAUDE_CODE_PLUGIN_DIRS from ~\.claude\settings.json by hand, then run this again.' }
} else {
  throw 'Node.js not found: remove "statusLine" and the usage-monitor entry of env.CLAUDE_CODE_PLUGIN_DIRS from ~\.claude\settings.json by hand, then delete this folder.'
}

Write-Host '> Deleting the install folder' -ForegroundColor Cyan
Set-Location $HOME
Remove-Item -LiteralPath $Root -Recurse -Force
Write-Host "  deleted $Root"

Write-Host "`nLast step, in your browser: open chrome://extensions and click Remove on 'Claude Usage Monitor'." -ForegroundColor Yellow
Write-Host 'Restart open Claude Code sessions (terminal and Desktop) to drop the status line and band.' -ForegroundColor Green
