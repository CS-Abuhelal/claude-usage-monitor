// usage-monitor's state contract: the one value its drawing reads.

/** A UsageSnapshot as JSON (see hooks/core/usage-schema.d.mts for its shape). */
export type UsageSnapshotJson = { [field: string]: unknown }

export type UsageMonitorView = {
  /** The latest snapshot: the shared cache, refreshed, with live rate limits merged in. */
  snapshot: UsageSnapshotJson | null
  /** Short machine reason the last refresh failed (core/usage-cache), or null. */
  error: string | null
  /** True until the first refresh has finished. */
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'usage-monitor': { view: UsageMonitorView }
  }
}
