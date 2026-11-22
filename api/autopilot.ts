// The autopilot. Every few minutes, with nobody pressing a button, it reads STEG's notices and the live forecast,
// replans the borehole, sends every family its turn (Telegram, else SMS) at the send hour, re-sends if STEG announces a new cut
// before the turns start, follows each SMS until delivered, and says what the pump and the valve must do now.
//   GET  /api/autopilot                                 -> live status (pump, valve, plan, STEG, weather, SMS, log)
//   POST /api/autopilot { pin, action: 'run' | 'send' }  -> run a check now / send tonight's messages now
import { plan as makePlan, nightOrder, fmtClock, windowTime, type Plan, type Setup } from '../src/planner.ts'
import { liveWeather, tunisNow } from '../src/forecast.ts'
import { TEMPLATES, UPDATE, pctOf } from '../src/messages.ts'
import { toE164 } from '../src/phone.ts'
import { DEMO_SETUP } from '../src/weather.ts'
import { stegNotices, noticeFor } from './steg.ts'
import { sendSms, smsStatus, gatewayReady, MOBILE_TN } from './send.ts'
import { readStored } from './setup.ts'
import { tgReady, linkedChats, sendTelegram, botName, joinToken } from './telegram.ts'
import { checkPin } from './_pin.ts'
import { load, save } from './_store.ts'

type Sent = { name: string; to: string; via?: 'telegram' | 'sms'; id?: string; state: string; error?: string; tries?: number }
type State = { sentFor: string | null; sentKey: string | null; sentAt: string | null; sent: Sent[]; lastRun: string | null; last: string; log: { at: string; msg: string }[] }
const EMPTY: State = { sentFor: null, sentKey: null, sentAt: null, sent: [], lastRun: null, last: '', log: [] }
const FINAL = ['Delivered', 'Failed']
export const EVERY_MIN = 5

// Tonight's plan from what is true right now: the saved borehole, STEG's notice for this window, the live forecast.
export async function currentPlan(now = new Date()) {
  const stored = readStored()
  const base = stored?.setup ?? DEMO_SETUP
  const [w, steg] = await Promise.all([liveWeather(0, now), stegNotices().catch(() => null)])
  const notice = steg ? noticeFor(steg.notices, w.date) : undefined
  const setup: Setup = { ...base, cut: notice ? [notice.start, notice.end % 24] : null, members: nightOrder(base.members, w.date) }
  return { w, steg, notice, setup, plan: makePlan(w, setup), autopilot: stored?.autopilot ?? { enabled: false, sendAt: 17 }, saved: !!stored }
}

// What the pump and the gravity valve must do at this minute. A relay polling /api/pump switches the real pump.
export function pumpNow(p: Plan, s: Setup, t = tunisNow()) {
  const i = windowTime(t.hour), h = p.hours[i], m3 = h.solar + h.grid
  const minutes = Math.min(60, Math.round(m3 / s.pumpM3h * 60))
  const on = t.minute < minutes
  const nowW = i + t.minute / 60
  const end = (x: number) => windowTime(x) || 24 // a turn ending at 06:00 ends the window
  const turn = p.turns.find(x => x.allot >= 1 && windowTime(x.start) <= nowW && nowW < end(x.end))
  const nextTurn = p.turns.find(x => x.allot >= 1 && windowTime(x.start) > nowW)
  const next = p.hours.findIndex((x, k) => k > i && x.solar + x.grid > 0.5)
  return {
    pump: {
      on, minutes, m3: Math.round(m3), source: !on ? null : h.solar > 0.5 && h.grid > 0.5 ? 'solar + grid' : h.solar >= h.grid ? 'solar' : 'grid',
      reason: on ? `${minutes} min planned this hour` : h.cut && m3 < 0.5 ? 'STEG cut: no grid pumping' : m3 < 0.5 ? 'no pumping planned this hour' : `this hour's ${minutes} min are done`,
      next: next >= 0 ? `${String(p.hours[next].clock).padStart(2, '0')}:00` : null,
    },
    valve: turn ? { open: true, family: turn.name, until: fmtClock(turn.end) } : { open: false, next: nextTurn ? `${nextTurn.name} at ${fmtClock(nextTurn.start)}` : null },
    basinM3: Math.round(h.level), cut: h.cut,
  }
}

// When to text the families. Hours are counted from 06:00 so a night crossing midnight stays in order.
export function decide(o: { enabled: boolean; gateway: boolean; recipients: number; date: string; key: string; nowW: number; sendAtW: number; firstTurnW: number | null; sentFor: string | null; sentKey: string | null }) {
  if (!o.enabled) return 'off'
  if (!o.recipients) return 'no-phones'
  if (!o.gateway) return 'no-gateway'
  if (o.sentFor !== o.date) return o.nowW >= o.sendAtW ? 'send' : 'wait'
  return o.key !== o.sentKey && o.firstTurnW !== null && o.nowW < o.firstTurnW ? 'update' : 'done'
}

