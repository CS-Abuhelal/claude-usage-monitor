// Claude Usage Monitor (browser): the indicators and their tooltip.
//
// A closed shadow root on an element of its own under <html>, outside React's
// tree, so claude.ai's styles and re-renders never touch it and it never
// touches them. Colours are claude.ai's own theme tokens (--text-300,
// --accent-brand, ...), which flip with its light/dark mode; the fallbacks
// cover a future rename. No data logic here: it draws the UsageView it is given.

import { cloudSvg, ringSvg } from './core/usage-format.mjs'

const CSS = `
:host { all: initial; position: fixed; z-index: 40; top: 0; right: 0; display: block;
  --fb-text: 30 3% 25%; --fb-strong: 30 3% 15%; --fb-muted: 40 2% 50%; --fb-bg: 0 0% 100%; --fb-border: 30 3% 25%;
  --fb-warn: 40 100% 39%; --fb-brand: 15 63% 60%; --fb-danger: 0 72% 51%; }
:host([data-mode="dark"]) { --fb-text: 50 9% 74%; --fb-strong: 60 14% 97%; --fb-muted: 48 5% 57%; --fb-bg: 60 2% 12%; --fb-border: 50 10% 85%;
  --fb-warn: 41 96% 54%; --fb-danger: 0 72% 65%; }
:host([hidden]) { display: none; }
:host([data-crowded]) .bar { background: hsl(var(--bg-100, var(--fb-bg))); border-radius: 8px;
  box-shadow: -14px 0 12px -2px hsl(var(--bg-100, var(--fb-bg))); }
* { box-sizing: border-box; }
.bar { display: flex; align-items: center; gap: 2px; height: 32px; font: 400 13px/1 var(--font-ui, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: hsl(var(--text-400, var(--fb-muted))); -webkit-font-smoothing: antialiased; user-select: none; }
/* At rest: an icon and a figure on Claude's own background, nothing else. */
.ind { display: inline-flex; align-items: center; gap: 5px; padding: 3px 5px; border-radius: 5px; color: inherit; text-decoration: none;
  cursor: pointer; outline: none; transition: background-color 120ms ease, color 120ms ease; white-space: nowrap; }
.ind:hover, .ind:focus-visible { background: hsl(var(--text-100, var(--fb-strong)) / 0.06); }
.ind:focus-visible { box-shadow: 0 0 0 1.5px hsl(var(--accent-100, 212 75% 62%) / 0.7); }
.ind svg { flex: none; display: block; }
.lbl { font-variant-numeric: tabular-nums; }
.weekly .lbl { color: hsl(var(--text-200, var(--fb-text))); font-weight: 500; } /* weekly reads first */
.ind:hover .lbl { color: hsl(var(--text-100, var(--fb-strong))); }
/* Only the ring carries the signal colour. */
.ring { color: hsl(var(--text-400, var(--fb-muted))); }
.sev-elevated .ring { color: hsl(var(--warning-100, var(--fb-warn))); }
.sev-warning .ring { color: hsl(var(--accent-brand, var(--fb-brand))); }
.sev-critical .ring { color: hsl(var(--danger-100, var(--fb-danger))); }
.sev-unknown .lbl { color: hsl(var(--text-500, var(--fb-muted))); }
.stale .lbl { opacity: 0.6; }
.tip { position: fixed; z-index: 1; max-width: 260px; padding: 9px 11px 8px; border-radius: 10px; pointer-events: none;
  background: hsl(var(--bg-000, var(--fb-bg))); color: hsl(var(--text-200, var(--fb-text)));
  border: 0.5px solid hsl(var(--border-300, var(--fb-border)) / 0.18);
  box-shadow: 0 6px 24px hsl(var(--always-black, 0 0% 0%) / 0.14), 0 1px 3px hsl(var(--always-black, 0 0% 0%) / 0.08);
  font: 400 12.5px/1.45 var(--font-ui, system-ui, -apple-system, "Segoe UI", sans-serif); opacity: 0; transform: translateY(-2px);
  transition: opacity 110ms ease, transform 110ms ease; }
.tip.show { opacity: 1; transform: none; }
.tip .t { font-weight: 600; color: hsl(var(--text-100, var(--fb-strong))); margin-bottom: 3px; }
.tip .strong { color: hsl(var(--text-100, var(--fb-strong))); font-weight: 500; }
.tip .muted, .tip .hint, .tip .foot { color: hsl(var(--text-500, var(--fb-muted))); }
.tip .gap { height: 6px; }
.tip .foot { margin-top: 6px; font-size: 11.5px; }
`

const SHOW_DELAY_MS = 280
const ICON = 14

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/** A trusted, self-built SVG string -> element (no HTML parsing of data). */
function svgNode(markup, fallback) {
  try {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    if (doc.documentElement?.nodeName === 'svg') return document.importNode(doc.documentElement, true)
  } catch {}
  return document.createTextNode(fallback)
}

