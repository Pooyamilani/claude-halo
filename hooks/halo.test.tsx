import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { toJalali, jalaliShort, gregorianShort, shortModel, resetsIn, fit, level, modelColor, haloMark, DESKTOP_TEXT } from './register'
import type { Chip } from './register'
import type { On } from 'claude-code'

const BAND = { plugin: 'halo', component: 'AbovePrompt' } as const
const SURFACES = ['desktop', 'terminal'] as const

const AGENTS = Array.from({ length: 8 }, (_, i) => ({
  id: `a${i}`, type: i % 2 ? 'general-purpose' : 'Explore', model: 'claude-haiku-4-5-20251001', effort: 'medium',
}))

// Stands in for the engine beneath the plugin: a session with two limit
// readings, opus as the main model and 8 running subagents on haiku.
const seed = async ($: Engine, on: On, fiveHour = 62, weekly = 38, live: () => (typeof AGENTS[number] & { status?: string })[] = () => AGENTS) => {
  on('agent.list', () => ({ value: live().map(a => ({ id: a.id, type: a.type, status: a.status ?? 'running', description: a.type })) }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: {},
    rateLimits: [
      { kind: 'five_hour', percentUsed: fiveHour, resetsAt: new Date(2 * 3600e3).toISOString() },
      { kind: 'seven_day', percentUsed: weekly, resetsAt: new Date(3 * 86400e3).toISOString() },
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
  expect(mid.chips.at(-1)).toMatchObject({ key: 'more', dim: 'more' })
  expect(mid.date).toBe('Mon 13 Oct')

  const narrow = fit(30, base, many, 'Mon 13 Oct')
  expect(narrow.compact).toBe(true)
  expect(narrow.date).toBe('')
  expect(narrow.chips.filter(c => c.key.startsWith('a'))).toEqual([])
  expect(narrow.chips.at(-1)).toMatchObject({ key: 'more', text: '8', dim: 'agents' })
  expect(fit(30, base, many.slice(0, 1), '').chips.at(-1)).toMatchObject({ text: '1', dim: 'agent' })
})

test('8 agents at every width stay inside the band on both surfaces', async ($, on) => {
  mock.clock(on)
  await seed($, on)
  for (const surface of SURFACES) {
    for (const bodyColumns of [40, 80, 120, 200, 400]) {
      const ui = await $.ui.mount({ ...BAND, surface, props: { bodyColumns } } as never)
      expect(await ui.find({ type: 'Text', text: /62%/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'opus 5.5' })).toBeDefined()
      const folded = (await ui.findAll({ type: 'Button' })).some(b => b.props.key === 'more:open')
      expect(folded).toBe(bodyColumns < 400)
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

test('levels and model colors', () => {
  expect([0, 74.9, 75, 89.9, 90, 120].map(level)).toEqual(['calm', 'calm', 'warm', 'warm', 'hot', 'hot'])
  expect(modelColor('claude-opus-5-5')).toBe('#e07a52')
  expect(modelColor('claude-sonnet-5-5')).toBe('#8f9bff')
  expect(modelColor('claude-haiku-4-5-20251001')).toBe('#4fd1b5')
  expect(modelColor('some-other-model')).toBe('#c4cad4')
})

test('halo mark: dots capped at 8, animated only while working', () => {
  const rings = [{ radius: 9, pct: 62, color: '#4fd1b5', hasReading: true }, { radius: 15, pct: 38, color: '#8f9bff', hasReading: true }]
  const twelve = Array.from({ length: 12 }, () => '#4fd1b5')
  const idle = haloMark(rings, twelve, false)
  expect(idle.match(/class="agent"/g)?.length).toBe(8)
  expect(idle).not.toContain('<animate')
  const busy = haloMark(rings, twelve.slice(0, 3), true)
  expect(busy.match(/class="agent"/g)?.length).toBe(3)
  expect(busy).toContain('<animate attributeName="opacity"')
  expect(busy).toContain('<animateTransform')
  // With no agents the rings fill the box; with agents the orbit band is kept.
  expect(haloMark(rings, [], false)).toContain('viewBox="6 6 36 36"')
  expect(busy).toContain('viewBox="0 0 48 48"')
  // The orbit keeps a clear lane: every dot clears the outer ring (radius 15 + half its stroke) and the box.
  for (const m of busy.matchAll(/class="agent" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
    const d = Math.hypot(+m[1]! - 24, +m[2]! - 24)
    expect(d - +m[3]!).toBeGreaterThan(15 + 3.6 / 2 + 1)
    expect(d + +m[3]!).toBeLessThan(24)
  }
  // No reading yet: the track is drawn, no lit arc.
  expect(haloMark([{ radius: 9, pct: 0, color: '#4fd1b5', hasReading: false }], [], false)).not.toContain('stroke-dasharray')
})

test('desktop draws one halo mark that breathes only while working', async ($, on) => {
  mock.clock(on)
  await seed($, on)
  for (const isWorking of [false, true]) {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 200, isWorking } } as never)
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBe(1)
    expect(svgs[0]!.props.width).toBe(36)
    expect(svgs[0]!.props.alt).toBe('5-hour 62% used, Weekly 38% used, 8 agents running')
    expect(svgs[0]!.props.isInteractive).toBe(isWorking ? true : undefined)
    expect(await ui.find({ type: 'Text', text: '◉' })).toBeUndefined()
    await ui.unmount()
  }
})

test('terminal uses glyphs, colored like the rings', async ($, on) => {
  mock.clock(on)
  await seed($, on, 93, 40)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { bodyColumns: 200 } } as never)
  expect((await ui.find({ type: 'Text', text: '◉' }))?.props.color).toBe('#f0645c')
  expect((await ui.find({ type: 'Text', text: '◎' }))?.props.color).toBe('#8f9bff')
  expect((await ui.find({ type: 'Text', text: '93%' }))?.props.color).toBe('#f0645c')
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  await ui.unmount()
})

for (const [five, week, rim] of [[30, 40, '#4fd1b55c'], [20, 80, '#f2b84b80'], [95, 10, '#f0645c99']] as const) {
  test(`the rim follows the tighter limit (${five}% / ${week}%)`, async ($, on) => {
    mock.clock(on)
    await seed($, on, five, week)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 200 } } as never)
    expect((await ui.drawn() as { props: { borderColor?: string } }).props.borderColor).toBe(rim)
    await ui.unmount()
  })
}

