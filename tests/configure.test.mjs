// The settings editor must leave every unrelated setting exactly as it was.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SCRIPT = fileURLToPath(new URL('../scripts/configure.mjs', import.meta.url))
const ORIGINAL = {
  attribution: { commit: '', pr: '' },
  enabledPlugins: { 'superpowers@claude-plugins-official': true },
  extraKnownMarketplaces: { trailofbits: { source: { source: 'github', repo: 'trailofbits/skills' } } },
  autoUpdatesChannel: 'latest',
  theme: 'dark',
}

function sandbox(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'usage-monitor-cfg-'))
  if (settings !== undefined) writeFileSync(join(dir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2))
  const run = action => spawnSync(process.execPath, [SCRIPT, action], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8' })
  const read = () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  return { run, read }
}

test('install adds exactly two entries and keeps everything else', () => {
  const s = sandbox(ORIGINAL)
  assert.equal(s.run('install').status, 0)
  const after = s.read()
  for (const [k, v] of Object.entries(ORIGINAL)) assert.deepEqual(after[k], v, `${k} untouched`)
  assert.match(after.statusLine.command, /^node ".*usage-monitor\/statusline\/statusline\.mjs"$/)
  assert.equal(after.statusLine.refreshInterval, 30)
  assert.match(after.env.CLAUDE_CODE_PLUGIN_DIRS, /usage-monitor[\\/]claude-code-plugin$/)
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(ORIGINAL), 'statusLine', 'env'].sort())
})

test('install is idempotent and uninstall restores the original exactly', () => {
  const s = sandbox(ORIGINAL)
  s.run('install')
  s.run('install')
  assert.equal(s.read().env.CLAUDE_CODE_PLUGIN_DIRS.split(';').length, 1, 'no duplicate plugin dir')
  assert.equal(s.run('uninstall').status, 0)
  assert.deepEqual(s.read(), ORIGINAL)
})

test('existing env vars, other plugin dirs and a foreign status line are kept', () => {
  const mine = { ...ORIGINAL, statusLine: { type: 'command', command: 'my-own-line.sh' }, env: { FOO: '1', CLAUDE_CODE_PLUGIN_DIRS: 'D:\\other\\plugin' } }
  const s = sandbox(mine)
  s.run('install')
  const after = s.read()
  assert.deepEqual(after.statusLine, mine.statusLine, 'foreign status line untouched')
  assert.equal(after.env.FOO, '1')
  assert.match(after.env.CLAUDE_CODE_PLUGIN_DIRS, /^D:\\other\\plugin;.*claude-code-plugin$/)
  s.run('uninstall')
  assert.deepEqual(s.read(), mine)
})

test('a malformed settings file is never overwritten', () => {
  const s = sandbox('{ "theme": "dark", oops')
  const r = s.run('install')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /usage-monitor:/)
})

test('a missing settings file is created', () => {
  const s = sandbox(undefined)
  assert.equal(s.run('install').status, 0)
  assert.ok(s.read().statusLine)
})
