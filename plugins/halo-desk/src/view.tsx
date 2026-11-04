import { describeItem, group } from './summary'
import type { Item } from './types'

const KIND_COLOR: Record<string, string> = { unpushed: 'error', 'review-stale': 'warning', 'jira-mismatch': 'warning', 'on-hold': 'inactive', merged: 'merged', unverified: 'inactive' }
// Halo's palette: teal is calm and the primary accent, violet the secondary, amber and red the warm and hot states.
const HALO: Record<string, string> = { error: '#f0645c', warning: '#f2b84b', success: '#4fd1b5', suggestion: '#8f9bff', merged: '#e07a52', inactive: '#8b93a1', subtle: '#8b93a1' }
const hex = (c: string) => HALO[c] ?? c
const alpha = (a: number) => Math.round(a * 255).toString(16).padStart(2, '0')
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 46">
  <circle cx="23" cy="23" r="15" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3.2"/>
  <circle cx="23" cy="23" r="9" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3.2"/>
  <circle cx="23" cy="23" r="15" fill="none" stroke="#8f9bff" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="62 94.25" transform="rotate(-90 23 23)"/>
  <circle cx="23" cy="23" r="9" fill="none" stroke="#4fd1b5" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="38 56.55" transform="rotate(-90 23 23)"/>
  <circle cx="23" cy="2.5" r="2" fill="#e07a52"/><circle cx="40.75" cy="33.25" r="2" fill="#4fd1b5"/><circle cx="5.25" cy="33.25" r="2" fill="#8f9bff"/>
