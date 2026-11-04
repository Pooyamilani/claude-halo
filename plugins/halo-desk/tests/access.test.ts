import { expect, test } from 'claude-code/testing'
import { parseConfig } from '../src/config'
import { browserRefreshPrompt } from '../src/remote'
import type { Config } from '../src/types'

const base: Config = { projects: [], jira: { baseUrl: 'https://jira.example.com' } }
const ask = (config: Config) => browserRefreshPrompt({ config, keys: ['A-1'], branches: [], file: '/tmp/s.json' })

test('default stays browser-only', () => {
  const prompt = ask(base)
  expect(prompt).toContain('using the signed-in browser (')
  expect(prompt).not.toContain('mcp__')
})

test('mcp mode names the servers per source and falls back to the browser', () => {
  const prompt = ask({ ...base, access: { jira: 'mcp', gitlab: 'mcp' } })
  expect(prompt).toContain('mcp__jira__*')
  expect(prompt).toContain('mcp__gitlab-mcp__*')
  expect(prompt).toContain('do NOT switch to the browser by yourself')
  expect(prompt).toContain('AskUserQuestion')
  expect(prompt).toContain('no source-branch filter')
})

test('sources are independent', () => {
  const prompt = ask({ ...base, access: { gitlab: 'mcp' } })
  expect(prompt).toContain('/rest/api/2/myself')
  expect(prompt).toContain('mcp__gitlab-mcp__*')
})

test('bad access value is reported', () => {
  const { problems } = parseConfig(JSON.stringify({ projects: [{ name: 'a', path: '/a' }], access: { jira: 'api' } }))
  expect(problems).toContain('access.jira must be "browser" or "mcp"')
})
