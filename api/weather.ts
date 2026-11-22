// Vercel function: GET /api/weather?day=0|1 -> the live Kebili forecast for the window running now (0) or the next (1).
import { liveWeather } from '../src/forecast.ts'

export async function GET(req: Request) {
  const day = new URL(req.url).searchParams.get('day') === '1' ? 1 : 0
  try { return Response.json(await liveWeather(day)) } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'no live forecast' }, { status: 502 })
  }
}
