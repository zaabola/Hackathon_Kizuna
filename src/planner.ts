// NOUBA planner: one shared borehole, one storage basin, N members taking turns (nouba).
// Horizon = 24 hourly slots starting 06:00 (index i -> clock (6 + i) % 24).

export type Crop = 'palmier' | 'olivier' | 'tomate'
// reseau: grid-tied PV, stops with the grid (anti-islanding). hybride: PV inverter that keeps running in a cut,
// grid as backup. isole: standalone PV pump, no grid at all (most solar pumps in Kebili).
export type PvType = 'aucun' | 'reseau' | 'hybride' | 'isole'

export type SmsLang = 'ar' | 'fr' | 'en' | 'ja'
export interface Member { name: string; crop: Crop; ha: number; phone?: string; lang?: SmsLang }

export interface Weather {
  et0: number[]   // mm per hour, 24 values from 06:00
  rad: number[]   // W/m² on the tilted PV plane, 24 values
  temp: number[]  // °C, 24 values
  rainMm: number
  rhMin: number   // daily minimum relative humidity, %
  u2: number      // mean wind speed at 2 m, m/s
}

export interface Setup {
  members: Member[]
  pumpM3h: number
  pumpKw: number
  pvKwp: number
  pv: PvType
  basinM3: number
  basinStartM3: number
  quotaM3: number          // daily aquifer withdrawal cap
  outletM3h: number        // gravity outflow basin -> canals
  cut: [number, number] | null  // STEG cut, clock hours [start, end)
  efficiency: number       // overall efficiency, canals x field application (0..1)
  feeM3?: number           // GDA water fee, TND/m³ (not used by the planner: the fee ledger)
}

// FAO-56 Table 12, mid-season Kc for standard climate (RHmin 45 %, u2 2 m/s), and crop heights for Eq. 62.
export const KC: Record<Crop, number> = { palmier: 0.95, olivier: 0.7, tomate: 1.15 }
export const HEIGHT: Record<Crop, number> = { palmier: 8, olivier: 4, tomate: 0.6 }
// FAO-56 Eq. 62: dry, windy oasis air raises Kc mid; inputs clamped to the equation's validity range.
export const kcAdjusted = (crop: Crop, w: Weather) => {
  const u2 = Math.min(6, Math.max(1, w.u2)), rh = Math.min(80, Math.max(20, w.rhMin))
  return KC[crop] + (0.04 * (u2 - 2) - 0.004 * (rh - 45)) * (HEIGHT[crop] / 3) ** 0.3
}
// STEG low-voltage irrigation tariff, 3 time slots, excl. VAT, in force since 1 May 2022 (TND/kWh).
// shortcut: summer slot hours used all year, add the winter calendar if the demo moves out of summer.
export const TARIFF = { jour: 0.14, pointe: 0.391, nuit: 0.116 }
export const isPeak = (clock: number) => clock >= 19 && clock < 22
export const price = (clock: number) => (isPeak(clock) ? TARIFF.pointe : clock >= 22 || clock < 7 ? TARIFF.nuit : TARIFF.jour)
export const PV_PERFORMANCE = 0.8
// shortcut: on solar alone a borehole pump needs ~40 % of rated power to lift water; replace with the real pump curve.
export const solarOnlyFlow = (powerFrac: number) => Math.min(1, Math.max(0, (powerFrac - 0.4) / 0.6))
// Irrigate at night: clock 18:00 -> 06:00 = horizon slots 12..23.
export const NIGHT = { from: 12, to: 24 }

export const clockOf = (i: number) => (6 + i) % 24
// Hours since 06:00, so a night that crosses midnight stays in order (end at 06:00 = 24).
export const windowTime = (clock: number) => (clock - 6 + 24) % 24
// The night order rotates every day, so nobody always gets the 03:00 slot.
export const nightOrder = <T>(members: T[], date: string) => {
  const off = Number(date.slice(8, 10)) % members.length
  return [...members.slice(off), ...members.slice(0, off)]
}
export const inCut = (clock: number, cut: Setup['cut']) =>
  !!cut && cut[0] !== cut[1] && (cut[0] < cut[1] ? clock >= cut[0] && clock < cut[1] : clock >= cut[0] || clock < cut[1])

