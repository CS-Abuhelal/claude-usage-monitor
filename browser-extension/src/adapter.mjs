// Claude Usage Monitor (browser): everything that depends on claude.ai itself.
//
// If a claude.ai update breaks the indicators, this is the file to look at:
// the endpoints the Settings > Usage page uses, how the organisation is found,
// which requests mean "a reply just finished", and where the header controls
// sit. Placement is geometric (it finds the header's right-hand controls by
// hit-testing the top band), so it does not depend on generated class names.

export const USAGE_PAGE = '/settings/usage'

/** A finished reply: the moment usage moves. */
export const COMPLETION_URL = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|retry_completion)\b/

/** Pages with no signed-in header, where nothing is drawn. */
const NO_UI_PATHS = /^\/(login|logout|signup|magic-link|oauth|onboarding|invite|upgrade\/checkout)/

export const isUsablePage = (path = location.pathname) => !NO_UI_PATHS.test(path)

const UUID = /^[0-9a-f-]{36}$/i

class HttpError extends Error {}

async function getJson(path, timeoutMs = 10000) {
  let res
  try {
    res = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new HttpError(err?.name === 'TimeoutError' ? 'timeout' : navigator.onLine === false ? 'offline' : 'network')
  }
  if (!res.ok) throw new HttpError(`http-${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new HttpError('bad-json')
  }
}

export const errorCode = err => (err instanceof HttpError ? err.message : 'network')

function cookie(name) {
  const hit = document.cookie.split('; ').find(c => c.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
}

let knownOrg = null

/** The organisation the page is signed in to (the same one Settings shows). */
export async function organizationId() {
  const fromCookie = cookie('lastActiveOrg')
  if (fromCookie && UUID.test(fromCookie)) return (knownOrg = fromCookie)
  if (knownOrg) return knownOrg
  const orgs = await getJson('/api/organizations')
  const list = Array.isArray(orgs) ? orgs : []
  const pick = list.find(o => Array.isArray(o?.capabilities) && o.capabilities.includes('chat')) ?? list[0]
  if (!pick?.uuid || !UUID.test(pick.uuid)) throw new HttpError('no-org')
  return (knownOrg = pick.uuid)
}

export const fetchUsage = org => getJson(`/api/organizations/${org}/usage`)
export const fetchPrepaidCredits = org => getJson(`/api/organizations/${org}/prepaid/credits`)

// ---------- placement ----------

const INTERACTIVE = 'button, a[href], [role="button"], [role="tab"], input, select, textarea'
const BAND_ROWS = [26, 20, 32, 40] // y offsets that cross claude.ai's header controls
const RIGHT_EDGE_PX = 220 // the header's right-hand controls start within this of the edge

function controlAt(x, y, own) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === own || own.contains(el)) continue
    const control = el.closest(INTERACTIVE)
    if (control) return control
    const style = getComputedStyle(el)
    if (style.pointerEvents !== 'none' && el !== document.body && el !== document.documentElement && el.childElementCount === 0 && el.textContent.trim()) return el // a visible label (e.g. a title)
  }
  return null
}

/**
 * Where the indicators go: just left of the header's right-hand controls,
 * vertically centred on them, plus how much free room lies further left.
 * Returns { right, centerY, room } in viewport pixels.
 */
export function measureSlot(own) {
  const width = document.documentElement.clientWidth
  const step = 6
  for (const y of BAND_ROWS) {
    let clusterLeft = null
    let rect = null
    let lastLeft = width
    for (let x = width - 4; x > width * 0.35; x -= step) {
      const control = controlAt(x, y, own)
      if (control) {
        const r = control.getBoundingClientRect()
        if (r.height < 14 || r.height > 64 || r.top > 72) continue
        if (clusterLeft === null && r.right < width - RIGHT_EDGE_PX) break // nothing at the right edge: no cluster on this row
        if (clusterLeft !== null && lastLeft - r.right > 28) break // a gap: the cluster ended
        clusterLeft = Math.min(clusterLeft ?? r.left, r.left)
        rect = rect ?? r
        lastLeft = r.left
        x = r.left // jump past this control
      } else if (clusterLeft !== null && lastLeft - x > 28) {
        break
      }
    }
    if (clusterLeft !== null) {
      const centerY = rect.top + rect.height / 2
      return { right: width - clusterLeft + 6, centerY, room: roomLeftOf(clusterLeft - 6, centerY, own) }
    }
  }
  return { right: 12, centerY: 26, room: roomLeftOf(width - 12, 26, own) }
}

/** Free pixels leftwards of `fromX` before the next control or label (up to 420). */
function roomLeftOf(fromX, y, own) {
  let room = 0
  for (let x = fromX; x > 0 && room < 420; x -= 6, room += 6) {
    if (controlAt(x, y, own)) break
  }
  return room
}
