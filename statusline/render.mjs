// Claude Usage Monitor: the status line's text, from stdin and the cache (pure).
//
//   W ◔ 37% ↻ Fri 9:59 PM · S ○ 2%
//
// Weekly comes first and bold so it survives truncation in a narrow terminal;
// colour appears only once a figure needs attention (60/80/95%). Only the
// metrics in core's VISIBLE_METRICS are shown.

import { describeError } from '../core/usage-cache.mjs'
import { describeUsage, formatResetTime, ringGlyph, VISIBLE_METRICS } from '../core/usage-format.mjs'
import { fresherWindow, fromStatusLineRateLimits } from '../core/usage-schema.mjs'

const ESC = '\x1b['
const paint = (code, s) => `${ESC}${code}m${s}${ESC}0m`
const dim = s => paint('2', s)
const TONE = { normal: '', elevated: '38;5;179', warning: '38;5;208', critical: '1;38;5;196', unknown: '2' }
const tone = (severity, s, base = '') => {
  const code = [base, TONE[severity]].filter(Boolean).join(';')
  return code ? paint(code, s) : s
}

export function render(input, cache, now = Date.now()) {
  const live = fromStatusLineRateLimits(input?.rate_limits)
  const cached = cache?.snapshot ?? {}
  const snapshot = {
    ...cached,
    session: fresherWindow(live.session, cached.session, now) ?? undefined,
    weekly: fresherWindow(live.weekly, cached.weekly, now) ?? undefined,
    fetchedAt: live.weekly || live.session ? now : cached.fetchedAt,
  }
  const view = describeUsage(snapshot, { now })
  const parts = []

  const w = view.weekly
  if (w.isAvailable) {
    const reset = formatResetTime(snapshot.weekly?.resetsAt, { now })
    parts.push(tone(w.severity, `W ${ringGlyph(w.usedPct)} ${w.short}`, '1') + (reset ? dim(` ↻ ${reset}`) : ''))
  } else {
    parts.push(dim('W —'))
  }

  const s = view.session
  if (VISIBLE_METRICS.includes('session') && s.isAvailable) {
    const reset = s.usedPct >= 60 ? formatResetTime(snapshot.session?.resetsAt, { now }) : null
    parts.push(tone(s.severity, `S ${ringGlyph(s.usedPct)} ${s.short}`) + (reset ? dim(` ↻ ${reset}`) : ''))
  }

  const c = view.cloud
  if (VISIBLE_METRICS.includes('cloud') && c.isAvailable) parts.push(tone(c.severity, `☁ ${c.short}`))

  const uc = snapshot.usageCredits
  if (VISIBLE_METRICS.includes('credits') && uc && uc.available > 0) parts.push(dim(`+${view.credits.short} credits`))

  if (!w.isAvailable && cache?.error) parts.push(dim(describeError(cache.error) ?? 'usage unavailable'))
  else if (view.isStale && !live.weekly) parts.push(dim(`updated ${view.updated}`))

  return parts.join(dim(' · '))
}
