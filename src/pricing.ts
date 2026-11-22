// What NOUBA sells and what it is worth to the buyer, computed from the day's real plan (shared by the app and /api/leads).
import type { Plan } from './planner.ts'

export type PlanId = 'free' | 'pro' | 'gda' | 'partner'
export interface Offer { id: PlanId; name: string; price: number | null; unit: string; who: string; features: string[] }

// Launch prices (TND, excl. VAT): hypotheses to validate in the pilot.
export const OFFERS: Offer[] = [
  { id: 'free', name: 'Free', price: 0, unit: 'forever', who: 'Every farmer and GDA',
    features: ['Tonight\'s plan from the live forecast and STEG\'s notices', 'Pump and valve schedule on screen', 'One-tap WhatsApp message to every family'] },
  { id: 'pro', name: 'Well Pro', price: 15, unit: 'TND per well per month', who: 'Farmers with their own well',
    features: ['NOUBA Box on the pump (199 TND once): runs it around cuts and the sun', 'Pumping planned under the quota every day; a metered log for the 2026 well law from the pilot', 'Turn re-sent when STEG announces a cut, and a bot that answers'] },
  { id: 'gda', name: 'GDA', price: 49, unit: 'TND per borehole per month', who: 'Shared boreholes',
    features: ['Everything in Well Pro', 'Fair night turns and messages for up to 12 families', 'Water-fee ledger per family, printable schedule'] },
  { id: 'partner', name: 'Institutions', price: null, unit: 'licence or tender', who: 'CRDA, DGGREE, STEG, installers',
    features: ['Quota dashboard for a whole aquifer (from year 2)', 'Outage map from the boxes and a peak-shift pilot for STEG (roadmap)', 'White label for solar installers'] },
]
export const offer = (id: PlanId) => OFFERS.find(o => o.id === id)!

// The buyer's gain on this day versus today's practice (the fixed rotation, paused or running through the cut).
export function value(p: Plan) {
  const tndPerDay = Math.max(0, p.paused.cost - p.cost)
  const peakKwAvoided = Math.max(0, p.paused.peakKwh - p.peakKwh) / 3 // the evening peak lasts 3 hours
  return {
    tndPerDay,
    extraM3: Math.max(0, p.delivered - p.baseline.delivered),
    peakKwAvoided,
    mwPer1000: peakKwAvoided, // 1,000 pumps x kW = MW
    // Days like this one whose saving pays a full year of the plan: the honest payback, not a month of heatwaves.
    daysToPayYear: (monthly: number) => (tndPerDay > 0 ? monthly * 12 / tndPerDay : null),
  }
}

// The NOUBA Box: ESP32 + relay on the pump's existing contactor + current clamp. Parts at Tunisian shops (Nov 2026):
// ESP32 28.5 TND (didactico.tn), opto relay 7 TND and SCT-013 clamp 34 TND (souilah-electronique.tn).
export const BOX = { price: 199, parts: 28.5 + 7 + 34 }
// Worst-case channel: one SMS a night at WinSMS's 10,000-pack price (0.044 TND HT, winsms.tn). Telegram is free.
export const SMS_TND = 0.044

// Why this year: each fact opened at its source.
export const WHY_NOW = [
  { what: 'Law 18/2026 regularises unlicensed wells for 3,500 DT each and requires meters on pumped volumes plus a digital platform', src: 'AgriTunisie, Oct 2026', url: 'https://www.agritunisie.com/puits-agricoles-non-autorises-larp-adopte-leur-regularisation-contre-une-redevance-de-3-500-dinars/' },
  { what: 'Summer 2026 power cuts damaged irrigation pumps in Kebili oases', src: 'Kapitalis, 25 Jul 2026', url: 'https://kapitalis.com/tunisie/2026/07/25/tunisie-les-coupures-delectricite-affectent-la-filiere-des-dattes/' },
  { what: 'STEG wants 300 MW of demand shifted off the summer 2027 peak', src: "L'Économiste Maghrébin, 20 Nov 2026", url: 'https://www.leconomistemaghrebin.com/2026/11/20/apres-les-coupures-de-lete-2026-la-steg-veut-securiser-celui-de-2027/' },
  { what: 'JICA and Smart Tunisian Technoparks start a 2026–2028 startup programme in December', src: 'JICA Tunisia, Jul 2026', url: 'https://www.jica.go.jp/french/overseas/tunisia/information/press/2026/1583849_71737.html' },
]

