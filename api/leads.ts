// Vercel function: pilot reservations, the live traction counter shown during the pitch.
//   POST /api/leads { name, phone, plan, units, region, consent: true } -> { ok, count }
//   GET  /api/leads                -> { count, units, mrr, byPlan, recent }   no phone numbers, first names only
//   GET  /api/leads  (header x-pin)  -> everything, for the team to call people back
import { toE164 } from '../src/phone.ts'
import { OFFERS, type PlanId } from '../src/pricing.ts'
import { checkPin } from './_pin.ts'
import { load, save } from './_store.ts'

type Lead = { at: string; name: string; phone: string; plan: PlanId; units: number; region: string }
const PLANS = OFFERS.map(o => o.id)
// shortcut: in-memory per server instance, enough to stop a script flooding the counter during a demo.
let window0 = 0, inWindow = 0

const stats = (leads: Lead[]) => ({
  count: leads.length,
  units: leads.reduce((a, l) => a + l.units, 0),
  // Monthly revenue the reservations would bring at launch prices (free and partner reservations count 0).
  mrr: leads.reduce((a, l) => a + (OFFERS.find(o => o.id === l.plan)?.price ?? 0) * l.units, 0),
  byPlan: Object.fromEntries(PLANS.map(id => [id, leads.filter(l => l.plan === id).length])),
  recent: leads.slice(-6).reverse().map(l => ({ name: l.name.split(/\s+/)[0], region: l.region, plan: l.plan, at: l.at })),
})

export async function GET(req: Request) {
  const leads = load<Lead[]>('leads.json', [])
  const pin = req.headers.get('x-pin')
  if (pin) { const denied = checkPin(pin); return denied ?? Response.json({ ...stats(leads), leads }) }
  return Response.json(stats(leads))
}

export async function POST(req: Request) {
  if (Date.now() - window0 > 60_000) { window0 = Date.now(); inWindow = 0 }
  if (++inWindow > 60) return Response.json({ error: 'too many reservations this minute, try again' }, { status: 429 })
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return Response.json({ error: 'bad request' }, { status: 400 })
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : ''
  const region = typeof b.region === 'string' ? b.region.trim().slice(0, 40) : ''
  const phone = typeof b.phone === 'string' ? toE164(b.phone) : null
  const units = Number(b.units)
  if (name.length < 2 || name.length > 60) return Response.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!phone) return Response.json({ error: 'Please enter a valid phone number.' }, { status: 400 })
  if (!PLANS.includes(b.plan as PlanId)) return Response.json({ error: 'Please choose a plan.' }, { status: 400 })
  if (!Number.isInteger(units) || units < 1 || units > 500) return Response.json({ error: 'Number of pumps: 1 to 500.' }, { status: 400 })
  if (b.consent !== true) return Response.json({ error: 'Please accept to be contacted.' }, { status: 400 })
  const leads = load<Lead[]>('leads.json', [])
  // One reservation per phone: a second one replaces the first.
  const next = [...leads.filter(l => l.phone !== phone), { at: new Date().toISOString(), name, phone, plan: b.plan as PlanId, units, region }]
  save('leads.json', next)
  return Response.json({ ok: true, ...stats(next) })
}