test('usage off: no halo mark, the rest still draws', { options: { usage: 'off' } }, async ($, on) => {
  mock.clock(on)
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 200 } } as never)
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'opus 5.5' })).toBeDefined()
  await ui.unmount()
})

// Background work runs on promise turns; a few hundred of them is plenty for it to finish.
const settle = async () => {
  for (let i = 0; i < 500; i++) await Promise.resolve()
}

test('an update that finds nothing new writes nothing', async ($, on) => {
  mock.clock(on)
  let writes: string[] = []
  on('state.set', ($, e, next) => {
    writes.push(e.key)
    return next(e)
  })
  await seed($, on)
  expect(writes.length).toBeGreaterThan(0)
  // The seed's model reports are recorded on the side; let them land first.
  await settle()

  // The same session start, the same requests: nothing changed, nothing written.
  writes = []
  await $.session.start({ source: 'startup', cwd: '/' } as never)
  for await (const _ of $.turn.step({ turnId: 't', index: 1, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)) void _
  for await (const _ of $.turn.step({ turnId: 't', index: 1, model: AGENTS[0]!.model, effort: AGENTS[0]!.effort, messageCount: 1, agentId: AGENTS[0]!.id } as never)) void _
  await settle()
  expect(writes).toEqual([])

  // A real change is still written.
  for await (const _ of $.turn.step({ turnId: 't', index: 2, model: 'claude-opus-5-5', effort: 'low', messageCount: 1 } as never)) void _
  await settle()
  expect(writes).toContain('efforts')
})

// Walks a drawn tree: every node, depth first.
type Node = { type: string; props: Record<string, unknown>; hover?: Record<string, unknown>; children?: (Node | string)[] }
const nodes = (n: Node | string): Node[] =>
  typeof n === 'string' ? [] : [n, ...(n.children ?? []).flatMap(nodes)]
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))
const agentsTable = (tree: Node) => nodes(tree).find(n => n.props.key === 'agents')