function iconFor(metric) {
  if (metric.key === 'cloud') {
    const remaining = metric.usedPct === null ? (metric.isAvailable ? 100 : 0) : 100 - metric.usedPct
    return cloudSvg({ remainingPct: remaining, size: ICON, id: 'page' })
  }
  if (metric.key === 'credits') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.7 5.9c-.3-.5-.9-.8-1.7-.8-1 0-1.7.5-1.7 1.3 0 1.8 3.5.9 3.5 2.8 0 .8-.8 1.4-1.8 1.4-.9 0-1.5-.4-1.8-1M8 4.2v1M8 10.8v1" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`
  }
  return ringSvg({ usedPct: metric.usedPct, size: ICON, stroke: 1.75, trackOpacity: 0.22 }) // Claude's ring geometry, a touch larger
}

/**
 * Creates the indicator bar. `onOpenUsage` handles a click; returns
 * { render(view, level), place(slot), hide(), destroy() }.
 */
export function createIndicatorBar({ usageHref, onOpenUsage }) {
  for (const stale of document.querySelectorAll('claude-usage-monitor')) stale.remove() // left by a reloaded extension
  const host = document.createElement('claude-usage-monitor')
  host.setAttribute('hidden', '')
  const root = host.attachShadow({ mode: 'closed' })
  const style = el('style')
  style.textContent = CSS
  const bar = el('div', 'bar')
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Claude usage')
  const tip = el('div', 'tip')
  tip.setAttribute('role', 'tooltip')
  tip.id = 'cum-tip'
  root.append(style, bar, tip)
  document.documentElement.append(host)

  const syncMode = () => host.setAttribute('data-mode', document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light')
  syncMode()
  const modeWatch = new MutationObserver(syncMode)
  modeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'class'] })

  let showTimer = 0
  let tipFor = null
  let current = new Map() // key -> { metric, footer }

  function fillTip(key) {
    const entry = current.get(key)
    if (!entry) return false
    const { metric, footer } = entry
    tip.replaceChildren(el('div', 't', metric.title))
    for (const line of metric.lines) {
      const row = el('div', line.tone)
      row.append(line.text)
      if (line.hint) row.append(el('span', 'hint', ` · ${line.hint}`))
      tip.append(row)
    }
    if (footer) tip.append(el('div', 'foot', footer))
    return true
  }

  function positionTip(anchor) {
    const a = anchor.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    tip.style.left = '0px'
    tip.style.top = '0px'
    const t = tip.getBoundingClientRect()
    let left = a.left + a.width / 2 - t.width / 2
    left = Math.max(8, Math.min(left, vw - t.width - 8))
    let top = a.bottom + 6
    if (top + t.height > vh - 8) top = Math.max(8, a.top - t.height - 6)
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
  }

  function showTip(anchor, key, isImmediate) {
    clearTimeout(showTimer)
    const open = () => {
      if (!fillTip(key)) return
      tipFor = key
      anchor.setAttribute('aria-describedby', 'cum-tip')
      positionTip(anchor)
      tip.classList.add('show')
    }
    if (isImmediate) open()
    else showTimer = setTimeout(open, SHOW_DELAY_MS)
  }

  function hideTip() {
    clearTimeout(showTimer)
    tipFor = null
    tip.classList.remove('show')
  }

  function indicator(metric, { hasLabel, footer, isStale }) {
    const link = el('a', `ind ${metric.key} sev-${metric.isAvailable ? metric.severity : 'unknown'}${isStale ? ' stale' : ''}`)
    link.href = usageHref
    link.setAttribute('aria-label', `${metric.title}: ${metric.lines.map(l => l.text).join(', ')}`)
    const icon = el('span', 'ring')
    icon.append(svgNode(iconFor(metric), metric.key === 'cloud' ? '☁' : metric.key === 'credits' ? '$' : '◔'))
    link.append(icon)
    if (hasLabel) link.append(el('span', 'lbl', metric.short))
    link.addEventListener('mouseenter', () => showTip(link, metric.key, tipFor !== null))
    link.addEventListener('mouseleave', hideTip)
    link.addEventListener('focus', () => showTip(link, metric.key, true))
    link.addEventListener('blur', hideTip)
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return // new tab etc.
      event.preventDefault()
      hideTip()
      onOpenUsage()
    })
    current.set(metric.key, { metric, footer })
    return link
  }

  return {
    /** `items`: [{ metric, hasLabel }] in display order. */
    render(items, { footer, isStale }) {
      const reopen = tipFor
      current = new Map()
      bar.replaceChildren(...items.map(item => indicator(item.metric, { hasLabel: item.hasLabel, footer, isStale })))
      host.removeAttribute('hidden')
      if (reopen && fillTip(reopen)) {
        const anchor = bar.querySelector(`.ind.${reopen}`)
        if (anchor) positionTip(anchor)
      } else hideTip()
    },
    /** Puts the bar's right edge `right` px from the viewport edge, centred on `centerY`. */
    place({ right, centerY }) {
      host.style.right = `${Math.round(right)}px`
      host.style.top = `${Math.round(centerY - 16)}px`
    },
    width: () => bar.getBoundingClientRect().width,
    /** Out of room even at the smallest level: sit on the header's own colour. */
    setCrowded(isCrowded) {
      if (isCrowded) host.setAttribute('data-crowded', '')
      else host.removeAttribute('data-crowded')
    },
    hide() {
      hideTip()
      host.setAttribute('hidden', '')
    },
    get element() {
      return host
    },
    destroy() {
      modeWatch.disconnect()
      host.remove()
    },
  }
}
