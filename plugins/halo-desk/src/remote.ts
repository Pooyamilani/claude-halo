import { keyOf } from './config'
import type { Access, Config, JiraInfo, JiraSettings, LocalRepo, MrInfo, Project, RemoteSnapshot } from './types'

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: string }>

export function parseSnapshot(text: string): RemoteSnapshot | undefined {
  try {
    const s = JSON.parse(text)
    if (typeof s?.fetchedAt !== 'string' || typeof s.jira !== 'object' || !Array.isArray(s.mrs)) return undefined

    return s
  } catch {
    return undefined
  }
}

export const ageMinutes = (s: RemoteSnapshot, now: number) => Math.floor((now - Date.parse(s.fetchedAt)) / 60_000)

const auth = (token: string) => (/^(Bearer|Basic) /.test(token) ? token : `Bearer ${token}`)

/** One search for every key, 50 at a time. A missing key simply has no entry (never inferred as done). */
export async function collectJira(
  fetch: Fetch,
  jira: JiraSettings,
  keys: string[],
  token?: string,
): Promise<{ me?: string; jira: Record<string, JiraInfo>; health: { ok: boolean; error?: string } }> {
  const headers: Record<string, string> = token ? { Authorization: auth(token), Accept: 'application/json' } : { Accept: 'application/json' }
  const base = jira.baseUrl.replace(/\/$/, '')
  const result: Record<string, JiraInfo> = {}
  const me = await fetch(`${base}/rest/api/2/myself`, { headers })
  if (!me.ok) return { jira: result, health: { ok: false, error: me.status === 401 || me.status === 403 ? 'not signed in to Jira (401)' : `Jira answered ${me.status}` } }
  for (let i = 0; i < keys.length; i += 50) {
    const jql = encodeURIComponent(`key in (${keys.slice(i, i + 50).join(',')})`)
    const res = await fetch(`${base}/rest/api/2/search?maxResults=50&fields=summary,status,assignee&jql=${jql}`, { headers })
    if (!res.ok) return { me: parseJson(me.text)?.displayName, jira: result, health: { ok: false, error: `Jira search answered ${res.status}` } }
    for (const issue of parseJson(res.text)?.issues ?? []) {
      result[issue.key] = {
        status: issue.fields.status?.name,
        statusCategory: issue.fields.status?.statusCategory?.key,
        assignee: issue.fields.assignee?.displayName,
        summary: issue.fields.summary,
      }
    }
  }

  return { me: parseJson(me.text)?.displayName, jira: result, health: { ok: true } }
}

