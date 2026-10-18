export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type RunningAgent = { id: string; type: string; model: string; effort: string }

declare module 'claude-code' {
  interface PluginState {
    halo: { limits: Limit[]; main: string; agents: RunningAgent[]; models: Record<string, string>; efforts: Record<string, string> }
  }
}
