import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'halo-desk',
  component: 'Pane',
  requestId: 'halo-desk',
  props: { title: 'Task Desk', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('the pane draws its buttons and first-run hint on every surface', async ($, on) => {
  on('env.get', () => ({ value: '/tmp/none' }))
  on('fs.exists', () => ({ value: false }))
  on('command.register', () => ({ value: { command: 'halo-desk' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'remote' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'cleanup' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Press Refresh/ })).toBeTruthy()
    await ui.unmount()
  }
})
