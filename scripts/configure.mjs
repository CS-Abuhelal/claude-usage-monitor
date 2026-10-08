// Claude Usage Monitor: adds or removes its two entries in Claude Code's
// user settings (~/.claude/settings.json), touching nothing else.
//
//   node scripts/configure.mjs install     statusLine + CLAUDE_CODE_PLUGIN_DIRS
//   node scripts/configure.mjs uninstall   removes exactly those again
//   node scripts/configure.mjs status
//
// - statusLine: the terminal status line. An existing status line that is not
//   ours is left alone (reported), never overwritten.
// - env.CLAUDE_CODE_PLUGIN_DIRS: loads claude-code-plugin/ in every Claude Code
//   session the Desktop app (or a newer CLI) starts. Other folders already
//   listed there are kept.
// The original file is backed up once, before the first change, and every
// write is atomic.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const SETTINGS = join(CONFIG_DIR, 'settings.json')
// Beside the settings it backs up (for the real install: this folder's backup/).
const BACKUP = join(CONFIG_DIR, 'usage-monitor', 'backup', 'settings.before-install.json')

const PLUGIN_DIR = join(ROOT, 'claude-code-plugin')
const STATUS_SCRIPT = join(ROOT, 'statusline', 'statusline.mjs').replaceAll('\\', '/')
const STATUS_LINE = { type: 'command', command: `node "${STATUS_SCRIPT}"`, padding: 0, refreshInterval: 30 }
const IS_OURS = /usage-monitor[\\/]+statusline[\\/]+statusline\.mjs/i

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

function readSettings() {
  if (!existsSync(SETTINGS)) return {}
  const text = readFileSync(SETTINGS, 'utf8').replace(/^﻿/, '')
  if (!text.trim()) return {}
  const value = JSON.parse(text) // a malformed file aborts: never clobber it
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${SETTINGS} is not a JSON object`)
  return value
}

function writeSettings(settings) {
  mkdirSync(dirname(SETTINGS), { recursive: true })
  const tmp = `${SETTINGS}.usage-monitor.tmp`
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`)
  renameSync(tmp, SETTINGS)
}

const pluginDirsOf = settings =>
  String(settings.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '')
    .split(delimiter)
    .map(s => s.trim())
    .filter(Boolean)

export function install() {
  const settings = readSettings()
  if (existsSync(SETTINGS) && !existsSync(BACKUP)) {
    mkdirSync(dirname(BACKUP), { recursive: true })
    copyFileSync(SETTINGS, BACKUP)
  }
  const report = { settings: SETTINGS }

  const existing = settings.statusLine
  if (!existing || IS_OURS.test(String(existing.command ?? ''))) {
    settings.statusLine = STATUS_LINE
    report.statusLine = 'installed'
  } else {
    report.statusLine = `kept your existing status line (${existing.command}); see README to switch`
  }

  const dirs = pluginDirsOf(settings)
  if (!dirs.some(d => samePath(d, PLUGIN_DIR))) dirs.push(PLUGIN_DIR)
  settings.env = { ...(settings.env ?? {}), CLAUDE_CODE_PLUGIN_DIRS: dirs.join(delimiter) }
  report.pluginDirs = settings.env.CLAUDE_CODE_PLUGIN_DIRS

  writeSettings(settings)
  return report
}

export function uninstall() {
  if (!existsSync(SETTINGS)) return { settings: SETTINGS, changed: false }
  const settings = readSettings()
  const report = { settings: SETTINGS }

  if (settings.statusLine && IS_OURS.test(String(settings.statusLine.command ?? ''))) {
    delete settings.statusLine
    report.statusLine = 'removed'
  }
  if (settings.env && 'CLAUDE_CODE_PLUGIN_DIRS' in settings.env) {
    const dirs = pluginDirsOf(settings).filter(d => !samePath(d, PLUGIN_DIR))
    if (dirs.length) settings.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(delimiter)
    else delete settings.env.CLAUDE_CODE_PLUGIN_DIRS
    if (Object.keys(settings.env).length === 0) delete settings.env
    report.pluginDirs = 'removed'
  }
  writeSettings(settings)
  return report
}

export function status() {
  const settings = readSettings()
  return {
    settings: SETTINGS,
    statusLine: settings.statusLine && IS_OURS.test(String(settings.statusLine.command ?? '')) ? 'installed' : settings.statusLine ? 'another status line' : 'none',
    plugin: pluginDirsOf(settings).some(d => samePath(d, PLUGIN_DIR)) ? 'installed' : 'not installed',
  }
}

const action = process.argv[2]
if (fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1] ?? '').toLowerCase()) {
  try {
    const run = { install, uninstall, status }[action]
    if (!run) throw new Error('usage: node configure.mjs install|uninstall|status')
    console.log(JSON.stringify(run(), null, 2))
  } catch (err) {
    console.error(`usage-monitor: ${err.message}`)
    process.exit(1)
  }
}
