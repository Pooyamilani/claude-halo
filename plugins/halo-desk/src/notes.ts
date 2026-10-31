import { keyOf } from './config'
import type { Config, Note, Project } from './types'
import { jiraFor } from './config'

/** One plan/notes file -> a Note when it names a card key. A line matching a waiting marker becomes the reason. */
export function noteFromText(file: string, text: string, config: Config, project: Project): Note | undefined {
  const settings = jiraFor(config, project)
  const key = keyOf(file, settings) ?? keyOf(text.split('\n').slice(0, 20).join('\n'), settings)
  if (!key) return undefined
  const markers = (config.waitingMarkers ?? []).map(m => new RegExp(m, 'i'))
  const line = text.split('\n').find(l => markers.some(m => m.test(l)))

  return { key, project: project.name, waiting: line?.trim().slice(0, 120) }
}

/** `dir/*.md` style patterns only: a literal directory and a `*` in the file name. */
export function matchGlob(pattern: string, path: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')

  return re.test(path)
}
