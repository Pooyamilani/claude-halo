import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { toJalali, jalaliShort, gregorianShort, shortModel, resetsIn, fit } from './register'
import type { Chip } from './register'
import type { On } from 'claude-code'

const BAND = { plugin: 'halo', component: 'AbovePrompt' } as const
const SURFACES = ['desktop', 'terminal'] as const

const AGENTS = Array.from({ length: 8 }, (_, i) => ({
  id: `a${i}`, type: i % 2 ? 'general-purpose' : 'Explore', model: 'claude-haiku-4-5-20251001', effort: 'medium',
}))

// Stands in for the engine beneath the plugin: a session with two limit
// readings, opus as the main model and 8 running subagents on haiku.
const seed = async ($: Engine, on: On) => {
  on('agent.list', () => ({ value: AGENTS.map(a => ({ id: a.id, type: a.type, status: 'running', description: a.type })) }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: {},
    rateLimits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(2 * 3600e3).toISOString() },
      { kind: 'seven_day', percentUsed: 38, resetsAt: new Date(3 * 86400e3).toISOString() },
    ],
  } }) as never)
  on('session.start', ($, e) => e as never)
  on('turn.step', async function* ($, e) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never })
  await $.session.start({ source: 'startup', cwd: '/' } as never)
  const step = (model: string, effort: string, agentId?: string) =>
    $.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
  for await (const _ of step('claude-opus-5-5', 'high')) void _
  for (const a of AGENTS) for await (const _ of step(a.model, a.effort, a.id)) void _
}

test('gregorian → jalali', () => {
  expect(toJalali(2025, 10, 13)).toEqual([1404, 7, 21])
  expect(toJalali(2026, 10, 18)).toEqual([1405, 7, 26])
  expect(toJalali(2025, 3, 21)).toEqual([1404, 1, 1])
  expect(toJalali(2025, 3, 20)).toEqual([1403, 12, 30])
  expect(toJalali(2024, 2, 29)).toEqual([1402, 12, 10])
  expect(jalaliShort(new Date(2025, 9, 13))).toBe('دوشنبه ۲۱ مهر')
  expect(gregorianShort(new Date(2025, 9, 13))).toBe('Mon 13 Oct')
})

test('short model names and reset times', () => {
  expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus 5.5')
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  expect(shortModel('sonnet')).toBe('sonnet')
  expect(resetsIn('not a date', 0)).toBe('')
  expect(resetsIn(undefined, 0)).toBe('')
  expect(resetsIn(new Date(90 * 60e3).toISOString(), 0)).toBe('1h 30m')
  expect(resetsIn(new Date(0).toISOString(), 60e3)).toBe('0h 0m')
})

test('fit folds agents, then compacts, then drops the date', () => {
  const chip = (key: string, text: string, dim: string, full: string): Chip => ({ key, color: '#fff', text, dim, full })
  const base = [chip('five_hour', '62%', '5h', '5h · 2h 14m'), chip('main', 'opus 5.5', '', 'high')]
  const many = AGENTS.map(a => chip(a.id, a.type, 'haiku 4.5', 'haiku 4.5 · medium'))

  const wide = fit(400, base, many, 'Mon 13 Oct')
  expect(wide.chips.length).toBe(base.length + many.length)
  expect(wide.compact).toBe(false)

  const mid = fit(110, base, many, 'Mon 13 Oct')
  expect(mid.chips.at(-1)?.key).toBe('more')
  expect(mid.date).toBe('Mon 13 Oct')

  const narrow = fit(30, base, many, 'Mon 13 Oct')
  expect(narrow.compact).toBe(true)
  expect(narrow.date).toBe('')
  expect(narrow.chips.filter(c => c.key.startsWith('a'))).toEqual([])
  expect(narrow.chips.at(-1)).toMatchObject({ key: 'more', text: '+8' })
})

test('8 agents at every width stay inside the band on both surfaces', async ($, on) => {
  mock.clock(on)
  await seed($, on)
  for (const surface of SURFACES) {
    for (const bodyColumns of [40, 80, 120, 200, 400]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { bodyColumns } } as never)
      expect(await ui.find({ type: 'Text', text: /62%/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'opus 5.5' })).toBeDefined()
      if (bodyColumns < 400) expect(await ui.find({ type: 'Text', text: /^\+\d+$/ })).toBeDefined()
      else expect(await ui.find({ type: 'Text', text: /^\+\d+$/ })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('defaults draw both rings and the jalali date', async ($, on) => {
  mock.clock(on)
  await seed($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { bodyColumns: 400 } } as never)
    expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^week/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'high' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[۰-۹]/ })).toBeDefined()
    await ui.unmount()
  }
})

test('weekly only, model without effort, gregorian', { options: { usage: 'weekly', models: 'model', date: 'gregorian' } }, async ($, on) => {
  mock.clock(on)
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 400 } } as never)
  expect(await ui.find({ type: 'Text', text: /^week/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'high' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /medium/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+ [A-Z][a-z]{2}$/ })).toBeDefined()
  await ui.unmount()
})

test('everything off leaves the engine band alone', { options: { usage: 'off', models: 'off', date: 'off' } }, async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: {} } as never)
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})
