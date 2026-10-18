import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, RunningAgent } from '../types'

const limits = atom({ plugin: 'halo', key: 'limits' } as const, [])
const main = atom({ plugin: 'halo', key: 'main' } as const, '')
const agents = atom({ plugin: 'halo', key: 'agents' } as const, [])
const models = atom({ plugin: 'halo', key: 'models' } as const, {})
const efforts = atom({ plugin: 'halo', key: 'efforts' } as const, {})
const MAIN = 'main'

const WINDOWS = [
  { kind: 'five_hour', label: '5-hour', short: '5h', color: '#4fc796' },
  { kind: 'seven_day', label: 'Weekly', short: 'week', color: '#6b8cff' },
]
const MAIN_COLOR = '#e07a52'
const AGENT_COLOR = '#4fc796'

// claude-opus-5-5[1m] → opus 5.5, claude-haiku-4-5-20251001 → haiku 4.5
export const shortModel = (m: string) =>
  m.replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(/-(\d+)-(\d+)(-\d{8})?$/, ' $1.$2').replace(/-(\d{8})$/, '')

// ── dates ────────────────────────────────────────────────────────────────

// Gregorian → Jalali (the jalaali-js day-count algorithm)
export const toJalali = (gy: number, gm: number, gd: number): [number, number, number] => {
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
  const gy2 = gm > 2 ? gy + 1 : gy
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) + gd + before[gm - 1]!
  let jy = -1595 + 33 * Math.floor(days / 12053)
  days %= 12053
  jy += 4 * Math.floor(days / 1461)
  days %= 1461
  if (days > 365) {
    jy += Math.floor((days - 1) / 365)
    days = (days - 1) % 365
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30)
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30)
  return [jy, jm, jd]
}

const FA_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
const FA_DAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const faDigits = (n: number) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]!)

export const jalaliShort = (d: Date) => {
  const [, m, day] = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate())
  return `${FA_DAYS[d.getDay()]} ${faDigits(day)} ${FA_MONTHS[m - 1]}`
}

export const gregorianShort = (d: Date) => `${EN_DAYS[d.getDay()]} ${d.getDate()} ${EN_MONTHS[d.getMonth()]}`

export const resetsIn = (iso: string | undefined, now: number) => {
  const at = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(at)) return ''
  const min = Math.max(0, Math.round((at - now) / 60000))
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}

// ── layout ───────────────────────────────────────────────────────────────

// One chip of the bar: a colored mark (a ring when `pct` is set), a strong text and a dim one.
export type Chip = { key: string; color: string; text: string; dim: string; full: string; pct?: number }

const GAP = 3 // cells between chips
const FRAME = 4 // border + padding on both sides
const chipWidth = (c: Chip, compact: boolean) => 2 + c.text.length + ((compact ? c.dim : c.full) ? 1 + (compact ? c.dim : c.full).length : 0)

/**
 * Picks the richest bar that fits `cols` cells. It gives up, in order: the
 * agents beyond what fits (folded into a "+N" chip), the reset times and
 * efforts (compact), then the date. Anything left still too wide wraps.
 */
export const fit = (cols: number, base: Chip[], agentChips: Chip[], date: string) => {
  const more = (n: number): Chip[] => (n > 0 ? [{ key: 'more', color: AGENT_COLOR, text: `+${n}`, dim: 'agents', full: 'agents' }] : [])
  let last = { chips: base, compact: true, date: '' }
  for (const d of date ? [date, ''] : ['']) {
    for (const compact of [false, true]) {
      for (let k = agentChips.length; k >= 0; k--) {
        const chips = [...base, ...agentChips.slice(0, k), ...more(agentChips.length - k)]
        const width = FRAME + chips.reduce((n, c) => n + chipWidth(c, compact) + GAP, 0) + d.length
        last = { chips, compact, date: d }
        if (width <= cols) return last
      }
    }
  }
  return last
}

