process.env.TZ = 'Etc/GMT-3' // fixed UTC+3

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

process.env.CLAUDE_USAGE_MONITOR_CACHE_DIR = mkdtempSync(join(tmpdir(), 'usage-monitor-test-'))

import { emptyCache, withFailure, withSuccess } from '../core/usage-cache.mjs'
import { render } from '../statusline/render.mjs'

const NOW = Date.parse('2026-10-07T09:00:00Z')
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')
const stdin = (five, seven) => ({
  rate_limits: {
    ...(five === undefined ? {} : { five_hour: { used_percentage: five, resets_at: Date.parse('2026-10-07T14:09:59Z') / 1000 } }),
    ...(seven === undefined ? {} : { seven_day: { used_percentage: seven, resets_at: Date.parse('2026-10-09T18:59:59Z') / 1000 } }),
  },
})
const cached = withSuccess(emptyCache(), {
  weekly: { usedPct: 30, resetsAt: '2026-10-09T18:59:59Z' },
  cloudCredits: [{ key: 'iguana_necktie', label: 'Cloud Session Credits', ends: 'Expires', remaining: 100, total: 100, usedPct: 0, endsAt: '2026-11-05T07:59:00Z', currency: 'USD' }],
  usageCredits: { available: 0, currency: 'USD', autoReload: false },
}, NOW - 20000)

test('weekly first and bold, then session; live figures win; nothing else is shown', () => {
  const out = render(stdin(8, 36), cached, NOW)
  assert.equal(plain(out), 'W ◔ 36% ↻ Friday 9:59 PM · S ○ 8%')
  assert.ok(out.startsWith('\x1b[1mW'), 'weekly is bold at rest')
})

test('every band from the spec', () => {
  const cases = [
    [0, 'W ○ 0%', '\x1b[1mW'],
    [36, 'W ◔ 36%', '\x1b[1mW'],
    [60, 'W ◑ 60%', '\x1b[1;38;5;179mW'],
    [80, 'W ◕ 80%', '\x1b[1;38;5;208mW'],
    [95, 'W ● 95%', '\x1b[1;1;38;5;196mW'],
    [100, 'W ● 100%', '\x1b[1;1;38;5;196mW'],
  ]
  for (const [pct, text, prefix] of cases) {
    const out = render(stdin(undefined, pct), emptyCache(), NOW)
    assert.ok(plain(out).startsWith(text), `${pct}% -> ${plain(out)}`)
    assert.ok(out.startsWith(prefix), `${pct}% colour -> ${JSON.stringify(out.slice(0, 16))}`)
  }
})

test('session shows its reset once it matters', () => {
  assert.ok(!plain(render(stdin(59, 10), emptyCache(), NOW)).includes('Today'))
  assert.ok(plain(render(stdin(72, 10), emptyCache(), NOW)).includes('S ◕ 72% ↻ Today 5:09 PM'))
})

test('no data at all: W — with the reason', () => {
  assert.equal(plain(render({}, emptyCache(), NOW)), 'W —')
  assert.equal(plain(render({}, withFailure(emptyCache(), 'token-expired', NOW), NOW)), 'W — · Waiting for Claude Code to refresh its login')
  assert.equal(plain(render({ rate_limits: null }, null, NOW)), 'W —')
})

test('cache only (before the first response): shows it, and its age when stale', () => {
  assert.equal(plain(render({}, cached, NOW)), 'W ◔ 30% ↻ Friday 9:59 PM')
  const old = { ...cached, snapshot: { ...cached.snapshot, fetchedAt: NOW - 30 * 60000 } }
  assert.equal(plain(render({}, old, NOW)), 'W ◔ 30% ↻ Friday 9:59 PM · updated 30 min ago')
})

test('cloud and usage credits stay off the line even when the cache holds them', () => {
  const rich = { ...cached, snapshot: { ...cached.snapshot, session: { usedPct: 91, resetsAt: '2026-10-07T14:09:59Z' }, usageCredits: { available: 12.5, currency: 'USD', autoReload: true } } }
  const line = plain(render({}, rich, NOW))
  assert.equal(line, 'W ◔ 30% ↻ Friday 9:59 PM · S ● 91% ↻ Today 5:09 PM')
  assert.ok(!/☁|\$|credits/.test(line))
})

test('the entry point never fails: garbage stdin still prints a line', () => {
  const script = fileURLToPath(new URL('../statusline/statusline.mjs', import.meta.url))
  const r = spawnSync(process.execPath, [script], { input: '{not json', encoding: 'utf8', timeout: 10000 })
  assert.equal(r.status, 0)
  assert.ok(r.stdout.length > 0)
  assert.equal(r.stderr, '')
})
