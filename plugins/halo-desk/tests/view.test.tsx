import { expect, test } from 'claude-code/testing'

import { renderView } from '../src/view'

const item = {
  key: 'ACME-1', project: 'web', branch: 'ACME-1_fix', bucket: 'action', nextStep: 'Push the branch', badges: ['unpushed', 'review-stale'],
  jira: { status: 'Review' }, jiraUrl: 'https://jira.example.com/browse/ACME-1',
  mr: { project: 'web', sourceBranch: 'ACME-1_fix', iid: 3, state: 'opened', ageDays: 9, webUrl: 'https://git.example.com/web/-/merge_requests/3' },
}
const v = {
  items: [item, { ...item, key: undefined, branch: 'tooling/x', bucket: 'tooling', badges: [], jira: undefined, mr: undefined, jiraUrl: undefined }, { ...item, key: 'ACME-2', branch: undefined, bucket: 'waiting', waitingOn: 'backend', badges: ['on-hold'] }],
  repos: [{ project: 'web', branches: [], stashes: [], dirty: [], untracked: [] }],
  problems: ['a problem'], sources: [{ name: 'jira', ok: false, error: 'not signed in' }], busy: false, status: 'Updated', collapsed: {}, snapshotAge: 5,
  cleanup: { branches: [{ project: 'web', branch: 'old', action: 'delete', reasons: ['merged'] }], stashes: [{ project: 'web', stash: { index: 0, message: 'WIP' }, action: 'drop', why: 'noise' }], untracked: [{ project: 'web', files: ['a'] }] },
}
const act: any = { toggle() {}, focus() {}, refresh() {}, remote() {}, review() {}, copy() {}, arm() {}, cancel() {}, closeCleanup() {}, deleteBranches: async () => {}, dropStashes: async () => {} }

test('a full view is accepted by the engine on every surface', async ($, on) => {
  // A test hook stands for the plugin here; the mod's own hook passes this request on.
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: e.surface !== 'terminal', v, maxAge: 60, cleanable: 2, act, usage: { pct: 68, left: '2d left' } }))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface, props: { title: 'Halo Desk', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
    expect(await ui.find({ type: 'Text', text: /ACME-1/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Push the branch/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    await ui.unmount()
  }
})

test('an armed action raises an approval card with Approve and Cancel', async ($, on) => {
  let armed = ''
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: true, v: { ...v, armed }, maxAge: 60, cleanable: 2, act }))
  for (const [what, title] of [['remote', /Refresh Jira and GitLab data/], ['branches', /Delete 1 local branch/]] as const) {
    armed = what
    const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface: 'desktop', props: { title: 'Halo Desk', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
    expect(await ui.find({ type: 'Text', text: title })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'approve' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'cancel' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'close-cleanup' })).toBeTruthy()
    await ui.unmount()
  }
})

test('waiting reasons are plain, clamped, and not repeated from the status', async ($, on) => {
  const held = { ...item, key: 'ACME-9', bucket: 'waiting', nextStep: 'Wait', waitingOn: '**ON HOLD (2026-10-17):** ' + 'user said wait '.repeat(12), badges: ['on-hold'], jira: { status: 'On Hold' }, mr: undefined }
  const same = { ...item, key: 'ACME-10', bucket: 'waiting', nextStep: 'Wait', waitingOn: 'On Hold', badges: ['on-hold'], jira: { status: 'On Hold' }, mr: undefined }
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: true, v: { ...v, items: [held, same] }, maxAge: 60, cleanable: 0, act }))
  const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface: 'desktop', props: { title: 'Halo Desk', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
  expect(await ui.find({ type: 'Text', text: /\*\*/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^Wait: ON HOLD \(2026-10-17\): user said wait.*…$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Wait: On Hold$/ })).toBeFalsy()
  await ui.unmount()
})

test('the status chips carry their counts and are pressable', async ($, on) => {
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: e.surface !== 'terminal', v, maxAge: 60, cleanable: 2, act }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface, props: { title: 'Halo Desk', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
    expect(await ui.find({ type: 'Button', text: /^Needs action$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', text: /^Waiting$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', text: /^Clean up$/ })).toBeTruthy()
    await ui.unmount()
  }
})
