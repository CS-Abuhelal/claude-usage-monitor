// Run: node --test tests/   (from the usage-monitor folder)
// Times are checked in a fixed zone so the assertions hold on any machine.
process.env.TZ = 'Etc/GMT-3' // fixed UTC+3, no DST (POSIX sign is inverted)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backoffMs, describeError, emptyCache, isDue, parseCache, withFailure, withSuccess } from '../core/usage-cache.mjs'
import { describeUsage, formatCountdown, formatExpiry, formatMoney, formatPercent, formatResetTime, itemsForLevel, ringGlyph, ringSvg, severityOf, VISIBLE_METRICS } from '../core/usage-format.mjs'
import { fresherWindow, fromEngineRateLimits, fromPrepaidCredits, fromStatusLineRateLimits, fromUsagePayload, mergeSnapshot, toIso } from '../core/usage-schema.mjs'

const NOW = Date.parse('2026-10-07T09:00:00Z') // Wednesday 12:00 PM at UTC+3

// Shape as returned by /api/oauth/usage and claude.ai .../usage (Oct 2026).
const PAYLOAD = {
  five_hour: { utilization: 8, resets_at: '2026-10-07T14:09:59.871Z' },
  seven_day: { utilization: 36, resets_at: '2026-10-09T18:59:59.871Z' },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 4.5, resets_at: '2026-10-09T18:59:59.871Z' },
  iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00Z', remaining_dollars: 100, limit_dollars: 100 },
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  unknown_future_window: { utilization: 3, resets_at: null },
}

test('severity bands match the spec', () => {
  assert.equal(severityOf(0), 'normal')
  assert.equal(severityOf(36), 'normal')
  assert.equal(severityOf(59.9), 'normal')
  assert.equal(severityOf(60), 'elevated')
  assert.equal(severityOf(79), 'elevated')
  assert.equal(severityOf(80), 'warning')
  assert.equal(severityOf(94), 'warning')
  assert.equal(severityOf(95), 'critical')
  assert.equal(severityOf(100), 'critical')
  assert.equal(severityOf(null), 'unknown')
  assert.equal(severityOf(undefined), 'unknown')
  assert.equal(severityOf(NaN), 'unknown')
})

test('percent formatting', () => {
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(2.4), '2%')
  assert.equal(formatPercent(36), '36%')
  assert.equal(formatPercent(100), '100%')
  assert.equal(formatPercent(null), '—')
})

test('normalises the usage payload', () => {
  const s = fromUsagePayload(PAYLOAD)
  assert.deepEqual(s.session, { usedPct: 8, resetsAt: '2026-10-07T14:09:59.871Z' })
  assert.deepEqual(s.weekly, { usedPct: 36, resetsAt: '2026-10-09T18:59:59.871Z' })
  assert.deepEqual(s.weeklyScoped, [{ label: 'Sonnet', usedPct: 4.5, resetsAt: '2026-10-09T18:59:59.871Z' }])
  assert.equal(s.cloudCredits.length, 1)
  assert.deepEqual(s.cloudCredits[0], { key: 'iguana_necktie', label: 'Cloud Session Credits', ends: 'Expires', remaining: 100, total: 100, usedPct: 0, endsAt: '2026-11-05T07:59:00.000Z', currency: 'USD' })
  assert.deepEqual(s.extraUsage, { enabled: false, monthlyLimit: null, used: null, usedPct: null, currency: 'USD' })
})

test('missing, null and malformed fields are left out, never thrown on', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}]) assert.deepEqual(fromUsagePayload(bad), {})
  const s = fromUsagePayload({ five_hour: null, seven_day: { utilization: null }, iguana_necktie: 'nope', extra_usage: { is_enabled: 'yes' } })
  assert.deepEqual(s, {})
  const partial = fromUsagePayload({ seven_day: { utilization: '61.5', resets_at: 'not a date' } })
  assert.deepEqual(partial.weekly, { usedPct: 61.5, resetsAt: null })
})

