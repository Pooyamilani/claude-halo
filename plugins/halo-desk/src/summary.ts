import type { Item } from './types'

export type Groups = { action: Item[]; waiting: Item[]; tooling: Item[]; closed: Item[]; local: Item[] }

const rank = (i: Item) => (i.mr?.ageDays ?? -1) * -1

/** "Needs action" sorts by MR age (oldest first), then Jira status. */
export function group(items: Item[]): Groups {
  const g: Groups = { action: [], waiting: [], tooling: [], closed: [], local: [] }
  for (const i of items) g[i.bucket].push(i)
  g.action.sort((a, b) => rank(a) - rank(b) || (a.jira?.status ?? '').localeCompare(b.jira?.status ?? ''))

  return g
}

const BADGE: Record<string, string> = {
  unpushed: 'unpushed',
  'review-stale': 'review stale',
  'jira-mismatch': 'jira≠MR',
  'on-hold': 'on hold',
  merged: 'merged',
  unverified: 'unverified',
}

/** Two display lines for a row: a title and a dim detail. */
export function describeItem(i: Item): { title: string; badges: string[]; detail: string } {
  const mr = i.mr ? `!${i.mr.iid} ${i.mr.state}${i.mr.ageDays !== undefined ? ` ${i.mr.ageDays}d` : ''}` : undefined
  const detail = [i.jira?.status, mr, i.waitingOn ?? i.nextStep].filter(Boolean).join(' · ')

  return { title: `${i.key ?? i.branch ?? '?'} · ${i.project}`, badges: i.badges.map(b => BADGE[b] ?? b), detail }
}
