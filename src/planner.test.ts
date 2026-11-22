// Self-check: node src/planner.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { plan, surprise, inCut, kcAdjusted, KC, price, TARIFF, type Setup } from './planner.ts'
import { toWeather, DEMO_SETUP, FARM_SETUP } from './weather.ts'
import { value, forecast, SCENARIOS, BOX } from './pricing.ts'
import { parseSetup } from './setup.ts'

const days = ['public/demo-canicule.json', 'public/fallback-live.json'].map(f => toWeather(JSON.parse(readFileSync(f, 'utf8'))))
const pvs: Setup['pv'][] = ['aucun', 'reseau', 'hybride', 'isole']
const cuts: Setup['cut'][] = [null, [12, 17], [20, 2], [4, 8], [13, 13]]
// Review repros: pump-limited, outlet-limited, oversized farms, empty basin.
const extra: Partial<Setup>[] = [{}, { cut: [6, 20], basinStartM3: 0, quotaM3: 2000 }, { outletM3h: 20, quotaM3: 2000 },
  { members: DEMO_SETUP.members.map(m => ({ ...m, ha: m.ha * 4 })), quotaM3: 5000 }]

let n = 0
for (const w of days) for (const pv of pvs) for (const cut of cuts) for (const quotaM3 of [200, 500, 2000]) for (const x of extra) {
  const s = { ...DEMO_SETUP, pv, cut, quotaM3, ...x }
  const p = plan(w, s)
  const tag = `${w.date} pv=${pv} cut=${s.cut} quota=${s.quotaM3}`
  assert.ok(p.pumped <= s.quotaM3 + 1e-6, `quota exceeded ${tag}`)
  for (const h of p.hours) {
    assert.ok(h.level <= s.basinM3 + 1e-6 && h.level >= -1e-6, `basin bounds ${tag}`)
    if (h.cut) assert.equal(h.grid, 0, `grid pumping during cut ${tag}`)
    if (h.cut && pv === 'reseau') assert.equal(h.solar, 0, `grid-tied solar during cut ${tag}`)
    if (pv === 'isole') assert.equal(h.grid, 0, `standalone pump on grid ${tag}`)
    assert.ok(Number.isFinite(h.level) && Number.isFinite(h.irr), `NaN ${tag}`)
  }
  const shares = p.turns.reduce((a, t) => a + t.allot, 0)
  assert.ok(Math.abs(shares - p.allotted) < 1e-6, `shares sum ${tag}`)
  // Fair sharing: every member gets the same fraction of their need.
  const r = p.turns.map(t => t.allot / t.need)
  assert.ok(Math.max(...r) - Math.min(...r) < 1e-9, `unfair shares ${tag}`)
  assert.ok(Math.abs(shares - p.delivered) < 1e-6, `shares = delivered water ${tag}`)
  assert.ok(p.turns.every(t => t.allot < 1e-6 || t.end !== t.start), `zero-length turn hides a shortfall ${tag}`)
  assert.ok(p.delivered <= p.pumped + s.basinStartM3 + 1e-6, `water balance ${tag}`)
  assert.ok(Math.abs(p.pumped - p.hours.reduce((a, h) => a + h.solar + h.grid, 0)) < 1e-6, `pump total ${tag}`)
  for (const b of [p.baseline, p.paused]) assert.ok(b.delivered <= p.allotted + 1e-6 && b.delivered >= -1e-9, `baseline bounds ${tag}`)
  if (s.cut && s.cut[0] !== s.cut[1]) {
    const x = surprise(w, s, s.cut)
    assert.ok(x.delivered <= x.planned + 1e-6 && x.endLevel <= x.plannedEnd + 1e-6, `surprise can only lose ${tag}`)
  }
  n++
}

