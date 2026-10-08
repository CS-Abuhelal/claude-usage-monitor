// Claude Usage Monitor: the shared cache file, for Node.
// The policy (when to refresh, backoff) lives in core/usage-cache.mjs.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emptyCache, parseCache } from '../core/usage-cache.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = process.env.CLAUDE_USAGE_MONITOR_CACHE_DIR || join(ROOT, 'cache') // override: tests only
export const CACHE_FILE = join(CACHE_DIR, 'usage.json')
export const LOCK_FILE = join(CACHE_DIR, 'refresh.lock')

export function readCache() {
  try {
    return parseCache(readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return emptyCache()
  }
}

/** Atomic replace, so a reader never sees half a file. */
export function writeCache(cache) {
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, CACHE_FILE)
}
