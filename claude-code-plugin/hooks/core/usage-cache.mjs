// Claude Usage Monitor: refresh policy for the shared cache file.
//
// The Claude Code status line and the Claude Code plugin share one cache file
// (cache/usage.json) so that several terminals and Desktop sessions make one
// request a minute between them, not one each. This module is the policy
// only (pure); each runtime does its own file I/O.
//
// Cache record: { v, snapshot, attemptAt, failures, error, errorBy }
//   snapshot.fetchedAt  last successful fetch (ms)
//   attemptAt           last attempt, success or not (ms)
//   failures            consecutive failures, for backoff
//   error               short machine-readable reason of the last failure
//   errorBy             which reader failed ('statusline' | 'plugin'). Each has
//                       its own login, so a login failure backs off only the
//                       reader that hit it; endpoint failures back off both.

export const CACHE_VERSION = 1
/** Minimum age before data is fetched again. */
export const REFRESH_EVERY_MS = 60 * 1000
/** Longest wait between attempts while the endpoint keeps failing. */
export const MAX_BACKOFF_MS = 15 * 60 * 1000

/** Failures tied to one reader's own login rather than to the endpoint. */
const LOGIN_ERRORS = new Set(['signed-out', 'token-expired', 'http-401', 'http-403', 'no-auth'])

export function emptyCache() {
  return { v: CACHE_VERSION, snapshot: null, attemptAt: 0, failures: 0, error: null, errorBy: null }
}

/** Parses cache text defensively; anything unexpected becomes an empty cache. */
export function parseCache(text) {
  try {
    const c = JSON.parse(text)
    if (c && typeof c === 'object' && c.v === CACHE_VERSION) {
      return {
        ...emptyCache(),
        ...c,
        failures: Number.isFinite(c.failures) ? c.failures : 0,
        attemptAt: Number.isFinite(c.attemptAt) ? c.attemptAt : 0,
      }
    }
  } catch {}
  return emptyCache()
}

export function backoffMs(failures) {
  if (!failures) return REFRESH_EVERY_MS
  return Math.min(MAX_BACKOFF_MS, REFRESH_EVERY_MS * 2 ** Math.min(failures, 8))
}

/**
 * True when reader `by` should try the network again: the data is a minute
 * old and the last attempt is past its backoff. Another reader's login failure
 * does not hold this one back.
 */
export function isDue(cache, now = Date.now(), by) {
  const c = cache ?? emptyCache()
  const fetchedAt = c.snapshot?.fetchedAt ?? 0
  if (now - fetchedAt < REFRESH_EVERY_MS) return false
  const isOthersLogin = c.error && LOGIN_ERRORS.has(c.error) && c.errorBy && by && c.errorBy !== by
  const wait = isOthersLogin ? REFRESH_EVERY_MS / 4 : backoffMs(c.failures)
  return now - (c.attemptAt || 0) >= wait
}

export function withSuccess(cache, snapshot, now = Date.now()) {
  return { ...(cache ?? emptyCache()), v: CACHE_VERSION, snapshot: { ...snapshot, fetchedAt: now }, attemptAt: now, failures: 0, error: null, errorBy: null }
}

export function withFailure(cache, error, now = Date.now(), by = null) {
  const c = cache ?? emptyCache()
  return { ...c, v: CACHE_VERSION, attemptAt: now, failures: (c.failures || 0) + 1, error: String(error).slice(0, 80), errorBy: by }
}

/** Short human reason for a cached failure, for tooltips. */
export function describeError(error) {
  if (!error) return null
  if (error === 'signed-out') return 'Signed out of Claude Code'
  if (error === 'token-expired') return 'Waiting for Claude Code to refresh its login'
  if (error === 'http-401' || error === 'http-403') return 'Not authorised to read usage'
  if (error === 'http-429') return 'Usage endpoint is rate limited; retrying later'
  if (error.startsWith('http-5')) return 'Usage service unavailable; retrying'
  if (error === 'timeout') return 'Usage request timed out; retrying'
  if (error === 'offline' || error === 'network') return 'Offline; retrying'
  return 'Usage unavailable; retrying'
}
