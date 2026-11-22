// Live Kebili forecast for the server (autopilot, /api/weather): Open-Meteo first, MET Norway as a second real source.
// Open-Meteo hung from the demo network on 2026-11-21 while api.met.no answered, so NOUBA never falls back to stored data.
import type { Weather } from './planner.ts'
import { toWeather, KEBILI, QUERY } from './weather.ts'

export type Live = Weather & { date: string; source: string; note: string }

// --- FAO-56 hourly reference evapotranspiration (Allen et al. 1998, Eq. 53 and Eq. 28-33) -------------------------
const Z = 39 // m, elevation of MET's Kebili grid point
const GAMMA = 0.000665 * 101.3 * ((293 - 0.0065 * Z) / 293) ** 5.26
const es = (t: number) => 0.6108 * Math.exp(17.27 * t / (t + 237.3))

// Extraterrestrial radiation (MJ m-2) for the clock hour [hour, hour+1) local time (UTC+1) on day-of-year J.
export function raHour(J: number, hour: number, latDeg = KEBILI.lat, lonDeg = KEBILI.lon) {
  const phi = latDeg * Math.PI / 180
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365), delta = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39)
  const b = 2 * Math.PI * (J - 81) / 364, sc = 0.1645 * Math.sin(2 * b) - 0.1255 * Math.cos(b) - 0.025 * Math.sin(b)
  // FAO measures longitudes in degrees west of Greenwich; the UTC+1 zone is centred on 345°.
  const w = Math.PI / 12 * ((hour + 0.5 + 0.06667 * (345 - (360 - lonDeg)) + sc) - 12)
  const ws = Math.acos(-Math.tan(phi) * Math.tan(delta))
  const w1 = Math.max(-ws, w - Math.PI / 24), w2 = Math.min(ws, w + Math.PI / 24)
  if (w1 >= w2) return 0
  return 12 * 60 / Math.PI * 0.082 * dr * ((w2 - w1) * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * (Math.sin(w2) - Math.sin(w1)))
}

// One hour of ET0 (mm). rsRso = cloudiness ratio Rs/Rso (FAO: at night, the ratio from before sunset).
export function et0Hour(t: number, rh: number, u2: number, rs: number, rsRso: number) {
  const ea = es(t) * rh / 100, delta = 4098 * es(t) / (t + 237.3) ** 2
  const rnl = 2.043e-10 * (t + 273.16) ** 4 * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * rsRso - 0.35)
  const rn = 0.77 * rs - rnl, g = rs > 0 ? 0.1 * rn : 0.5 * rn
  return Math.max(0, (0.408 * delta * (rn - g) + GAMMA * 37 / (t + 273) * u2 * (es(t) - ea)) / (delta + GAMMA * (1 + 0.34 * u2)))
}

const dayOfYear = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`)) / 864e5) + 1
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
// Tunisia is UTC+1 all year (no daylight saving since 2009).
export const tunisNow = (now = new Date()) => {
  const d = new Date(now.getTime() + 3600_000)
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

interface MetPoint { time: string; data: { instant: { details: Record<string, number> }; next_1_hours?: { details: { precipitation_amount?: number } } } }

// MET Norway compact JSON -> 24 hourly slots from 06:00 of `date`. Hours already past (MET starts at "now") take the
// nearest forecast hour's air values; their sun is still computed from the sun's position.
export function fromMet(json: { properties: { timeseries: MetPoint[] } }, date: string): Live {
  const byHour = new Map<number, MetPoint>()
  for (const p of json.properties.timeseries) if (p.data.next_1_hours) byHour.set(Date.parse(p.time), p)
  const times = [...byHour.keys()]
  const et0: number[] = [], rad: number[] = [], temp: number[] = [], rh: number[] = [], wind: number[] = []
  let rain = 0, estimated = 0
  for (let i = 0; i < 24; i++) {
    const clock = (6 + i) % 24, day = i < 18 ? date : addDays(date, 1)
    const at = Date.parse(`${day}T${String(clock).padStart(2, '0')}:00:00Z`) - 3600_000 // local -> UTC
    let p = byHour.get(at)
    if (!p) { estimated++; p = byHour.get(times.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a)))! }
    const d = p.data.instant.details
    const t = d.air_temperature, h = d.relative_humidity, u2 = d.wind_speed * 4.87 / Math.log(67.8 * 10 - 5.42)
    const ra = raHour(dayOfYear(day), clock), rso = (0.75 + 2e-5 * Z) * ra
    const ratio = Math.min(1, Math.max(0.25, 1 - 0.75 * (d.cloud_area_fraction / 100) ** 3.4)) // Kasten & Czeplak
    const rs = rso * ratio
    et0.push(et0Hour(t, h, u2, rs, ratio)); rad.push(rs / 0.0036); temp.push(t); rh.push(h); wind.push(u2)
    rain += p.data.next_1_hours?.details.precipitation_amount ?? 0
  }
  return {
    date, source: 'MET Norway (api.met.no)', et0, rad, temp, rainMm: rain, rhMin: Math.min(...rh), u2: wind.reduce((a, b) => a + b, 0) / 24,
    note: `ET0 by FAO-56 Penman-Monteith from MET Norway's forecast; sunlight on horizontal panels from cloud cover${estimated ? `; ${estimated} past hours use the nearest forecast hour` : ''}`,
  }
}

const UA = { 'user-agent': 'NOUBA/1.0 (KIZUNA 2026 hackathon, Kebili irrigation planner)' }
const cache = new Map<number, { at: number; value: Live }>()

// The 06:00-06:00 window running now: before 06:00, last night's turns are still going, so it started yesterday.
export const windowDate = (now = new Date()) => { const t = tunisNow(now); return t.hour < 6 ? addDays(t.date, -1) : t.date }

// day 0 = the window running now, 1 = the next one.
export async function liveWeather(day: 0 | 1, now = new Date()): Promise<Live> {
  const date = addDays(windowDate(now), day)
  const hit = cache.get(day)
  if (hit && hit.value.date === date && now.getTime() - hit.at < 20 * 60_000) return hit.value
  let value: Live
  try {
    // past_days=1: the series starts yesterday 00:00, so the window index counts from there.
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${KEBILI.lat}&longitude=${KEBILI.lon}&${QUERY}&past_days=1&forecast_days=3`, { signal: AbortSignal.timeout(8_000) })
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`)
    const index = Math.round((Date.parse(date) - Date.parse(addDays(tunisNow(now).date, -1))) / 864e5)
    value = { ...toWeather(await r.json(), index), source: 'Open-Meteo', note: 'Hourly FAO-56 ET0 and sunlight on panels tilted 30° south' }
  } catch {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${KEBILI.lat}&lon=${KEBILI.lon}`, { headers: UA, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) throw new Error(`No live forecast: Open-Meteo unreachable, MET Norway ${r.status}`)
    value = fromMet(await r.json(), date)
  }
  cache.set(day, { at: now.getTime(), value })
  return value
}