/** MR state per branch, by exact source branch. Uses the numeric project id (a path form is rejected by some servers). */
export async function collectGitlab(
  fetch: Fetch,
  project: Project,
  gitlab: { baseUrl: string; path?: string; projectId?: number },
  branches: string[],
  token?: string,
): Promise<{ mrs: MrInfo[]; projectId?: number; health: { ok: boolean; error?: string } }> {
  const headers: Record<string, string> = token ? { 'PRIVATE-TOKEN': token } : {}
  const base = `${gitlab.baseUrl.replace(/\/$/, '')}/api/v4`
  let id = gitlab.projectId
  if (id === undefined && gitlab.path) {
    const res = await fetch(`${base}/projects/${encodeURIComponent(gitlab.path)}`, { headers })
    id = res.ok ? parseJson(res.text)?.id : undefined
  }
  if (id === undefined) return { mrs: [], health: { ok: false, error: `cannot resolve the GitLab project id for ${project.name}: set gitlab.projectId in config.json` } }
  const mrs: MrInfo[] = []
  for (const branch of branches) {
    const res = await fetch(`${base}/projects/${id}/merge_requests?source_branch=${encodeURIComponent(branch)}&per_page=20`, { headers })
    if (!res.ok) return { mrs, projectId: id, health: { ok: false, error: res.status === 401 ? 'not signed in to GitLab (401)' : `GitLab answered ${res.status}` } }
    for (const m of parseJson(res.text) ?? []) {
      mrs.push({ project: project.name, sourceBranch: branch, iid: m.iid, state: m.state, target: m.target_branch, updatedAt: m.updated_at, sha: m.sha, webUrl: m.web_url, title: m.title })
    }
  }

  return { mrs, projectId: id, health: { ok: true } }
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Card keys worth asking Jira about: every branch name, plus any note keys. */
export function wantedKeys(config: Config, repos: LocalRepo[], extra: string[] = []): string[] {
  const keys = new Set(extra)
  for (const repo of repos) {
    const project = config.projects.find(p => p.name === repo.project)
    for (const b of repo.branches) {
      const key = keyOf(b.name, project?.jira ?? config.jira)
      if (key) keys.add(key)
    }
  }

  return [...keys]
}

/**
 * The prompt that asks Claude to build remote-snapshot.json, per source through a browser the user is
 * already signed in to (default) or through an MCP server (`config.access`). The mod never sees cookies
 * or tokens; the snapshot file is the whole contract.
 */
export function browserRefreshPrompt(args: {
  config: Config
  keys: string[]
  branches: { project: string; branches: string[]; gitlab?: { baseUrl: string; path?: string; projectId?: number } }[]
  file: string
}): string {
  const jira = args.config.jira?.baseUrl ?? '(per-project jira.baseUrl in config.json)'
  const gl = args.branches.map(b => `- ${b.project}: ${b.gitlab ? `${b.gitlab.baseUrl} path ${b.gitlab.path ?? '?'}${b.gitlab.projectId ? ` id ${b.gitlab.projectId}` : ''}` : 'no GitLab remote'}; branches: ${b.branches.join(', ') || '(none)'}`).join('\n')

  const mode = (source: 'jira' | 'gitlab'): Access => args.config.access?.[source] ?? 'browser'
  const browserJira = `navigate the browser to <jira>/rest/api/2/myself once (same-origin), then fetch /rest/api/2/search?maxResults=50&fields=summary,status,assignee&jql=key in (...) for these keys: ${args.keys.join(', ') || '(none)'}. Record status.name, status.statusCategory.key, assignee.displayName, summary per key, and displayName from /myself as "me".`
  const browserGitlab = `for each project below, on the GitLab origin fetch /api/v4/projects/<numeric id>/merge_requests?source_branch=<branch>&per_page=20 for every listed branch (use the numeric id; resolve it once via /api/v4/projects/<url-encoded path> if unknown). Cross-origin fetches are blocked: navigate the tab to the right origin first.`
  // Never fall back to the browser on its own: the user approves each switch.
  const gate = (name: string, browser: string) =>
    `If ${name} is missing, times out, is not signed in or cannot do this lookup, do NOT switch to the browser by yourself: stop, say which MCP failed and why, and ask the user (AskUserQuestion) whether to use the browser for this source. On yes, ${browser} On no, set this source to { "ok": false, "error": "<why>" } and keep the rest.`
  const jiraStep =
    mode('jira') === 'mcp'
      ? `1. Jira (${jira}) through the Jira MCP (tools named mcp__jira__*, load them with ToolSearch): search with JQL key in (...) for these keys: ${args.keys.join(', ') || '(none)'}, 50 at a time, and read the current user for "me". Record status.name, status.statusCategory.key, assignee.displayName and summary per key. ${gate('the Jira MCP', browserJira)}`
      : `1. Jira (${jira}): ${browserJira}`
  const gitlabStep =
    mode('gitlab') === 'mcp'
      ? `2. GitLab through the GitLab MCP (tools named mcp__gitlab-mcp__*, load them with ToolSearch; use the tool names it actually exposes). Its merge request list has no source-branch filter: for each project below list merge requests with state all (100 per page, follow the cursor until the listed branches are covered or the pages run out) and match each listed branch against the source branch yourself, using the numeric project id. Only if that cannot work (the list does not show the source branch), ${gate('the GitLab MCP', browserGitlab)}`
      : `2. GitLab: ${browserGitlab}`
  const via = mode('jira') === 'mcp' || mode('gitlab') === 'mcp' ? 'the configured MCP servers and the signed-in browser' : 'the signed-in browser'

  return `Refresh the Halo Desk remote snapshot using ${via} (read-only, no tokens, no credentials).

${jiraStep}
${gitlabStep}
${gl}
3. Write ${args.file} as JSON: { "fetchedAt": <ISO now>, "me": string, "jira": { "KEY": { "status", "statusCategory": "new|indeterminate|done", "assignee", "summary" } }, "mrs": [ { "project", "sourceBranch", "iid", "state": "opened|merged|closed", "target", "updatedAt", "sha", "webUrl", "title" } ], "sources": { "jira": { "ok": true }, "gitlab": { "ok": true } } }. If a source fails (401, redirect to login), set that source's { "ok": false, "error": "..." } and keep the rest. Never guess a status that you could not read.
Then reply with one line: how many cards and MRs were written, and any source that failed.`
}
