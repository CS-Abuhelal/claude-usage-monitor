// Claude Usage Monitor: Claude Code status line entry point.
//
// Claude Code runs this after each update and every `refreshInterval` seconds
// with the session's JSON on stdin, and shows the one line it prints. It reads
// only stdin and the shared cache, never waits on the network, and starts
// refresh.mjs in the background when the cache is due. On any error it prints
// "W —" rather than failing.

import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isDue } from '../core/usage-cache.mjs'
import { readCache } from './cache-file.mjs'
import { render } from './render.mjs'

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

/** Starts the refresher when the cache is due, or right away after a new login. */
function maybeRefresh(cache) {
  let isNewLogin = false
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    isNewLogin = cache.errorBy === 'statusline' && statSync(join(dir, '.credentials.json')).mtimeMs > cache.attemptAt
  } catch {}
  if (!isNewLogin && !isDue(cache, Date.now(), 'statusline')) return
  try {
    const script = fileURLToPath(new URL('./refresh.mjs', import.meta.url))
    const child = spawn(process.execPath, isNewLogin ? [script, '--force'] : [script], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {}
}

let line = '\x1b[2mW —\x1b[0m'
try {
  const cache = readCache()
  maybeRefresh(cache)
  line = render(readInput(), cache)
} catch {}
process.stdout.write(line)
