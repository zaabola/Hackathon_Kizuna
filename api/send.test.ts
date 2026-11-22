// Self-check of the SMS endpoint's guards and of phone normalisation: node api/send.test.ts
// The upstream call goes to the real sms-gate.app with wrong credentials, so it must come back as a clean failure.
import assert from 'node:assert/strict'
import { toE164 } from '../src/phone.ts'

assert.equal(toE164('98 123 456'), '+21698123456')
assert.equal(toE164('+216 98-123-456'), '+21698123456')
assert.equal(toE164('0021698123456'), '+21698123456')
assert.equal(toE164('21698123456'), '+21698123456')
assert.equal(toE164('+33 6 12 34 56 78'), '+33612345678')
assert.equal(toE164('12ab'), null)
assert.equal(toE164('+216 0 98 123 456'), '+21698123456')
assert.equal(toE164('+216981234567'), null, '9 digits')
assert.equal(toE164('+2169812345'), null, '7 digits')
assert.equal(toE164('12 345 678'), null, 'no Tunisian number starts with 1')
assert.equal(toE164(''), null)

process.env.SMSGATE_USER = 'nouba-test-wrong'; process.env.SMSGATE_PASS = 'wrong'; process.env.SEND_PIN = '4321'
const { GET, POST } = await import('./send.ts')
const post = async (body: unknown) => {
  const r = await POST(new Request('http://x/api/send', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
  return { status: r.status, json: await r.json() }
}
assert.deepEqual(await (await GET(new Request('http://x/api/send'))).json(), { sms: true })
assert.equal((await post('null')).status, 400)
assert.equal((await post({ pin: '0000', messages: [{ to: '98123456', text: 'hi' }] })).status, 401, 'wrong PIN')
assert.equal((await post({ pin: '4321', messages: [] })).status, 400, 'empty list')
assert.equal((await post({ pin: '4321', messages: [{ to: '12', text: 'hi' }] })).status, 400, 'bad phone')
assert.equal((await post({ pin: '4321', messages: [{ to: '71 123 456', text: 'hi' }] })).status, 400, 'landline')
assert.equal((await post({ pin: '4321', messages: [{ to: '+1 900 555 0100', text: 'hi' }] })).status, 400, 'premium / foreign')
assert.equal((await post({ pin: '4321', messages: Array(31).fill({ to: '98123456', text: 'hi' }) })).status, 400, 'too many')
const real = await post({ pin: '4321', messages: [{ to: '98 123 456', text: 'NOUBA test' }] })
assert.equal(real.status, 200)
assert.equal(real.json.results[0].to, '+21698123456')
assert.equal(real.json.results[0].ok, false, 'wrong credentials must fail, not pretend')
// Brute force: after 5 wrong PINs even the right one waits a minute.
for (let i = 0; i < 5; i++) await post({ pin: `x${i}`, messages: [{ to: '98123456', text: 'hi' }] })
assert.equal((await post({ pin: '4321', messages: [{ to: '98123456', text: 'hi' }] })).status, 429, 'locked after 5 wrong PINs')
console.log(`ok: SMS endpoint guards (live gateway answered: ${real.json.results[0].error})`)