// Telegram first (free, instant), else SMS to a Tunisian mobile when a gateway is set up.
function reach(setup: Setup, p: Plan) {
  const chats = tgReady() ? linkedChats() : {}
  return p.turns.flatMap((turn, k): { turn: Plan['turns'][number]; m: Setup['members'][number]; to: string; via: 'telegram' | 'sms' }[] => {
    const m = setup.members[k], phone = toE164(m?.phone ?? '')
    if (m && chats[m.name]) return [{ turn, m, to: String(chats[m.name]), via: 'telegram' }]
    if (m && phone && MOBILE_TN.test(phone) && gatewayReady()) return [{ turn, m, to: phone, via: 'sms' }]
    return []
  })
}

// The screen shows a plain reason, never the gateway's raw error.
const friendly = (e?: string) => !e ? undefined : /SEND_SMS|permission/i.test(e) ? 'the SMS phone may not send messages'
  : /blocked|chat not found|deactivated/i.test(e) ? 'the family left the Telegram chat' : 'not sent, retried at the next check'

// An update goes out only when STEG's cut changes: a forecast refresh that moves a turn by minutes is not worth a message.
const planKey = (s: Setup) => JSON.stringify(s.cut)

// One run at a time: the 5-minute tick, "Send now" and the cron queue up instead of sending twice.
let queue: Promise<unknown> = Promise.resolve()
export function runAutopilot(now = new Date(), force = false): Promise<State> {
  const run = queue.catch(() => {}).then(() => runOnce(now, force))
  queue = run
  return run
}

async function runOnce(now: Date, force: boolean) {
  const st = { ...EMPTY, ...load<State>('autopilot.json', EMPTY) }
  const log = (msg: string) => { st.log = [{ at: now.toISOString(), msg }, ...st.log].slice(0, 40) }
  let cur
  try { cur = await currentPlan(now) } catch (e) {
    log(`No plan: ${e instanceof Error ? e.message : e}`); st.lastRun = now.toISOString(); save('autopilot.json', st); return st
  }
  const { w, notice, setup, plan: p, autopilot } = cur
  // Follow the SMS already sent until the operator confirms delivery.
  for (const s of st.sent) {
    if (!s.id || s.via === 'telegram' || FINAL.includes(s.state)) continue
    const r = await smsStatus(s.id).catch(() => null)
    if (r && r.state !== s.state) { s.state = r.state; s.error = r.reason ?? undefined; log(`SMS to ${s.name}: ${r.state}${r.reason ? ` (${r.reason})` : ''}`) }
  }
  const t = tunisNow(now), nowW = windowTime(t.hour) + t.minute / 60
  const recipients = reach(setup, p)
  const first = p.turns.find(x => x.allot >= 1)
  const key = planKey(setup)
  let action = force ? (!recipients.length ? 'no-phones' : st.sentFor === w.date && st.sentKey !== key ? 'update' : 'send') : decide({
    enabled: autopilot.enabled, gateway: tgReady() || gatewayReady(), recipients: recipients.length, date: w.date, key,
    nowW, sendAtW: windowTime(autopilot.sendAt), firstTurnW: first ? windowTime(first.start) : null, sentFor: st.sentFor, sentKey: st.sentKey,
  })
  // STEG unreachable after the families were told: never re-send on a plan that lost tonight's cut.
  if (!cur.steg && st.sentFor === w.date && action === 'update') action = 'done'
  const cut: [string, string] | null = setup.cut ? [fmtClock(setup.cut[0]), fmtClock(setup.cut[1])] : null
  const deliver = async (list: typeof recipients, update: boolean): Promise<Sent[]> => {
    const text = (r: typeof recipients[number]) => (update ? UPDATE[r.m.lang ?? 'ar'] : '') + TEMPLATES[r.m.lang ?? 'ar'](r.turn, pctOf(r.turn), cut)
    const tg = list.filter(r => r.via === 'telegram'), sms = list.filter(r => r.via === 'sms')
    const [tgRes, smsRes] = await Promise.all([Promise.all(tg.map(r => sendTelegram(Number(r.to), text(r)))), sendSms(sms.map(r => ({ to: r.to, text: text(r) })))])
    return [
      ...tgRes.map((r, k) => ({ name: tg[k].turn.name, to: tg[k].to, via: 'telegram' as const, state: r.ok ? 'Delivered' : 'Failed', error: r.error })),
      ...smsRes.map((r, k) => ({ name: sms[k].turn.name, to: r.to, via: 'sms' as const, id: r.id, state: r.ok ? r.state ?? 'Pending' : 'Failed', error: r.error })),
    ]
  }
  // Families whose message failed get up to two more tries, at the next checks.
  const retry = action === 'done' ? recipients.filter(r => st.sent.some(x => x.name === r.turn.name && x.state === 'Failed' && (x.tries ?? 1) < 3)) : []
  if (retry.length) {
    const res = await deliver(retry, false)
    st.sent = st.sent.map(x => { const n = res.find(y => y.name === x.name); return n ? { ...n, tries: (x.tries ?? 1) + 1 } : x })
    log(`Retried ${retry.length} ${retry.length > 1 ? 'families' : 'family'}: ${res.filter(x => x.state !== 'Failed').length} sent`)
  }
  if ((action === 'send' || action === 'update') && recipients.length) {
    st.sent = await deliver(recipients, action === 'update')
    const ok = st.sent.filter(x => x.state !== 'Failed').length
    // Nothing went out: leave the day open so the next check tries again.
    if (ok) { st.sentFor = w.date; st.sentKey = key; st.sentAt = now.toISOString() }
    log(`${action === 'update' ? 'STEG changed the plan: update' : "Tonight's turns"} sent to ${ok} of ${st.sent.length} families${ok < st.sent.length ? ', the others are retried at the next check' : ''}`)
  }
  const summary = `${w.date} · weather ${w.source} · STEG ${notice ? `cut ${notice.window}` : 'no notice'} · ${action}`
  if (summary !== st.last) {
    st.last = summary
    log(`Checked: ${notice ? `STEG cut ${notice.window} applied` : 'no STEG notice for Kebili'}, forecast from ${w.source}, ${{
      off: 'autopilot off', 'no-phones': 'no family reachable yet', 'no-gateway': 'no message channel connected',
      wait: `SMS at ${String(autopilot.sendAt).padStart(2, '0')}:00`, done: 'families already informed', send: 'messages sent', update: 'update sent',
    }[action]}`)
  }
  st.lastRun = now.toISOString()
  save('autopilot.json', st)
  return st
}

