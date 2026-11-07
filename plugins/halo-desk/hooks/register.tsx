import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ViewState } from '../types'
import { branchCandidates, triageStash } from '../src/cleanup'
import type { BranchCandidate, StashCandidate } from '../src/cleanup'
import { classify, statusKind } from '../src/classify'
import { addProject, jiraFor, keyOf, parseConfig } from '../src/config'
import { collectRepo, parseRemote, stashAdds } from '../src/git'
import { matchGlob, noteFromText } from '../src/notes'
import { ageMinutes, browserRefreshPrompt, collectGitlab, collectJira, parseSnapshot, wantedKeys } from '../src/remote'
import { renderView } from '../src/view'
import type { Config, Item, LocalRepo, Note, Project, RemoteSnapshot } from '../src/types'

const PANE = 'halo-desk'
type Cleanup = { branches: BranchCandidate[]; stashes: StashCandidate[]; untracked: { project: string; files: string[] }[] }
type View = Omit<ViewState, 'items' | 'repos' | 'cleanup'> & { items: Item[]; repos: LocalRepo[]; cleanup?: Cleanup }

const view = atom({ plugin: 'halo-desk', key: 'view' } as const, {
  items: [],
  repos: [],
  problems: [],
  sources: [],
  busy: false,
  status: 'Press Refresh',
  collapsed: {},
} as ViewState)

// Set by register on every (re)load; the helpers below are top level so `$` can be passed to them.
let OPTS: any = {}

const patch = ($: any, p: Partial<View>) => update($, view, v => ({ ...v, ...p }) as ViewState)
// The open/closed sections are a per-person habit: kept across sessions.
const setCollapsed = ($: any, next: (s: ViewState) => Record<string, boolean>) =>
  update($, view, s => {
    const collapsed = next(s)
    void $.store.set('collapsed', collapsed).catch(() => {})

    return { ...s, collapsed }
  })
const get = async ($: any) => (await read($, view)) as unknown as View

const dataDir = async ($: any) => {
  const configured = String(OPTS?.dataDir ?? '')
  if (configured) return configured

  return `${await $.env.get('HOME')}/.claude/halo-desk`
}
const readText = async ($: any, path: string) => ((await $.fs.exists(path)) ? ((await $.fs.read(path)) as string) : undefined)
const run = ($: any) => (argv: string[], opts?: any) => $.process.run(argv, opts)
const token = async ($: any, name?: string) => {
  if (!name) return undefined
  const res = await $.process.run(['printenv', name])

  return res.exitCode === 0 ? res.stdout.trim() : undefined
}

async function loadConfig($: any) {
  const text = await readText($, `${await dataDir($)}/config.json`)
  if (text === undefined) return { config: { projects: [] } as Config, problems: ['No config yet: run /halo-desk add <path-to-repo>'] }

  return parseConfig(text)
}