test('session model can be hidden; agents still show', { options: { sessionModel: 'hide' } }, async ($, on) => {
  mock.clock(on)
  await seed($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { bodyColumns: 400 } } as never)
    expect(await ui.find({ type: 'Text', text: 'opus 5.5' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Button' })).some(b => String(b.props.label).startsWith('Explore'))).toBe(true)
    await ui.unmount()
  }
})

const labelOf = async (ui: { findAll: (q: never) => Promise<{ props: Record<string, unknown> }[]> }, key: string) =>
  String((await ui.findAll({ type: 'Button' } as never)).find(b => b.props.key === key)?.props.label)

// Rows on screen in the agents table: the header plus each agent row drawn so far.
const tableRowCount = (tree: Node) => agentsTable(tree)?.children?.length ?? 0

test('clicking the agent count opens the table at once and fades it in; clicking again fades it out', async ($, on) => {
  const clock = mock.clock(on)
  await seed($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { bodyColumns: 80 } } as never)
    const tree = async () => (await ui.drawn()) as unknown as Node
    const firstRow = async () => agentsTable(await tree())!.children![1]! as Node
    expect(agentsTable(await tree())).toBeUndefined()
    // No hover styling anywhere: nothing turns gray under the pointer.
    expect(nodes(await tree()).some(n => n.hover !== undefined)).toBe(false)
    expect(await labelOf(ui as never, 'more:open')).toBe('8 agents\u2002▾')

    await ui.press({ key: 'more:open' })
    // The whole table is there at once (one height change), still faint.
    expect(tableRowCount(await tree())).toBe(1 + AGENTS.length)
    expect(await labelOf(ui as never, 'more:open')).toBe('8 agents\u2002▴')
    expect(nodes(await firstRow()).find(n => n.type === 'Text' && textOf(n) !== '●')?.props.dimColor).toBe(true)
    await clock.advance(60 * 2)
    // Fully faded in: names at full strength, dots at full color.
    expect(nodes(await firstRow()).find(n => n.type === 'Text' && textOf(n) !== '●')?.props.dimColor).toBe(false)
    expect(nodes(await firstRow()).find(n => n.type === 'Text' && textOf(n) === '●')?.props.color).toBe('#4fd1b5')
    const table = agentsTable(await tree())!
    expect(textOf(table.children![0]!)).toContain('Effort')
    expect(textOf(table.children![1]!)).toContain('haiku 4.5')
    expect(textOf(table.children![1]!)).toContain('medium')

    // A second click closes the table after the fade out.
    await ui.press({ key: 'more:open' })
    await clock.advance(60)
    expect(agentsTable(await tree())).toBeDefined()
    await clock.advance(60 * 2)
    expect(agentsTable(await tree())).toBeUndefined()
    await ui.unmount()
  }
})

test('every agent chip opens the table, not just the count', async ($, on) => {
  const clock = mock.clock(on)
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 400 } } as never)
  await ui.press({ key: `${AGENTS[0]!.id}:open` })
  await clock.advance(60 * 3)
  expect(tableRowCount((await ui.drawn()) as unknown as Node)).toBe(1 + AGENTS.length)
  await ui.unmount()
})

test('agentTable: agents+session adds a row for this session', { options: { agentTable: 'agents+session' } }, async ($, on) => {
  const clock = mock.clock(on)
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 200 } } as never)
  await ui.press({ key: 'more:open' })
  await clock.advance(60 * 3)
  const table = agentsTable((await ui.drawn()) as unknown as Node)!
  expect(table.children!.length).toBe(2 + AGENTS.length)
  expect(textOf(table.children![1]!)).toContain('this session')
  expect(textOf(table.children![1]!)).toContain('opus 5.5')
  await ui.unmount()
})

test('agentTable: off leaves the chips as plain text', { options: { agentTable: 'off' } }, async ($, on) => {
  mock.clock(on)
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 80 } } as never)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await ui.unmount()
})

test('the table closes on its own once every agent has finished', async ($, on) => {
  const clock = mock.clock(on)
  let live = true
  await seed($, on, 62, 38, () => (live ? AGENTS.slice(0, 2) : []))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 80 } } as never)
  await ui.press({ key: (await ui.findAll({ type: 'Button' }))[0]!.props.key as string })
  await clock.advance(60 * 3)
  expect(tableRowCount((await ui.drawn()) as unknown as Node)).toBeGreaterThan(0)
  live = false
  await $.session.start({ source: 'startup', cwd: '/' } as never)
  live = true
  await $.session.start({ source: 'startup', cwd: '/' } as never)
  expect(agentsTable((await ui.drawn()) as unknown as Node)).toBeUndefined()
  await ui.unmount()
})

test('the agent count has no dot; each agent chip keeps its model-colored dot', async ($, on) => {
  mock.clock(on)
  await seed($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 120 } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  const count = nodes(tree).find(n => n.props.key === 'more')!
  expect(nodes(count).some(n => n.type === 'Text' && textOf(n) === '●')).toBe(false)
  const agentChip = nodes(tree).find(n => n.props.key === AGENTS[0]!.id)!
  expect(nodes(agentChip).find(n => n.type === 'Text' && textOf(n) === '●')?.props.color).toBe('#4fd1b5')
  await ui.unmount()
})

test('no two buttons sit side by side: the chevron lives in the count label or as text', async ($, on) => {
  mock.clock(on)
  await seed($, on, 62, 38, () => AGENTS.slice(0, 1))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 200 } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  // One agent, room to show it: its chip ends with a plain-text chevron.
  const chip = nodes(tree).find(n => n.props.key === AGENTS[0]!.id)!
  expect(nodes(chip).filter(n => n.type === 'Button').length).toBe(1)
  expect(nodes(chip).find(n => n.type === 'Text' && textOf(n) === '▾')).toBeDefined()
  await ui.unmount()
})

