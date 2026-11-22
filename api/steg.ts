// Vercel function: GET /api/steg -> the latest STEG load-shedding notices that list Kebili, read live from steg.com.tn.
// STEG has no feed: notices are news pages "إشعار بانقطاع الكهرباء - جهة الجنوب", whose table has a "قبلي" column.
// The cut hours are written in Arabic words ("بين الساعة الواحدة بعد الزوال و الساعة الخامسة مساءا").

const BASE = 'https://www.steg.com.tn'
const PAGES = 5 // the newest ~50 news items; notices are event-driven (summer 2026: 6 Aug to 3 Sep)

import { type Notice } from '../src/notices.ts'
export { noticeFor, type Notice } from '../src/notices.ts'

// Hamza-free spellings: text() folds أ/إ/آ to ا so "أوت" and "اوت" both match.
const MONTHS = ['جانفي', 'فيفري', 'مارس', 'افريل', 'ماي', 'جوان', 'جويلية', 'اوت', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر']
// Longest first: "الثانية عشر" must win over "الثانية".
const HOURS: [string, number][] = [['الحادية عشر', 11], ['الثانية عشر', 12], ['الواحدة', 1], ['الثانية', 2], ['الثالثة', 3], ['الرابعة', 4],
  ['الخامسة', 5], ['السادسة', 6], ['السابعة', 7], ['الثامنة', 8], ['التاسعة', 9], ['العاشرة', 10]]

// Plain text with the spellings STEG varies on folded: tags, entities, Eastern Arabic digits, hamza on alif.
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim()
const pad = (n: number) => String(n).padStart(2, '0')

// One spoken time ("التاسعة و نصف صباحا", "الثانية بعد منتصف الليل", "13h") -> decimal hours, 0..24.
export function spokenHour(raw: string): number | null {
  const s = text(raw)
  const hit = HOURS.find(([w]) => s.includes(w))
  if (!hit) {
    if (s.includes('منتصف الليل')) return 24
    if (s.includes('منتصف النهار')) return 12
    const m = s.match(/(\d{1,2})(?:\s*[:hH]\s*(\d{2})?)?/)
    if (!m) return null
    const h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0)
    return /بعد الزوال|بعد الظهر|مساء|عشية|عصر/.test(s) && h < 12 ? h + 12 : h
  }
  const q = /الا ربع/.test(s) ? -0.25 : s.includes('نصف') ? 0.5 : s.includes('ربع') ? 0.25 : s.includes('ثلث') ? 1 / 3 : 0
  let h = hit[1] + q
  if (s.includes('بعد منتصف الليل')) return h % 12 // "الثانية بعد منتصف الليل" = 02:00
  const pm = /بعد الزوال|بعد الظهر|مساء|عشية|عصر/.test(s) || (s.includes('ليلا') && hit[1] >= 6 && hit[1] < 12)
  if (pm && h < 12) h += 12
  if (s.includes('ليلا') && hit[1] === 12) h -= 12
  return h
}