export interface Hour {
  clock: number
  solar: number   // m³ pumped on solar
  grid: number    // m³ pumped on grid
  irr: number     // m³ released to the fields
  level: number   // basin level at end of hour
  cut: boolean
  temp: number
  pvKw: number
}
export interface Turn { name: string; crop: Crop; need: number; allot: number; start: number; end: number }
export interface Baseline { delivered: number; lost: number; cost: number; gridKwh: number; solarKwh: number; peakKwh: number; losers: string[]; lostBy: number[]; end: number }
export interface Plan {
  hours: Hour[]
  turns: Turn[]
  need: number
  allotted: number
  pumped: number
  delivered: number
  solarKwh: number
  gridKwh: number
  cost: number
  endLevel: number
  peakKwh: number     // grid energy drawn during STEG's evening peak (19:00-22:00)
  warnings: string[]
  baseline: Baseline  // fixed turn, the clock keeps running during a cut
  paused: Baseline    // fixed turn, the water bailiff pauses the turn during a cut
}

export const memberNeed = (m: Member, w: Weather, eff: number) =>
  Math.max(0, w.et0.reduce((a, b) => a + b, 0) * kcAdjusted(m.crop, w) - w.rainMm) * 10 * m.ha / eff // 1 mm on 1 ha = 10 m³

// m³ the pump can lift in hour i, split by energy source.
function capacity(s: Setup, pvKw: number, clock: number) {
  const gridUp = s.pv !== 'isole' && !inCut(clock, s.cut)
  const f = pvKw / s.pumpKw
  if (gridUp) {
    const share = s.pv === 'aucun' ? 0 : Math.min(1, f) // grid tops up whatever the panels give
    return { solar: share * s.pumpM3h, grid: (1 - share) * s.pumpM3h }
  }
  const solarAlone = s.pv === 'hybride' || s.pv === 'isole'
  return { solar: solarAlone ? solarOnlyFlow(f) * s.pumpM3h : 0, grid: 0 }
}

export function simulate(s: Setup, pump: number[], sched: number[]) {
  let level = s.basinStartM3
  let spill = 0, delivered = 0
  const levels: number[] = [], irr: number[] = []
  for (let i = 0; i < 24; i++) {
    const out = Math.min(sched[i], level + pump[i])
    level += pump[i] - out
    if (level > s.basinM3) { spill = Math.max(spill, level - s.basinM3); level = s.basinM3 }
    levels.push(level); irr.push(out); delivered += out
  }
  return { levels, irr, spill, delivered }
}

