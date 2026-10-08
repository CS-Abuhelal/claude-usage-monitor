// Claude Usage Monitor: background refresher for the terminal status line.
//
// Started detached by statusline.mjs when the shared cache is due. It reads
// Claude Code's own login (never refreshing or rewriting it), asks the same
// endpoints Claude Code's /usage asks, and writes only usage figures to the
// cache. The token stays in this process's memory and is sent to
// api.anthropic.com alone; nothing is logged.

import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { isDue, withFailure, withSuccess } from '../core/usage-cache.mjs'
import { fromPrepaidCredits, fromUsagePayload, mergeSnapshot } from '../core/usage-schema.mjs'
import { LOCK_FILE, readCache, writeCache } from './cache-file.mjs'

const API = 'https://api.anthropic.com' // fixed: the token must never go anywhere else
const TIMEOUT_MS = 8000
const LOCK_STALE_MS = 30000

const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

function takeLock() {
  try {
    mkdirSync(dirname(LOCK_FILE), { recursive: true }) // first run: no cache folder yet
  } catch {}
  try {
    closeSync(openSync(LOCK_FILE, 'wx'))
    return true
  } catch {
    try {
      if (Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) {
        unlinkSync(LOCK_FILE)
        closeSync(openSync(LOCK_FILE, 'wx'))
        return true
      }
    } catch {}
    return false
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function organizationUuid() {
  const global = readJson(process.env.CLAUDE_CONFIG_DIR ? join(configDir, '.claude.json') : join(homedir(), '.claude.json'))
  const id = global?.oauthAccount?.organizationUuid
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

class FetchError extends Error {}

async function getJson(path, headers) {
  let res
  try {
    res = await fetch(API + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new FetchError(err?.name === 'TimeoutError' ? 'timeout' : 'network')
  }
  if (!res.ok) throw new FetchError(`http-${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new FetchError('bad-json')
  }
}

async function main() {
  const force = process.argv.includes('--force')
  if (!force && !isDue(readCache(), Date.now(), 'statusline')) return
  if (!takeLock()) return
  try {
    const now = Date.now()
    const oauth = readJson(join(configDir, '.credentials.json'))?.claudeAiOauth
    if (!oauth?.accessToken) return writeCache(withFailure(readCache(), 'signed-out', now, 'statusline'))
    if (Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= now) return writeCache(withFailure(readCache(), 'token-expired', now, 'statusline'))

    const headers = {
      Authorization: `Bearer ${oauth.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-usage-monitor/1.0',
    }
    let usage
    try {
      usage = await getJson('/api/oauth/usage', headers)
    } catch (err) {
      return writeCache(withFailure(readCache(), err instanceof FetchError ? err.message : 'error', now, 'statusline'))
    }

    // Usage credits are optional detail: a failure here keeps the rest.
    let prepaid = null
    const org = organizationUuid()
    if (org) {
      prepaid = await getJson(`/api/oauth/organizations/${org}/prepaid/credits`, { ...headers, 'x-organization-uuid': org }).catch(() => null)
    }
    const previous = readCache()
    const snapshot = mergeSnapshot(
      prepaid ? {} : { usageCredits: previous.snapshot?.usageCredits },
      fromUsagePayload(usage),
      fromPrepaidCredits(prepaid),
    )
    writeCache(withSuccess(previous, snapshot, Date.now()))
  } finally {
    try {
      unlinkSync(LOCK_FILE)
    } catch {}
  }
}

main().catch(() => {})
