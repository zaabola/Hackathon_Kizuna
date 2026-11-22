// Vercel function: real SMS through "SMS Gateway for Android" (sms-gate.app, cloud mode): an Android phone with a
// Tunisian SIM sends the messages. Docs: https://docs.sms-gate.app/features/sending-messages/
//   GET  /api/send            -> { sms: boolean }          is a gateway configured?
//   GET  /api/send?id=<id>    -> { id, state, reason? }    delivery state: Pending, Processed, Sent, Delivered, Failed
//   POST /api/send { pin, messages: [{ to, text }] } -> { results: [{ to, ok, id?, state?, error? }] }
import { toE164 } from '../src/phone.ts'
import { checkPin } from './_pin.ts'

const GATE = 'https://api.sms-gate.app/3rdparty/v1/messages'
const MAX = 30
// Tunisian mobiles only: landlines never get the SMS, and the GDA's SIM must not pay for foreign or premium numbers.
export const MOBILE_TN = /^\+216[2459]\d{7}$/

const auth = () => {
  const { SMSGATE_USER: u, SMSGATE_PASS: p } = process.env
  return u && p ? `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` : null
}
export const gatewayReady = () => !!auth() && !!process.env.SEND_PIN

export type SmsResult = { to: string; ok: boolean; id?: string; state?: string; error?: string }

// Hands each message to the gateway phone. Numbers must already be valid Tunisian mobiles in E.164.
export async function sendSms(items: { to: string; text: string }[]): Promise<SmsResult[]> {
  const key = auth()
  if (!key) return items.map(({ to }) => ({ to, ok: false, error: 'SMS gateway not configured' }))
  return Promise.all(items.map(async ({ to, text }) => {
    try {
      const r = await fetch(GATE, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { authorization: key, 'content-type': 'application/json' },
        body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to], withDeliveryReport: true, ttl: 6 * 3600 }),
      })
      const j = (await r.json().catch(() => null)) ?? {}
      if (!r.ok) return { to, ok: false, error: String(j.message ?? j.error ?? `gateway ${r.status}`) }
      return { to, ok: true, id: typeof j.id === 'string' ? j.id : undefined, state: typeof j.state === 'string' ? j.state : 'Pending' }
    } catch {
      return { to, ok: false, error: 'gateway unreachable' }
    }
  }))
}

export async function smsStatus(id: string): Promise<{ state: string; reason: string | null }> {
  const key = auth()
  if (!key || !/^[\w-]{1,64}$/.test(id)) throw new Error('bad request')
  const r = await fetch(`${GATE}/${id}`, { headers: { authorization: key }, signal: AbortSignal.timeout(10_000) })
  const j = (await r.json().catch(() => null)) ?? {}
  if (!r.ok) throw new Error(`gateway ${r.status}`)
  const reason = j.reason ?? j.recipients?.[0]?.error
  return { state: typeof j.state === 'string' ? j.state : 'Unknown', reason: reason ? String(reason) : null }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ sms: gatewayReady() })
  try { return Response.json({ id, ...(await smsStatus(id)) }) } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'gateway unreachable' }, { status: e instanceof Error && e.message === 'bad request' ? 400 : 502 })
  }
}

export async function POST(req: Request) {
  if (!gatewayReady()) return Response.json({ error: 'SMS gateway not configured' }, { status: 503 })
  let body: { pin?: unknown; messages?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'bad request' }, { status: 400 })
  // The PIN stops anyone who finds the URL from texting through the GDA's SIM.
  const denied = checkPin(body.pin)
  if (denied) return denied
  const list = Array.isArray(body.messages) ? body.messages : []
  if (!list.length || list.length > MAX) return Response.json({ error: `1 to ${MAX} messages` }, { status: 400 })
  const items = list.map(m => ({
    to: m && typeof m.to === 'string' ? toE164(m.to) : null,
    text: m && typeof m.text === 'string' ? m.text.trim().slice(0, 1000) : '',
  }))
  if (items.some(m => !m.to || !MOBILE_TN.test(m.to) || !m.text)) return Response.json({ error: 'every message needs a Tunisian mobile number and a text' }, { status: 400 })
  return Response.json({ results: await sendSms(items as { to: string; text: string }[]) })
}
