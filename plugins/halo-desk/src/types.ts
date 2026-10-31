// Shared shapes. Nothing in src/ names a real host, project or card key: all of that comes from config.json.

export type JiraSettings = {
  baseUrl: string
  /** Where the card key is found in a branch name. Default: any PROJ-123. */
  keyRegex?: string
  /** Status names (case-insensitive) that mean the card is finished. Default: Jira's "done" status category. */
  closedStatuses?: string[]
  /** Status names meaning parked. Default: names containing "hold" or "waiting". */
  holdStatuses?: string[]
  /** Status names meaning someone is working on it. Default: Jira's "in progress" status category. */
  activeStatuses?: string[]
  /** Name of an environment variable holding a Jira token (the token itself is never stored). */
  tokenEnv?: string
}

export type GitlabSettings = {
  baseUrl?: string
  /** Project path on the host (group/repo); detected from the origin remote. */
  path?: string
  /** Numeric project id; resolved from the remote path when absent. */
  projectId?: number
  tokenEnv?: string
}

export type Project = {
  name: string
  path: string
  /** Branches work merges into, e.g. ["main"]. Detected from origin/HEAD when empty. */
  bases?: string[]
  jira?: JiraSettings
  gitlab?: GitlabSettings
}

export type Config = {
  projects: Project[]
  /** Default for every project that has no jira of its own. */
  jira?: JiraSettings
  gitlab?: GitlabSettings
  staleReviewDays?: number
  idleDays?: number
  /** Globs (relative to each project) of plan/notes files that may mention a card key and a waiting reason. */
  noteGlobs?: string[]
  /** Regexes; a note line matching one marks its card as waiting. */
  waitingMarkers?: string[]
  /** Deleting on MR-tip evidence needs a remote snapshot newer than this. */
  maxSnapshotAgeMinutes?: number
}

// ---- local git -------------------------------------------------------------

export type LocalBranch = {
  name: string
  tip: string
  /** ISO committer date of the tip. */
  date: string
  current: boolean
  worktree: boolean
  /** True when refs/remotes/origin/<name> exists. */
  pushed: boolean
  /** Commits on the branch that origin/<name> lacks (0 when not pushed: see `pushed`). */
  unpushed: number
  /** Commits on the branch that its base lacks. */
  ahead: number
  /** Tests against the first base that gave a verdict. */
  isAncestor?: boolean
  cherryPlus?: number
  /** Test 4 result; only computed on demand (cleanup review) because it is the costly one. */
  contentPresent?: boolean
}

export type Stash = { index: number; date: string; message: string; branch?: string }

export type LocalRepo = {
  project: string
  base: string
  current?: string
  dirty: string[]
  untracked: string[]
  branches: LocalBranch[]
  stashes: Stash[]
  /** Set when the repo could not be read or fetched; data may be stale. */
  error?: string
}

// ---- remote snapshot (written by any collector) ----------------------------

export type JiraInfo = {
  status: string
  statusCategory?: 'new' | 'indeterminate' | 'done'
  assignee?: string
  summary?: string
}

export type MrInfo = {
  project: string
  sourceBranch: string
  iid: number
  state: 'opened' | 'merged' | 'closed'
  target?: string
  updatedAt?: string
  /** Branch head at merge time. */
  sha?: string
  webUrl?: string
  title?: string
}

export type SourceHealth = { ok: boolean; error?: string }

export type RemoteSnapshot = {
  fetchedAt: string
  /** Display name of the signed-in Jira user; used to tell "mine" from "someone else's". */
  me?: string
  jira: Record<string, JiraInfo>
  mrs: MrInfo[]
  sources?: { jira?: SourceHealth; gitlab?: SourceHealth }
}

// ---- classification --------------------------------------------------------

export type Badge = 'unpushed' | 'review-stale' | 'jira-mismatch' | 'on-hold' | 'merged' | 'unverified'

export type Bucket = 'action' | 'waiting' | 'tooling' | 'closed' | 'local'

export type Item = {
  key?: string
  project: string
  branch?: string
  jiraUrl?: string
  jira?: JiraInfo
  mr?: MrInfo & { ageDays?: number }
  local?: Pick<LocalBranch, 'unpushed' | 'ahead' | 'pushed' | 'worktree' | 'current'> & { idleDays: number }
  bucket: Bucket
  nextStep: string
  waitingOn?: string
  badges: Badge[]
  /** Merge evidence, when the branch is merged. */
  mergedBy?: MergeTest
}

export type MergeTest = 'mr-tip' | 'ancestor' | 'cherry' | 'content'

export type Note = { key: string; project: string; waiting?: string }