// Verified counts: who could buy.
export const MARKET = [
  { n: '35,428', what: 'deep boreholes in Tunisia, 21,279 of them unlicensed', src: 'ONAGRI, national water report 2021', url: 'https://www.onagri.nat.tn//uploads/secteur-eau/RNE2021_VersionFianle_MarsF2023_ONAGRI.pdf' },
  { n: '9,252', what: 'unlicensed boreholes in Kebili alone, our first market', src: 'ONAGRI 2021', url: 'https://www.onagri.nat.tn//uploads/secteur-eau/RNE2021_VersionFianle_MarsF2023_ONAGRI.pdf' },
  { n: '1,358', what: 'GDAs running shared irrigation, by turns', src: 'ONAGRI 2021 (1,229 irrigation + 129 mixed)', url: 'https://www.onagri.nat.tn//uploads/secteur-eau/RNE2021_VersionFianle_MarsF2023_ONAGRI.pdf' },
  { n: '298,000 t', what: 'of dates from Kebili in 2025, the living of about 50,000 families', src: 'Webmanagercenter, Oct 2025', url: 'https://www.webmanagercenter.com/2025/10/24/554351/tunisie-une-recolte-exceptionnelle-de-dattes-a-kebili-pilier-du-secteur-agricole-national' },
  { n: '22 M', what: 'grid farm pumps in India, the same problem abroad', src: 'pv magazine India, 2022', url: 'http://www.pv-magazine-india.com/2022/01/21/solar-water-pumps-redefining-farmers-lives/' },
]

// 3-year forecast, sold through channels: installers fit boxes on wells, GDAs and CRDAs buy by tender.
// Counts are customers at each year's end; subscriptions are billed on the year's average. All are hypotheses.
export const GROWTH = [
  { year: 'Year 1 · Kebili pilot', pro: 300, gda: 20, crda: 0 },
  { year: 'Year 2 · the South', pro: 1500, gda: 60, crda: 1 },
  { year: 'Year 3 · Tunisia', pro: 4000, gda: 150, crda: 4 },
]
export const SCENARIOS = [{ id: 'prudent', name: 'Prudent', scale: 0.5 }, { id: 'base', name: 'Base', scale: 1 }, { id: 'bold', name: 'Ambitious', scale: 2 }] as const
export const CRDA_LICENCE = 24_000 // TND per governorate per year: the aquifer quota dashboard
export const COSTS = { team: [60_000, 180_000, 360_000], hosting: 6_000, supportPerWell: 12, installerShare: 0.2 }
// Subscription margin after the worst-case message channel (SMS) and support, per well and month.
export const MARGIN = 1 - (SMS_TND * 30 + COSTS.supportPerWell / 12) / 15

export function forecast(scale = 1) {
  let prev = { pro: 0, gda: 0, crda: 0 }, cash = 0
  return GROWTH.map((g, i) => {
    // A CRDA contract is whole: half of one is none, not one.
    const n = { pro: Math.round(g.pro * scale), gda: Math.round(g.gda * scale), crda: Math.floor(g.crda * scale) }
    const avg = (k: keyof typeof n) => (prev[k] + n[k]) / 2
    const boxes = Math.max(0, n.pro - prev.pro) + Math.max(0, n.gda - prev.gda)
    const subs = avg('pro') * offer('pro').price! * 12 + avg('gda') * offer('gda').price! * 12
    const licences = avg('crda') * CRDA_LICENCE
    const hardware = boxes * BOX.price
    const revenue = subs + licences + hardware
    // Installers sell, fit and support the box for a share of its price; messages go by Telegram or WhatsApp, free.
    const costs = COSTS.team[i] + COSTS.hosting + boxes * (BOX.parts + BOX.price * COSTS.installerShare) + (avg('pro') + avg('gda')) * COSTS.supportPerWell
    cash += revenue - costs
    prev = n
    return { year: g.year, ...n, boxes, subs, licences, hardware, revenue, costs, profit: revenue - costs, cash }
  })
}
