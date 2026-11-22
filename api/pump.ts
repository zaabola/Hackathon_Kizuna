// Vercel function for the pump controller (an ESP32 or a Wi-Fi relay such as a Shelly polls it every minute):
//   GET /api/pump              -> { pump: { on, source, minutes, reason, next }, valve, basinM3, cut, at }
//   GET /api/pump?format=text  -> "ON" or "OFF", for the simplest relay firmware
import { currentPlan, pumpNow } from './autopilot.ts'
import { tunisNow } from '../src/forecast.ts'

export async function GET(req: Request) {
  try {
    const { plan, setup } = await currentPlan()
    const t = tunisNow(), now = pumpNow(plan, setup, t)
    if (new URL(req.url).searchParams.get('format') === 'text') return new Response(now.pump.on ? 'ON' : 'OFF', { headers: { 'content-type': 'text/plain' } })
    return Response.json({ at: `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} Tunis`, ...now })
  } catch (e) {
    // No plan = no reason to run the pump: a controller that cannot reach the plan stays safe.
    if (new URL(req.url).searchParams.get('format') === 'text') return new Response('OFF', { status: 503, headers: { 'content-type': 'text/plain' } })
    return Response.json({ error: e instanceof Error ? e.message : 'no plan' }, { status: 503 })
  }
}
