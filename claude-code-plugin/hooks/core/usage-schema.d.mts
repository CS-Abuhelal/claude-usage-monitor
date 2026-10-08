// Types for usage-schema.mjs.

export type UsageWindow = { usedPct: number; resetsAt: string | null }

export type CreditWindow = {
  key: string
  label: string
  ends: string
  remaining: number | null
  total: number | null
  usedPct: number | null
  endsAt: string | null
  currency: string
}

export type UsageSnapshot = {
  fetchedAt?: number
  session?: UsageWindow
  weekly?: UsageWindow
  weeklyScoped?: Array<UsageWindow & { label: string }>
  cloudCredits?: CreditWindow[]
  usageCredits?: { available: number; currency: string; autoReload: boolean | null }
  extraUsage?: { enabled: boolean; monthlyLimit: number | null; used: number | null; usedPct: number | null; currency: string }
}

export declare const CREDIT_WINDOWS: ReadonlyArray<{ key: string; label: string; ends: string }>
export declare function toNumber(v: unknown): number | null
export declare function toIso(v: unknown): string | null
export declare function windowOf(raw: unknown): UsageWindow | null
export declare function fromUsagePayload(raw: unknown): UsageSnapshot
export declare function fromPrepaidCredits(raw: unknown): Pick<UsageSnapshot, 'usageCredits'>
export declare function fromStatusLineRateLimits(raw: unknown): Pick<UsageSnapshot, 'session' | 'weekly'>
export declare function fromEngineRateLimits(list: unknown): Pick<UsageSnapshot, 'session' | 'weekly'>
export declare function fresherWindow(a: UsageWindow | null | undefined, b: UsageWindow | null | undefined, now?: number): UsageWindow | null
export declare function mergeSnapshot(base: UsageSnapshot | null | undefined, ...parts: Array<Partial<UsageSnapshot> | null | undefined>): UsageSnapshot
