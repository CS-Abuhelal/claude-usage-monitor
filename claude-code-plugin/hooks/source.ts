// usage-monitor: where the figures come from (no UI here).
//
// The same endpoints Claude Code's own /usage reads, on api.anthropic.com,
// authorised by the engine: `$.session.authorize()` holds the session's
// credential on the host and hands back an opaque handle, so no token ever
// reaches this plugin. Results go through the cache file the terminal status
// line shares, so all readers together ask about once a minute.
//
// The engine's `$` stays in register.tsx (the engine requires it); this file
// gets the few operations it needs as a SourceIO port.

import { emptyCache, isDue, parseCache, withFailure, withSuccess } from './core/usage-cache.mjs'
import type { UsageCache } from './core/usage-cache.mjs'
import { fromPrepaidCredits, fromUsagePayload, mergeSnapshot } from './core/usage-schema.mjs'
import type { UsageSnapshot } from './core/usage-schema.mjs'

export const USAGE_URL = 'https://claude.ai/settings/usage'

const API = 'https://api.anthropic.com'
const HEADERS = { 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' }
const TIMEOUT_MS = 10_000
const ORG_UUID = /^[0-9a-f-]{36}$/i

export type SourceIO = {
  pluginRoot: string
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  readText: (path: string) => Promise<string>
  writeText: (path: string, text: string) => Promise<void>
  /** An opaque credential handle, or null without a first-party login. */
  authorize: () => Promise<{ handle: string } | null>
  fetch: (url: string, init: { auth: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: string }>
  /** The organisation the host app signed in with, when it says. */
  hostOrganization: () => Promise<string | undefined>
}

export type Reading = { snapshot: UsageSnapshot | null; error: string | null }

/** `<install>/cache/usage.json`, beside this plugin's folder. */
export const cachePathOf = (pluginRoot: string): string => `${pluginRoot.replace(/[\\/]+$/, '')}/../cache/usage.json`

async function readCache(io: SourceIO, path: string): Promise<UsageCache> {
  try {
    return parseCache(await io.readText(path))
  } catch {
    return emptyCache()
  }
}

async function writeCache(io: SourceIO, path: string, cache: UsageCache): Promise<void> {
  try {
    await io.writeText(path, JSON.stringify(cache))
  } catch {}
}

function withTimeout<T>(io: SourceIO, work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = io.after(TIMEOUT_MS, () => reject(new Error('timeout')))
    work.then(
      value => (timer.cancel(), resolve(value)),
      error => (timer.cancel(), reject(error)),
    )
  })
}

const codeOf = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return /^(http-\d{3}|timeout|bad-json|no-auth)$/.test(message) ? message : 'network'
}

let organizationUuid: string | null | undefined

async function organizationOf(io: SourceIO, get: (path: string) => Promise<any>): Promise<string | null> {
  if (organizationUuid !== undefined) return organizationUuid
  const fromHost = await io.hostOrganization().catch(() => undefined)
  if (fromHost && ORG_UUID.test(fromHost)) return (organizationUuid = fromHost)
  const profile = await get('/api/oauth/profile').catch(() => null)
  const id = profile?.organization?.uuid
  return (organizationUuid = typeof id === 'string' && ORG_UUID.test(id) ? id : null)
}

async function fetchUsage(io: SourceIO, previous: UsageSnapshot | null): Promise<UsageSnapshot> {
  const auth = await io.authorize().catch(() => null)
  if (!auth) throw new Error('no-auth')
  const get = async (path: string, extra: Record<string, string> = {}): Promise<any> => {
    const res = await withTimeout(io, io.fetch(API + path, { auth: auth.handle, headers: { ...HEADERS, ...extra } }))
    if (!res.ok) throw new Error(`http-${res.status}`)
    try {
      return JSON.parse(res.text)
    } catch {
      throw new Error('bad-json')
    }
  }
  const usage = await get('/api/oauth/usage')
  // Usage credits are optional detail: when they cannot be read, keep the last.
  const org = await organizationOf(io, get)
  const prepaid = org ? await get(`/api/oauth/organizations/${org}/prepaid/credits`, { 'x-organization-uuid': org }).catch(() => null) : null
  return mergeSnapshot(prepaid ? {} : { usageCredits: previous?.usageCredits }, fromUsagePayload(usage), fromPrepaidCredits(prepaid))
}

/**
 * The current figures: from the shared cache while it is fresh, else fetched
 * (and written back for the other readers). Never rejects.
 */
export async function refresh(io: SourceIO, options: { isForced?: boolean } = {}): Promise<Reading> {
  const path = cachePathOf(io.pluginRoot)
  const cache = await readCache(io, path)
  const now = await io.now()
  const ownError = cache.errorBy === 'statusline' ? null : cache.error
  if (!options.isForced && !isDue(cache, now, 'plugin')) return { snapshot: cache.snapshot, error: ownError }

  // Claim the attempt first so sessions starting together do not all fetch.
  await writeCache(io, path, { ...cache, attemptAt: now })
  let next: UsageCache
  try {
    next = withSuccess(cache, await fetchUsage(io, cache.snapshot), now)
  } catch (error) {
    next = withFailure(cache, codeOf(error), now, 'plugin')
  }
  await writeCache(io, path, next)
  return { snapshot: next.snapshot, error: next.error }
}
