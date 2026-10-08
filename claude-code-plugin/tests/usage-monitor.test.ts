// Run: claude plugin test <this plugin folder>
// The engine's own kit: hooks registered here stand for the engine beneath the
// plugin (network, files, credential, clock), so nothing real is touched.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ORG = '00000000-0000-4000-8000-000000000000'
const T0 = Date.parse('2026-10-07T09:00:00Z')
const usageBody = (weekly: number) => JSON.stringify({
  five_hour: { utilization: 8, resets_at: '2026-10-07T14:09:59Z' },
  seven_day: { utilization: weekly, resets_at: '2026-10-09T18:59:59Z' },
  iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00Z', remaining_dollars: 100, limit_dollars: 100 },
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
})
const FOOTER = (columns?: number, modes: string[] = []) => ({
  plugin: 'usage-monitor',
  surface: 'desktop' as const,
  component: 'SessionMode' as const,
  props: { modes },
  ...(columns === undefined ? {} : { viewport: { columns, rows: 40 } }),
})

type World = { weekly: number; usageStatus: number; requests: string[]; files: Map<string, string>; isSignedIn: boolean }

/** The engine beneath the plugin: a fake API, an in-memory disk, a credential. */
function engine(on: On, world: World) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { CLAUDE_CODE_ORGANIZATION_UUID: ORG })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  on('session.authorize', () => ({ value: world.isSignedIn ? { handle: 'opaque-handle', kind: 'bearer' as const } : null }))
  on('fs.read', ($, e) => {
    const text = world.files.get(String(e.path))
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.files.set(String(e.path), String(e.text))
    return { value: undefined }
  })
  on('http.fetch', ($, e) => {
    world.requests.push(String(e.url))
    if (String(e.url).endsWith('/api/oauth/usage')) {
      return { value: { status: world.usageStatus, ok: world.usageStatus < 300, headers: {}, text: world.usageStatus < 300 ? usageBody(world.weekly) : '{"error":{}}' } }
    }
    if (String(e.url).endsWith(`/organizations/${ORG}/prepaid/credits`)) {
      return { value: { status: 200, ok: true, headers: {}, text: '{"amount":0,"currency":"USD","auto_reload_settings":{"enabled":false}}' } }
    }
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  return clock
}

const world = (over: Partial<World> = {}): World => ({ weekly: 36, usageStatus: 200, requests: [], files: new Map(), isSignedIn: true, ...over })

async function start($: any) {
  await $.session.start({ cwd: 'C:/work', surface: 'desktop', isInteractive: true })
}

/** The footer as it reads (the Desktop joins the Text runs with spaces), and its runs. */
async function footer($: any, columns?: number, modes?: string[]) {
  const ui = await $.ui.mount(FOOTER(columns, modes))
  const runs = (await ui.findAll({ type: 'Text' })).map((t: any) => ({ text: String(t.text), props: t.props }))
  const boxes = await ui.findAll({ type: 'Box' })
  const svgs = await ui.findAll({ type: 'Svg' })
  await ui.unmount()
  return { text: runs.map((r: any) => r.text).join(' '), runs, hasBackground: boxes.some((b: any) => b.props.backgroundColor !== undefined || b.props.borderStyle !== undefined), svgs: svgs.length }
}

test('the footer reads W · S only, from the real endpoints, as plain text', { timeoutMs: 15000 }, async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await start($)
  await clock.advance(1)
  const f = await footer($)
  expect(f.text).toBe('W 36% · S 8%')
  expect(/☁|\$/.test(f.text), 'no cloud or credit figures').toBe(false)
  expect(f.svgs, 'no images in the footer').toBe(0)
  expect(f.hasBackground, 'no background, border or container').toBe(false)
  expect(w.requests).toEqual([
    'https://api.anthropic.com/api/oauth/usage',
    `https://api.anthropic.com/api/oauth/organizations/${ORG}/prepaid/credits`,
  ])
})