async function loadNotes($: any, config: Config): Promise<Note[]> {
  const notes: Note[] = []
  for (const project of config.projects) {
    for (const glob of config.noteGlobs ?? []) {
      const dir = glob.includes('/') ? glob.slice(0, glob.lastIndexOf('/')) : '.'
      const entries = await $.fs.list(`${project.path}/${dir}`).catch(() => [])
      for (const entry of entries) {
        const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`
        if (entry.kind !== 'file' || !matchGlob(glob, rel)) continue
        const text = ((await $.fs.read(`${project.path}/${rel}`)) as string) ?? ''
        const note = noteFromText(entry.name, text, config, project)
        if (note) notes.push(note)
      }
    }
  }

  return notes
}

async function refresh($: any, fetch = true, content = false) {
  await patch($, { busy: true, status: 'Reading git…' })
  const { config, problems } = await loadConfig($)
  const dir = await dataDir($)
  const raw = await readText($, `${dir}/remote-snapshot.json`)
  const remote = raw ? parseSnapshot(raw) : undefined
  if (raw && !remote) problems.push('remote-snapshot.json is not a valid snapshot')
  const repos = await Promise.all(config.projects.map(p => collectRepo(run($), p, { fetch, content })))
  const now = await $.clock.now()
  const items = classify({ config, repos, remote, notes: await loadNotes($, config), now })
  const sources = [
    ...repos.filter(r => r.error).map(r => ({ name: r.project, ok: false, error: r.error })),
    ...Object.entries(remote?.sources ?? {}).map(([name, s]) => ({ name, ok: !!s?.ok, error: s?.error })),
  ]
  await patch($, {
    items,
    repos,
    problems,
    sources,
    snapshotAge: remote ? ageMinutes(remote, now) : undefined,
    busy: false,
    armed: undefined,
    status: remote ? 'Updated' : 'Updated (no remote data yet)',
  })

  return { config, repos, remote }
}

async function remoteTargets($: any, config: Config, repos: LocalRepo[]) {
  return Promise.all(
    config.projects.map(async (p: Project) => {
      const url = (await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: p.path })).stdout
      const parsed = parseRemote(url)
      const gitlab = { ...p.gitlab, ...config.gitlab }
      const base = gitlab.baseUrl ?? parsed?.baseUrl

      return {
        project: p,
        branches: (repos.find(r => r.project === p.name)?.branches ?? []).filter(b => !(p.bases ?? []).includes(b.name)).map(b => b.name),
        gitlab: base ? { baseUrl: base, path: gitlab.path ?? parsed?.path, projectId: gitlab.projectId } : undefined,
        tokenEnv: gitlab.tokenEnv,
      }
    }),
  )
}

async function refreshRemote($: any) {
  const { config, repos } = await refresh($, true)
  const dir = await dataDir($)
  const targets = await remoteTargets($, config, repos)
  const keys = wantedKeys(config, repos, (await loadNotes($, config)).map(n => n.key))
  const jiraTokenEnv = config.jira?.tokenEnv ?? config.projects.find(p => p.jira?.tokenEnv)?.jira?.tokenEnv
  const gitlabTokenEnv = targets.find(t => t.tokenEnv)?.tokenEnv ?? config.gitlab?.tokenEnv
  const file = `${dir}/remote-snapshot.json`

  if (!jiraTokenEnv && !gitlabTokenEnv) {
    await $.prompt.submit({ text: browserRefreshPrompt({ config, keys, branches: targets.map(t => ({ project: t.project.name, branches: t.branches, gitlab: t.gitlab })), file }) })
    await patch($, { armed: undefined, status: 'Asked Claude to refresh (browser or MCP, per config); press Refresh when it is done' })

    return
  }
  await patch($, { busy: true, status: 'Asking Jira and GitLab…' })
  const fetch = (url: string, init?: any) => $.http.fetch(url, init)
  const snapshot: RemoteSnapshot = { fetchedAt: new Date(await $.clock.now()).toISOString(), jira: {}, mrs: [], sources: {} }
  const jira = config.jira ?? config.projects.find(p => p.jira)?.jira
  if (jira) {
    const j = await collectJira(fetch, jira, keys, await token($, jiraTokenEnv))
    snapshot.me = j.me
    snapshot.jira = j.jira
    snapshot.sources!.jira = j.health
  }
  const gitlabHealth = { ok: true } as { ok: boolean; error?: string }
  for (const t of targets) {
    if (!t.gitlab) continue
    const g = await collectGitlab(fetch, t.project, t.gitlab, t.branches, await token($, t.tokenEnv ?? gitlabTokenEnv))
    snapshot.mrs.push(...g.mrs)
    if (!g.health.ok) Object.assign(gitlabHealth, g.health)
  }
  snapshot.sources!.gitlab = gitlabHealth
  await $.process.run(['mkdir', '-p', dir])
  await $.fs.write(file, JSON.stringify(snapshot, null, 2))
  await refresh($, false)
}

// ---- cleanup --------------------------------------------------------------

async function reviewCleanup($: any) {
  await refresh($, false, true)
  const v = await get($)
  const { config } = await loadConfig($)
  await patch($, { busy: true, status: 'Checking merge evidence…' })
  const max = config.maxSnapshotAgeMinutes ?? 60
  const branches = branchCandidates(v.items, v.snapshotAge, max)
  const stashes: StashCandidate[] = []
  for (const repo of v.repos) {
    const project = config.projects.find(p => p.name === repo.project) as Project
    const base = (project.bases?.length ? project.bases : [repo.base])[0]
    for (const stash of repo.stashes) {
      const ref = `stash@{${stash.index}}`
      const diff = (await $.process.run(['git', 'diff', `${ref}^`, ref], { cwd: project.path, timeoutMs: 60_000 })).stdout
      const files = []
      for (const [file, adds] of stashAdds(diff)) {
        const shown = await $.process.run(['git', 'show', `origin/${base}:${file}`], { cwd: project.path })
        files.push({ file, adds, baseLines: shown.exitCode === 0 ? new Set<string>(shown.stdout.split('\n').map((x: string) => x.trim())) : undefined })
      }
      const key = stash.branch ? keyOf(stash.branch, jiraFor(config, project)) : undefined
      const card = key ? v.items.find(i => i.key === key)?.jira : undefined
      stashes.push({ project: repo.project, stash, ...triageStash(files, card ? statusKind(card, jiraFor(config, project)) : undefined) })
    }
  }
  const untracked = v.repos.filter(r => r.untracked.length).map(r => ({ project: r.project, files: r.untracked }))
  await patch($, { busy: false, status: 'Cleanup candidates ready: nothing is deleted until you confirm', cleanup: { branches, stashes, untracked } })
}

async function deleteBranches($: any) {
  const v = await get($)
  const { config } = await loadConfig($)
  // Re-evaluate from fresh git state: the list on screen may be stale.
  const { repos } = await refresh($, false, true)
  const raw = await readText($, `${await dataDir($)}/remote-snapshot.json`)
  const remote = raw ? parseSnapshot(raw) : undefined
  const items = classify({ config, repos, remote, notes: [], now: await $.clock.now() })
  const fresh = branchCandidates(items, remote ? ageMinutes(remote, await $.clock.now()) : undefined, config.maxSnapshotAgeMinutes ?? 60)
  const wanted = new Set((v.cleanup?.branches ?? []).filter(b => b.action === 'delete').map(b => `${b.project}\0${b.branch}`))
  let gone = 0
  for (const c of fresh.filter(c => c.action === 'delete' && wanted.has(`${c.project}\0${c.branch}`))) {
    const project = config.projects.find(p => p.name === c.project) as Project
    if ((await $.process.run(['git', 'branch', '-D', c.branch], { cwd: project.path })).exitCode === 0) gone++
  }
  await refresh($, false)
  await patch($, { cleanup: undefined, status: `Deleted ${gone} local branch(es); remote copies are untouched` })
}

async function dropStashes($: any) {
  const v = await get($)
  const { config } = await loadConfig($)
  let dropped = 0
  // Highest index first: indices shift after each drop.
  for (const c of (v.cleanup?.stashes ?? []).filter(s => s.action === 'drop').sort((a, b) => b.stash.index - a.stash.index)) {
    const project = config.projects.find(p => p.name === c.project) as Project
    const now = (await $.process.run(['git', 'stash', 'list', '--format=%gs', '--skip', String(c.stash.index), '-1'], { cwd: project.path })).stdout.trim()
    if (now !== c.stash.message) continue
    if ((await $.process.run(['git', 'stash', 'drop', '-q', `stash@{${c.stash.index}}`], { cwd: project.path })).exitCode === 0) dropped++
  }
  await refresh($, false)
  await patch($, { cleanup: undefined, status: `Dropped ${dropped} stash(es)` })
}

// Every button that fetches, writes or deletes asks first: the first press raises the approval card, Approve (or a second press) runs it.
const arm = async ($: any, what: string, act: () => Promise<void>) => {
  if ((await get($)).armed === what) return act()
  await patch($, { armed: what })
}

async function drawBody($: any, e: any) {
  const v = await get($)
  const { config } = await loadConfig($)
  const maxAge = config.maxSnapshotAgeMinutes ?? 60

  const { rateLimits } = await $.session.usage().catch(() => ({ rateLimits: [] as any[] }))
  const limit = rateLimits.find(r => r.kind === 'seven_day') ?? rateLimits[0]
  const now = await $.clock.now()
  const ms = limit?.resetsAt ? Date.parse(limit.resetsAt) - now : NaN
  const left = ms > 0 ? (ms >= 172800000 ? `${Math.floor(ms / 86400000)}d left` : ms >= 3600000 ? `${Math.floor(ms / 3600000)}h left` : `${Math.max(1, Math.floor(ms / 60000))}m left`) : 'resets soon'

  return renderView({
    E: $.ui.resolve(e),
    rich: e.surface !== 'terminal',
    v,
    usage: limit ? { pct: limit.percentUsed, left } : undefined,
    maxAge,
    cleanable: branchCandidates(v.items, v.snapshotAge, maxAge).length,
    act: {
      toggle: name => setCollapsed($, s => ({ ...s.collapsed, [name]: !s.collapsed[name] })),
      // Show only this section; if it already is the only one open, show them all again.
      focus: name =>
        setCollapsed($, s => {
          const all = ['action', 'waiting', 'tooling', 'local']
          if (name === 'all') return Object.fromEntries(all.map(n => [n, false]))
          const alone = all.every(n => (n === name ? !s.collapsed[n] : !!s.collapsed[n]))

          return Object.fromEntries(all.map(n => [n, alone ? false : n !== name]))
        }),
      refresh: () => refresh($),
      remote: () => refreshRemote($),
      review: () => reviewCleanup($),
      copy: async text => {
        await $.ui.copy({ text, surface: e.surface })
        await patch($, { status: `Copied ${text}` })
      },
      arm: (what, go) => arm($, what, go),
      cancel: () => patch($, { armed: undefined }),
      closeCleanup: () => patch($, { cleanup: undefined, armed: undefined, status: 'Updated' }),
      deleteBranches: () => deleteBranches($),
      dropStashes: () => dropStashes($),
    },
  })
}

export const register: Register = (on, options) => {
  OPTS = options
  // ---- commands -------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'halo-desk', description: 'Open the Halo Desk pane (read-only until you confirm a button). Subcommands: add <path> [--jira URL] [--base BRANCH], config' })
    const saved = await $.store.get('collapsed').catch(() => undefined)
    if (saved && typeof saved === 'object') await patch($, { collapsed: saved as Record<string, boolean> })
    if (OPTS?.autoOpen === 'yes') {
      await $.ui.open({ id: PANE, title: 'Halo Desk' })
      void refresh($, false)
    }

    return next(e)
  })

  on('command.run', { command: 'halo-desk' }, async ($, e) => {
    const [sub, ...rest] = e.args.trim().split(/\s+/)
    const dir = await dataDir($)
    if (sub === 'config') {
      const { problems } = await loadConfig($)

      return { text: `Config: ${dir}/config.json\nSnapshot: ${dir}/remote-snapshot.json\n${problems.join('\n') || 'Config is valid.'}` }
    }
    if (sub === 'add') {
      const flag = (name: string) => rest[rest.indexOf(name) + 1]
      const home = (await $.env.get('HOME')) as string
      let path = rest[0]
      if (!path || path.startsWith('--')) return { text: 'Usage: /halo-desk add <path-to-repo> [--name NAME] [--base BRANCH] [--jira URL]' }
      path = path.startsWith('~') ? home + path.slice(1) : path.startsWith('/') ? path : `${await $.session.cwd()}/${path}`
      const root = (await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: path })).stdout.trim()
      if (!root) return { text: `${path} is not inside a git repository.` }
      const remote = parseRemote((await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: root })).stdout)
      const { config } = await loadConfig($)
      const jira = flag('--jira') ? { baseUrl: flag('--jira') } : undefined
      const project: Project = {
        name: flag('--name') ?? root.split('/').pop()!,
        path: root,
        ...(flag('--base') ? { bases: [flag('--base')] } : {}),
        ...(remote ? { gitlab: { baseUrl: remote.baseUrl, path: remote.path } } : {}),
        ...(jira && config.jira ? { jira } : {}),
      }
      const next = addProject(config, project)
      if (jira && !config.jira) next.jira = jira
      await $.process.run(['mkdir', '-p', dir])
      await $.fs.write(`${dir}/config.json`, JSON.stringify(next, null, 2))

      return { text: `Added ${project.name} (${root}). Base branch: ${project.bases?.[0] ?? 'detected from origin/HEAD'}. Jira: ${jiraFor(next, project)?.baseUrl ?? 'not set (pass --jira URL)'}.` }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Halo Desk' })
    void refresh($, false)

    return { text: opened.isPlaced ? 'Halo Desk pane opened.' : `Halo Desk pane was not placed: ${(opened as any).reason ?? 'no reason given'}` }
  })

  // ---- drawing --------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawBody($, e))
}
