import type { Config, LocalBranch, LocalRepo, MrInfo, RemoteSnapshot } from '../src/types'

export const NOW = Date.parse('2030-03-31T12:00:00Z')
export const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

export const config: Config = {
  projects: [{ name: 'web', path: '/x/web', bases: ['main'] }],
  jira: { baseUrl: 'https://jira.example.com', closedStatuses: ['Done', 'Shipped'], holdStatuses: ['On Hold'], activeStatuses: ['In Progress'] },
  waitingMarkers: ['waiting for'],
}

export const branch = (name: string, over: Partial<LocalBranch> = {}): LocalBranch => ({
  name, tip: `tip-${name}`, date: daysAgo(1), current: false, worktree: false, pushed: true, unpushed: 0, ahead: 2, cherryPlus: 2, ...over,
})

export const repo = (...branches: LocalBranch[]): LocalRepo => ({
  project: 'web', base: 'main', dirty: [], untracked: [], stashes: [], branches: [branch('main', { ahead: 0 }), ...branches],
})

export const mr = (b: string, over: Partial<MrInfo> = {}): MrInfo => ({ project: 'web', sourceBranch: b, iid: 7, state: 'opened', updatedAt: daysAgo(1), ...over })

export const snapshot = (jira: RemoteSnapshot['jira'], mrs: MrInfo[] = [], me = 'Me'): RemoteSnapshot => ({ fetchedAt: daysAgo(0), me, jira, mrs })
