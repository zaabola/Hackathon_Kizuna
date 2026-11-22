// Self-check of the Telegram bot against a fake Telegram, offline: node api/telegram.test.ts
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const here = process.cwd()
process.chdir(mkdtempSync(join(tmpdir(), 'nouba-tg-')))
process.env.TELEGRAM_BOT_TOKEN = 'test'
for (const k of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'TELEGRAM_SECRET']) delete process.env[k]
const sent: { chat_id: number; text: string }[] = []
let updates: unknown[] = []
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const method = String(url).split('/').pop(), body = JSON.parse(String(init.body ?? '{}'))
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }))
  if (method === 'sendMessage') { if (body.chat_id === 666) return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 }); sent.push(body); return ok({}) }
  if (method === 'getUpdates') { const u = updates.filter((x: any) => x.update_id >= body.offset); updates = []; return ok(u) }
  if (method === 'getMe') return ok({ username: 'nouba_test_bot' })
  throw new Error(`unexpected fetch ${url}`)
}) as typeof fetch

const { plan, nightOrder, fmtClock } = await import('../src/planner.ts')
const { toWeather, DEMO_SETUP } = await import('../src/weather.ts')
const { handleUpdate, pollTelegram, sendTelegram, linkedChats, joinToken, GET, POST } = await import('./telegram.ts')
const w = toWeather(JSON.parse(readFileSync(join(here, 'public/demo-canicule.json'), 'utf8')))
const setup = { ...DEMO_SETUP, members: nightOrder(DEMO_SETUP.members, w.date) }
const cur = { w, setup, plan: plan(w, setup) }
const getPlan = async () => cur as any
const turn = (name: string) => cur.plan.turns[setup.members.findIndex(m => m.name === name)]
const msg = (id: number, text: string) => ({ message: { chat: { id }, text } })

await handleUpdate(msg(42, `/start ${joinToken('Fatma')}`), getPlan)
assert.equal(linkedChats().Fatma, 42, 'QR f1 links the chat to Fatma')
assert.ok(sent.at(-1)!.text.includes(fmtClock(turn('Fatma').start)), 'answers at once with her turn')
await handleUpdate(msg(42, `/start ${joinToken('Hédi')}`), getPlan)
assert.ok(!linkedChats().Fatma && linkedChats()['Hédi'] === 42, 'one family per chat')
await handleUpdate(msg(42, 'why only 59 %?'), getPlan)
assert.ok(sent.at(-1)!.text.includes(fmtClock(turn('Hédi').start)), 'AI unavailable: the family gets its turn again')
await handleUpdate(msg(7, 'hello'), getPlan); await handleUpdate(msg(7, '/start invalidtoken9'), getPlan)
assert.ok(sent.slice(-2).every(x => x.text.includes('QR')) && !Object.values(linkedChats()).includes(7), 'strangers get help, no link')
updates = [{ update_id: 10, ...msg(50, `/start ${joinToken('Ali')}`) }]
await pollTelegram(getPlan)
assert.equal(linkedChats().Ali, 50, 'polling links new families')
assert.equal(JSON.parse(readFileSync('data/telegram.json', 'utf8')).offset, 11, 'offset moves past handled updates')
assert.deepEqual(await sendTelegram(666, 'x'), { ok: false, error: 'Forbidden: bot was blocked by the user' })
assert.deepEqual(await (await GET()).json(), { ready: true, bot: 'nouba_test_bot', linked: ['Hédi', 'Ali'] })
assert.equal((await POST(new Request('http://x/api/telegram', { method: 'POST', body: JSON.stringify(msg(9, '/start f3')) }))).status, 403, 'webhook needs the secret')
console.log(`ok: Telegram bot (QR link, instant turn, questions, polling, webhook guard; ${sent.length} messages)`)
