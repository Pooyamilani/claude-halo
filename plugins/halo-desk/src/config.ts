import type { Config, JiraSettings, Project } from './types'

export const DEFAULT_KEY_REGEX = '[A-Z][A-Z0-9]+-\\d+'

/** Parses config.json text; returns the config or the problems found. Never throws. */
export function parseConfig(text: string): { config: Config; problems: string[] } {
  const problems: string[] = []
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { config: { projects: [] }, problems: [`config.json is not valid JSON: ${(error as Error).message}`] }
  }
  const projects: Project[] = []
  for (const [i, p] of (Array.isArray(raw?.projects) ? raw.projects : []).entries()) {
    if (typeof p?.name !== 'string' || typeof p?.path !== 'string') {
      problems.push(`projects[${i}] needs a "name" and a "path"`)
      continue
    }
    projects.push(p)
  }
  if (projects.length === 0) problems.push('no projects configured: run /halo-desk add <path>')
  for (const [i, regex] of [raw?.jira?.keyRegex, ...projects.map(p => p.jira?.keyRegex)].entries()) {
    if (typeof regex !== 'string') continue
    try {
      new RegExp(regex)
    } catch {
      problems.push(`keyRegex #${i} is not a valid regular expression`)
    }
  }
  return { config: { ...raw, projects }, problems }
}

export function jiraFor(config: Config, project: Project): JiraSettings | undefined {
  return project.jira ?? config.jira
}

/** The card key in a branch name, upper-cased, or undefined. */
export function keyOf(branch: string, jira?: JiraSettings): string | undefined {
  const found = new RegExp(jira?.keyRegex ?? DEFAULT_KEY_REGEX).exec(branch)

  return found?.[0].toUpperCase()
}

export const days = (config: Config) => ({
  stale: config.staleReviewDays ?? 7,
  idle: config.idleDays ?? 21,
})

export function addProject(config: Config, project: Project): Config {
  return { ...config, projects: [...config.projects.filter(p => p.name !== project.name), project] }
}
