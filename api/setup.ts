// Vercel function: the borehole and families the autopilot works with (phones included, so everything needs the PIN).
//   GET  /api/setup  (header x-pin)              -> { setup, autopilot } or { setup: null }
//   POST /api/setup { pin, setup?, autopilot? }  -> saves; autopilot = { enabled, sendAt (hour 0-23) }
import type { Setup } from '../src/planner.ts'
import { parseSetup } from '../src/setup.ts'
import { checkPin } from './_pin.ts'
import { load, save } from './_store.ts'

export type Autopilot = { enabled: boolean; sendAt: number }
export type Stored = { setup: Setup; autopilot: Autopilot }
const hourOk = (h: unknown) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23

export function readStored(): Stored | null {
  const x = load<{ setup?: unknown; autopilot?: Partial<Autopilot> } | null>('setup.json', null)
  const setup = x && parseSetup(x.setup)
  if (!setup) return null
  return { setup, autopilot: { enabled: x.autopilot?.enabled !== false, sendAt: hourOk(x.autopilot?.sendAt) ? x.autopilot!.sendAt! : 17 } }
}

export async function GET(req: Request) {
  const denied = checkPin(req.headers.get('x-pin'))
  return denied ?? Response.json(readStored() ?? { setup: null })
}

export async function POST(req: Request) {
  let body: { pin?: unknown; setup?: unknown; autopilot?: Partial<Autopilot> }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'bad request' }, { status: 400 })
  const denied = checkPin(body.pin)
  if (denied) return denied
  const current = readStored()
  const setup = body.setup === undefined ? current?.setup : parseSetup(body.setup)
  if (!setup) return Response.json({ error: 'invalid setup' }, { status: 400 })
  const a = body.autopilot ?? {}
  if (a.enabled !== undefined && typeof a.enabled !== 'boolean') return Response.json({ error: 'invalid autopilot' }, { status: 400 })
  if (a.sendAt !== undefined && !hourOk(a.sendAt)) return Response.json({ error: 'invalid autopilot' }, { status: 400 })
  const { cut: _cut, ...keep } = setup
  const autopilot = { ...(current?.autopilot ?? { enabled: true, sendAt: 17 }), ...a }
  save('setup.json', { setup: keep, autopilot })
  return Response.json({ ok: true, autopilot })
}