test('credit windows: dollars derive the percentage when utilization is absent', () => {
  const s = fromUsagePayload({ tangelo: { remaining_dollars: 25, limit_dollars: 100, resets_at: '2026-10-20T00:00:00Z' } })
  assert.equal(s.cloudCredits[0].usedPct, 75)
  assert.equal(s.cloudCredits[0].ends, 'Refills')
})

test('extra usage and prepaid credits are minor units', () => {
  const s = fromUsagePayload({ extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.7, currency: 'USD' } })
  assert.deepEqual(s.extraUsage, { enabled: true, monthlyLimit: 50, used: 12.34, usedPct: 24.7, currency: 'USD' })
  assert.deepEqual(fromPrepaidCredits({ amount: 0, currency: 'USD', auto_reload_settings: { enabled: false } }), { usageCredits: { available: 0, currency: 'USD', autoReload: false } })
  assert.deepEqual(fromPrepaidCredits({ amount: 1550, currency: 'USD' }), { usageCredits: { available: 15.5, currency: 'USD', autoReload: null } })
  assert.deepEqual(fromPrepaidCredits({ error: 'x' }), {})
})

test('status line and engine rate limits', () => {
  const rl = fromStatusLineRateLimits({ five_hour: { used_percentage: 8, resets_at: 1791382199 }, seven_day: { used_percentage: 36, resets_at: 1791572399 } })
  assert.equal(rl.session.usedPct, 8)
  assert.equal(rl.session.resetsAt, new Date(1791382199 * 1000).toISOString())
  assert.equal(rl.weekly.usedPct, 36)
  assert.deepEqual(fromStatusLineRateLimits(undefined), {})
  const eng = fromEngineRateLimits([{ kind: 'seven_day', percentUsed: 37, resetsAt: '2026-10-09T18:59:59Z' }, { kind: 'spend_limit', percentUsed: 10 }])
  assert.deepEqual(eng, { weekly: { usedPct: 37, resetsAt: '2026-10-09T18:59:59.000Z' } })
})

test('toIso accepts ISO, epoch seconds and epoch ms', () => {
  assert.equal(toIso('2026-10-09T18:59:59Z'), '2026-10-09T18:59:59.000Z')
  assert.equal(toIso(1791572399), '2026-10-09T18:59:59.000Z')
  assert.equal(toIso(1791572399000), '2026-10-09T18:59:59.000Z')
  assert.equal(toIso(null), null)
  assert.equal(toIso('garbage'), null)
})

test('fresherWindow: same window takes the higher reading, a newer window wins, expired dropped', () => {
  const a = { usedPct: 36, resetsAt: '2026-10-09T18:59:59Z' }
  const b = { usedPct: 37, resetsAt: '2026-10-09T18:59:59.871Z' }
  assert.equal(fresherWindow(a, b, NOW).usedPct, 37)
  const newer = { usedPct: 1, resetsAt: '2026-10-16T18:59:59Z' }
  assert.equal(fresherWindow(a, newer, NOW).usedPct, 1)
  const expired = { usedPct: 99, resetsAt: '2026-10-01T00:00:00Z' }
  assert.equal(fresherWindow(expired, a, NOW).usedPct, 36)
  assert.equal(fresherWindow(null, undefined, NOW), null)
})

test('mergeSnapshot keeps good metrics when a later part lacks them', () => {
  const m = mergeSnapshot({ weekly: { usedPct: 30 }, usageCredits: { available: 1 } }, { weekly: { usedPct: 31 } }, null, { cloudCredits: undefined })
  assert.equal(m.weekly.usedPct, 31)
  assert.equal(m.usageCredits.available, 1)
})

