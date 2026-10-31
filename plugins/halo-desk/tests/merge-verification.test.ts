import { expect, test } from 'claude-code/testing'

import { verifyMerged } from '../src/merge'

test('each positive test proves merged, strongest first', async () => {
  expect(verifyMerged({ tip: 'a', mr: { state: 'merged', sha: 'a' }, isAncestor: true })).toEqual({ merged: true, test: 'mr-tip' })
  expect(verifyMerged({ tip: 'a', isAncestor: true })).toEqual({ merged: true, test: 'ancestor' })
  expect(verifyMerged({ tip: 'a', cherryPlus: 0 })).toEqual({ merged: true, test: 'cherry' })
  expect(verifyMerged({ tip: 'a', contentPresent: true })).toEqual({ merged: true, test: 'content' })
})

test('failed tests are inconclusive, never proof of unmerged work', async () => {
  const v = verifyMerged({ tip: 'a', isAncestor: false, cherryPlus: 3, contentPresent: false })
  expect(v.merged).toBe(false)
})

test('merged MR with a different tip is flagged, not trusted', async () => {
  const v = verifyMerged({ tip: 'b', mr: { state: 'merged', sha: 'a' } })
  expect(v.merged).toBe(false)
  expect('note' in v && v.note).toContain('tip differs')
})

test('an open MR is no evidence of merge', async () => {
  expect(verifyMerged({ tip: 'a', mr: { state: 'opened', sha: 'a' } }).merged).toBe(false)
})
