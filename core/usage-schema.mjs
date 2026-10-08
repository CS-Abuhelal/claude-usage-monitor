// Claude Usage Monitor: schema adapter.
//
// The ONE place that knows the shape of Anthropic's usage payloads. Every
// surface (browser extension, Claude Code status line, Claude Code plugin)
// turns raw JSON into a `UsageSnapshot` here, so when the server renames a
// field only this file changes. Pure: no I/O, no DOM, no Node.
//
// Sources it understands (all observed in the installed apps, Oct 2026):
//   - GET claude.ai/api/organizations/{org}/usage   (the Settings > Usage page)
//   - GET api.anthropic.com/api/oauth/usage          (Claude Code's /usage)
//       both: { five_hour, seven_day, seven_day_opus, seven_day_sonnet, ...,
//               <grant windows>, extra_usage, limits[] }
//       window: { utilization: 0..100, resets_at: ISO }
//   - GET .../organizations/{org}/prepaid/credits    (Usage credits)
//       { amount (minor units), currency, auto_reload_settings: { enabled } }
//   - Claude Code status line stdin `rate_limits`
//       { five_hour: { used_percentage, resets_at (epoch s) }, seven_day: ... }
//   - Claude Code plugin `$.session.usage().rateLimits`
//       [{ kind: 'five_hour' | 'seven_day', percentUsed, resetsAt (ISO) }]

/**
 * Dollar-valued credit windows, by the server's codename. The first one present
 * drives the cloud indicator; the rest are listed in its tooltip.
 * `ends` is how the Usage page phrases the window's end date.
 */
export const CREDIT_WINDOWS = [
  { key: 'iguana_necktie', label: 'Cloud Session Credits', ends: 'Expires' },
  { key: 'tangelo', label: 'Credits', ends: 'Refills' },
]

/** Per-model weekly windows shown as extra detail in the weekly tooltip. */
const SCOPED_WEEKLY = [
  { key: 'seven_day_opus', label: 'Opus' },
  { key: 'seven_day_sonnet', label: 'Sonnet' },
]

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** ISO string, epoch seconds or epoch milliseconds -> ISO string (or null). */
export function toIso(v) {
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : new Date(t).toISOString()
  }
  const n = toNumber(v)
  if (n === null || n <= 0) return null
  return new Date(n < 1e12 ? n * 1000 : n).toISOString()
}

const fromMinorUnits = v => {
  const n = toNumber(v)
  return n === null ? null : n / 100
}

/** `{ utilization, resets_at }` (or the status line's spelling) -> Window. */
export function windowOf(raw) {
  if (!isObj(raw)) return null
  const usedPct = toNumber(raw.utilization ?? raw.used_percentage ?? raw.percentUsed)
  if (usedPct === null) return null
  return { usedPct, resetsAt: toIso(raw.resets_at ?? raw.resetsAt) }
}

function creditOf(raw, spec) {
  if (!isObj(raw)) return null
  const remaining = toNumber(raw.remaining_dollars)
  const total = toNumber(raw.limit_dollars)
  let usedPct = toNumber(raw.utilization)
  if (usedPct === null && remaining !== null && total) usedPct = (1 - remaining / total) * 100
  if (remaining === null && total === null && usedPct === null) return null
  return {
    key: spec.key,
    label: spec.label,
    ends: spec.ends,
    remaining,
    total,
    usedPct,
    endsAt: toIso(raw.resets_at),
    currency: 'USD',
  }
}

/**
 * Normalises a usage payload (claude.ai web or OAuth: same shape). Returns only
 * the metrics present; a missing or malformed field is simply left out.
 */
