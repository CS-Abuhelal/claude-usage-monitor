// Claude Usage Monitor: formatting.
//
// Turns a UsageSnapshot (see usage-schema.mjs) into what every surface shows:
// severity, compact labels, tooltip lines, the progress ring. Pure: no I/O,
// no DOM, no Node. Times are formatted in the runtime's local time zone, which
// is the user's own on all three surfaces.

/** Snapshots older than this are marked stale in tooltips. */
export const STALE_AFTER_MS = 10 * 60 * 1000

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 0-59 normal, 60-79 elevated, 80-94 warning, 95+ critical. */
export function severityOf(usedPct) {
  if (!isNum(usedPct)) return 'unknown'
  if (usedPct >= 95) return 'critical'
  if (usedPct >= 80) return 'warning'
  if (usedPct >= 60) return 'elevated'
  return 'normal'
}

export function formatPercent(v) {
  return isNum(v) ? `${Math.round(clamp(v, 0, 999))}%` : '—'
}

export function formatMoney(amount, currency = 'USD', locale) {
  if (!isNum(amount)) return '—'
  const whole = Math.abs(amount - Math.round(amount)) < 0.005
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency === 'USD' ? '$' : currency + ' '}${whole ? Math.round(amount) : amount.toFixed(2)}`
  }
}

const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

function fmt(date, locale, options) {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date)
  } catch {
    return date.toString()
  }
}

/**
 * A reset time as people read it: "Today 2:09 PM", "Tomorrow 9:00 AM",
 * "Friday 9:59 PM" within the week, "November 5, 10:59 AM" beyond it.
 */
export function formatResetTime(iso, { now = Date.now(), locale } = {}) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  const date = new Date(t)
  const time = fmt(date, locale, { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((dayStart(date) - dayStart(new Date(now))) / 86400000)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  if (days > 1 && days < 7) return `${fmt(date, locale, { weekday: 'long' })} ${time}`
  return `${fmt(date, locale, { month: 'long', day: 'numeric' })}, ${time}`
}

/** An expiry as the Usage page words it: "November 5 at 10:59 AM". */
export function formatExpiry(iso, { locale } = {}) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  const date = new Date(t)
  return `${fmt(date, locale, { month: 'long', day: 'numeric' })} at ${fmt(date, locale, { hour: 'numeric', minute: '2-digit' })}`
}

/** "in 2d 9h", "in 4h 57m", "in 12m", "now"; null when unknown. */
export function formatCountdown(iso, now = Date.now()) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return null
  const mins = Math.round((t - now) / 60000)
  if (mins <= 0) return 'now'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  return `in ${m}m`
}

/** "just now", "4 min ago", "2 h ago"; null when unknown. */
export function formatAge(ms, now = Date.now()) {
  if (!isNum(ms)) return null
  const mins = Math.floor((now - ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}

const unavailable = (key, title, reason) => ({
  key,
  title,
  isAvailable: false,
  usedPct: null,
  severity: 'unknown',
  short: '—',
  lines: [{ text: reason ?? 'Not available right now', tone: 'muted' }],
})

function windowMetric(key, title, w, opts) {
  if (!w || !isNum(w.usedPct)) return unavailable(key, title, opts.reason)
  const lines = [
    { text: `${formatPercent(w.usedPct)} used`, tone: 'strong' },
    { text: `${formatPercent(Math.max(0, 100 - w.usedPct))} remaining`, tone: 'normal' },
  ]
  const at = formatResetTime(w.resetsAt, opts)
  if (at) lines.push({ text: `Resets ${at}`, tone: 'muted', hint: formatCountdown(w.resetsAt, opts.now) })
  return { key, title, isAvailable: true, usedPct: w.usedPct, severity: severityOf(w.usedPct), short: formatPercent(w.usedPct), lines }
}

function cloudMetric(credits, opts) {
  const title = 'Cloud Session Credits'
  if (!Array.isArray(credits) || credits.length === 0) return unavailable('cloud', title, 'No cloud session credits on this account')
  const [main, ...rest] = credits
  const lines = []
  if (isNum(main.remaining) && isNum(main.total)) {
    lines.push({ text: `${formatMoney(main.remaining, main.currency, opts.locale)} / ${formatMoney(main.total, main.currency, opts.locale)} remaining`, tone: 'strong' })
  }
  if (isNum(main.usedPct)) lines.push({ text: `${formatPercent(Math.max(0, 100 - main.usedPct))} remaining`, tone: 'normal' })
  const at = formatExpiry(main.endsAt, opts)
  if (at) lines.push({ text: `${main.ends} ${at}`, tone: 'muted' })
  for (const c of rest) {
    const amount = isNum(c.remaining) ? `${formatMoney(c.remaining, c.currency, opts.locale)} left` : `${formatPercent(100 - (c.usedPct ?? 0))} left`
    lines.push({ text: `${c.label}: ${amount}`, tone: 'muted' })
  }
  return {
    key: 'cloud',
    title: main.label ?? title,
    isAvailable: true,
    usedPct: isNum(main.usedPct) ? main.usedPct : null,
    severity: severityOf(main.usedPct),
    short: isNum(main.remaining) ? formatMoney(main.remaining, main.currency, opts.locale) : formatPercent(100 - (main.usedPct ?? 0)),
    lines,
  }
}

function creditsMetric(snapshot, opts) {
  const { usageCredits: uc, extraUsage: xu } = snapshot
  if (!uc && !xu) return unavailable('credits', 'Usage Credits')
  const lines = []
  if (uc) {
    lines.push({ text: `${formatMoney(uc.available, uc.currency, opts.locale)} available`, tone: 'strong' })
    if (uc.autoReload !== null && uc.autoReload !== undefined) lines.push({ text: `Auto reload: ${uc.autoReload ? 'On' : 'Off'}`, tone: 'normal' })
  }
  if (xu) {
    if (!xu.enabled) lines.push({ text: 'Extra usage: Off', tone: 'muted' })
    else {
      const spent = isNum(xu.used) ? formatMoney(xu.used, xu.currency, opts.locale) : '—'
      const cap = isNum(xu.monthlyLimit) ? ` of ${formatMoney(xu.monthlyLimit, xu.currency, opts.locale)}` : ''
      lines.push({ text: `Extra usage: ${spent}${cap} this month`, tone: 'muted' })
    }
  }
  return {
    key: 'credits',
    title: 'Usage Credits',
    isAvailable: true,
    usedPct: xu?.enabled && isNum(xu.usedPct) ? xu.usedPct : null,
    severity: xu?.enabled ? severityOf(xu.usedPct) : 'normal',
    short: uc ? formatMoney(uc.available, uc.currency, opts.locale) : xu?.enabled ? formatPercent(xu.usedPct) : 'Off',
    lines,
  }
}

/**
 * Everything the indicators draw, in priority order (weekly first): one
 * metric per indicator, each `{ key, title, isAvailable, usedPct, severity,
 * short, lines: [{ text, tone, hint? }] }`, plus freshness.
 *
 * `opts.reason` explains a missing window (e.g. "Signed out").
 */
export function describeUsage(snapshot, opts = {}) {
  const o = { now: Date.now(), ...opts }
  const s = snapshot ?? {}
  const weekly = windowMetric('weekly', 'Weekly Usage', s.weekly, o)
  if (weekly.isAvailable && Array.isArray(s.weeklyScoped)) {
    for (const scoped of s.weeklyScoped) weekly.lines.push({ text: `${scoped.label}: ${formatPercent(scoped.usedPct)} used`, tone: 'muted' })
  }
  const isStale = isNum(s.fetchedAt) && o.now - s.fetchedAt > (o.staleAfterMs ?? STALE_AFTER_MS)
  return {
    weekly,
    session: windowMetric('session', 'Current Session', s.session, o),
    cloud: cloudMetric(s.cloudCredits, o),
    credits: creditsMetric(s, o),
    updated: formatAge(s.fetchedAt, o.now),
    isStale,
  }
}

/**
 * The metrics the indicators show, in display order. Cloud session credits and
 * usage credits are still fetched, cached and described (describeUsage); they
 * are only left off screen. Add 'cloud' / 'credits' here to show them again.
 */
export const VISIBLE_METRICS = ['weekly', 'session']

/**
 * Responsive levels shared by every surface, most room first. Weekly with its
 * percentage is always shown. As room shrinks, what goes first: usage
 * credits, then the cloud label (its icon stays), then the session label,
 * then the cloud icon, then the session ring.
 */
export const LAYOUT_LEVELS = [
  { session: 'label', cloud: 'label', credits: 'label' },
  { session: 'label', cloud: 'label', credits: null },
  { session: 'label', cloud: 'icon', credits: null },
  { session: 'icon', cloud: 'icon', credits: null },
  { session: 'icon', cloud: null, credits: null },
  { session: null, cloud: null, credits: null },
]

/** What to draw at a level, in display order (weekly first, then session, cloud, credits). */
export function itemsForLevel(view, level) {
  const spec = LAYOUT_LEVELS[Math.max(0, Math.min(level, LAYOUT_LEVELS.length - 1))]
  const items = [{ metric: view.weekly, hasLabel: true, isPrimary: true }]
  for (const key of ['session', 'cloud', 'credits']) {
    const mode = spec[key]
    if (mode && VISIBLE_METRICS.includes(key) && view[key].isAvailable) items.push({ metric: view[key], hasLabel: mode === 'label', isPrimary: false })
  }
  return items
}

/** One glyph per quarter for text surfaces: ○ ◔ ◑ ◕ ●. */
export function ringGlyph(usedPct) {
  if (!isNum(usedPct)) return '○'
  const p = clamp(usedPct, 0, 100)
  if (p < 12.5) return '○'
  if (p < 37.5) return '◔'
  if (p < 62.5) return '◑'
  if (p < 87.5) return '◕'
  return '●'
}

/** A 16-unit cloud outline, used for the cloud-credit indicator everywhere. */
export const CLOUD_PATH = 'M4.6 12.8h7a3 3 0 0 0 .5-5.96A4.2 4.2 0 0 0 4.1 7.3a2.75 2.75 0 0 0 .5 5.5Z'

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * A progress ring as SVG markup: `usedPct` of the circle filled clockwise from
 * 12 o'clock. Colours are any CSS colour (theme variables work inline).
 */
export function ringSvg({ usedPct, size = 16, stroke = 2, track = 'currentColor', fill = 'currentColor', trackOpacity = 0.25, title, extraStyle = '', css = '', trackClass = '', arcClass = '' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = isNum(usedPct) ? clamp(usedPct, 0, 100) : 0
  const dash = (p / 100) * c
  const mid = size / 2
  const t = title ? `<title>${esc(title)}</title>` : ''
  const cls = name => (name ? ` class="${esc(name)}"` : '')
  const arc = p > 0
    ? `<circle${cls(arcClass)} cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${fill}" stroke-width="${stroke}" stroke-linecap="${p >= 100 ? 'butt' : 'round'}" stroke-dasharray="${dash.toFixed(3)} ${c.toFixed(3)}" transform="rotate(-90 ${mid} ${mid})"/>`
    : ''
  const style = css ? `<style>${css}</style>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false"${extraStyle ? ` style="${esc(extraStyle)}"` : ''}>${t}${style}<circle${cls(trackClass)} cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${track}" stroke-opacity="${trackOpacity}" stroke-width="${stroke}"/>${arc}</svg>`
}

/**
 * The cloud icon: an outline whose inside fills from the left with the share
 * of credit that remains. `id` must be unique in the document (clip path).
 */
export function cloudSvg({ remainingPct, size = 16, line = 'currentColor', fill = 'currentColor', fillOpacity = 0.3, id = 'cum-cloud', title }) {
  const p = isNum(remainingPct) ? clamp(remainingPct, 0, 100) : 0
  const t = title ? `<title>${esc(title)}</title>` : ''
  const clip = `cum-clip-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${t}<defs><clipPath id="${clip}"><rect x="0" y="0" width="${(16 * p / 100).toFixed(2)}" height="16"/></clipPath></defs><path d="${CLOUD_PATH}" fill="${fill}" fill-opacity="${fillOpacity}" clip-path="url(#${clip})"/><path d="${CLOUD_PATH}" fill="none" stroke="${line}" stroke-width="1.3" stroke-linejoin="round"/></svg>`
}
