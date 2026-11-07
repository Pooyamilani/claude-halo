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
/** A thin progress bar: a quiet track and a rounded fill. */
const bar = (pct: number, color: string, w = 160) => {
  const fill = Math.max(0, Math.min(100, pct)) * (w / 100)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 8"><rect width="${w}" height="8" rx="4" fill="#ffffff" fill-opacity=".14"/><rect width="${Math.max(fill, 8)}" height="8" rx="4" fill="${color}"/></svg>`
}
const TIPS = {
  refresh: 'Re-reads local git (fetches origin, branches, stashes, changes) and reclassifies with the last saved Jira/GitLab data.',
  remote: 'Pulls fresh Jira and GitLab data (tokens, or Claude through your signed-in browser or an MCP server), saves it, then refreshes.',
  cleanup: 'Lists branches proven merged and stashes already in the base, with evidence. Deletes only after a second press.',
}

export type Usage = { pct: number; left: string }

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
export function renderView(args: { E: any; rich: boolean; v: any; maxAge: number; cleanable: number; act: Actions; usage?: Usage }) {
  const { E, rich, v, maxAge, cleanable, act, usage } = args
  const { Box, Text, Button, Link, Svg } = E
  const bold: any = { bold: true }
  const tint = (c: string, a: number): any => (rich ? { backgroundColor: `${hex(c)}${alpha(a)}` } : {})
  const edge = (c: string, a: number): any => (rich ? { borderColor: `${hex(c)}${alpha(a)}` } : { borderColor: hex(c) })
  const g = group(v.items)
  const glass = (c = 'inactive'): any => ({ borderStyle: 'round', ...edge(c, c === 'inactive' ? 0.3 : 0.4), ...(rich ? { backgroundColor: '#ffffff0a' } : {}) })

  const glyph = (name: keyof typeof ICONS, c: string, size: number, alt: string, fallback = '●') =>
    rich && Svg ? <Svg source={ICONS[name](hex(c))} alt={alt} width={size} height={size} /> : <Text color={hex(c)}>{fallback}</Text>

  // A pill is coloured text with a dot: a tinted background would draw a sharp rectangle, a border a tall block.
  const pill = (label: string, color: string) =>
    rich ? (
      <Text key={`pill-${label}`} color={hex(color)}>{label.startsWith('●') || label.startsWith('○') || label.startsWith('◷') ? label : `● ${label}`}</Text>
    ) : (
      <Text color={hex(color)}>{`[${label}]`}</Text>
    )

  // Small actions (Hide, Copy branch) are plain buttons, for the same reason.
  const ghost = (key: string, label: string, onPress: () => void) => <Button key={key} plain label={label} onPress={onPress} />
  const failed = v.sources.filter(s => !s.ok)
  const age = v.snapshotAge
  const sync = v.busy
    ? pill('● Working', 'suggestion')
    : failed.length
      ? pill('● Source error', 'error')
      : age === undefined
        ? pill('○ Local only', 'inactive')
        : age > (maxAge)
          ? pill(`◷ Stale: ${age >= 2880 ? Math.floor(age / 1440) + 'd' : age >= 120 ? Math.floor(age / 60) + 'h' : age + 'm'}`, 'warning')
          : pill(`● Synced: ${age}m`, 'success')

  // The filters are one native segmented row of Buttons: the shown section is primary, the rest neutral. "All" resets.
  const SECTIONS = ['action', 'waiting', 'tooling', 'local']
  const collapsedOf = (name: string) => v.collapsed[name] ?? name !== 'action'
  // The default view is Next action open, everything else closed: that is "All"; a filter is any other single open section.
  const isDefault = SECTIONS.every(n => collapsedOf(n) === (n !== 'action'))
  const alone = (name: string) => !isDefault && SECTIONS.every(n => (n === name ? !collapsedOf(n) : collapsedOf(n)))
  // A Button holds one plain string here, so the category cue is a ring character in the label.
  // One rounded track holds the segments: the shown one is primary, the rest plain.
  const seg = (name: string, label: string, count: number, onPress: () => void, lit: boolean) => (
    <Button key={`seg-${name}`} variant={lit ? 'primary' : undefined} label={`${name === 'all' ? '' : count ? '● ' : '○ '}${label} ${count}`} onPress={onPress} />
  )
  const filters = (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
      {seg('all', 'All', g.action.length + g.waiting.length, () => void act.focus('all'), isDefault)}
      {seg('action', 'Needs action', g.action.length, () => void act.focus('action'), alone('action'))}
      {seg('waiting', 'Waiting', g.waiting.length, () => void act.focus('waiting'), alone('waiting'))}
      {seg('cleanup', 'Cleanup', cleanable, () => void act.review(), false)}
    </Box>
  )

  const accentOf = (i: Item) =>
    i.badges.includes('unpushed') ? 'error' : i.badges.includes('review-stale') || i.badges.includes('jira-mismatch') ? 'warning' : i.bucket === 'action' ? 'suggestion' : i.bucket === 'tooling' ? 'merged' : 'inactive'

  // Notes and Jira text arrive with Markdown and can run long: show plain text, one clamp.
  const tidy = (t: string, max = 90) => {
    const plain = t.replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim()

    return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
  }

  const card = (i: Item) => {
    const d = describeItem(i)
    const accent = accentOf(i)
    const badgeLabels = d.badges.map(b => b.toLowerCase())
    // "On Hold" as a badge, a status and a reason says one thing three times: keep the first.
    const status = i.jira?.status && !badgeLabels.includes(i.jira.status.toLowerCase()) ? i.jira.status : undefined
    const reason = i.waitingOn && i.waitingOn.toLowerCase() !== i.jira?.status?.toLowerCase() ? tidy(i.waitingOn) : undefined
    const mr = i.mr ? `MR !${i.mr.iid} ${i.mr.state}${i.mr.ageDays !== undefined ? ` · ${i.mr.ageDays}d` : ''}` : undefined

    return (
      <Box key={`card-${i.project}-${i.branch ?? i.key}`} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            {glyph('dot', accent, 12, accent)}
            <Text {...bold}>{i.key ?? i.branch}</Text>
            {status && pill(status, accent)}
            {i.badges.map(b => pill(d.badges[i.badges.indexOf(b)], KIND_COLOR[b] ?? 'inactive'))}
          </Box>
          {i.branch && ghost(`copy-${i.project}-${i.branch}`, '⧉ Copy', () => void act.copy(i.branch))}
        </Box>
        <Box flexDirection="column" paddingLeft={3}>
          <Text wrap="truncate-end" color={hex('subtle')}>{`${i.project}${i.branch ? ` · ${i.branch}` : ''}`}</Text>
          <Text>{reason ? `${i.nextStep}: ${reason}` : i.nextStep}</Text>
          <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
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
          </Box>
        </Box>
      </Box>
    )
  }

  // Every section shares one header: rule, icon, title, count, Show/Hide; collapsed, a one-line summary instead of the entries.
  const head = (name: string, label: string, color: string, mark: keyof typeof ICONS, count: string | undefined, right: any) => (
    <Box key={`head-${name}`} flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box flexDirection="row" gap={1} alignItems="center">
        {glyph(mark, color, 16, label)}
        <Text {...bold}>{label}</Text>
        {count && <Text color={hex('subtle')}>{count}</Text>}
      </Box>
      {right}
    </Box>
  )
  const frame = (name: string, header: any, body: any, summary: string, color = 'inactive') => (
    <Box key={`section-${name}`} flexDirection="column" gap={1} paddingX={2} {...glass(color)}>
      {header}
      {collapsedOf(name) ? <Text color={hex('subtle')}>{summary}</Text> : body}
    </Box>
  )
  const section = (name: string, label: string, items: Item[], color: string, mark: keyof typeof ICONS) =>
    items.length === 0
      ? null
      : frame(
          name,
          head(name, label, color, mark, String(items.length), ghost(`t-${name}`, collapsedOf(name) ? 'Show' : 'Hide', () => void act.toggle(name))),
          <Box flexDirection="column" gap={1}>{items.map(card)}</Box>,
          `${items[0].key ?? items[0].branch}${items.length > 1 ? ` and ${items.length - 1} more` : ''}`,
          name === 'action' ? 'success' : 'inactive',
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
          {rich && Svg ? <Svg source={MARK} alt="halo" width={32} height={32} /> : <Text color={hex('success')} {...bold}>◉</Text>}
          <Box flexDirection="column">
            <Text {...bold}>
              halo <Text color={hex('subtle')}>desk</Text>
            </Text>
            <Text color={hex('subtle')}>{`${v.repos.length} repos · Jira · GitLab`}</Text>
          </Box>
        </Box>
        {sync}
      </Box>
      {filters}
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {tipped('refresh', v.busy ? '↻ Working…' : '↻ Refresh', () => void (v.busy || act.arm('refresh', act.refresh)), 'primary')}
          {tipped('remote', v.busy ? '☁ Working…' : '☁ Remote', () => void (v.busy || act.arm('remote', act.remote)))}
        </Box>
        {tip('refresh')}
        {tip('remote')}
        {tip('cleanup')}
      </Box>
      {approval('refresh')}
      {approval('remote')}
      {!/^Updated/.test(v.status) && <Text color={hex('subtle')}>{v.status}</Text>}
      {v.problems.map(p => (
        <Text color={hex('warning')}>{p}</Text>
      ))}
      {failed.map(s => (
        <Text color={hex('error')}>{`${s.name}: ${s.error ?? 'unavailable'}`}</Text>
      ))}
      {g.action.length + g.waiting.length === 0 && !v.busy && v.snapshotAge !== undefined && <Text color={hex('success')}>✓ Nothing needs you right now</Text>}
      {section('action', 'Next action', g.action, 'success', 'check')}
      {section('waiting', 'Waiting', g.waiting, 'suggestion', 'hourglass')}
      {section('tooling', 'Tooling', g.tooling, 'merged', 'wrench')}
      {!c && cleanable > 0 && frame('cleanup', head('cleanup', 'Cleanup', 'suggestion', 'sparkles', String(cleanable), ghost('t-cleanup', 'Review', () => void act.review())), null, `${cleanable} branch(es) proven merged or safe to review`)}
      {frame(
        'local',
        head('local', 'Local state', 'inactive', 'folder', undefined, ghost('t-local', collapsedOf('local') ? 'Show' : 'Hide', () => void act.toggle('local'))),
        <Box flexDirection="column">
          {v.repos.map(r => (
            <Text color={hex('subtle')}>{`${r.project}: ${r.branches.length} branches · ${r.stashes.length} stashes · ${r.dirty.length} changed · ${r.untracked.length} untracked`}</Text>
          ))}
        </Box>,
        `${v.repos.length} repos · ${v.repos.reduce((n, r) => n + r.branches.length, 0)} branches · ${v.repos.reduce((n, r) => n + r.dirty.length, 0)} changed`,
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
      {usage && (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap" paddingX={2} {...glass()}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {glyph('bars', 'suggestion', 16, 'Usage', '▮')}
            <Text {...bold}>Usage</Text>
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            {rich && Svg ? <Svg source={bar(usage.pct, hex('suggestion'))} alt={`${usage.pct}% used`} width={160} height={8} /> : null}
            <Text color={hex('subtle')}>{`${Math.round(usage.pct)}% · ${usage.left}`}</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