export function fromUsagePayload(raw) {
  if (!isObj(raw)) return {}
  const out = {}

  const session = windowOf(raw.five_hour)
  if (session) out.session = session
  const weekly = windowOf(raw.seven_day)
  if (weekly) out.weekly = weekly

  const scoped = []
  for (const { key, label } of SCOPED_WEEKLY) {
    const w = windowOf(raw[key])
    if (w) scoped.push({ label, ...w })
  }
  if (Array.isArray(raw.limits)) {
    for (const limit of raw.limits) {
      const name = limit?.scope?.model?.display_name
      const pct = toNumber(limit?.percent)
      if (limit?.kind !== 'weekly_scoped' || typeof name !== 'string' || pct === null) continue
      if (!scoped.some(s => s.label === name)) scoped.push({ label: name, usedPct: pct, resetsAt: toIso(limit.resets_at) })
    }
  }
  if (scoped.length > 0) out.weeklyScoped = scoped

  const credits = []
  for (const spec of CREDIT_WINDOWS) {
    const c = creditOf(raw[spec.key], spec)
    if (c) credits.push(c)
  }
  if (credits.length > 0) out.cloudCredits = credits

  const x = raw.extra_usage
  if (isObj(x) && typeof x.is_enabled === 'boolean') {
    out.extraUsage = {
      enabled: x.is_enabled,
      monthlyLimit: fromMinorUnits(x.monthly_limit),
      used: fromMinorUnits(x.used_credits),
      usedPct: toNumber(x.utilization),
      currency: typeof x.currency === 'string' && x.currency ? x.currency : 'USD',
    }
  }
  return out
}

/** Normalises `prepaid/credits` (the Usage page's "Usage credits" row). */
export function fromPrepaidCredits(raw) {
  if (!isObj(raw)) return {}
  const available = fromMinorUnits(raw.amount)
  if (available === null) return {}
  return {
    usageCredits: {
      available,
      currency: typeof raw.currency === 'string' && raw.currency ? raw.currency : 'USD',
      autoReload: isObj(raw.auto_reload_settings) ? raw.auto_reload_settings.enabled === true : null,
    },
  }
}

/** Claude Code status line stdin `rate_limits` -> { session, weekly }. */
export function fromStatusLineRateLimits(raw) {
  if (!isObj(raw)) return {}
  const out = {}
  const session = windowOf(raw.five_hour)
  if (session) out.session = session
  const weekly = windowOf(raw.seven_day)
  if (weekly) out.weekly = weekly
  return out
}

/** Claude Code plugin `rateLimits` list -> { session, weekly }. */
export function fromEngineRateLimits(list) {
  if (!Array.isArray(list)) return {}
  const out = {}
  for (const item of list) {
    const w = windowOf(item)
    if (!w) continue
    if (item.kind === 'five_hour') out.session = w
    else if (item.kind === 'seven_day') out.weekly = w
  }
  return out
}

/**
 * The fresher of two readings of the same kind of window. Neither carries a
 * timestamp of its own, but usage inside a window only grows until it resets:
 * for the same window the higher reading is the later one; across windows the
 * one resetting later is current. A window whose reset has passed is dropped.
 */
export function fresherWindow(a, b, now = Date.now()) {
  const live = w => w && Number.isFinite(w.usedPct) && !(w.resetsAt && Date.parse(w.resetsAt) <= now) ? w : null
  const x = live(a)
  const y = live(b)
  if (!x || !y) return x ?? y ?? null
  const tx = x.resetsAt ? Date.parse(x.resetsAt) : NaN
  const ty = y.resetsAt ? Date.parse(y.resetsAt) : NaN
  const sameWindow = Number.isNaN(tx) || Number.isNaN(ty) || Math.abs(tx - ty) < 30 * 60 * 1000
  if (sameWindow) return x.usedPct >= y.usedPct ? { ...x, resetsAt: x.resetsAt ?? y.resetsAt } : { ...y, resetsAt: y.resetsAt ?? x.resetsAt }
  return tx > ty ? x : y
}

/**
 * Layers metric groups over a base snapshot: each later part replaces only the
 * metrics it carries, so a partial reading never erases a good one.
 */
export function mergeSnapshot(base, ...parts) {
  const out = { ...(isObj(base) ? base : {}) }
  for (const part of parts) {
    if (!isObj(part)) continue
    for (const [k, v] of Object.entries(part)) if (v !== undefined && v !== null) out[k] = v
  }
  return out
}
