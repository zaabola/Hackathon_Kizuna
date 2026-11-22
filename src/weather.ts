import type { Setup, Weather } from './planner.ts'

export const KEBILI = { lat: 33.705, lon: 8.969 }
// Panels assumed tilted 30° facing south; wind in m/s for FAO-56.
export const QUERY = 'hourly=et0_fao_evapotranspiration,global_tilted_irradiance,temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m&tilt=30&azimuth=0&wind_speed_unit=ms&timezone=Africa%2FTunis'

interface OpenMeteo { hourly: Record<'time' | 'et0_fao_evapotranspiration' | 'global_tilted_irradiance' | 'temperature_2m' | 'precipitation' | 'relative_humidity_2m' | 'wind_speed_10m', (number | string)[]> }

// Open-Meteo hourly JSON (local time) -> 24 slots from 06:00 of day 1 + `day` (0 = first day, 1 = the next).
export function toWeather(j: OpenMeteo, day = 0): Weather & { date: string } {
  const h = j.hourly
  const at = (k: keyof OpenMeteo['hourly'], from: number) => h[k].slice(day * 24 + from, day * 24 + from + 24).map(v => Number(v ?? 0))
  // Radiation, ET0 and rain are totals or means over the preceding hour: the 06:00-07:00 slot is stamped 07:00.
  const wind10 = at('wind_speed_10m', 6)
  return {
    date: String(h.time[day * 24 + 6]).slice(0, 10),
    et0: at('et0_fao_evapotranspiration', 7), rad: at('global_tilted_irradiance', 7), temp: at('temperature_2m', 6),
    rainMm: at('precipitation', 7).reduce((a, b) => a + b, 0),
    rhMin: Math.min(...at('relative_humidity_2m', 6)),
    u2: wind10.reduce((a, b) => a + b, 0) / 24 * 4.87 / Math.log(67.8 * 10 - 5.42), // FAO-56 Eq. 47, 10 m -> 2 m
  }
}

export type Mode = 'canicule' | 'today' | 'tomorrow'

export async function loadWeather(mode: Mode) {
  if (mode === 'canicule') return toWeather(await (await fetch('/demo-canicule.json')).json())
  const r = await fetch(`/api/weather?day=${mode === 'tomorrow' ? 1 : 0}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? 'no live forecast')
  return j as Weather & { date: string; source: string; note: string }
}

// Demo borehole: every value here is an assumption shown as "hypothèse" in the UI.
// Pump 22 kW for 50 m³/h ≈ 100 m total head at 60 % efficiency (Complexe Terminal borehole).
export const DEMO_SETUP: Setup = {
  members: [
    { name: 'Ali', crop: 'palmier', ha: 1.5 },
    { name: 'Fatma', crop: 'palmier', ha: 1.2 },
    { name: 'Hédi', crop: 'olivier', ha: 0.8 },
    { name: 'Salma', crop: 'palmier', ha: 0.5 },
    { name: 'Coop. des jeunes', crop: 'palmier', ha: 1.0 },
  ],
  pumpM3h: 50, pumpKw: 22,
  pvKwp: 30, pv: 'reseau',
  basinM3: 600, basinStartM3: 250,
  quotaM3: 500,
  outletM3h: 60,
  cut: [12, 17],
  efficiency: 0.7,
  feeM3: 0.12, // GDA fees run 0.120-0.250 TND/m³ (Ministry of Agriculture, national water report 2020)
}

// The largest segment: one farmer, one borehole (7.5 kW lifts 20 m³/h from ~100 m), small hybrid solar, own basin.
export const FARM_SETUP: Setup = {
  members: [{ name: 'My farm', crop: 'palmier', ha: 1.5 }],
  pumpM3h: 20, pumpKw: 7.5,
  pvKwp: 10, pv: 'hybride',
  basinM3: 250, basinStartM3: 100,
  quotaM3: 250,
  outletM3h: 30,
  cut: [12, 17],
  efficiency: 0.7,
}
