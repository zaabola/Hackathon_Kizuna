// Self-check of the reservation endpoint on a throwaway data folder: node api/leads.test.ts
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.chdir(mkdtempSync(join(tmpdir(), 'nouba-leads-')))
process.env.SEND_PIN = '4321'
const { GET, POST } = await import('./leads.ts')
const post = async (b: unknown) => { const r = await POST(new Request('http://x/api/leads', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: await r.json() } }
const ok = { name: 'Mohamed Ben Salah', phone: '98 123 456', plan: 'pro', units: 2, region: 'Douz', consent: true }

assert.equal((await post({ ...ok, consent: false })).status, 400, 'consent required')
assert.equal((await post({ ...ok, phone: '12' })).status, 400, 'bad phone')
assert.equal((await post({ ...ok, plan: 'toString' })).status, 400, 'unknown plan')
assert.equal((await post({ ...ok, units: 0 })).status, 400, 'units')
assert.equal((await post({ ...ok, name: 'x' })).status, 400, 'name')
const a = await post(ok)
assert.equal(a.status, 200); assert.equal(a.json.count, 1); assert.equal(a.json.mrr, 30, '2 pumps x 15 TND')
const b = await post({ ...ok, name: 'Fatma', phone: '+216 52 000 111', plan: 'free', units: 1 })
assert.equal(b.json.mrr, 30)
const again = await post({ ...ok, units: 3 }) // same phone: replaces the first reservation
assert.equal(again.json.count, 2); assert.equal(again.json.mrr, 45)
const pub = await (await GET(new Request('http://x/api/leads'))).json()
assert.ok(!JSON.stringify(pub).includes('98123456') && pub.recent[0].name === 'Mohamed', 'public stats: first names, no phones')
const priv = await (await GET(new Request('http://x/api/leads', { headers: { 'x-pin': '4321' } }))).json()
assert.equal(priv.leads.length, 2); assert.ok(priv.leads.some((l: { phone: string }) => l.phone === '+21698123456'))
assert.equal((await GET(new Request('http://x/api/leads', { headers: { 'x-pin': 'nope' } }))).status, 401)
console.log(`ok: pilot reservations (count ${again.json.count}, ${again.json.mrr} TND/month at launch prices)`)