// A notice page -> its Kebili cut, or null when Kebili is not in the table or the page is not a notice.
export function parseNotice(html: string, url = '', publishedAt = ''): Notice | null {
  const at = html.indexOf('field-name-body')
  if (at < 0) return null
  const body = html.slice(at)
  const t0 = body.indexOf('<table')
  if (t0 < 0) return null
  const table = body.slice(t0, body.indexOf('</table>', t0))
  // Row by row: the header row names the governorates, the rows under it list their localities.
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => m[1]))
  const r = rows.findIndex(cells => cells.some(c => text(c).includes('قبلي')))
  const k = r < 0 ? -1 : rows[r].findIndex(c => text(c).includes('قبلي'))
  if (k < 0 || !rows[r + 1]?.[k]) return null
  const localities = rows.slice(r + 1).map(row => row[k]).filter(Boolean)
    .flatMap(cell => [...cell.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1]).concat(/<p/.test(cell) ? [] : [cell]))
    .map(x => text(x).replace(/^-\s*/, '')).filter(Boolean)
  const intro = text(body.slice(0, t0))
  const d = intro.match(new RegExp(`(\\d{1,2}) (${MONTHS.join('|')}) (\\d{4})`))
  // Strict form first: "و" alone also appears inside a time ("التاسعة و نصف"), so only split on it as a last resort.
  const w = intro.match(/(?:بين|من) الساعة (.+?) (?:و ?|الى )الساعة (.+?)(?:،|,|$)/)
    ?? intro.match(/(?:بين|من) الساعة (.+?) (?:الى |و )(.+?)(?:،|,|$)/)
  const from = w ? spokenHour(w[1]) : null, to = w ? spokenHour(w[2]) : null
  if (!d || from === null || to === null) return null
  const fmt = (h: number) => `${pad(Math.floor(h) % 24)}:${pad(Math.round((h % 1) * 60))}`
  const block = intro.match(/لا تتجاوز (ساعتين|ساعة واحدة|ثلاث ساعات)/)
  return {
    url, publishedAt,
    date: `${d[3]}-${pad(MONTHS.indexOf(d[2]) + 1)}-${pad(Number(d[1]))}`,
    start: Math.floor(from), end: Math.ceil(to),
    window: `${fmt(from)}–${to === 24 ? '24:00' : fmt(to)}`,
    localities,
    intermittent: /متق[طّ]+عة/.test(intro),
    maxBlockHours: block ? { 'ساعتين': 2, 'ساعة واحدة': 1, 'ثلاث ساعات': 3 }[block[1]] ?? null : null,
  }
}

// A news listing page -> South-region power-cut notices (Kebili sits in "جهة الجنوب", not "الجنوب الغربي").
export function southLinks(html: string) {
  return [...html.matchAll(/<div class="date">([\s\S]*?)<\/div>[\s\S]*?<h4>([\s\S]*?)<\/h4>[\s\S]*?href="(\/fr\/news\/[^"]+)"/g)]
    .map(m => ({ publishedAt: text(m[1]), title: text(m[2]), url: BASE + m[3] }))
    .filter(x => x.title.includes('اشعار بانقطاع الكهرباء') && x.title.includes('جهة الجنوب') && !x.title.includes('الغربي'))
}

const get = async (url: string) => {
  const r = await fetch(url, { headers: { 'user-agent': 'NOUBA/1.0 (KIZUNA 2026 hackathon)' }, signal: AbortSignal.timeout(12_000) })
  if (!r.ok) throw new Error(`STEG ${r.status}`)
  return r.text()
}

export type Steg = { source: string; checkedAt: string; notices: Notice[] }
let cache: { at: number; body: Steg } | null = null


// The live Kebili notices, re-read from steg.com.tn at most every 10 minutes.
export async function stegNotices(): Promise<Steg> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.body
  // One unreadable page or notice must not hide the others.
  const pages = await Promise.all(Array.from({ length: PAGES }, (_, i) => get(`${BASE}/fr/news${i ? `?page=${i}` : ''}`).catch(() => null)))
  // Site down: keep the last notices rather than plan as if tonight's announced cut had vanished.
  if (pages.every(x => x === null)) { if (cache) return cache.body; throw new Error('steg.com.tn unreachable') }
  const links = pages.flatMap(p => (p ? southLinks(p) : [])).slice(0, 8)
  const notices = (await Promise.all(links.map(l => get(l.url).then(h => parseNotice(h, l.url, l.publishedAt)).catch(() => null))))
    .filter((x): x is Notice => !!x)
  const body = { source: `${BASE}/fr/news`, checkedAt: new Date().toISOString(), notices }
  cache = { at: Date.now(), body }
  return body
}

export async function GET() {
  try { return Response.json(await stegNotices()) } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'STEG unreachable' }, { status: 502 })
  }
}
