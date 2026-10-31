import { expect, test } from 'claude-code/testing'

import { branchCandidates, triageStash } from '../src/cleanup'
import { classify } from '../src/classify'
import { parseConfig } from '../src/config'
import { stashAdds } from '../src/git'
import { branch, config, mr, NOW, repo, snapshot } from './fixtures'

const items = (...bs: ReturnType<typeof branch>[]) =>
  classify({ config, repos: [repo(...bs)], remote: snapshot({ 'ACME-1': { status: 'Done' } }, bs.map(b => mr(b.name, { state: 'merged', sha: b.tip }))), now: NOW })

test('a merged, closed branch is a delete candidate; the current branch never is', async () => {
  const c = branchCandidates(items(branch('ACME-1_a'), branch('ACME-1_b', { current: true })), 5, 60)
  expect(c.map(x => [x.branch, x.action])).toEqual([['ACME-1_a', 'delete']])
})

test('worktree-held branches are skipped', async () => {
  expect(branchCandidates(items(branch('ACME-1_a', { worktree: true })), 5, 60)).toEqual([])
})

test('MR-tip evidence from an old snapshot is only a review', async () => {
  expect(branchCandidates(items(branch('ACME-1_a')), 500, 60)[0].action).toBe('review')
  expect(branchCandidates(items(branch('ACME-1_a')), undefined, 60)[0].action).toBe('review')
})

test('git-proven merge does not need a fresh snapshot', async () => {
  const b = branch('ACME-1_a', { isAncestor: true })
  const i = classify({ config, repos: [repo(b)], remote: snapshot({ 'ACME-1': { status: 'Done' } }, [mr(b.name, { state: 'merged', sha: 'other' })]), now: NOW })
  const c = branchCandidates(i, 500, 60)
  expect(c[0].action).toBe('delete')
})

test('merged but the card is still open is a review, not a delete', async () => {
  const b = branch('ACME-2_a', { isAncestor: true })
  const i = classify({ config, repos: [repo(b)], remote: snapshot({ 'ACME-2': { status: 'In Progress' } }), now: NOW })
  expect(branchCandidates(i, 5, 60)[0].action).toBe('review')
})

const lines = (...l: string[]) => new Set(l)

test('stash triage: already in the base drops', async () => {
  expect(triageStash([{ file: 'a.ts', adds: ['x', 'y'], baseLines: lines('x', 'y') }]).action).toBe('drop')
})

test('stash triage: lockfile-only noise drops', async () => {
  expect(triageStash([{ file: 'yarn.lock', adds: ['a', 'b', 'c'], baseLines: lines() }]).action).toBe('drop')
})

test('stash triage: files gone from the base are obsolete', async () => {
  expect(triageStash([{ file: 'old.ts', adds: Array.from({ length: 60 }, (_, i) => `l${i}`) }]).action).toBe('drop')
})

test('stash triage: active card keeps, unknown asks, never drops unknowns', async () => {
  const unique = [{ file: 'a.ts', adds: Array.from({ length: 60 }, (_, i) => `l${i}`), baseLines: lines('other') }]
  expect(triageStash(unique, 'active').action).toBe('keep')
  expect(triageStash(unique).action).toBe('ask')
  expect(triageStash(unique, 'closed').action).toBe('drop')
})

test('stashAdds reads only added, non-blank lines per file', async () => {
  const diff = ['+++ b/a.ts', '+one', '+', '-gone', '+++ b/b.ts', '+two'].join('\n')
  expect([...stashAdds(diff)]).toEqual([['a.ts', ['one']], ['b.ts', ['two']]])
})

test('config parsing reports problems instead of throwing', async () => {
  expect(parseConfig('{nope').problems[0]).toContain('not valid JSON')
  expect(parseConfig('{"projects":[{"name":"a"}]}').problems.join()).toContain('needs a "name" and a "path"')
  expect(parseConfig('{"projects":[{"name":"a","path":"/a"}],"jira":{"baseUrl":"u","keyRegex":"("}}').problems.join()).toContain('regular expression')
})
