import type { MergeTest, MrInfo } from './types'

export type MergeEvidence = {
  tip: string
  isAncestor?: boolean
  /** Count of "+" lines from `git cherry <base> <branch>`. */
  cherryPlus?: number
  /** The branch's diff is already applied to the base (reverse-apply check passed). */
  contentPresent?: boolean
  mr?: Pick<MrInfo, 'state' | 'sha'>
}

export type MergeVerdict =
  | { merged: true; test: MergeTest }
  | { merged: false; note?: string }

/**
 * The four "is it merged?" tests, strongest first. Only a positive result is
 * evidence: a failed ancestor, cherry or content test is inconclusive (squash,
 * rebase and reworded commits all defeat them), so the answer is never "unmerged".
 */
export function verifyMerged(e: MergeEvidence): MergeVerdict {
  if (e.mr?.state === 'merged' && e.mr.sha === e.tip) return { merged: true, test: 'mr-tip' }
  if (e.isAncestor) return { merged: true, test: 'ancestor' }
  if (e.cherryPlus === 0) return { merged: true, test: 'cherry' }
  if (e.contentPresent) return { merged: true, test: 'content' }
  if (e.mr?.state === 'merged') {
    return { merged: false, note: 'MR merged but the tip differs: newer local commits, or the branch was rebased' }
  }

  return { merged: false }
}
