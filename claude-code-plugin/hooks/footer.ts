// usage-monitor: the Desktop footer text (pure; no engine, no drawing).
//
// Claude Desktop shows a plugin's SessionMode text in the composer footer,
// beside "Opus 5.5  Extra", as plain dim text capped at 24ch (longer text is
// cut with an ellipsis). So the line is chosen to fit, dropping parts in the
// spec's order rather than letting it be cut:
//
//   W 56% · S 44%  →  W 56%
//
// Only a percentage may take a colour, and only when it needs attention.

import { VISIBLE_METRICS } from './core/usage-format.mjs'
import type { Metric, UsageView } from './core/usage-format.mjs'

/** Text props the footer keeps: the theme's muted ink, or a theme colour name. */
export type FooterStyle = { dimColor: true } | { color: string }
export type FooterPart = { text: string; style: FooterStyle }
/** One metric as it reads in the footer, e.g. [W][56%]. */
export type FooterItem = FooterPart[]

const DIM: FooterStyle = { dimColor: true }

/** Claude's theme names: amber (warning ink), clay (brand), red (danger ink). */
const PERCENT_STYLE: Record<string, FooterStyle> = {
  normal: DIM,
  elevated: { color: 'warning' },
  warning: { color: 'claude' },
  critical: { color: 'error' },
  unknown: DIM,
}

/** The Desktop caps the footer text at 24ch; keep a little slack. */
export const FOOTER_MAX_CH = 23.5
/** The footer's own controls either side of it (+ 🎙 Auto … Opus 5.5 Extra), in ch. */
const FOOTER_CONTROLS_CH = 42

const percent = (metric: Metric): FooterPart => ({
  text: metric.isAvailable ? metric.short : '—',
  style: PERCENT_STYLE[metric.isAvailable ? metric.severity : 'unknown'] ?? DIM,
})

/**
 * Every shown metric that has a figure, in priority order: weekly, session
 * (and cloud, credits when core's VISIBLE_METRICS lists them).
 */
export function footerItems(view: UsageView): FooterItem[] {
  const shows = (key: string): boolean => (VISIBLE_METRICS as readonly string[]).includes(key)
  const items: FooterItem[] = [[{ text: 'W', style: DIM }, percent(view.weekly)]]
  if (shows('session') && view.session.isAvailable) items.push([{ text: 'S', style: DIM }, percent(view.session)])
  if (shows('cloud') && view.cloud.isAvailable) items.push([{ text: '☁', style: DIM }, { text: view.cloud.short, style: DIM }])
  if (shows('credits') && view.credits.isAvailable && view.credits.short.startsWith('$')) items.push([{ text: view.credits.short, style: DIM }])
  return items
}

/** The line as read: parts joined by spaces, items by " · ". */
export const footerText = (items: FooterItem[]): string => items.map(item => item.map(p => p.text).join(' ')).join(' · ')

/** Approximate width in ch of footer text in Claude's UI font (digits are 1ch). */
export function widthCh(text: string): number {
  let ch = 0
  for (const c of text) {
    if (/[0-9$]/.test(c)) ch += 1
    else if (c === ' ' || c === '·' || c === '.' || c === ',') ch += 0.45
    else if (c === '%') ch += 1.45
    else if (c === '☁') ch += 1.8
    else if (c === '—') ch += 1.6
    else if (c === 'W' || c === 'M') ch += 1.5
    else if (/[A-Z]/.test(c)) ch += 1.15
    else ch += 0.95
  }
  return ch
}

/**
 * The richest prefix of the items that fits: within the 24ch cap, within the
 * room the window leaves (when its width in columns is known), and after any
 * mode labels Claude itself shows there. Weekly always stays.
 */
export function fitFooter(items: FooterItem[], { columns, modesText = '' }: { columns?: number; modesText?: string } = {}): FooterItem[] {
  const room = columns === undefined ? FOOTER_MAX_CH : Math.min(FOOTER_MAX_CH, columns - FOOTER_CONTROLS_CH)
  const budget = room - (modesText ? widthCh(`${modesText} · `) : 0)
  for (let n = items.length; n > 1; n--) {
    const candidate = items.slice(0, n)
    if (widthCh(footerText(candidate)) <= budget) return candidate
  }
  return items.slice(0, 1)
}
