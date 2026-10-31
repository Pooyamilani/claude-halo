import { days, jiraFor, keyOf } from './config'
import { verifyMerged } from './merge'
import type { Badge, Config, Item, JiraInfo, LocalBranch, LocalRepo, MrInfo, Note, Project, RemoteSnapshot } from './types'

const DAY = 86_400_000
/** Never listed as work or offered for deletion, whatever the project's own bases say. */
const MAINLINE = ['main', 'master', 'develop', 'development', 'trunk']
const lower = (list?: string[]) => (list ?? []).map(s => s.toLowerCase())

type Kind = 'closed' | 'hold' | 'active' | 'other'

/** Maps a Jira status onto closed / hold / active using config names first, then Jira's own category. */
export function statusKind(jira: JiraInfo, settings?: Config['jira']): Kind {
  const name = jira.status.toLowerCase()
  if (lower(settings?.closedStatuses).includes(name)) return 'closed'
  if (lower(settings?.holdStatuses).includes(name)) return 'hold'
  if (lower(settings?.activeStatuses).includes(name)) return 'active'
  if (!settings?.closedStatuses && jira.statusCategory === 'done') return 'closed'
  if (!settings?.holdStatuses && /hold|waiting/.test(name)) return 'hold'
  if (!settings?.activeStatuses && jira.statusCategory === 'indeterminate') return 'active'

  return 'other'
}

function bestMr(mrs: MrInfo[], project: string, branch: string): MrInfo | undefined {
  return mrs
    .filter(m => m.project === project && m.sourceBranch === branch)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
}

export type ClassifyInput = {
  config: Config
  repos: LocalRepo[]
  remote?: RemoteSnapshot
  notes?: Note[]
  now: number
}

export function classify({ config, repos, remote, notes = [], now }: ClassifyInput): Item[] {
  const items: Item[] = []
  const { stale, idle } = days(config)
  const me = remote?.me?.toLowerCase()
  const protectedNames = new Set([...MAINLINE, ...config.projects.flatMap(p => p.bases ?? [])])

  for (const repo of repos) {
    const project = config.projects.find(p => p.name === repo.project) as Project
    const settings = jiraFor(config, project)
    const bases = project.bases?.length ? project.bases : [repo.base]
    const seen = new Set<string>()

    for (const b of repo.branches) {
      if (bases.includes(b.name) || protectedNames.has(b.name)) continue
      const key = keyOf(b.name, settings)
      if (key) seen.add(key)
      items.push(withUrl(classifyBranch({ b, key, project: project.name, settings, remote, notes, me, now, stale, idle }), settings?.baseUrl))
    }
    for (const n of notes) {
      if (n.project !== project.name || seen.has(n.key)) continue
      // A plan for a card with no local branch only matters while Jira says it is open.
      const jira = remote?.jira[n.key]
      if (!jira || statusKind(jira, settings) === 'closed') continue
      items.push(withUrl(classifyNoteOnly(n, project.name, jira, me), settings?.baseUrl))
    }
  }

  return items
}

const withUrl = (item: Item, base?: string): Item => (base && item.key ? { ...item, jiraUrl: `${base.replace(/\/$/, '')}/browse/${item.key}` } : item)

type BranchArgs = {
  b: LocalBranch
  key?: string
  project: string
  settings?: Config['jira']
  remote?: RemoteSnapshot
  notes: Note[]
  me?: string
  now: number
  stale: number
  idle: number
}

