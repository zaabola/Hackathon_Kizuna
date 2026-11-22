// Telegram bot: the free, instant channel (no SIM, no phone permission). A family scans its QR code
// (t.me/<bot>?start=f<k>), the bot links that chat to the family and answers at once with tonight's turn; the autopilot
// then sends every linked family its turn each evening. Anything else typed to the bot is answered by the AI writer
// from the day's plan, in the family's language.
//   GET  /api/telegram  -> { ready, bot, linked: [family names] }
//   POST /api/telegram  Telegram webhook (header X-Telegram-Bot-Api-Secret-Token = TELEGRAM_SECRET), on Vercel
// In `npm run dev`, vite.config.ts polls Telegram every 3 s instead, so no public URL is needed.
import { createHmac } from 'node:crypto'
import { fmtClock } from '../src/planner.ts'
import { TEMPLATES, pctOf } from '../src/messages.ts'
import { DEMO_SETUP } from '../src/weather.ts'
import { currentPlan } from './autopilot.ts'
import { POST as ask } from './ask.ts'
import { readStored } from './setup.ts'
import { load, save } from './_store.ts'

// shortcut: a family is linked by its name, so renaming a family unlinks it until it scans again; use member ids if families get renamed often.
type Links = { links: Record<string, number>; offset: number }
const EMPTY: Links = { links: {}, offset: 0 }
const token = () => process.env.TELEGRAM_BOT_TOKEN
export const tgReady = () => !!token()
export const linkedChats = () => load<Links>('telegram.json', EMPTY).links
// A family's QR code carries a token only the server can make: a guessed code cannot take over another family's link,
// and reordering the families does not move a printed code to someone else.
export const joinToken = (name: string) => createHmac('sha256', process.env.TELEGRAM_SECRET || process.env.SEND_PIN || 'nouba').update(name).digest('base64url').slice(0, 12)
const linkedText = (name: string) => `نوبة: تم ربط ${name}. ستصلك نوبة الماء هذا المساء.\nNOUBA: linked to ${name}; your water turn arrives this evening.`
const HELP = 'NOUBA: اطلب من مجمع التنمية الفلاحية رمز QR الخاص بعائلتك لتصلك نوبة الماء هنا.\nAsk your GDA for your family\'s QR code to get your water turn here.'

async function call(method: string, body: object = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  })
  const j = await r.json().catch(() => null)
  if (!j?.ok) throw new Error(j?.description ?? `telegram ${r.status}`)
  return j.result
}

let bot: string | null = null
export async function botName() {
  if (!bot && tgReady()) bot = (await call('getMe')).username as string
  return bot
}

export async function sendTelegram(chat: number, text: string): Promise<{ ok: boolean; error?: string }> {
  try { await call('sendMessage', { chat_id: chat, text }); return { ok: true } } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'telegram unreachable' }
  }
}

type Cur = Pick<Awaited<ReturnType<typeof currentPlan>>, 'setup' | 'plan' | 'w'>

// Tonight's turn for one family, in its language, from the live plan.
function turnOf(cur: Cur, name: string) {
  const k = cur.setup.members.findIndex(m => m.name === name)
  const t = cur.plan.turns[k]
  if (!t) return null
  const cut: [string, string] | null = cur.setup.cut ? [fmtClock(cur.setup.cut[0]), fmtClock(cur.setup.cut[1])] : null
  const lang = cur.setup.members[k].lang ?? 'ar'
  return { t, lang, cut, text: TEMPLATES[lang](t, pctOf(t), cut) }
}

// A question typed to the bot: the AI writer answers from the plan; if it is busy, the family gets its turn again.
async function answer(cur: Cur, name: string, question: string) {
  const x = turnOf(cur, name)
  if (!x) return HELP
  const plan = {
    date: cur.w.date, member: { name, crop: x.t.crop },
    turn: { start: fmtClock(x.t.start), end: fmtClock(x.t.end), m3: Math.round(x.t.allot), percentOfNeed: pctOf(x.t) },
    steg_cut: x.cut ? `${x.cut[0]}-${x.cut[1]}` : 'none', aquifer_quota_m3: cur.setup.quotaM3,
    why_percent: 'When water is short, every family gets the same percentage of its need.',
    during_cut: 'No grid pumping during the cut: the basin is filled before it and irrigation runs at night by gravity.',
    all_turns: cur.plan.turns.map(t => ({ name: t.name, start: fmtClock(t.start), end: fmtClock(t.end) })),
  }
  const r = await ask(new Request('http://x/api/ask', { method: 'POST', body: JSON.stringify({ lang: x.lang, plan, question: question.slice(0, 300) }) }))
  const j = await r.json().catch(() => null)
  return r.ok && typeof j?.text === 'string' ? j.text : x.text
}

export async function handleUpdate(u: unknown, getPlan: () => Promise<Cur> = currentPlan) {
  const m = (u as { message?: { chat?: { id?: unknown }; text?: unknown } })?.message
  const chat = m?.chat?.id, text = typeof m?.text === 'string' ? m.text.trim() : ''
  if (typeof chat !== 'number' || !text) return
  const st = { ...EMPTY, ...load<Links>('telegram.json', EMPTY) }
  const start = /^\/start(?:\s+([\w-]{12}))?$/.exec(text)
  if (start) {
    const member = start[1] === undefined ? undefined : (readStored()?.setup ?? DEMO_SETUP).members.find(m => joinToken(m.name) === start[1])
    if (!member) return sendTelegram(chat, HELP)
    // One family per chat: scanning another family's code moves the chat there.
    st.links = Object.fromEntries(Object.entries(st.links).filter(([, c]) => c !== chat))
    st.links[member.name] = chat
    save('telegram.json', { ...load<Links>('telegram.json', EMPTY), links: st.links })
    // No weather or STEG right now: the link still holds, and the family hears so instead of silence.
    const cur = await getPlan().catch(() => null)
    return sendTelegram(chat, (cur && turnOf(cur, member.name)?.text) ?? linkedText(member.name))
  }
  const name = Object.keys(st.links).find(n => st.links[n] === chat)
  if (!name) return sendTelegram(chat, HELP)
  const cur = await getPlan().catch(() => null)
  return sendTelegram(chat, cur ? await answer(cur, name, text) : linkedText(name))
}

// Development: fetch new messages instead of a webhook. One poll at a time; the offset is saved after each update.
let polling = false
export async function pollTelegram(getPlan: () => Promise<Cur> = currentPlan) {
  if (!tgReady() || polling) return
  polling = true
  try {
    const ups = await call('getUpdates', { offset: load<Links>('telegram.json', EMPTY).offset, timeout: 0, allowed_updates: ['message'] }) as { update_id: number }[]
    for (const u of ups) {
      await handleUpdate(u, getPlan).catch(() => {})
      save('telegram.json', { ...EMPTY, ...load<Links>('telegram.json', EMPTY), offset: u.update_id + 1 })
    }
  } finally { polling = false }
}

export async function GET() {
  if (!tgReady()) return Response.json({ ready: false, linked: [] })
  try { return Response.json({ ready: true, bot: await botName(), linked: Object.keys(linkedChats()) }) } catch {
    return Response.json({ ready: false, linked: [], error: 'Telegram refused the bot token' })
  }
}

export async function POST(req: Request) {
  // Without the secret anyone could post fake updates and link a stranger's chat to a family.
  const secret = process.env.TELEGRAM_SECRET
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) return Response.json({ error: 'forbidden' }, { status: 403 })
  try { await handleUpdate(await req.json()) } catch { /* Telegram retries non-200 forever: always answer 200 */ }
  return Response.json({ ok: true })
}