test('only a percentage takes a colour, and only once it needs attention', { timeoutMs: 30000 }, async ($, on) => {
  // Usage only rises within a window, so the readings climb minute by minute.
  const w = world({ weekly: 0 })
  const clock = engine(on, w)
  await start($)
  await clock.advance(1)
  const expected = { 0: { dimColor: true }, 36: { dimColor: true }, 59: { dimColor: true }, 60: { color: 'warning' }, 79: { color: 'warning' }, 80: { color: 'claude' }, 94: { color: 'claude' }, 95: { color: 'error' }, 100: { color: 'error' } } as const
  for (const [pct, style] of Object.entries(expected)) {
    w.weekly = Number(pct)
    await clock.advance(61_000)
    const f = await footer($)
    const [label, figure] = f.runs
    expect(label?.text).toBe('W')
    expect(label?.props, 'the W label stays muted').toEqual({ dimColor: true })
    expect(figure?.text).toBe(`${pct}%`)
    expect(figure?.props, `${pct}%`).toEqual(style)
    expect(f.runs.filter((r: any) => r.text === '·').every((r: any) => r.props.dimColor === true)).toBe(true)
  }
})

test('narrow windows drop session; weekly always stays', { timeoutMs: 15000 }, async ($, on) => {
  const clock = engine(on, world())
  await start($)
  await clock.advance(1)
  expect((await footer($, 140)).text).toBe('W 36% · S 8%')
  expect((await footer($, 55)).text).toBe('W 36% · S 8%')
  expect((await footer($, 45)).text).toBe('W 36%')
  expect((await footer($, 10)).text).toBe('W 36%')
})

test("Claude's own mode labels stay first when it shows any", { timeoutMs: 15000 }, async ($, on) => {
  const clock = engine(on, world())
  await start($)
  await clock.advance(1)
  const f = await footer($, 140, ['focus'])
  expect(f.text.startsWith('focus · W 36%')).toBe(true)
})

test('API error: the footer shows W — and nothing throws', { timeoutMs: 15000 }, async ($, on) => {
  const clock = engine(on, world({ usageStatus: 503 }))
  await start($)
  await clock.advance(1)
  expect((await footer($)).text).toBe('W —')
})

test('signed out: W —', { timeoutMs: 15000 }, async ($, on) => {
  const clock = engine(on, world({ isSignedIn: false }))
  await start($)
  await clock.advance(1)
  expect((await footer($)).text).toBe('W —')
})

test('one request a minute, shared through the cache file', { timeoutMs: 15000 }, async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await start($)
  await clock.advance(1)
  expect(w.requests.length).toBe(2)
  await clock.advance(30_000)
  expect(w.requests.length).toBe(2)
  await clock.advance(31_000)
  expect(w.requests.length).toBe(4)
  const cachePath = [...w.files.keys()].find(p => /cache[\\/]usage\.json$/.test(p))
  expect(cachePath !== undefined, 'written: ' + [...w.files.keys()].join(', ')).toBe(true)
  const cache = JSON.parse(w.files.get(cachePath as string) as string)
  expect(cache.snapshot.weekly.usedPct).toBe(36)
  expect(JSON.stringify(cache).includes('opaque-handle')).toBe(false)
})

test('live rate limits from API responses update the footer without a request', { timeoutMs: 15000 }, async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await start($)
  await clock.advance(1)
  const before = w.requests.length
  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-09T18:59:59Z' }],
    changed: ['rateLimits'],
  })
  expect((await footer($)).text.startsWith('W 41% · S 8%')).toBe(true)
  expect(w.requests.length).toBe(before)
})

test('no row above the prompt any more, and the terminal is left alone', { timeoutMs: 15000 }, async ($, on) => {
  const clock = engine(on, world())
  await start($)
  await clock.advance(1)
  const band = await $.ui.mount({ plugin: 'usage-monitor', surface: 'desktop' as const, component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} } })
  expect((await band.findAll({ type: 'Text' })).length, 'the above-prompt band draws nothing of ours').toBe(0)
  expect((await band.findAll({ type: 'Svg' })).length).toBe(0)
  await band.unmount()
  const terminal = await $.ui.mount({ ...FOOTER(), surface: 'terminal' as const })
  expect((await terminal.findAll({ type: 'Text' })).some((t: any) => /\d+%/.test(t.text)), 'the terminal keeps its status line instead').toBe(false)
  await terminal.unmount()
})