const [canicule, live] = days
// Demo day must be fully served: no deficit, and the fixed timetable loses turns to the cut.
const demo = plan(canicule, DEMO_SETUP)
assert.ok(demo.allotted - demo.delivered < 1, 'demo day delivers its allotment')
assert.ok(demo.baseline.lost > 0 && demo.baseline.losers.length > 0, 'fixed timetable loses turns to the cut')
assert.ok(Math.abs(demo.paused.delivered - demo.delivered) < 1 && demo.cost < demo.paused.cost, 'paused turn: same water, NOUBA cheaper')
assert.ok(inCut(23, [22, 2]) && inCut(1, [22, 2]) && !inCut(2, [22, 2]) && !inCut(13, [13, 13]), 'cut across midnight, empty cut')
// FAO-56 Eq. 62: standard climate leaves Kc unchanged; the dry windy heatwave raises it.
assert.ok(Math.abs(kcAdjusted('palmier', { ...canicule, u2: 2, rhMin: 45 }) - KC.palmier) < 1e-9, 'Kc standard climate')
assert.ok(kcAdjusted('palmier', canicule) > KC.palmier, 'Kc arid adjustment')
assert.equal(price(20), TARIFF.pointe); assert.equal(price(23), TARIFF.nuit); assert.equal(price(14), TARIFF.jour)
assert.ok(canicule.rad.slice(0, 1)[0] < canicule.rad[6], 'radiation slots aligned: 06h is dawn, 12h is midday')
assert.ok(live.et0.length === 24 && live.rad.length === 24, 'live slices')
// What the app tells a buyer: saving = paused rotation's bill minus NOUBA's, same water; peak kWh only in 19:00-22:00.
const worth = value(demo)
assert.ok(Math.abs(worth.tndPerDay - (demo.paused.cost - demo.cost)) < 1e-9 && worth.tndPerDay > 0, 'saving vs paused rotation')
assert.equal(demo.peakKwh, 0, 'NOUBA keeps the pump off the evening peak')
assert.ok(Math.abs(worth.peakKwAvoided - demo.paused.peakKwh / 3) < 1e-9, 'peak kW = peak kWh over 3 h')
for (const pv of pvs) { const q = plan(canicule, { ...DEMO_SETUP, pv }); assert.ok(value(q).tndPerDay >= 0 && q.peakKwh <= q.gridKwh + 1e-9, `value ${pv}`) }
const farm = plan(canicule, FARM_SETUP)
assert.ok(farm.pumped <= FARM_SETUP.quotaM3 + 1e-6 && farm.delivered > 0, 'single-farm preset plans')

console.log(`ok: ${n} scenarios | canicule ${canicule.date} need=${demo.need.toFixed(0)} m³ delivered=${demo.delivered.toFixed(0)} (${Math.round(demo.delivered / demo.need * 100)} %) cost=${demo.cost.toFixed(2)} TND | fixed running ${demo.baseline.delivered.toFixed(0)} m³ (${demo.baseline.losers}) | fixed paused ${demo.paused.delivered.toFixed(0)} m³ ${demo.paused.cost.toFixed(2)} TND`)
console.log(`ok: value | saves ${worth.tndPerDay.toFixed(2)} TND/day, ${worth.peakKwAvoided.toFixed(0)} kW off the evening peak | single farm ${farm.delivered.toFixed(0)}/${farm.need.toFixed(0)} m³, ${farm.cost.toFixed(2)} TND vs paused ${farm.paused.cost.toFixed(2)} TND`)

// Forecast: revenue is its parts, cash is cumulative profit, boxes are only net new wells and boreholes.
for (const sc of SCENARIOS) {
  let cash = 0, wells = 0
  for (const y of forecast(sc.scale)) {
    assert.ok(Math.abs(y.revenue - y.subs - y.licences - y.hardware) < 1e-6 && Math.abs(y.hardware - y.boxes * BOX.price) < 1e-6, `revenue parts ${sc.id}`)
    cash += y.profit; assert.ok(Math.abs(y.cash - cash) < 1e-6, `cash ${sc.id}`)
    assert.ok(y.boxes >= y.pro - wells, 'a box for every new well'); wells = y.pro
  }
}
assert.ok(worth.daysToPayYear(49)! > 25 && worth.daysToPayYear(49)! < 35, 'a GDA year is ~29 cut days of saving, not one month')
assert.equal(parseSetup({ ...DEMO_SETUP, feeM3: -1 }), null, 'negative water fee refused')
assert.equal(parseSetup({ ...DEMO_SETUP, feeM3: 0.2 })!.feeM3, 0.2, 'water fee kept')
const base = forecast(1)
console.log(`ok: forecast | base year 3 revenue ${Math.round(base[2].revenue / 1000)}k TND, profit ${Math.round(base[2].profit / 1000)}k | GDA year paid by ${worth.daysToPayYear(49)!.toFixed(0)} cut days`)
