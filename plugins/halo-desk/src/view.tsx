import { describeItem, group, STEP_GROUPS, stepGroup } from './summary'
import type { Item } from './types'

const KIND_COLOR: Record<string, string> = { unpushed: 'error', 'review-stale': 'warning', 'jira-mismatch': 'warning', 'on-hold': 'inactive', merged: 'merged', unverified: 'inactive' }
// Halo's palette: teal is calm and the primary accent, violet the secondary, amber and red the warm and hot states.
const HALO: Record<string, string> = { error: '#f0645c', warning: '#f2b84b', success: '#4fd1b5', suggestion: '#8f9bff', merged: '#e07a52', inactive: '#8b93a1', subtle: '#8b93a1' }
const hex = (c: string) => HALO[c] ?? c
const alpha = (a: number) => Math.round(a * 255).toString(16).padStart(2, '0')
/** Small line icons (24x24 grid), tinted by the caller. Decorative: the label beside each says what it is. */
const icon = (paths: string, color: string, fill = 'none') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
const ICONS = {
  check: (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${c}"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#0f1218" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hourglass: (c: string) => icon('<path d="M5 22h14M5 2h14"/><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4A2 2 0 0 0 7 17.8V22"/><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2"/>', c),
  wrench: (c: string) => icon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>', c),
  sparkles: (c: string) => icon('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>', c),
  folder: (c: string) => icon('<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', c),
  bars: (c: string) => icon('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', c),
  dot: (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="${c}"/></svg>`,
  hollow: (c: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="${c}" stroke-width="3"/></svg>`,
}
/** The Halo mark as data: three rings (action, waiting, cleanup), each filled by how much is waiting in it. */
const rings = (counts: [number, number, number], lit = -1) => {
  const arc = (i: number, r: number, n: number, c: string) => {
    const w = 3.2
    const len = 2 * Math.PI * r
    const frac = n === 0 ? 0 : Math.max(0.1, Math.min(0.94, n / 6))

    const ring = `<circle cx="23" cy="23" r="${r}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="${w}"/>${frac ? `<circle cx="23" cy="23" r="${r}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(len * frac).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 23 23)"/>` : ''}`
    // The selected ring glows (a blurred copy that breathes) and shivers. A ring is never quite closed, so the turn shows.
    const glow = frac
      ? `<circle cx="23" cy="23" r="${r}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(len * frac).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 23 23)" filter="url(#glow)" opacity=".2"><animate attributeName="opacity" values=".2;.95;.2" dur="1.8s" repeatCount="indefinite"/></circle>`
      : ''

    return i === lit ? `<g>${glow}${ring}<animateTransform attributeName="transform" type="rotate" values="0 23 23;7 23 23;-7 23 23;4 23 23;0 23 23" dur="1.4s" repeatCount="indefinite"/></g>` : ring
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 46"><defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8"/></filter></defs>${arc(0, 19, counts[0], HALO.success)}${arc(1, 13, counts[1], HALO.suggestion)}${arc(2, 7, counts[2], HALO.merged)}<circle cx="23" cy="23" r="2.2" fill="${counts[0] ? HALO.success : '#ffffff'}" fill-opacity="${counts[0] ? 1 : 0.35}"/></svg>`
}

export type Actions = {
  toggle: (name: string) => unknown
  focus: (name: string) => unknown
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

  const glyph = (name: keyof typeof ICONS, c: string, size: number, alt: string, fallback = '●') =>
    rich && Svg ? <Svg source={ICONS[name](hex(c))} alt={alt} width={size} height={size} /> : <Text color={hex(c)}>{fallback}</Text>

  // A pill is coloured text with a dot: a tinted background would draw a sharp rectangle, a border a tall block.
  const pill = (label: string, color: string, dot = true) =>
    rich ? (
      <Text key={`pill-${label}`} color={hex(color)}>{!dot || /^[●○◷]/.test(label) ? label : `● ${label}`}</Text>
    ) : (
      <Text color={hex(color)}>{`[${label}]`}</Text>
    )

  const ghost = (key: string, label: string, onPress: () => void) => <Button key={key} plain label={label} onPress={onPress} />
  const failed = v.sources.filter(s => !s.ok)
  const age = v.snapshotAge
  const ago = (m: number) => (m >= 2880 ? `${Math.floor(m / 1440)}d` : m >= 120 ? `${Math.floor(m / 60)}h` : `${m}m`)
  const stale = age !== undefined && age > maxAge
  // One status line under the title: what the data is and how old, coloured by trust.
  const [syncText, syncColor] = v.busy
    ? ['● Working…', 'suggestion']
    : failed.length
      ? ['● A source failed', 'error']
      : age === undefined
        ? ['○ Local only, no Jira or GitLab data', 'inactive']
        : stale
          ? [`◷ Stale · updated ${ago(age)} ago`, 'warning']
          : [`● Synced · updated ${ago(age)} ago`, 'success']

  // Two tabs. Needs action holds the cards' tasks and the branches without a card: both need the user.
  const tab: 'action' | 'waiting' = v.tab === 'waiting' ? 'waiting' : 'action'
  const todo = [...g.action, ...g.tooling]
  const seg = (name: 'action' | 'waiting', label: string, count: number) => (
    <Button key={`seg-${name}`} variant={tab === name ? 'primary' : undefined} label={`${count ? '● ' : '○ '}${label} ${count}`} onPress={() => void act.focus(name)} />
  )

  const accentOf = (i: Item) =>
    i.badges.includes('unpushed') ? 'error' : i.badges.includes('review-stale') || i.badges.includes('jira-mismatch') ? 'warning' : i.bucket === 'action' ? 'suggestion' : i.bucket === 'tooling' ? 'merged' : 'inactive'

  // Notes and Jira text arrive with Markdown and can run long: show plain text, one clamp.
  const tidy = (t: string, max = 90) => {
    const plain = t.replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim()

    return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
  }

  // A row is two lines. Line one: the key (a link to the card), the Jira title and Copy. Line two: the state and Open MR.
  // The key and the title are separate runs so a right-to-left title cannot reorder the key.
  const row = (i: Item) => {
    const d = describeItem(i)
    const accent = accentOf(i)
    const badgeLabels = d.badges.map(b => b.toLowerCase())
    // "On Hold" as a badge, a status and a reason says one thing three times: keep the first.
    const status = i.jira?.status && !badgeLabels.includes(i.jira.status.toLowerCase()) ? i.jira.status : undefined
    const reason = i.waitingOn && i.waitingOn.toLowerCase() !== i.jira?.status?.toLowerCase() ? tidy(i.waitingOn, 60) : undefined
    const mr = i.mr ? `MR !${i.mr.iid}${i.mr.ageDays !== undefined ? ` · ${i.mr.ageDays}d` : ''}` : undefined
    const title = i.jira?.summary ? tidy(i.jira.summary, 80) : i.key && i.branch ? i.branch : ''
    const state = [reason ? `${i.nextStep}: ${reason}` : i.nextStep, mr].filter(Boolean).join(' · ')
    const label = i.key ?? i.branch ?? '?'

    return (
      <Box key={`row-${i.project}-${i.branch ?? i.key}`} flexDirection="column" marginBottom={2}>
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
          {glyph('dot', accent, 12, accent)}
          <Text {...bold}>{i.jiraUrl ? <Link href={i.jiraUrl}>{label}</Link> : label}</Text>
          {title && <Text wrap="truncate-end">{title}</Text>}
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap" paddingLeft={3} marginTop={1}>
          {status && pill(status, accent, false)}
          {i.badges.map(b => pill(d.badges[i.badges.indexOf(b)], KIND_COLOR[b] ?? 'inactive', false))}
          <Text color={hex('subtle')}>{state}</Text>
        </Box>
        {(i.branch || i.mr?.webUrl) && (
          <Box flexDirection="row" gap={3} alignItems="center" flexWrap="wrap" paddingLeft={3} marginTop={1}>
            {i.branch && ghost(`copy-${i.project}-${i.branch}`, '⧉ Copy branch', () => void act.copy(i.branch))}
            {i.mr?.webUrl && (
              <Text>
                <Link href={i.mr.webUrl}>Open MR ↗</Link>
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  }

  // The list is capped so a long queue stays a glance; "Show more" opens the rest.
  const CAP = 8
  const showAll = v.collapsed.more === false
  const label = (key: string, text: string, first = false) => (
    <Box key={`g-${key}`} marginTop={first ? 0 : 1} marginBottom={2}>
      <Text {...bold} color={hex('subtle')}>
        {text}
      </Text>
    </Box>
  )
  const queue = (): any[] => {
    const out: any[] = []
    let shown = 0
    const take = (items: Item[]) => items.filter(() => showAll || shown++ < CAP)
    if (tab === 'waiting') {
      out.push(label('waiting', `WAITING ON SOMEONE · ${g.waiting.length}`, true))
      take(g.waiting).forEach(i => out.push(row(i)))

      return out
    }
    for (const name of STEP_GROUPS) {
      const items = take(todo.filter(i => stepGroup(i) === name))
      if (items.length === 0) continue
      out.push(label(name, `${name.toUpperCase()} · ${todo.filter(i => stepGroup(i) === name).length}`, out.length === 0))
      items.forEach(i => out.push(row(i)))
    }

    return out
  }
  const total = tab === 'waiting' ? g.waiting.length : todo.length
  const empty = total === 0

  const c = v.cleanup

  // The approval card: says what will run, then Approve or Cancel. Pressing the same action button again also approves.
  const run: Record<string, () => Promise<void>> = { refresh: async () => void act.refresh(), remote: async () => void act.remote(), sync: async () => void act.remote(), branches: act.deleteBranches, stashes: act.dropStashes }
  const doomed = (c?.branches ?? []).filter(b => b.action === 'delete')
  const droppable = (c?.stashes ?? []).filter(s => s.action === 'drop')
  const WILL: Record<string, [string, string]> = {
    sync: ['Sync Git, Jira and GitLab?', `Fetches ${v.repos.length} repo(s), then reads Jira and GitLab (or asks Claude to use your signed-in browser or an MCP server) and saves remote-snapshot.json. Read-only; nothing is deleted.`],
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
          {what === 'sync' && <Button key="git-only" label="Git only" onPress={() => void act.refresh()} />}
          <Button key="cancel" plain label="Cancel" onPress={() => void act.cancel()} />
        </Box>
      </Box>
    ) : null

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} paddingX={2} paddingY={1} {...glass(v.busy || failed.length || !stale ? 'inactive' : 'warning')}>
        <Box flexDirection="row" gap={2} alignItems="center">
          {rich && Svg ? <Svg source={rings([todo.length, g.waiting.length, cleanable], c ? 2 : tab === 'waiting' ? 1 : 0)} alt={`${todo.length} need action, ${g.waiting.length} waiting, ${cleanable} to clean up`} width={52} height={52} /> : <Text color={hex('success')} {...bold}>◉</Text>}
          <Box flexDirection="column">
            <Text {...bold}>
              halo <Text color={hex('subtle')}>desk</Text>
            </Text>
            <Text color={hex(syncColor)}>{syncText}</Text>
            <Text color={hex('subtle')}>{`${v.repos.length} repos · Jira · GitLab`}</Text>
          </Box>
        </Box>
        <Button key="sync" label={v.busy ? '↻ Working…' : '↻ Sync'} variant="primary" onPress={() => void (v.busy || act.arm('sync', async () => void act.remote()))} />
      </Box>
      {approval('sync')}
      {!/^Updated/.test(v.status) && <Text color={hex('subtle')}>{v.status}</Text>}
      {v.problems.map(p => (
        <Text color={hex('warning')}>{p}</Text>
      ))}
      {failed.map(s => (
        <Text color={hex('error')}>{`${s.name}: ${s.error ?? 'unavailable'}`}</Text>
      ))}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {seg('action', 'Needs action', todo.length)}
        {seg('waiting', 'Waiting', g.waiting.length)}
      </Box>
      <Box flexDirection="column" paddingX={2} paddingY={1} {...glass(tab === 'action' && !empty ? 'success' : 'inactive')}>
        {empty ? (
          <Text color={hex(tab === 'action' ? 'success' : 'subtle')}>{v.snapshotAge === undefined && !v.items.length ? 'Nothing yet: press Sync.' : tab === 'action' ? '✓ Nothing needs you right now' : 'Nothing is waiting'}</Text>
        ) : (
          queue()
        )}
        {!empty && total > CAP && ghost('more', showAll ? 'Show fewer' : `Show ${total - CAP} more`, () => void act.toggle('more'))}
      </Box>
      {!c && cleanable > 0 && (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} paddingX={2} paddingY={1} {...glass('suggestion')}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {glyph('sparkles', 'suggestion', 16, 'Cleanup')}
            <Text>{`${cleanable} branch(es) ready to clean up`}</Text>
          </Box>
          <Button key="cleanup" label="Review" onPress={() => void act.review()} />
        </Box>
      )}
      {c && (
        <Box flexDirection="column" gap={1} padding={1} {...glass()}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {glyph('sparkles', 'suggestion', 20, 'Cleanup review')}
            <Text {...bold}>Cleanup review</Text>
          </Box>
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
      {(() => {
        const open = v.collapsed.local === false
        const sum = (f: (r: any) => number) => v.repos.reduce((n: number, r: any) => n + f(r), 0)
        // A count is dim at zero and coloured when it is something to look at.
        const stat = (n: number, word: string, color: string) => (
          <Text key={word} color={hex(n ? color : 'subtle')}>{`${n} ${word}`}</Text>
        )

        return (
          <Box flexDirection="column" paddingX={2} paddingY={1} {...glass()}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Box flexDirection="row" gap={1} alignItems="center">
                {glyph('folder', 'inactive', 16, 'Local details')}
                <Text {...bold}>Local details</Text>
              </Box>
              {ghost('t-local', open ? 'Hide' : 'Show', () => void act.toggle('local'))}
            </Box>
            {open ? (
              v.repos.map((r: any) => (
                <Box key={`repo-${r.project}`} flexDirection="column" marginTop={1}>
                  <Text {...bold}>{r.project}</Text>
                  <Box flexDirection="row" gap={3} flexWrap="wrap">
                    {stat(r.branches.length, 'branches', 'suggestion')}
                    {stat(r.stashes.length, 'stashes', 'suggestion')}
                    {stat(r.dirty.length, 'changed', 'warning')}
                    {stat(r.untracked.length, 'untracked', 'warning')}
                  </Box>
                </Box>
              ))
            ) : (
              <Text color={hex('subtle')}>{`${v.repos.length} repos · ${sum(r => r.branches.length)} branches · ${sum(r => r.dirty.length)} changed`}</Text>
            )}
          </Box>
        )
      })()}
    </Box>
  )
}
