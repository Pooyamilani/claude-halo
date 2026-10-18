import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, RunningAgent } from '../types'

const limits = atom({ plugin: 'halo', key: 'limits' } as const, [])
const main = atom({ plugin: 'halo', key: 'main' } as const, '')
const agents = atom({ plugin: 'halo', key: 'agents' } as const, [])
const models = atom({ plugin: 'halo', key: 'models' } as const, {})
const efforts = atom({ plugin: 'halo', key: 'efforts' } as const, {})
const MAIN = 'main'

// ── palette ──────────────────────────────────────────────────────────────

// Each limit keeps its own calm color; past 75% and 90% both turn amber, then red.
// The ring, its number and the bar's rim always share one color, so nothing needs a legend.
const WINDOWS = [
  { kind: 'five_hour', label: '5-hour', short: '5h', calm: '#4fd1b5', glyph: '◉', radius: 9 },
  { kind: 'seven_day', label: 'Weekly', short: 'week', calm: '#8f9bff', glyph: '◎', radius: 15 },
]
const WARM = '#f2b84b'
const HOT = '#f0645c'
const MORE_COLOR = '#c4cad4'

export type Level = 'calm' | 'warm' | 'hot'
export const level = (pct: number): Level => (pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : 'calm')
const levelColor = (pct: number, calm: string) => ({ calm, warm: WARM, hot: HOT })[level(pct)]

// One color per model family, used by its chip's dot and its dot on the halo.
export const modelColor = (model: string) =>
  /opus/.test(model) ? '#e07a52' : /sonnet/.test(model) ? '#8f9bff' : /haiku/.test(model) ? '#4fd1b5' : MORE_COLOR

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

// One chip of the bar: an optional colored glyph, a strong text and a dim one
// (`full` while there is room, `dim` once the bar is compact).
export type Chip = { key: string; color: string; glyph?: string; textColor?: string; text: string; dim: string; full: string }

const GAP = 3 // cells between chips
const FRAME = 4 // border + padding on both sides
const MARK = 5 // the halo mark (desktop) and its gap
const chipWidth = (c: Chip, compact: boolean) => {
  const dim = compact ? c.dim : c.full
  return (c.glyph ? 2 : 0) + c.text.length + (dim ? 1 + dim.length : 0)
}

/**
 * Picks the richest bar that fits `cols` cells. It gives up, in order: the
 * agents beyond what fits (folded into a "+N" chip), the reset times and
 * efforts (compact), then the date. `lead` is the room something before the
 * chips takes (the halo mark). Anything left still too wide wraps.
 */
export const fit = (cols: number, base: Chip[], agentChips: Chip[], date: string, lead = 0) => {
  // "+2 more" beside the agents that fit; "3 agents" when none of them fit.
  const more = (n: number, shown: number): Chip[] => {
    if (n === 0) return []
    const dim = shown > 0 ? 'more' : n === 1 ? 'agent' : 'agents'
    return [{ key: 'more', color: MORE_COLOR, glyph: '●', text: shown > 0 ? `+${n}` : `${n}`, dim, full: dim }]
  }
  let last = { chips: base, compact: true, date: '' }
  for (const d of date ? [date, ''] : ['']) {
    for (const compact of [false, true]) {
      for (let k = agentChips.length; k >= 0; k--) {
        const chips = [...base, ...agentChips.slice(0, k), ...more(agentChips.length - k, k)]
        const width = FRAME + lead + chips.reduce((n, c) => n + chipWidth(c, compact) + GAP, 0) + d.length
        last = { chips, compact, date: d }
        if (width <= cols) return last
      }
    }
  }
  return last
}

// ── the halo mark ────────────────────────────────────────────────────────

export type MarkRing = { radius: number; pct: number; color: string; hasReading: boolean }

const MAX_DOTS = 8

/**
 * The halo: the weekly ring outside, the 5-hour ring inside, a soft glow on
 * each lit arc (stronger as a limit fills), and one dot per running agent
 * orbiting it in its model's color. While Claude works the glow breathes and
 * the dots turn slowly; idle, it stays still.
 */
