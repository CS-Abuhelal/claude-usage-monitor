// Types for usage-format.mjs.
import type { UsageSnapshot } from './usage-schema.mjs'

export type Severity = 'normal' | 'elevated' | 'warning' | 'critical' | 'unknown'
export type MetricLine = { text: string; tone: 'strong' | 'normal' | 'muted'; hint?: string | null }
export type Metric = {
  key: 'weekly' | 'session' | 'cloud' | 'credits'
  title: string
  isAvailable: boolean
  usedPct: number | null
  severity: Severity
  short: string
  lines: MetricLine[]
}
export type UsageView = {
  weekly: Metric
  session: Metric
  cloud: Metric
  credits: Metric
  updated: string | null
  isStale: boolean
}
export type FormatOptions = { now?: number; locale?: string; reason?: string; staleAfterMs?: number }

export declare const STALE_AFTER_MS: number
export declare function severityOf(usedPct: unknown): Severity
export declare function formatPercent(v: unknown): string
export declare function formatMoney(amount: unknown, currency?: string, locale?: string): string
export declare function formatResetTime(iso: unknown, opts?: { now?: number; locale?: string }): string | null
export declare function formatExpiry(iso: unknown, opts?: { locale?: string }): string | null
export declare function formatCountdown(iso: unknown, now?: number): string | null
export declare function formatAge(ms: unknown, now?: number): string | null
export declare function describeUsage(snapshot: UsageSnapshot | null | undefined, opts?: FormatOptions): UsageView
export declare function ringGlyph(usedPct: unknown): string
export type LayoutLevel = { session: 'label' | 'icon' | null; cloud: 'label' | 'icon' | null; credits: 'label' | 'icon' | null }
export type LayoutItem = { metric: Metric; hasLabel: boolean; isPrimary: boolean }
/** Metrics shown on screen, in order; the rest are still fetched and described. */
export declare const VISIBLE_METRICS: ReadonlyArray<'weekly' | 'session' | 'cloud' | 'credits'>
export declare const LAYOUT_LEVELS: readonly LayoutLevel[]
export declare function itemsForLevel(view: UsageView, level: number): LayoutItem[]
export declare const CLOUD_PATH: string
export declare function cloudSvg(opts: {
  remainingPct: number | null
  size?: number
  line?: string
  fill?: string
  fillOpacity?: number
  id?: string
  title?: string
}): string
export declare function ringSvg(opts: {
  usedPct: number | null
  size?: number
  stroke?: number
  track?: string
  fill?: string
  trackOpacity?: number
  title?: string
  extraStyle?: string
  /** CSS placed in the SVG's own <style> (e.g. light/dark colours by class). */
  css?: string
  trackClass?: string
  arcClass?: string
}): string
