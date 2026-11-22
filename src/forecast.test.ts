// Self-check of the FAO-56 hourly ET0 and of the MET Norway path: node src/forecast.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { et0Hour, raHour, fromMet, tunisNow } from './forecast.ts'

// FAO-56 Example 19 (N'Diaye, Senegal, 1 Oct, 14:00-15:00): T 38 °C, RH 52 %, u2 3.3 m/s, Rs 2.450, Rso 2.658 -> 0.63 mm/h.
// The example's own altitude is 8 m; ours is 39 m, which moves gamma by 0.4 %: well inside the rounding of 0.63.
const day = et0Hour(38, 52, 3.3, 2.45, 2.45 / 2.658)
assert.ok(Math.abs(day - 0.63) < 0.02, `FAO-56 Example 19 day hour: ${day.toFixed(3)} mm`)
// Same example, 02:00-03:00: T 28 °C, RH 90 %, u2 1.9 m/s, dark, Rs/Rso 0.8 from before sunset -> 0.0 mm/h.
assert.ok(et0Hour(28, 90, 1.9, 0, 0.8) < 0.01, 'FAO-56 Example 19 night hour')

// Hourly Ra adds up to the daily Ra of FAO-56 Eq. 21 (Kebili, 21 Nov, J = 325).
const J = 325, phi = 33.705 * Math.PI / 180, dr = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365), dl = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39)
const ws = Math.acos(-Math.tan(phi) * Math.tan(dl))
const raDay = 24 * 60 / Math.PI * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dl) + Math.cos(phi) * Math.cos(dl) * Math.sin(ws))
const raSum = Array.from({ length: 24 }, (_, h) => raHour(J, h)).reduce((a, b) => a + b, 0)
assert.ok(Math.abs(raSum - raDay) / raDay < 0.02, `hourly Ra ${raSum.toFixed(2)} vs daily ${raDay.toFixed(2)} MJ/m²`)
assert.equal(raHour(J, 2), 0, 'no sun at 02:00')
// Solar noon in Kebili (9° E in the UTC+1 zone) falls after 12:00: the 12:00-13:00 hour gets the most sun.
const hours = Array.from({ length: 24 }, (_, h) => raHour(J, h))
assert.equal(hours.indexOf(Math.max(...hours)), 12)

// Real MET Norway forecast saved on 2026-11-21 at 19:00 Tunis: tomorrow's window is fully covered.
const met = JSON.parse(readFileSync(new URL('../test/fixtures/met-kebili.json', import.meta.url), 'utf8'))
const w = fromMet(met, '2026-11-22')
const sum = w.et0.reduce((a, b) => a + b, 0)
assert.ok(sum > 1.5 && sum < 5, `November ET0 ${sum.toFixed(2)} mm/day`)
assert.ok(w.rad[0] < w.rad[6] && w.rad[16] === 0, 'sun at noon, dark at 22:00')
assert.equal(w.et0.length, 24); assert.ok(!w.note.includes('past hours'), 'tomorrow needs no estimate')
assert.ok(fromMet(met, '2026-11-21').note.includes('past hours'), 'today before 19:00 is estimated and says so')
assert.deepEqual(tunisNow(new Date('2026-11-21T23:30:00Z')), { date: '2026-11-22', hour: 0, minute: 30 })
console.log(`ok: FAO-56 hourly ET0 (Example 19 = ${day.toFixed(2)} mm/h) · MET Norway tomorrow ET0 ${sum.toFixed(2)} mm/day, peak sun ${Math.max(...w.rad).toFixed(0)} W/m²`)
