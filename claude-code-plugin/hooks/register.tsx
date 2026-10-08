// usage-monitor: plan usage as plain footer text in Claude Desktop's Code tab,
// beside "Opus 5.5  Extra":  W 56% · S 44% · ☁ $100
// Drawn into the footer's SessionMode slot (Claude's own dim status text); no
// row, band or container of its own. Details live on Claude's Usage page.
//
// Data: hooks/source.ts (fetching and the shared cache) refreshed once a
// minute, plus the engine's own rate-limit readings from every API response
// (session.measure), which are exact and free. Drawing: the desktop surface
// only; the terminal has the status line (statusline/ in the install folder).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageMonitorView } from '../types'
import { describeError } from './core/usage-cache.mjs'
import { describeUsage } from './core/usage-format.mjs'
import { fresherWindow, fromEngineRateLimits } from './core/usage-schema.mjs'
import type { UsageSnapshot, UsageWindow } from './core/usage-schema.mjs'
import { fitFooter, footerItems } from './footer'
import { refresh } from './source'
import type { SourceIO } from './source'

const POLL_MS = 60_000

const INITIAL: UsageMonitorView = { snapshot: null, error: null, isLoading: true }
const view = atom({ plugin: 'usage-monitor', key: 'view' } as const, INITIAL)

const asSnapshot = (json: UsageMonitorView['snapshot']): UsageSnapshot | null => json as UsageSnapshot | null

/** Live windows into a snapshot: each window keeps whichever reading is fresher. */
function withWindows(snapshot: UsageSnapshot | null, live: { session?: UsageWindow; weekly?: UsageWindow }, now: number): UsageSnapshot {
  const out: UsageSnapshot = { ...(snapshot ?? {}) }
  const session = fresherWindow(live.session, snapshot?.session, now)
  const weekly = fresherWindow(live.weekly, snapshot?.weekly, now)
  if (session) out.session = session
  else delete out.session
  if (weekly) out.weekly = weekly
  else delete out.weekly
  return out
}

/** The engine operations source.ts uses, nothing more. */
function ioOf($: EngineInterface): SourceIO {
  return {
    pluginRoot: $.plugin.root,
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    readText: path => $.fs.read(path),
    writeText: (path, text) => $.fs.write(path, text),
    authorize: () => $.session.authorize(),
    fetch: (url, init) => $.http.fetch(url, init),
    hostOrganization: () => $.env.get('CLAUDE_CODE_ORGANIZATION_UUID'),
  }
}

async function sync($: EngineInterface): Promise<void> {
  const reading = await refresh(ioOf($))
  const now = await $.clock.now()
  await update($, view, current => {
    const kept = asSnapshot(current.snapshot)
    const snapshot = reading.snapshot ? withWindows(reading.snapshot, { session: kept?.session, weekly: kept?.weekly }, now) : kept
    return { snapshot: snapshot as UsageMonitorView['snapshot'], error: reading.error, isLoading: false }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(0, () => void sync($).catch(() => {}))
    $.clock.every(POLL_MS, () => void sync($).catch(() => {}))
    return result
  })

  // Every API response carries the account's rate-limit windows: apply them at
  // once, no request of our own.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const live = fromEngineRateLimits(e.rateLimits)
      if (live.session || live.weekly) {
        const now = await $.clock.now()
        await update($, view, current => ({
          ...current,
          snapshot: withWindows(asSnapshot(current.snapshot), live, now) as UsageMonitorView['snapshot'],
          isLoading: false,
        }))
      }
    }
    return next(e)
  })

  // The footer's dim status text, right beside the model picker. The slot shows
  // plain text only: the Desktop joins these Text runs with spaces, gives them
  // its muted footer ink, and lets a percentage take a theme colour.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const state = await read($, view)
    const now = await $.clock.now()
    const usage = describeUsage(asSnapshot(state.snapshot), { now, reason: describeError(state.error) ?? undefined })
    const modesText = e.props.modes.join(' & ') // Claude's own mode labels, when it has any, stay first
    const items = fitFooter(footerItems(usage), { columns: e.viewport?.columns, modesText })

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        {modesText ? <Text dimColor>{`${modesText} ·`}</Text> : null}
        {items.map((item, i) => (
          <Box>
            {i > 0 ? <Text dimColor>·</Text> : null}
            {item.map(part => (
              <Text {...part.style}>{part.text}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