const ring = (pct: number, color: string) => {
  const C = 2 * Math.PI * 9
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3"/>
    <circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"
      stroke-dasharray="${(C * Math.min(Math.max(pct, 0), 100)) / 100} ${C}" transform="rotate(-90 12 12)"/>
  </svg>`
}

// ── state ────────────────────────────────────────────────────────────────

// The agent list carries no model or effort: turn.step reports both per
// request, kept by agentId (MAIN for the main loop) and pruned to who runs.
const refresh = async ($: EngineInterface) => {
  const list = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending')
  const live = new Set([MAIN, ...list.map(a => a.id)])
  const keep = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).filter(([id]) => live.has(id)))
  await update($, models, keep)
  await update($, efforts, keep)
  const m: Record<string, string> = await read($, models)
  const ef: Record<string, string> = await read($, efforts)
  const running: RunningAgent[] = list.map(a => ({ id: a.id, type: a.type, model: m[a.id] ?? '', effort: ef[a.id] ?? '' }))
  const mainModel = m[MAIN] ?? (await $.session.model())
  await update($, agents, () => running)
  await update($, main, () => mainModel)
}

const recordStep = async ($: EngineInterface, id: string, model: string, effort: string) => {
  const m: Record<string, string> = await read($, models)
  const ef: Record<string, string> = await read($, efforts)
  if (m[id] === model && (ef[id] ?? '') === effort) return
  await update($, models, x => ({ ...x, [id]: model }))
  await update($, efforts, x => ({ ...x, [id]: effort }))
  await refresh($)
}

// ── hooks ────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const usage = String(options.usage ?? 'both')
  const modelMode = String(options.models ?? 'model+effort')
  const dateMode = String(options.date ?? 'jalali')
  const withEffort = modelMode === 'model+effort'
  const windows = WINDOWS.filter(w =>
    usage === 'both' || (usage === '5h' && w.kind === 'five_hour') || (usage === 'weekly' && w.kind === 'seven_day'))

  on('session.start', async ($, e, next) => {
    const { rateLimits } = await $.session.usage()
    await update($, limits, () => rateLimits)
    await refresh($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = 'agentId' in r ? r.agentId : undefined
    if (id && 'model' in r && r.model) await update($, models, m => ({ ...m, [id]: r.model }))
    await refresh($)
    return r
  })

  // turn.step streams: record on the side, pass every chunk through untouched.
  on('turn.step', async function* ($, e, next) {
    // Best effort: a failed record (the session ending mid-step) must never touch the request.
    recordStep($, e.agentId ?? MAIN, e.model, e.effort === undefined ? '' : String(e.effort)).catch(() => {})
    return yield* next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  // AbovePrompt is the one band the mod API keeps pinned on screen.
  // ponytail: redraws on each measure/turn, so the countdown and the date can lag while idle; add a $.clock tick if that matters
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const now = await $.clock.now()
    const list: Limit[] = await read($, limits)
    const mainModel: string = modelMode === 'off' ? '' : await read($, main)
    const running: RunningAgent[] = modelMode === 'off' ? [] : await read($, agents)
    const mainEffort: string = withEffort ? (((await read($, efforts)) as Record<string, string>)[MAIN] ?? '') : ''
    const date = dateMode === 'gregorian' ? gregorianShort(new Date(now)) : dateMode === 'jalali' ? jalaliShort(new Date(now)) : ''

    const base: Chip[] = windows.map(w => {
      const l = list.find(x => x.kind === w.kind)
      const reset = l ? resetsIn(l.resetsAt, now) : ''
      const pct = l?.percentUsed ?? 0
      return { key: w.kind, color: w.color, pct, text: l ? `${Math.round(pct)}%` : '–', dim: w.short, full: reset ? `${w.short} · ${reset}` : w.short }
    })
    if (mainModel !== '') {
      const name = shortModel(mainModel)
      base.push({ key: MAIN, color: MAIN_COLOR, text: name, dim: '', full: withEffort ? mainEffort : '' })
    }
    const agentChips: Chip[] = running.map(a => {
      const model = a.model ? shortModel(a.model) : 'inherit'
      return { key: a.id, color: AGENT_COLOR, text: a.type, dim: model, full: [model, withEffort ? a.effort : ''].filter(Boolean).join(' · ') }
    })

    if (base.length === 0 && agentChips.length === 0 && date === '') return next(e)

    const cols = e.props.bodyColumns > 0 ? e.props.bodyColumns : 120
    const bar = fit(cols, base, agentChips, date)
    const hasSvg = 'Svg' in ui

    const mark = (c: Chip) => {
      if (c.pct !== undefined && 'Svg' in ui) {
        const { Svg } = ui
        return <Svg source={ring(c.pct, c.color)} alt={`${c.text} used`} width={14} height={14} />
      }
      return <Text color={c.color}>{c.key === MAIN ? '✳' : '●'}</Text>
    }

    return (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={GAP}
        {...(hasSvg ? { paddingX: 1, backgroundColor: '#ffffff0a', borderStyle: 'round', borderColor: '#ffffff14' } : {})}>
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" flexShrink={1} columnGap={GAP}>
          {bar.chips.map(c => {
            const dim = bar.compact ? c.dim : c.full
            return (
              <Box key={c.key} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
                {mark(c)}
                <Text wrap="truncate-end">{c.text}</Text>
                {dim !== '' && <Text dimColor wrap="truncate-end">{dim}</Text>}
              </Box>
            )
          })}
        </Box>
        {bar.date !== '' && (
          <Box flexShrink={0}>
            <Text dimColor>{bar.date}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
