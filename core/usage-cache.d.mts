// Types for usage-cache.mjs.
import type { UsageSnapshot } from './usage-schema.mjs'

export type UsageCache = {
  v: number
  snapshot: UsageSnapshot | null
  attemptAt: number
  failures: number
  error: string | null
  errorBy: 'statusline' | 'plugin' | null
}
export type CacheReader = 'statusline' | 'plugin'

export declare const CACHE_VERSION: number
export declare const REFRESH_EVERY_MS: number
export declare const MAX_BACKOFF_MS: number
export declare function emptyCache(): UsageCache
export declare function parseCache(text: string): UsageCache
export declare function backoffMs(failures: number): number
export declare function isDue(cache: UsageCache | null | undefined, now?: number, by?: CacheReader): boolean
export declare function withSuccess(cache: UsageCache | null | undefined, snapshot: UsageSnapshot, now?: number): UsageCache
export declare function withFailure(cache: UsageCache | null | undefined, error: string, now?: number, by?: CacheReader | null): UsageCache
export declare function describeError(error: string | null | undefined): string | null