export function plan(w: Weather, s: Setup): Plan {
  const warnings: string[] = []
  const needs = s.members.map(m => memberNeed(m, w, s.efficiency))
  const need = needs.reduce((a, b) => a + b, 0)
  const ratio = need > s.quotaM3 ? s.quotaM3 / need : 1
  let allots = needs.map(n => n * ratio)
  let allotted = allots.reduce((a, b) => a + b, 0)

  // Night release, members back to back, packed to end at 06:00 so pumping has the most time to fill the basin.
  const sched = Array(24).fill(0)
  let left = allotted
  for (let i = NIGHT.to - 1; i >= NIGHT.from && left > 1e-9; i--) { sched[i] = Math.min(s.outletM3h, left); left -= sched[i] }
  if (left > 1e-6) warnings.push(`Night window too short: ${Math.round(left)} m³ not scheduled (increase the outlet flow).`)

  // Per-hour energy availability -> pumping chunks priced per m³.
  const kwhPerM3 = s.pumpKw / s.pumpM3h
  const pvKw = w.rad.map(r => s.pv === 'aucun' ? 0 : s.pvKwp * r / 1000 * PV_PERFORMANCE)
  const chunks: { i: number; src: 'solar' | 'grid'; m3: number; cost: number }[] = []
  for (let i = 0; i < 24; i++) {
    const cap = capacity(s, pvKw[i], clockOf(i))
    if (cap.solar > 1e-9) chunks.push({ i, src: 'solar', m3: cap.solar, cost: 0 })
    if (cap.grid > 1e-9) chunks.push({ i, src: 'grid', m3: cap.grid, cost: price(clockOf(i)) * kwhPerM3 })
  }
  chunks.sort((a, b) => a.cost - b.cost || a.i - b.i)

  // Greedy: cheapest energy first, never above quota, never overflowing the basin.
  const target = Math.min(s.quotaM3, allotted - Math.max(0, left))
  const solar = Array(24).fill(0), grid = Array(24).fill(0)
  let pumped = 0
  for (const ch of chunks) {
    if (target - pumped <= 1e-9) break
    let amt = Math.min(ch.m3, target - pumped)
    const pump = solar.map((v, k) => v + grid[k])
    for (let tries = 0; tries < 8 && amt > 1e-9; tries++) {
      pump[ch.i] += amt
      const { spill } = simulate(s, pump, sched)
      pump[ch.i] -= amt
      if (spill <= 1e-9) break
      amt = Math.max(0, amt - spill)
    }
    if (amt <= 1e-9) continue
    ;(ch.src === 'solar' ? solar : grid)[ch.i] += amt
    pumped += amt
  }

  if (target - pumped > 1) warnings.push(`Pump limited by available energy (cut, sunlight, full basin): ${Math.round(target - pumped)} m³ not pumped.`)
  const sim = simulate(s, solar.map((v, k) => v + grid[k]), sched)
  const dry = sim.irr.findIndex((v, i) => sched[i] - v > 1e-6)
  if (dry >= 0) warnings.push(`Basin empty at ${String(clockOf(dry)).padStart(2, '0')}:00: fill more before the night.`)
  // Any shortfall is shared like the quota: every member gets the same % of their need.
  if (allotted - sim.delivered > 1e-6) {
    const r = sim.delivered / allotted
    allots = allots.map(a => a * r)
    allotted = sim.delivered
  }
  if (need - allotted > 1) {
    const quotaBound = ratio < 1 && Math.abs(allotted - s.quotaM3) < 1
    warnings.push(`${quotaBound ? 'Aquifer quota reached' : 'Water limited (energy, cut or basin)'}: every family gets ${Math.round(allotted / need * 100)} % of its need, in equal shares.`)
  }
  if (sim.levels[23] < s.basinStartM3 - 1) warnings.push(`The basin ends lower than it started (${Math.round(sim.levels[23])} m³): tomorrow's reserve is being used.`)

  const hours: Hour[] = sim.levels.map((level, i) => ({
    clock: clockOf(i), solar: solar[i], grid: grid[i], irr: sim.irr[i], level,
    cut: inCut(clockOf(i), s.cut), temp: w.temp[i], pvKw: pvKw[i],
  }))

  // Turns: members share the released water in order.
  let acc = 0
  const released = cumulative(sim.irr)
  const turns: Turn[] = s.members.map((m, k) => {
    const start = timeAt(released, acc); acc += allots[k]
    return { name: m.name, crop: m.crop, need: needs[k], allot: allots[k], start, end: timeAt(released, acc) }
  })

  const gridKwh = grid.reduce((a, b) => a + b, 0) * kwhPerM3
  const cost = grid.reduce((a, g, i) => a + g * kwhPerM3 * price(clockOf(i)), 0)
  const peakKwh = grid.reduce((a, g, i) => a + (isPeak(clockOf(i)) ? g * kwhPerM3 : 0), 0)

  return {
    hours, turns, need, allotted, pumped, delivered: sim.delivered,
    solarKwh: solar.reduce((a, b) => a + b, 0) * kwhPerM3, gridKwh, cost, peakKwh,
    endLevel: sim.levels[23], warnings, baseline: baseline(s, allots, pvKw, false), paused: baseline(s, allots, pvKw, true),
  }
}