export async function GET(req?: Request) {
  // QR tokens only for the GDA (PIN in the x-pin header): the public status shows who is linked, never how to link.
  const pin = req?.headers.get('x-pin')
  const authed = !!pin && !checkPin(pin)
  // Vercel Cron calls GET with "Authorization: Bearer <CRON_SECRET>": that call also runs the autopilot.
  const secret = process.env.CRON_SECRET
  if (secret && req?.headers.get('authorization') === `Bearer ${secret}`) await runAutopilot()
  try {
    const cur = await currentPlan()
    const st = { ...EMPTY, ...load<State>('autopilot.json', EMPTY) }
    const { w, steg, notice, setup, plan: p, autopilot, saved } = cur
    const reachable = reach(setup, p), base = (readStored()?.setup ?? DEMO_SETUP).members
    return Response.json({
      now: tunisNow(), saved, autopilot, gateway: tgReady() || gatewayReady(),
      channels: { telegram: tgReady(), bot: await botName().catch(() => null), sms: gatewayReady() },
      join: base.map(m => ({ name: m.name, start: authed ? joinToken(m.name) : null, linked: !!linkedChats()[m.name] })),
      weather: { date: w.date, source: w.source, note: w.note, maxC: Math.max(...w.temp), et0: w.et0.reduce((a, b) => a + b, 0) },
      steg: steg ? { checkedAt: steg.checkedAt, source: steg.source, notice: notice ?? null, latest: steg.notices[0] ?? null } : null,
      plan: { date: w.date, cut: setup.cut, need: Math.round(p.need), delivered: Math.round(p.delivered), warnings: p.warnings,
        turns: p.turns.map((x, k) => ({ name: x.name, start: fmtClock(x.start), end: fmtClock(x.end), m3: Math.round(x.allot), pct: pctOf(x), reach: reachable.find(r => r.turn === x)?.via ?? null })) },
      ...pumpNow(p, setup),
      sms: { sentFor: st.sentFor, sentAt: st.sentAt, sent: st.sent.map(({ name, via, state, error }) => ({ name, via, state, error: friendly(error) })) },
      lastRun: st.lastRun, everyMin: EVERY_MIN, log: st.log.slice(0, 12),
    })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'autopilot unavailable' }, { status: 502 })
  }
}

export async function POST(req: Request) {
  let body: { pin?: unknown; action?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'bad request' }, { status: 400 })
  const denied = checkPin(body.pin)
  if (denied) return denied
  if (body.action !== 'run' && body.action !== 'send') return Response.json({ error: 'action must be run or send' }, { status: 400 })
  const st = await runAutopilot(new Date(), body.action === 'send')
  return Response.json({ ok: true, lastRun: st.lastRun, log: st.log.slice(0, 5) })
}
