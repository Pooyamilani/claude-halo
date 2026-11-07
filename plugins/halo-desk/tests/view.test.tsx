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
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: true, v: { ...v, items: [held, same], collapsed: { waiting: false } }, maxAge: 60, cleanable: 0, act }))
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
    expect(await ui.find({ type: 'Button', text: /^. Needs action \d+$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', text: /^. Waiting \d+$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Button', text: /^. Cleanup \d+$/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('by default Next action is open, the other sections show a one-line summary, and All is the lit segment', async ($, on) => {
  const w = { ...item, key: 'ACME-7', bucket: 'waiting', waitingOn: 'Someone', badges: [], jira: { status: 'Open' }, mr: undefined }
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: true, v: { ...v, items: [item, w], collapsed: {} }, maxAge: 60, cleanable: 0, act }))
  const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface: 'desktop', props: { title: 'Halo Desk', isFocused: false, bodyColumns: 24, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
  expect(await ui.find({ type: 'Text', text: /^ACME-7$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Someone$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Button', text: /^Show$/ })).toBeTruthy()
  await ui.unmount()
})

test('rows lead with the Jira title; the first Next action is the hero with its actions drawn', async ($, on) => {
  const titled = { ...item, key: 'ACME-1', bucket: 'action', jira: { status: 'Review', summary: 'Conditional required discount' } }
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: true, hover: true, v: { ...v, items: [titled, { ...titled, key: 'ACME-2', branch: 'ACME-2_' + 'very_long_branch_name_'.repeat(6) }], collapsed: {} }, maxAge: 60, cleanable: 0, act }))
  const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface: 'desktop', props: { title: 'Halo Desk', isFocused: false, bodyColumns: 30, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
  expect(await ui.find({ type: 'Text', text: /Conditional required discount/ })).toBeTruthy()
  expect(await ui.find({ type: 'Button', text: /Copy/ })).toBeTruthy()
  await ui.unmount()
})

test('odd real-world rows still draw', async ($, on) => {
  const odd = [
    { ...item, key: undefined, branch: 'TOOLING/x', bucket: 'tooling', jira: undefined, mr: undefined, jiraUrl: undefined, waitingOn: undefined, badges: ['review-stale'] },
    { ...item, key: 'HD-1', branch: undefined, bucket: 'waiting', jira: { status: 'Develop', summary: 'این مورد نیازمند «اضافه» شدن' }, mr: undefined, waitingOn: 'ON HOLD: ' + 'x'.repeat(300), badges: [] },
    { ...item, key: 'RCT-1', bucket: 'action', jira: { status: 'Review', summary: undefined }, badges: ['unpushed', 'on-hold'] },
  ]
  on('ui.render', ($, e) => renderView({ E: $.ui.resolve(e), rich: true, hover: true, v: { ...v, items: odd, collapsed: {} }, maxAge: 60, cleanable: 2, act, usage: { pct: 27, left: '3d left' } }))
  const ui = await $.ui.mount({ plugin: 'halo-desk', component: 'Pane', requestId: 'other', surface: 'desktop', props: { title: 'Halo Desk', isFocused: false, bodyColumns: 30, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as any)
  expect(await ui.find({ type: 'Button', text: /Copy/ })).toBeTruthy()
  await ui.unmount()
})
