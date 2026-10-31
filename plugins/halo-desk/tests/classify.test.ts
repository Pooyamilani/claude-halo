import { expect, test } from 'claude-code/testing'

import { classify } from '../src/classify'
import { branch, config, daysAgo, mr, NOW, repo, snapshot } from './fixtures'

const one = (b: ReturnType<typeof branch>, remote?: ReturnType<typeof snapshot>, notes = []) =>
  classify({ config, repos: [repo(b)], remote, notes, now: NOW })[0]

test('rule 1: closed card and merged MR is closed', async () => {
  const b = branch('ACME-1_done')
  const i = one(b, snapshot({ 'ACME-1': { status: 'Done' } }, [mr(b.name, { state: 'merged', sha: b.tip })]))
  expect(i.bucket).toBe('closed')
  expect(i.mergedBy).toBe('mr-tip')
})

test('rule 1 needs merge evidence: closed card, unproven branch stays local', async () => {
  const i = one(branch('ACME-1_done'), snapshot({ 'ACME-1': { status: 'Done' } }))
  expect(i.bucket).toBe('local')
  expect(i.nextStep).toContain('merge not verified')
})

test('rule 2: open MR needs action; stale after the configured days', async () => {
  const fresh = one(branch('ACME-2_a'), snapshot({ 'ACME-2': { status: 'In Progress' } }, [mr('ACME-2_a')]))
  expect(fresh.bucket).toBe('action')
  expect(fresh.badges).not.toContain('review-stale')
  const old = one(branch('ACME-2_a'), snapshot({ 'ACME-2': { status: 'In Progress' } }, [mr('ACME-2_a', { updatedAt: daysAgo(9) })]))
  expect(old.badges).toContain('review-stale')
  expect(old.nextStep).toContain('9 days')
})

test('rule 2: open MR on a To Do card is a mismatch', async () => {
  const i = one(branch('ACME-3_a'), snapshot({ 'ACME-3': { status: 'To Do', statusCategory: 'new' } }, [mr('ACME-3_a')]))
  expect(i.badges).toContain('jira-mismatch')
})

test('rule 3: unpushed commits need a push', async () => {
  const i = one(branch('ACME-4_a', { unpushed: 3 }), snapshot({ 'ACME-4': { status: 'In Progress' } }))
  expect(i.bucket).toBe('action')
  expect(i.nextStep).toBe('Push the new commits')
  expect(i.badges).toContain('unpushed')
})

test('rule 4: pushed, active, no MR means open an MR', async () => {
  const i = one(branch('ACME-5_a'), snapshot({ 'ACME-5': { status: 'In Progress' } }))
  expect(i.nextStep).toBe('Open an MR')
})

test('rule 5: on-hold status or a notes marker is waiting, with the reason', async () => {
  const hold = one(branch('ACME-6_a'), snapshot({ 'ACME-6': { status: 'On Hold' } }))
  expect(hold.bucket).toBe('waiting')
  const noted = one(branch('ACME-7_a', { ahead: 0 }), snapshot({ 'ACME-7': { status: 'In Progress' } }), [{ key: 'ACME-7', project: 'web', waiting: 'waiting for backend ids' }] as any)
  expect(noted.waitingOn).toBe('waiting for backend ids')
})

test('rule 6: active but untouched for weeks is unclear', async () => {
  const i = one(branch('ACME-8_a', { date: daysAgo(40), ahead: 0 }), snapshot({ 'ACME-8': { status: 'In Progress' } }))
  expect(i.nextStep).toContain('Unclear')
})

test('rule 7: someone else owns the card', async () => {
  const i = one(branch('ACME-9_a', { ahead: 0 }), snapshot({ 'ACME-9': { status: 'To Do', assignee: 'Dana' } }))
  expect(i.bucket).toBe('waiting')
  expect(i.waitingOn).toBe('owned by Dana')
})

test('rule 8: a branch without a card key is tooling', async () => {
  const i = one(branch('tooling/linter', { unpushed: 1 }), snapshot({}))
  expect(i.bucket).toBe('tooling')
  expect(i.nextStep).toBe('Push the new commits')
})

test('no remote data: local rules still work and nothing is inferred closed', async () => {
  const i = one(branch('ACME-10_a'), undefined)
  expect(i.bucket).toBe('local')
  expect(i.nextStep).toContain('No remote data')
})

test('Jira status categories apply when no names are configured', async () => {
  const cfg = { ...config, jira: { baseUrl: 'https://jira.example.com' } }
  const b = branch('ACME-11_a', { isAncestor: true })
  const i = classify({ config: cfg, repos: [repo(b)], remote: snapshot({ 'ACME-11': { status: 'Closed', statusCategory: 'done' } }), now: NOW })[0]
  expect(i.bucket).toBe('closed')
})

test('base branches are never listed as work', async () => {
  const items = classify({ config, repos: [repo()], now: NOW })
  expect(items).toHaveLength(0)
})

test('mainline branches are never work or deletion candidates, even when not this project\'s base', async () => {
  const items = classify({ config, repos: [repo(branch('master', { isAncestor: true, ahead: 0 }), branch('release/1', { isAncestor: true, ahead: 0 }))], now: NOW })
  expect(items.map(i => i.branch)).toEqual(['release/1'])
})