function classifyBranch({ b, key, project, settings, remote, notes, me, now, stale, idle }: BranchArgs): Item {
  const jira = key ? remote?.jira[key] : undefined
  const mr = remote ? bestMr(remote.mrs, project, b.name) : undefined
  const mrAge = mr?.updatedAt ? Math.floor((now - Date.parse(mr.updatedAt)) / DAY) : undefined
  const idleDays = Math.floor((now - Date.parse(b.date)) / DAY)
  const verdict = verifyMerged({ tip: b.tip, isAncestor: b.isAncestor, cherryPlus: b.cherryPlus, contentPresent: b.contentPresent, mr })
  const kind = jira ? statusKind(jira, settings) : undefined
  const badges: Badge[] = []
  const unpushed = !b.pushed ? b.ahead > 0 : b.unpushed > 0
  if (unpushed) badges.push('unpushed')

  const item: Item = {
    key,
    project,
    branch: b.name,
    jira,
    mr: mr && { ...mr, ageDays: mrAge },
    local: { unpushed: b.unpushed, ahead: b.ahead, pushed: b.pushed, worktree: b.worktree, current: b.current, idleDays },
    bucket: 'local',
    nextStep: '',
    badges,
    mergedBy: verdict.merged ? verdict.test : undefined,
  }
  const done = (bucket: Item['bucket'], nextStep: string, waitingOn?: string): Item => ({ ...item, bucket, nextStep, waitingOn })

  // Rule 1: finished card and merged work.
  if (verdict.merged && (kind === 'closed' || !jira)) {
    return done('closed', 'Nothing to do: merged' + (b.worktree || b.current ? ' (branch in use, keep)' : ''))
  }
  if (!key) return done('tooling', toolingStep(b, mr, unpushed, verdict.merged, stale, mrAge, badges))

  // Rule 2: open MR.
  if (mr?.state === 'opened') {
    const old = mrAge !== undefined && mrAge > stale
    if (old) badges.push('review-stale')
    if (kind === 'closed' || (jira && jira.statusCategory === 'new')) badges.push('jira-mismatch')

    return done('action', old ? `Chase the review (open ${mrAge} days)` : 'Review / merge the MR')
  }
  // Rule 3: unpushed commits.
  if (unpushed) return done('action', b.pushed ? 'Push the new commits' : 'Push the branch')
  // Rule 4: pushed, active, no MR.
  if (kind === 'active' && b.pushed && (!mr || mr.state === 'closed') && b.ahead > 0) return done('action', 'Open an MR')
  // Rule 5: parked.
  const note = notes.find(n => n.key === key && n.project === project && n.waiting)
  if (kind === 'hold' || note) {
    badges.push('on-hold')

    return done('waiting', 'Wait', note?.waiting ?? jira?.status)
  }
  // Rule 6: active but cold.
  if (kind === 'active' && idleDays > idle) return done('action', `Unclear: untouched ${idleDays} days, still active?`)
  // Rule 7: someone else's card.
  if (jira?.assignee && me && jira.assignee.toLowerCase() !== me) return done('waiting', 'Not yours', `owned by ${jira.assignee}`)
  if (kind === 'closed') return done('local', 'Card closed but merge not verified: review before deleting')
  if (!jira && remote) badges.push('unverified')

  return done('local', remote ? (jira ? 'Nothing pending' : 'Card not found in Jira') : 'No remote data: run a remote refresh')
}

function toolingStep(b: LocalBranch, mr: MrInfo | undefined, unpushed: boolean, merged: boolean, stale: number, age: number | undefined, badges: Badge[]): string {
  if (mr?.state === 'opened') {
    if (age !== undefined && age > stale) badges.push('review-stale')

    return age !== undefined && age > stale ? `Chase the review (open ${age} days)` : 'Review / merge the MR'
  }
  if (unpushed) return b.pushed ? 'Push the new commits' : 'Push the branch'
  if (merged) return 'Merged: delete locally'

  return 'Local only, no card'
}

function classifyNoteOnly(n: Note, project: string, jira: JiraInfo | undefined, me?: string): Item {
  const mine = !jira?.assignee || !me || jira.assignee.toLowerCase() === me
  const waitingOn = n.waiting ?? (mine ? 'no local branch yet' : `owned by ${jira?.assignee}`)

  return { key: n.key, project, jira, bucket: 'waiting', nextStep: 'Not started here', waitingOn, badges: [] }
}
