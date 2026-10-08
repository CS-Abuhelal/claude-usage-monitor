// Claude Usage Monitor (browser): wiring. Fetch (adapter) -> normalise (core)
// -> describe (core) -> draw (view), refreshed on a timer and on the moments
// usage moves. Every step is guarded: on any failure claude.ai is untouched.
//
// Refresh policy: once a minute while the tab is visible (the Usage page
// itself polls every five), on focus/visibility when older than 15 s, shortly
// after each finished reply, and when the browser comes back online. Errors
// back off (1, 2, 4 ... 15 min). Usage credits are re-read every 10 minutes.

import { errorCode, fetchPrepaidCredits, fetchUsage, isUsablePage, measureSlot, organizationId, USAGE_PAGE } from './adapter.mjs'
import { backoffMs, describeError } from './core/usage-cache.mjs'
import { describeUsage, itemsForLevel, LAYOUT_LEVELS } from './core/usage-format.mjs'
import { fromPrepaidCredits, fromUsagePayload, mergeSnapshot } from './core/usage-schema.mjs'
import { createIndicatorBar } from './view.mjs'

const POLL_MS = 60 * 1000
const FOCUS_MIN_AGE_MS = 15 * 1000
const AFTER_REPLY_MS = 2500
const PREPAID_EVERY_MS = 10 * 60 * 1000
const PLACE_EVERY_MS = 1500
const LEVELS = LAYOUT_LEVELS // shared with the Desktop plugin: credits go first, weekly never

/** Starting level from the window width; collisions push it further down. */
const levelForWidth = w => (w >= 1000 ? 0 : w >= 860 ? 1 : w >= 700 ? 2 : w >= 560 ? 3 : w >= 440 ? 4 : 5)

export function start({ onActivity } = {}) {
  const state = { snapshot: null, error: null, failures: 0, lastAttempt: 0, lastPrepaid: 0, isLoading: true, inFlight: null }
  let replyTimer = 0
  let lastPath = location.pathname
  let lastWidth = 0
  let level = levelForWidth(document.documentElement.clientWidth)
  const steppedDownAt = {}

  const bar = createIndicatorBar({
    usageHref: USAGE_PAGE,
    onOpenUsage: () => {
      if (location.pathname !== USAGE_PAGE) location.assign(USAGE_PAGE)
    },
  })

  function draw() {
    try {
      if (!isUsablePage() || state.error === 'http-401' || state.error === 'http-403' || state.error === 'no-org') return bar.hide()
      const reason = state.isLoading ? 'Loading usage…' : (describeError(state.error) ?? undefined)
      const view = describeUsage(state.snapshot, { now: Date.now(), reason })
      const problem = state.error && state.snapshot ? describeError(state.error) : null
      const footer = [view.updated ? `Updated ${view.updated}` : null, problem, 'Click to open Usage'].filter(Boolean).join(' · ')
      bar.render(itemsForLevel(view, level), { footer, isStale: view.isStale })
      place()
    } catch {
      bar.hide()
    }
  }

  /**
   * Puts the bar beside the header controls. Steps down a level while it does
   * not fit, and back up once clearly more room has opened than when it last
   * stepped down (so it never flickers between two levels).
   */
  function place() {
    if (bar.element.hasAttribute('hidden')) return
    const slot = measureSlot(bar.element)
    bar.place(slot)
    const width = bar.width()
    bar.setCrowded(width > slot.room - 8 && level === LEVELS.length - 1)
    if (width > slot.room - 8 && level < LEVELS.length - 1) {
      steppedDownAt[level] = slot.room
      level += 1
      draw()
    } else if (level > levelForWidth(document.documentElement.clientWidth) && slot.room > (steppedDownAt[level - 1] ?? 0) + 60) {
      level -= 1
      draw()
    }
  }

  async function refresh({ force = false } = {}) {
    if (state.inFlight) return state.inFlight
    const now = Date.now()
    if (!force && now - state.lastAttempt < (state.failures ? backoffMs(state.failures) : FOCUS_MIN_AGE_MS)) return
    if (!isUsablePage()) return
    if (navigator.onLine === false) {
      state.error = 'offline'
      return draw()
    }
    state.lastAttempt = now
    state.inFlight = (async () => {
      try {
        const org = await organizationId()
        const usage = await fetchUsage(org)
        let prepaid = null
        if (now - state.lastPrepaid >= PREPAID_EVERY_MS) {
          prepaid = await fetchPrepaidCredits(org).catch(() => null)
          if (prepaid) state.lastPrepaid = now
        }
        state.snapshot = mergeSnapshot(
          { usageCredits: state.snapshot?.usageCredits },
          fromUsagePayload(usage),
          fromPrepaidCredits(prepaid),
          { fetchedAt: Date.now() },
        )
        state.error = null
        state.failures = 0
      } catch (err) {
        state.error = errorCode(err)
        state.failures += 1
      } finally {
        state.isLoading = false
        state.inFlight = null
        draw()
      }
    })()
    return state.inFlight
  }

  // Refresh triggers.
  setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh())
  window.addEventListener('focus', () => refresh())
  window.addEventListener('online', () => refresh({ force: true }))
  window.addEventListener('offline', () => {
    state.error = 'offline'
    draw()
  })
  onActivity?.(() => {
    clearTimeout(replyTimer)
    replyTimer = setTimeout(() => refresh({ force: true }), AFTER_REPLY_MS)
  })

  // Layout triggers: resizes, client-side navigation, and a slow check for
  // header changes (no DOM observer, so streaming replies cost nothing).
  window.addEventListener('resize', () => {
    const w = document.documentElement.clientWidth
    if (w === lastWidth) return
    lastWidth = w
    level = levelForWidth(w)
    for (const k of Object.keys(steppedDownAt)) delete steppedDownAt[k]
    draw()
  })
  setInterval(() => {
    try {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname
        level = levelForWidth(document.documentElement.clientWidth)
        draw()
        if (location.pathname === USAGE_PAGE) refresh({ force: true })
      } else if (document.visibilityState === 'visible') place()
    } catch {}
  }, PLACE_EVERY_MS)

  lastWidth = document.documentElement.clientWidth
  draw()
  refresh({ force: true })
  return { refresh, state, bar }
}