test('reset times are local (UTC+3 here) and read naturally', () => {
  assert.equal(formatResetTime('2026-10-07T14:09:59Z', { now: NOW, locale: 'en-US' }), 'Today 5:09 PM')
  assert.equal(formatResetTime('2026-10-07T22:30:00Z', { now: NOW, locale: 'en-US' }), 'Tomorrow 1:30 AM')
  assert.equal(formatResetTime('2026-10-09T18:59:59Z', { now: NOW, locale: 'en-US' }), 'Friday 9:59 PM')
  assert.equal(formatResetTime('2026-11-05T07:59:00Z', { now: NOW, locale: 'en-US' }), 'November 5, 10:59 AM')
  assert.equal(formatResetTime(null, { now: NOW }), null)
  assert.equal(formatExpiry('2026-11-05T07:59:00Z', { locale: 'en-US' }), 'November 5 at 10:59 AM')
  assert.equal(formatCountdown('2026-10-09T18:59:59Z', NOW), 'in 2d 10h')
  assert.equal(formatCountdown('2026-10-07T13:57:00Z', NOW), 'in 4h 57m')
  assert.equal(formatCountdown('2026-10-07T08:00:00Z', NOW), 'now')
})

test('local time follows the machine zone (checked in two other zones)', async () => {
  const { spawnSync } = await import('node:child_process')
  const core = new URL('../core/usage-format.mjs', import.meta.url).href
  const code = `import(${JSON.stringify(core)}).then(m => process.stdout.write(m.formatResetTime('2026-10-09T18:59:59Z', { now: Date.parse('2026-10-07T09:00:00Z'), locale: 'en-US' })))`
  const run = tz => spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).stdout
  assert.equal(run('America/New_York'), 'Friday 2:59 PM')
  assert.equal(run('Asia/Tokyo'), 'Saturday 3:59 AM')
})

test('money', () => {
  assert.equal(formatMoney(100, 'USD', 'en-US'), '$100')
  assert.equal(formatMoney(0, 'USD', 'en-US'), '$0')
  assert.equal(formatMoney(12.5, 'USD', 'en-US'), '$12.50')
  assert.equal(formatMoney(null), '—')
})

test('describeUsage builds every tooltip from the spec', () => {
  const snap = mergeSnapshot(fromUsagePayload(PAYLOAD), fromPrepaidCredits({ amount: 0, auto_reload_settings: { enabled: false } }), { fetchedAt: NOW })
  const v = describeUsage(snap, { now: NOW, locale: 'en-US' })
  assert.equal(v.weekly.title, 'Weekly Usage')
  assert.deepEqual(v.weekly.lines.map(l => l.text), ['36% used', '64% remaining', 'Resets Friday 9:59 PM', 'Sonnet: 5% used'])
  assert.equal(v.weekly.lines[2].hint, 'in 2d 10h')
  assert.deepEqual(v.session.lines.map(l => l.text), ['8% used', '92% remaining', 'Resets Today 5:09 PM'])
  assert.equal(v.cloud.title, 'Cloud Session Credits')
  assert.deepEqual(v.cloud.lines.map(l => l.text), ['$100 / $100 remaining', '100% remaining', 'Expires November 5 at 10:59 AM'])
  assert.equal(v.cloud.short, '$100')
  assert.deepEqual(v.credits.lines.map(l => l.text), ['$0 available', 'Auto reload: Off', 'Extra usage: Off'])
  assert.equal(v.updated, 'just now')
  assert.equal(v.isStale, false)
})

test('describeUsage degrades per metric', () => {
  const v = describeUsage({ weekly: { usedPct: 95, resetsAt: null } }, { now: NOW })
  assert.equal(v.weekly.isAvailable, true)
  assert.equal(v.weekly.severity, 'critical')
  assert.deepEqual(v.weekly.lines.map(l => l.text), ['95% used', '5% remaining'])
  assert.equal(v.session.isAvailable, false)
  assert.equal(v.session.short, '—')
  assert.equal(v.cloud.isAvailable, false)
  assert.equal(v.credits.isAvailable, false)
  const empty = describeUsage(null, { now: NOW, reason: 'Signed out' })
  assert.equal(empty.weekly.short, '—')
  assert.equal(empty.weekly.lines[0].text, 'Signed out')
  assert.equal(describeUsage({ fetchedAt: NOW - 11 * 60000 }, { now: NOW }).isStale, true)
})