export const haloMark = (rings: MarkRing[], dots: string[], isWorking: boolean) => {
  const arc = (r: MarkRing, extra: string) => {
    const C = 2 * Math.PI * r.radius
    const lit = (C * Math.min(Math.max(r.pct, 0), 100)) / 100
    return `<circle cx="23" cy="23" r="${r.radius}" fill="none" stroke="${r.color}" stroke-width="3.2" stroke-linecap="round"
      stroke-dasharray="${lit.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 23 23)"${extra}/>`
  }
  // Visible even when calm, brighter as a limit fills.
  const glowOpacity = (pct: number) => ({ calm: 0.6, warm: 0.8, hot: 1 })[level(pct)]
  const breathe = isWorking
    ? `<animate attributeName="opacity" values=".25;1;.25" dur="2.6s" repeatCount="indefinite"/>`
    : ''
  const spin = isWorking
    ? `<animateTransform attributeName="transform" type="rotate" from="0 23 23" to="360 23 23" dur="14s" repeatCount="indefinite"/>`
    : ''
  const shown = dots.slice(0, MAX_DOTS)
  const dot = (color: string, i: number) => {
    const a = (2 * Math.PI * i) / shown.length - Math.PI / 2
    return `<circle class="agent" cx="${(23 + 20.5 * Math.cos(a)).toFixed(2)}" cy="${(23 + 20.5 * Math.sin(a)).toFixed(2)}" r="2" fill="${color}"/>`
  }
  // The outer band holds the orbiting dots; with no agents the rings zoom in to fill the box.
  const viewBox = shown.length > 0 ? '0 0 46 46' : '4 4 38 38'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter></defs>
  ${rings.map(r => `<circle cx="23" cy="23" r="${r.radius}" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3.2"/>`).join('')}
  <g filter="url(#glow)">${rings.filter(r => r.hasReading).map(r => `<g opacity="${glowOpacity(r.pct)}">${arc(r, '')}</g>`).join('')}${breathe}</g>
  ${rings.filter(r => r.hasReading).map(r => arc(r, '')).join('')}
  <g>${shown.map(dot).join('')}${spin}</g>
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

    const readings = windows.map(w => {
      const l = list.find(x => x.kind === w.kind)
      const pct = l?.percentUsed ?? 0
      return { ...w, l, pct, color: levelColor(pct, w.calm), reset: l ? resetsIn(l.resetsAt, now) : '' }
    })
    // The terminal draws no SVG (its element table still lists the name), so ask the surface.
    const hasSvg = e.surface !== 'terminal' && 'Svg' in ui

    const base: Chip[] = readings.map(r => ({
      key: r.kind,
      color: r.color,
      // The halo mark carries the rings on desktop; the terminal gets a glyph per limit.
      glyph: hasSvg ? undefined : r.glyph,
      textColor: r.l ? r.color : undefined,
      text: r.l ? `${Math.round(r.pct)}%` : '–',
      dim: r.short,
      full: r.reset ? `${r.short} · ${r.reset}` : r.short,
    }))
    if (mainModel !== '') {
      base.push({ key: MAIN, color: modelColor(mainModel), glyph: '✳', text: shortModel(mainModel), dim: '', full: withEffort ? mainEffort : '' })
    }
    const agentChips: Chip[] = running.map(a => {
      const model = a.model ? shortModel(a.model) : 'inherit'
      const color = modelColor(a.model || mainModel)
      return { key: a.id, color, glyph: '●', text: a.type, dim: model, full: [model, withEffort ? a.effort : ''].filter(Boolean).join(' · ') }
    })

    if (base.length === 0 && agentChips.length === 0 && date === '') return next(e)

    const showMark = hasSvg && readings.length > 0
    const cols = e.props.bodyColumns > 0 ? e.props.bodyColumns : 120
    const bar = fit(cols, base, agentChips, date, showMark ? MARK : 0)

    // The rim always glows faintly: teal while calm (or before the first reading),
    // then the tighter limit's amber or red.
    const tight = readings.filter(r => r.l).sort((x, y) => y.pct - x.pct)[0]
    const rim = { calm: '#4fd1b55c', warm: `${WARM}80`, hot: `${HOT}99` }[tight ? level(tight.pct) : 'calm']

    const mark = () => {
      if (!showMark || !('Svg' in ui)) return null
      const { Svg } = ui
      const rings: MarkRing[] = readings.map(r => ({ radius: r.radius, pct: r.pct, color: r.color, hasReading: !!r.l }))
      const dots = running.map(a => modelColor(a.model || mainModel))
      const alt = [
        ...readings.map(r => (r.l ? `${r.label} ${Math.round(r.pct)}% used` : `${r.label} no reading yet`)),
        running.length ? `${running.length} agent${running.length === 1 ? '' : 's'} running` : '',
      ].filter(Boolean).join(', ')
      return (
        <Box key="halo" flexShrink={0}>
          <Svg source={haloMark(rings, dots, e.props.isWorking)} alt={alt} width={28} height={28} isInteractive={e.props.isWorking || undefined} />
        </Box>
      )
    }

    return (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={GAP}
        {...(hasSvg ? { paddingX: 1, backgroundColor: '#ffffff0a', borderStyle: 'round', borderColor: rim } : {})}>
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" flexShrink={1} columnGap={GAP}>
          {mark()}
          {bar.chips.map(c => {
            const dim = bar.compact ? c.dim : c.full
            return (
              <Box key={c.key} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
                {c.glyph !== undefined && <Text color={c.color}>{c.glyph}</Text>}
                <Text wrap="truncate-end" bold={c.textColor !== undefined} color={c.textColor}>{c.text}</Text>
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
