// A saved or received borehole setup -> a Setup the planner can trust, or null. Used by the app (device storage)
// and by the server (/api/setup), so bad data can neither crash the page nor reach the autopilot.
import { KC, type Setup, type Member } from './planner.ts'
import { DEMO_SETUP } from './weather.ts'

const NUMBERS = ['pumpKw', 'pumpM3h', 'outletM3h', 'efficiency', 'pvKwp', 'basinM3', 'quotaM3'] as const
const LANGS = ['ar', 'fr', 'en', 'ja']

export function parseSetup(x: unknown): Setup | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const numbersOk = NUMBERS.every(k => o[k] === undefined || (typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) > 0))
    && (o.basinStartM3 === undefined || (typeof o.basinStartM3 === 'number' && Number.isFinite(o.basinStartM3) && o.basinStartM3 >= 0))
    && (o.efficiency === undefined || (o.efficiency as number) <= 1)
    && (o.feeM3 === undefined || (typeof o.feeM3 === 'number' && o.feeM3 >= 0 && o.feeM3 <= 5))
  const members = o.members
  const membersOk = Array.isArray(members) && members.length > 0 && members.length <= 12 && members.every((m: Member) =>
    m && typeof m.name === 'string' && m.name.length <= 40 && Object.hasOwn(KC, m.crop) && typeof m.ha === 'number' && m.ha > 0 && m.ha <= 20
    && (m.phone === undefined || (typeof m.phone === 'string' && m.phone.length <= 30)) && (m.lang === undefined || LANGS.includes(m.lang)))
  // Families are told apart by name (messages, Telegram links), so two families cannot share one.
  const unique = membersOk && new Set((members as Member[]).map(m => m.name.trim())).size === (members as Member[]).length
  if (!numbersOk || !unique || (o.pv !== undefined && !['aucun', 'reseau', 'hybride', 'isole'].includes(o.pv as string))) return null
  const keep = Object.fromEntries(Object.entries(o).filter(([k]) => k in DEMO_SETUP && k !== 'cut'))
  return { ...DEMO_SETUP, ...keep, cut: DEMO_SETUP.cut } as Setup
}