test('desktop text is measured narrower: one agent shows in full where the grid count alone would fold it', () => {
  // The screenshot that prompted this: ~93 columns, one agent, reset times showing.
  const chip = (key: string, text: string, dim: string, full: string, glyph?: string): Chip => ({ key, color: '#fff', text, dim, full, glyph })
  const base = [chip('five_hour', '64%', '5h', '5h · 1h 36m'), chip('seven_day', '14%', 'week', 'week · 3d 10h')]
  const one = [chip('a1', 'general-purpose', 'haiku 5.5', 'haiku 5.5 · low', '●')]
  const date = 'شنبه ۲ آبان'
  const lead = 5 + 2 // the halo mark and the chevron
  expect(fit(93, base, one, date, lead).chips.at(-1)?.key).toBe('more') // counted as grid cells: folds
  const desktop = fit(93, base, one, date, lead, DESKTOP_TEXT)
  expect(desktop.chips.at(-1)?.key).toBe('a1') // measured as desktop text: the agent shows
  expect(desktop.compact).toBe(false)
  expect(desktop.date).toBe(date)
  // Still folds once the room is really gone.
  expect(fit(80, base, one, date, lead, DESKTOP_TEXT).chips.at(-1)?.key).toBe('more')
})

test('desktop counts the button padding: a chip that would only fit without it folds instead of wrapping', () => {
  const chip = (key: string, text: string, dim: string, full: string, glyph?: string, pad?: number): Chip => ({ key, color: '#fff', text, dim, full, glyph, pad })
  const base = [chip('five_hour', '75%', '5h', '5h · 0h 36m'), chip('seven_day', '16%', 'week', 'week · 3d 9h')]
  const two = ['a1', 'a2'].map(id => chip(id, 'general-purpose', 'haiku 5.5', 'haiku 5.5 · low', '●', 2))
  const date = 'شنبه ۲ آبان'
  // Without padding the first agent plus "+1 more" looks like it fits; with it, both fold.
  expect(fit(96, base, two.map(c => ({ ...c, pad: 0 })), date, 7, DESKTOP_TEXT, 0).chips.map(c => c.key)).toEqual(['five_hour', 'seven_day', 'a1', 'more'])
  expect(fit(96, base, two, date, 7, DESKTOP_TEXT, 2).chips.map(c => c.key)).toEqual(['five_hour', 'seven_day', 'more'])
})

test('agents waiting on background work, or idle, stay in the bar (faded); ended ones leave', async ($, on) => {
  const clock = mock.clock(on)
  const states = ['running', 'waiting', 'idle', 'completed', 'failed', 'killed']
  await seed($, on, 62, 38, () => AGENTS.slice(0, 6).map((a, i) => ({ ...a, status: states[i] })))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 400 } } as never)
  const tree = (await ui.drawn()) as unknown as Node
  const dotOf = (id: string) => nodes(nodes(tree).find(n => n.props.key === id)!).find(n => n.type === 'Text' && textOf(n) === '●')?.props.color
  expect(dotOf(AGENTS[0]!.id)).toBe('#4fd1b5') // running: full color
  expect(dotOf(AGENTS[1]!.id)).toBe('#4fd1b599') // waiting: faded
  expect(dotOf(AGENTS[2]!.id)).toBe('#4fd1b599') // idle: faded
  for (const ended of AGENTS.slice(3, 6)) expect(nodes(tree).find(n => n.props.key === ended.id)).toBeUndefined()
  expect((await ui.findAll({ type: 'Svg' }))[0]!.props.alt).toContain('3 agents running')
  // The table names each state that isn't plain running.
  await ui.press({ key: `${AGENTS[0]!.id}:open` })
  await clock.advance(60 * 3)
  const table = agentsTable((await ui.drawn()) as unknown as Node)!
  expect(textOf(table.children![1]!)).not.toContain('·')
  expect(textOf(table.children![2]!)).toContain('· waiting')
  // The table fades a waiting agent's dot just as the bar does.
  expect(nodes(table.children![2]! as Node).find(n => n.type === 'Text' && textOf(n) === '●')?.props.color).toBe('#4fd1b599')
  expect(nodes(table.children![1]! as Node).find(n => n.type === 'Text' && textOf(n) === '●')?.props.color).toBe('#4fd1b5')
  expect(textOf(table.children![3]!)).toContain('· idle')
  await ui.unmount()
})
