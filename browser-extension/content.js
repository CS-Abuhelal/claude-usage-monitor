// Claude Usage Monitor: content-script loader. Loads the extension's ES modules
// and starts them; any failure leaves claude.ai exactly as it was.
;(async () => {
  try {
    if (window.top !== window) return
    const { start } = await import(chrome.runtime.getURL('src/main.mjs'))
    start({
      onActivity: notify =>
        chrome.runtime.onMessage.addListener(message => {
          if (message?.type === 'claude-usage-monitor/activity') notify()
        }),
    })
  } catch {}
})()
