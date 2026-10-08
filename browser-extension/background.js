// Claude Usage Monitor: tells the page when a reply has finished, so the
// indicators refresh right after a message instead of at the next minute.
// It only sees request URLs and completion events (no bodies, no headers).

import { COMPLETION_URL } from './src/adapter.mjs'

chrome.webRequest.onCompleted.addListener(
  details => {
    if (details.tabId < 0 || !COMPLETION_URL.test(details.url)) return
    chrome.tabs.sendMessage(details.tabId, { type: 'claude-usage-monitor/activity' }).catch(() => {})
  },
  { urls: ['https://claude.ai/api/organizations/*'] },
)
