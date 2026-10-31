import type { Item, LocalRepo, MergeTest, Stash } from './types'

export type BranchCandidate = {
  project: string
  branch: string
  action: 'delete' | 'review'
  test?: MergeTest
  reasons: string[]
}

/**
 * Splits branches into ones that are safe to delete and ones that need a human.
 * Only a closed item (merged with evidence) can be "delete"; nothing is ever deleted here.
 */
export function branchCandidates(items: Item[], snapshotAgeMinutes: number | undefined, maxAgeMinutes: number): BranchCandidate[] {
  const out: BranchCandidate[] = []
  for (const it of items) {
    if (!it.branch || !it.local) continue
    const base = { project: it.project, branch: it.branch, test: it.mergedBy }
    if (it.local.current || it.local.worktree) continue
    if (it.bucket === 'closed') {
      const stale = it.mergedBy === 'mr-tip' && (snapshotAgeMinutes === undefined || snapshotAgeMinutes > maxAgeMinutes)
      out.push(
        stale
          ? { ...base, action: 'review', reasons: [`MR-tip evidence comes from a remote snapshot older than ${maxAgeMinutes} min: refresh first`] }
          : { ...base, action: 'delete', reasons: [`merged (${it.mergedBy})`, ...(it.jira ? [`Jira: ${it.jira.status}`] : [])] },
      )
    } else if (it.mergedBy) {
      out.push({ ...base, action: 'review', reasons: [`merged (${it.mergedBy}) but the card is ${it.jira?.status ?? 'not closed'}`] })
    } else if (it.badges.includes('merged')) {
      out.push({ ...base, action: 'review', reasons: ['merge not proven'] })
    }
  }

  return out
}

export type StashVerdict = { action: 'drop' | 'keep' | 'ask'; why: string; missingPct: number }

const NOISE = /(^|\/)(\.husky\/|CLAUDE\.md$|yarn\.lock$|package-lock\.json$|pnpm-lock\.yaml$|session-context\.md$)/

/**
 * The stash heuristic: how many added lines are absent from the base. A high
 * percentage is not proof of value (reworked lines count as missing), so
 * anything unclear is "ask", never "drop".
 */
export function triageStash(
  files: { file: string; adds: string[]; baseLines?: Set<string> }[],
  cardKind?: 'closed' | 'active' | 'hold' | 'other',
): StashVerdict {
  let total = 0
  let missing = 0
  let noiseOnly = true
  let allGone = files.length > 0
  for (const f of files) {
    const miss = f.baseLines ? f.adds.filter(a => !f.baseLines!.has(a)).length : f.adds.length
    total += f.adds.length
    missing += miss
    if (miss > 0 && !NOISE.test(f.file)) noiseOnly = false
    if (f.baseLines) allGone = false
  }
  const missingPct = total ? Math.floor((100 * missing) / total) : 0
  const v = (action: StashVerdict['action'], why: string): StashVerdict => ({ action, why, missingPct })

  if (cardKind === 'active' || cardKind === 'hold') return v('keep', `card is ${cardKind}`)
  if (total === 0 || missingPct <= 5) return v('drop', 'already in the base')
  if (noiseOnly && missing <= 25) return v('drop', 'only tooling/lockfile noise')
  if (allGone) return v('drop', 'every file is gone from the base (obsolete)')
  if (cardKind === 'closed') return v('drop', 'its card is closed')

  return v('ask', `${missingPct}% of added lines are not in the base: may be reworked, may be unique`)
}

export type StashCandidate = { project: string; stash: Stash } & StashVerdict

export const stashCount = (repos: LocalRepo[]) => repos.reduce((n, r) => n + r.stashes.length, 0)