test('only weekly and session are shown: weekly first and never dropped, session label then ring go as room shrinks', () => {
  const snap = mergeSnapshot(fromUsagePayload(PAYLOAD), fromPrepaidCredits({ amount: 0, auto_reload_settings: { enabled: false } }), { fetchedAt: NOW })
  const v = describeUsage(snap, { now: NOW, locale: 'en-US' })
  assert.deepEqual(VISIBLE_METRICS, ['weekly', 'session'])
  const shape = level => itemsForLevel(v, level).map(i => `${i.metric.key}${i.hasLabel ? ':' + i.metric.short : ''}`).join(' ')
  assert.equal(shape(0), 'weekly:36% session:8%')
  assert.equal(shape(2), 'weekly:36% session:8%')
  assert.equal(shape(3), 'weekly:36% session')
  assert.equal(shape(4), 'weekly:36% session')
  assert.equal(shape(5), 'weekly:36%')
  assert.equal(shape(99), 'weekly:36%')
  // Hidden, not removed: cloud and usage credits are still parsed and described.
  assert.equal(v.cloud.isAvailable, true)
  assert.equal(v.cloud.short, '$100')
  assert.equal(v.credits.isAvailable, true)
  assert.equal(v.credits.short, '$0')
  assert.equal(itemsForLevel(v, 0)[0].isPrimary, true)
  assert.equal(itemsForLevel(describeUsage({}, { now: NOW }), 0).length, 1, 'unavailable metrics are hidden, weekly shows —')
})

test('rings: glyphs and SVG arcs follow the percentage', () => {
  assert.deepEqual([0, 10, 36, 50, 80, 95, 100, null].map(ringGlyph), ['○', '○', '◔', '◑', '◕', '●', '●', '○'])
  const circ = 2 * Math.PI * 7
  const svg36 = ringSvg({ usedPct: 36, size: 16, stroke: 2 })
  const dash = Number(/stroke-dasharray="([\d.]+)/.exec(svg36)[1])
  assert.ok(Math.abs(dash - 0.36 * circ) < 0.01, `36% arc is ${dash} of ${circ}`)
  assert.ok(!/stroke-dasharray/.test(ringSvg({ usedPct: 0 })), '0% draws the track only')
  assert.ok(!/stroke-dasharray/.test(ringSvg({ usedPct: null })), 'unknown draws the track only')
  assert.ok(/<title>a &amp; b<\/title>/.test(ringSvg({ usedPct: 5, title: 'a & b' })), 'titles are escaped')
})

test('cache policy: refresh every minute, back off on failure, parse defensively', () => {
  const fresh = withSuccess(emptyCache(), { weekly: { usedPct: 1 } }, NOW)
  assert.equal(fresh.snapshot.fetchedAt, NOW)
  assert.equal(isDue(fresh, NOW + 30000), false)
  assert.equal(isDue(fresh, NOW + 60000), true)
  const failed = withFailure(fresh, 'http-429', NOW)
  assert.equal(failed.failures, 1)
  assert.equal(failed.snapshot.weekly.usedPct, 1, 'a failure keeps the last good data')
  assert.equal(isDue(failed, NOW + 60000), false)
  assert.equal(isDue(failed, NOW + 120000), true)
  assert.equal(backoffMs(20), 15 * 60 * 1000)
  // A login failure backs off only the reader whose login it was.
  const terminalLoginDead = withFailure(withFailure(withFailure(fresh, 'token-expired', NOW, 'statusline'), 'token-expired', NOW, 'statusline'), 'token-expired', NOW + 1000, 'statusline')
  assert.equal(isDue(terminalLoginDead, NOW + 80000, 'statusline'), false, 'terminal waits out its backoff')
  assert.equal(isDue(terminalLoginDead, NOW + 80000, 'plugin'), true, 'desktop is not held back by the terminal login')
  const endpointDown = withFailure(fresh, 'http-503', NOW, 'plugin')
  assert.equal(isDue(endpointDown, NOW + 80000, 'statusline'), false, 'an endpoint failure backs off everyone')
  assert.deepEqual(parseCache('{oops'), emptyCache())
  assert.deepEqual(parseCache('{"v":99}'), emptyCache())
  assert.equal(describeError('http-429'), 'Usage endpoint is rate limited; retrying later')
  assert.equal(describeError(null), null)
})
