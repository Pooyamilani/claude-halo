export type ViewState = {
  /** JSON-safe copies of the last refresh. */
  items: unknown[]
  repos: unknown[]
  problems: string[]
  sources: { name: string; ok: boolean; error?: string }[]
  snapshotAge?: number
  busy: boolean
  status: string
  collapsed: Record<string, boolean>
  armed?: string
  cleanup?: unknown
}

declare module 'claude-code' {
  interface PluginState {
    'halo-desk': { view: ViewState }
  }
}
