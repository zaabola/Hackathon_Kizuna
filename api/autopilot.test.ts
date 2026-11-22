// Self-check of the autopilot's decisions and of the pump/valve command: node api/autopilot.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decide, pumpNow } from './autopilot.ts'
import { plan, nightOrder } from '../src/planner.ts'
import { toWeather, DEMO_SETUP } from '../src/weather.ts'

const base = { enabled: true, gateway: true, recipients: 5, date: '2026-11-22', key: 'A', nowW: 12, sendAtW: 11, firstTurnW: 15, sentFor: null, sentKey: null }
assert.equal(decide({ ...base, enabled: false }), 'off')
assert.equal(decide({ ...base, recipients: 0 }), 'no-phones')
assert.equal(decide({ ...base, gateway: false }), 'no-gateway')
assert.equal(decide({ ...base, nowW: 10 }), 'wait', 'before the send hour')
assert.equal(decide(base), 'send', 'send hour passed, nothing sent today')
assert.equal(decide({ ...base, sentFor: '2026-11-22', sentKey: 'A' }), 'done')
assert.equal(decide({ ...base, sentFor: '2026-11-22', sentKey: 'old' }), 'update', 'STEG changed the plan before the turns')
assert.equal(decide({ ...base, sentFor: '2026-11-22', sentKey: 'old', nowW: 16 }), 'done', 'too late to change tonight')
assert.equal(decide({ ...base, sentFor: '2026-11-21' }), 'send', 'a new day')

// Real heatwave day, STEG cut 12:00-17:00: the pump follows the plan hour by hour.
const w = toWeather(JSON.parse(readFileSync(new URL('../public/demo-canicule.json', import.meta.url), 'utf8')))
const s = { ...DEMO_SETUP, members: nightOrder(DEMO_SETUP.members, w.date) }
const p = plan(w, s)
const at = (hour: number, minute = 0) => pumpNow(p, s, { date: w.date, hour, minute })
assert.equal(at(14).pump.on, false); assert.match(at(14).pump.reason, /STEG cut/)
assert.equal(at(14).cut, true)
const sunny = p.hours.findIndex(h => h.solar > 1 && !h.cut)
assert.equal(pumpNow(p, s, { date: w.date, hour: p.hours[sunny].clock, minute: 0 }).pump.on, true)
// Valve: the first family's turn at its start time, closed in the afternoon.
const first = p.turns[0], [fh, fm] = [Math.floor(first.start), Math.round(first.start % 1 * 60)]
assert.equal(at(fh, fm).valve.open, true); assert.equal((at(fh, fm).valve as { family: string }).family, first.name)
assert.equal(at(15).valve.open, false)
assert.equal(at(5, 59).valve.open, true, 'last turn runs until 06:00')
console.log(`ok: autopilot decisions and pump/valve commands (14:00 ${at(14).pump.reason}; ${first.name} from ${first.start.toFixed(2)})`)
