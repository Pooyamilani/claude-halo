import type { LocalBranch, LocalRepo, Project, Stash } from './types'

export type Run = (
  argv: string[],
  opts?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

const lines = (text: string) => text.split('\n').filter(Boolean)

/** Read-only snapshot of one repo. Fetches first so "merged" is judged against fresh remotes. */
export async function collectRepo(run: Run, project: Project, opts: { fetch: boolean; content?: boolean }): Promise<LocalRepo> {
  const cwd = project.path
  const git = (...args: string[]) => run(['git', ...args], { cwd })
  const out = async (...args: string[]) => (await git(...args)).stdout.trim()
  const empty: LocalRepo = { project: project.name, base: project.bases?.[0] ?? '', dirty: [], untracked: [], branches: [], stashes: [] }

  const inside = await git('rev-parse', '--is-inside-work-tree').catch(() => undefined)
  if (inside?.exitCode !== 0) return { ...empty, error: `not a git repository: ${cwd}` }

  let error: string | undefined
  if (opts.fetch) {
    const fetched = await run(['git', 'fetch', '-q', '--prune', 'origin'], { cwd, timeoutMs: 60_000 }).catch(e => ({
      exitCode: 1,
      stdout: '',
      stderr: String(e),
    }))
    if (fetched.exitCode !== 0) error = `fetch failed, merge state may be stale: ${fetched.stderr.trim().split('\n')[0]}`
  }

  const remoteNames = new Set(lines(await out('for-each-ref', 'refs/remotes/origin', '--format=%(refname:short)')).map(r => r.replace(/^origin\//, '')))
  let bases = project.bases?.length ? project.bases : []
  if (bases.length === 0) {
    const head = (await out('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).replace(/^origin\//, '')
    bases = [head || ['main', 'master', 'develop'].find(b => remoteNames.has(b)) || 'main']
  }
  const baseRefs = bases.map(b => (remoteNames.has(b) ? `origin/${b}` : b))

  const gitDir = await out('rev-parse', '--absolute-git-dir')
  const current = await out('branch', '--show-current')
  const status = lines((await git('status', '-s')).stdout)
  const worktrees = new Set(
    (await out('worktree', 'list', '--porcelain'))
      .split('\n\n')
      .slice(1)
      .map(block => /^branch refs\/heads\/(.+)$/m.exec(block)?.[1])
      .filter((b): b is string => !!b),
  )

  const heads = lines(await out('for-each-ref', 'refs/heads', '--format=%(refname:short)\t%(objectname)\t%(committerdate:iso-strict)'))
  const branches: LocalBranch[] = await Promise.all(
    heads.map(async line => {
      const [name, tip, date] = line.split('\t')
      const pushed = remoteNames.has(name)
      const branch: LocalBranch = { name, tip, date, current: name === current, worktree: worktrees.has(name), pushed, unpushed: 0, ahead: 0 }
      if (bases.includes(name)) return branch
      if (pushed) branch.unpushed = Number(await out('rev-list', '--count', `origin/${name}..${name}`)) || 0
      let ahead: number | undefined
      for (const ref of baseRefs) {
        const count = Number(await out('rev-list', '--count', `${ref}..${name}`))
        if (!Number.isNaN(count)) ahead = Math.min(ahead ?? count, count)
        if ((await git('merge-base', '--is-ancestor', name, ref)).exitCode === 0) branch.isAncestor = true
        const plus = lines(await out('cherry', ref, name)).filter(l => l.startsWith('+')).length
        branch.cherryPlus = Math.min(branch.cherryPlus ?? plus, plus)
      }
      branch.ahead = ahead ?? 0
      if (opts.content && branch.ahead > 0 && !branch.isAncestor && (branch.cherryPlus ?? 0) > 0) {
        for (const ref of baseRefs) {
          if (await contentPresent(run, cwd, ref, name, `${gitDir}/halo-desk-${tip.slice(0, 8)}.idx`).catch(() => false)) branch.contentPresent = true
        }
      }

      return branch
    }),
  )

  const stashes: Stash[] = lines(await out('stash', 'list', '--format=%gd|%cs|%gs')).map(l => {
    const [ref, date, ...rest] = l.split('|')
    const message = rest.join('|')

    return { index: Number(/\{(\d+)\}/.exec(ref)?.[1]), date, message, branch: /^(?:WIP )?[Oo]n ([^:]+):/.exec(message)?.[1] }
  })

  return {
    project: project.name,
    base: bases[0],
    current: current || undefined,
    dirty: status.filter(l => !l.startsWith('??')),
    untracked: status.filter(l => l.startsWith('??')).map(l => l.slice(3)),
    branches,
    stashes,
    error,
  }
}

/** `git remote get-url origin` split into host URL and project path, for https and ssh remotes. */
export function parseRemote(url: string): { baseUrl: string; path: string } | undefined {
  const ssh = /^[^@/]+@([^:/]+):(.+?)(?:\.git)?$/.exec(url.trim())
  if (ssh) return { baseUrl: `https://${ssh[1]}`, path: ssh[2] }
  const http = /^(https?:\/\/[^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url.trim())

  return http ? { baseUrl: http[1], path: http[2] } : undefined
}

/** Test 4: is the branch's diff already applied to the base? Positive only; "no" is inconclusive. */
export async function contentPresent(run: Run, cwd: string, baseRef: string, branch: string, tmpIndex: string): Promise<boolean> {
  const env = { GIT_INDEX_FILE: tmpIndex }
  const git = (args: string[], stdin?: string) => run(['git', ...args], { cwd, env, stdin })
  await git(['read-tree', baseRef])
  const mb = (await run(['git', 'merge-base', baseRef, branch], { cwd })).stdout.trim()
  if (!mb) return false
  const diff = (await run(['git', 'diff', mb, branch], { cwd })).stdout
  if (!diff) return true

  return (await git(['apply', '-R', '--check', '--cached'], diff)).exitCode === 0
}

/** Added lines per file of `git diff stash^ stash`. */
export function stashAdds(diff: string): Map<string, string[]> {
  const files = new Map<string, string[]>()
  let current: string[] | undefined
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ b/')) files.set(l.slice(6), (current = []))
    else if (l.startsWith('+') && !l.startsWith('+++') && current && l.slice(1).trim()) current.push(l.slice(1).trim())
  }

  return files
}