// Unannounced cut: the plan was made without knowing it, then the cut happens. Pumping in those hours drops to
// what the panels alone can lift (hybrid/standalone) or to zero; the night release goes out from what the basin holds.
export function surprise(w: Weather, s: Setup, cut: [number, number]) {
  const blind = plan(w, { ...s, cut: null })
  const hit = { ...s, cut }
  const pump = blind.hours.map(h => {
    if (!inCut(h.clock, cut)) return h.solar + h.grid
    const cap = capacity(hit, h.pvKw, h.clock)
    return Math.min(h.solar + h.grid, cap.solar + cap.grid)
  })
  const sim = simulate(s, pump, blind.hours.map(h => h.irr))
  return {
    planned: blind.delivered, delivered: sim.delivered, lostPumping: blind.pumped - pump.reduce((a, b) => a + b, 0),
    plannedEnd: blind.endLevel, endLevel: sim.levels[23],
  }
}

// Usual practice (hypothesis): fixed tour d'eau from 08:00, same pump and panels, pumped straight to the fields,
// no basin. Running: the turn clock keeps going during a cut, so whoever's turn it is loses that water.
// Paused: the water bailiff stops the clock and the turn resumes after the cut (later, in the heat, on peak rates).
function baseline(s: Setup, allots: number[], pvKw: number[], paused: boolean): Baseline {
  const rem = [...allots], lostBy = allots.map(() => 0), kwhPerM3 = s.pumpKw / s.pumpM3h
  let k = 0, delivered = 0, cost = 0, gridKwh = 0, solarKwh = 0, peakKwh = 0, end = 8
  for (let i = 2; i < 24 && k < rem.length; i++) {
    const c = clockOf(i), cap = capacity(s, pvKw[i], c)
    const runFrac = Math.min(1, (cap.solar + cap.grid) / s.pumpM3h)
    if (paused && inCut(c, s.cut) && runFrac < 1) continue
    const solarShare = runFrac > 0 ? cap.solar / (cap.solar + cap.grid) : 0
    let slot = s.pumpM3h
    while (slot > 1e-9 && k < rem.length) {
      const m3 = Math.min(slot, rem[k])
      rem[k] -= m3; slot -= m3
      const got = m3 * runFrac
      delivered += got; lostBy[k] += m3 - got
      solarKwh += got * solarShare * kwhPerM3
      const g = got * (1 - solarShare) * kwhPerM3
      gridKwh += g; cost += g * price(c); if (isPeak(c)) peakKwh += g
      end = c + (s.pumpM3h - slot) / s.pumpM3h
      if (rem[k] <= 1e-9) k++
    }
  }
  rem.forEach((r, j) => { lostBy[j] += r })
  return {
    delivered, lost: lostBy.reduce((a, b) => a + b, 0), cost, gridKwh, solarKwh, peakKwh, end: end % 24,
    losers: s.members.filter((_, j) => lostBy[j] > 1).map(m => m.name), lostBy,
  }
}

const cumulative = (xs: number[]) => xs.reduce<number[]>((acc, x) => (acc.push((acc.at(-1) ?? 0) + x), acc), [])

// Clock time (decimal hours) when cumulative release reaches v.
function timeAt(cum: number[], v: number) {
  if (cum[23] < 1e-9) return 18
  for (let i = 0; i < 24; i++) {
    const before = i ? cum[i - 1] : 0
    if (cum[i] >= v - 1e-9 && cum[i] > before) return (6 + i + (v - before) / (cum[i] - before)) % 24
  }
  const last = cum.findIndex(c => c >= cum[23] - 1e-9)
  return (6 + last + 1) % 24
}

export const fmtClock = (h: number) => {
  const m = Math.round(h * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