</svg>`
const TIPS = {
  refresh: 'Re-reads local git (fetches origin, branches, stashes, changes) and reclassifies with the last saved Jira/GitLab data.',
  remote: 'Pulls fresh Jira and GitLab data (tokens, or Claude through your signed-in browser or an MCP server), saves it, then refreshes.',
  cleanup: 'Lists branches proven merged and stashes already in the base, with evidence. Deletes only after a second press.',
}

export type Actions = {
  toggle: (name: string) => unknown
  refresh: () => unknown
  remote: () => unknown
  review: () => unknown
  copy: (text: string) => unknown
  arm: (what: string, run: () => Promise<void>) => unknown
  cancel: () => unknown
  closeCleanup: () => unknown
  deleteBranches: () => Promise<void>
  dropStashes: () => Promise<void>
}

/** Pure drawing: the element table, the surface, the data and the handlers in; a tree out. */
export function renderView(args: { E: any; rich: boolean; v: any; maxAge: number; cleanable: number; act: Actions }) {
  const { E, rich, v, maxAge, cleanable, act } = args
  const { Box, Text, Button, Link, Svg } = E
  const bold: any = { bold: true }
  const tint = (c: string, a: number): any => (rich ? { backgroundColor: `${hex(c)}${alpha(a)}` } : {})
  const edge = (c: string, a: number): any => (rich ? { borderColor: `${hex(c)}${alpha(a)}` } : { borderColor: hex(c) })
  const g = group(v.items)
  const glass = (c = 'inactive'): any => ({ borderStyle: 'round', ...edge(c, c === 'inactive' ? 0.3 : 0.4), ...(rich ? { backgroundColor: '#ffffff0a' } : {}) })

  // A pill is one tinted line of text, not a bordered box: it keeps a card's header a single row high.
  const pill = (label: string, color: string) =>
    rich ? (
      <Text color={hex(color)} {...tint(color, 0.22)}>{` ${label} `}</Text>
    ) : (
      <Text color={hex(color)}>{`[${label}]`}</Text>
    )
  const failed = v.sources.filter(s => !s.ok)
  const age = v.snapshotAge
  const sync = v.busy
    ? pill('● Working', 'suggestion')
    : failed.length
      ? pill('● Source error', 'error')
      : age === undefined
        ? pill('○ Local only', 'inactive')
        : age > (maxAge)
          ? pill(`● Stale · ${age >= 120 ? Math.floor(age / 60) + 'h' : age + 'm'}`, 'warning')
          : pill(`● Synced · ${age}m`, 'success')

  const tile = (label: string, count: number, color: string) => (
    <Box key={`tile-${label}`} flexDirection="column" flexGrow={1} paddingX={1} {...glass(count > 0 ? color : 'inactive')} hover={rich ? { backgroundColor: `${hex(color)}2e` } : {}}>
      <Text {...bold} color={hex(count > 0 ? color : 'inactive')}>
        {String(count).padStart(2, '0')}
      </Text>
      <Text color={hex('subtle')}>{label}</Text>
    </Box>
  )

  const accentOf = (i: Item) =>
    i.badges.includes('unpushed') ? 'error' : i.badges.includes('review-stale') || i.badges.includes('jira-mismatch') ? 'warning' : i.bucket === 'action' ? 'suggestion' : i.bucket === 'tooling' ? 'merged' : 'inactive'

  const card = (i: Item) => {
    const d = describeItem(i)
    const accent = accentOf(i)
    const mr = i.mr ? `MR !${i.mr.iid} ${i.mr.state}${i.mr.ageDays !== undefined ? ` · ${i.mr.ageDays}d` : ''}` : undefined

    return (
      <Box key={`card-${i.project}-${i.branch ?? i.key}`} flexDirection="row" {...glass(accent)} hover={rich ? { backgroundColor: `${hex(accent)}1f`, borderColor: `${hex(accent)}cc` } : {}}>
        <Box width={1} backgroundColor={hex(accent)} />
        <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Text {...bold}>{i.key ?? i.branch}</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {i.badges.map(b => pill(d.badges[i.badges.indexOf(b)], KIND_COLOR[b] ?? 'inactive'))}
              {i.jira?.status && pill(i.jira.status, accent)}
            </Box>
          </Box>
          <Text color={hex('subtle')}>
            {i.project}
            {i.branch ? ` · ${i.branch}` : ''}
          </Text>
          <Text>{i.waitingOn ? `${i.nextStep}: ${i.waitingOn}` : i.nextStep}</Text>
          <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap" marginTop={1}>
            {mr && <Text color={hex('subtle')}>{mr}</Text>}
            {i.jiraUrl && (
              <Text>
                <Link href={i.jiraUrl}>Jira card</Link>
              </Text>
            )}
            {i.mr?.webUrl && (
              <Text>
                <Link href={i.mr.webUrl}>Merge request</Link>
              </Text>
            )}
            {i.branch && <Button key={`copy-${i.project}-${i.branch}`} plain label="Copy branch" onPress={() => void act.copy(i.branch)} />}
          </Box>
        </Box>
      </Box>
    )
  }

  const section = (name: string, label: string, items: Item[], color: string) =>
    items.length === 0 ? null : (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={hex(color)}>●</Text>
            <Text {...bold}>{label}</Text>
            <Text color={hex('subtle')}>{items.length}</Text>
          </Box>
          <Button key={`t-${name}`} plain label={v.collapsed[name] ? 'Show' : 'Hide'} onPress={() => void act.toggle(name)} />
        </Box>
        {!v.collapsed[name] && items.map(card)}
      </Box>
    )

  const tip = (name: keyof typeof TIPS) => (
    <Box display="none" hover={{ scope: `tip-${name}`, display: 'flex' }}>
      <Text color={hex('subtle')}>{TIPS[name]}</Text>
    </Box>
  )
  const tipped = (name: keyof typeof TIPS, label: string, onPress: () => void, variant?: 'primary') => (
    <Box hover={{ scope: `tip-${name}` }}>
      <Button key={name} label={label} variant={variant} onPress={onPress} />
    </Box>
  )

  const c = v.cleanup

  // The approval card: says what will run, then Approve or Cancel. Pressing the same action button again also approves.
  const run: Record<string, () => Promise<void>> = { refresh: async () => void act.refresh(), remote: async () => void act.remote(), branches: act.deleteBranches, stashes: act.dropStashes }
  const doomed = (c?.branches ?? []).filter(b => b.action === 'delete')
  const droppable = (c?.stashes ?? []).filter(s => s.action === 'drop')
  const WILL: Record<string, [string, string]> = {
    refresh: ['Fetch from remotes?', `Runs git fetch in ${v.repos.length} repo(s). Only remote-tracking branches change; nothing is deleted.`],
    remote: ['Refresh Jira and GitLab data?', 'Fetches, then reads Jira and GitLab (or asks Claude to use your signed-in browser or an MCP server) and saves remote-snapshot.json. Read-only on Jira and GitLab.'],
    branches: [`Delete ${doomed.length} local branch(es)?`, `${doomed.map(b => `${b.project}/${b.branch}`).join(', ')}. Each is re-checked against fresh git state first.`],
    stashes: [`Drop ${droppable.length} stash(es)?`, 'Each is re-checked first. Untracked files are never touched.'],
  }
  const approval = (what: string) =>
    v.armed === what && WILL[what] ? (
      <Box key={`approve-${what}`} flexDirection="column" gap={1} padding={1} {...glass('warning')} {...tint('warning', 0.08)}>
        <Text {...bold} color={hex('warning')}>
          {`⚠ ${WILL[what][0]}`}
        </Text>
        <Text color={hex('subtle')}>{WILL[what][1]}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="approve" label="Approve" variant="primary" onPress={() => void act.arm(what, run[what])} />
          <Button key="cancel" plain label="Cancel" onPress={() => void act.cancel()} />
        </Box>
      </Box>
    ) : null

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" gap={1} alignItems="center">
          {rich && Svg ? <Svg source={MARK} alt="halo" width={30} height={30} /> : <Text color={hex('success')} {...bold}>◉</Text>}
          <Box flexDirection="column">
            <Text {...bold}>
              halo <Text color={hex('subtle')}>desk</Text>
            </Text>
            <Text color={hex('subtle')}>{`${v.repos.length} repos · Jira · GitLab`}</Text>
          </Box>
        </Box>
        {sync}
      </Box>
      <Box flexDirection="row" gap={1}>
        {tile('Needs action', g.action.length, 'error')}
        {tile('Waiting', g.waiting.length, 'warning')}
        {tile('Cleanup', cleanable, 'suggestion')}
      </Box>
      <Box flexDirection="row" gap={1}>
        {tipped('refresh', 'Refresh', () => void act.arm('refresh', act.refresh), 'primary')}
        {tipped('remote', 'Remote', () => void act.arm('remote', act.remote))}
        {tipped('cleanup', 'Cleanup', () => void act.review())}
      </Box>
      {approval('refresh')}
      {approval('remote')}
      <Box flexDirection="column" minHeight={1}>
        {tip('refresh')}
        {tip('remote')}
        {tip('cleanup')}
      </Box>
      {!/^Updated/.test(v.status) && <Text color={hex('subtle')}>{v.status}</Text>}
      {v.problems.map(p => (
        <Text color={hex('warning')}>{p}</Text>
      ))}
      {failed.map(s => (
        <Text color={hex('error')}>{`${s.name}: ${s.error ?? 'unavailable'}`}</Text>
      ))}
      {section('action', 'Needs action', g.action, 'error')}
      {section('waiting', 'Waiting on something', g.waiting, 'warning')}
      {section('tooling', 'Tooling, no card', g.tooling, 'merged')}
      <Box flexDirection="column" gap={1} padding={1} {...glass()}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text {...bold}>Local state</Text>
          <Button key="t-local" plain label={v.collapsed.local ? 'Show' : 'Hide'} onPress={() => void toggle('local')} />
        </Box>
        {!v.collapsed.local &&
          v.repos.map(r => (
            <Text color={hex('subtle')}>{`${r.project}: ${r.branches.length} branches · ${r.stashes.length} stashes · ${r.dirty.length} changed · ${r.untracked.length} untracked`}</Text>
          ))}
      </Box>
      {c && (
        <Box flexDirection="column" gap={1} padding={1} {...glass('suggestion')}>
          <Text {...bold}>Cleanup review</Text>
          <Text color={hex('subtle')}>Nothing is deleted until you confirm. Untracked files are never deleted here.</Text>
          {c.branches.map(b => (
            <Text color={hex(b.action === 'delete' ? 'success' : 'warning')}>{`${b.action === 'delete' ? '✓' : '?'} ${b.project}/${b.branch}: ${b.reasons.join('; ')}`}</Text>
          ))}
          {c.stashes.map(s => (
            <Text color={hex(s.action === 'drop' ? 'success' : s.action === 'keep' ? 'subtle' : 'warning')}>{`${s.action === 'drop' ? '✓' : s.action === 'keep' ? '•' : '?'} ${s.project} stash@{${s.stash.index}} ${s.stash.message.slice(0, 40)}: ${s.why}`}</Text>
          ))}
          {c.untracked.map(u => (
            <Text color={hex('subtle')}>{`${u.project} untracked: ${u.files.join(', ')}`}</Text>
          ))}
          {approval('branches')}
          {approval('stashes')}
          <Box flexDirection="row" gap={1}>
            {c.branches.some(b => b.action === 'delete') && (
              <Button key="del-branches" label="Delete branches" onPress={() => void act.arm('branches', act.deleteBranches)} />
            )}
            {c.stashes.some(s => s.action === 'drop') && (
              <Button key="drop-stashes" label="Drop stashes" onPress={() => void act.arm('stashes', act.dropStashes)} />
            )}
            <Button key="close-cleanup" plain label="Cancel" onPress={() => void act.closeCleanup()} />
          </Box>
        </Box>
      )}
    </Box>
  )
}
