// Self-check on real STEG pages saved from steg.com.tn on 2026-11-21: node api/steg.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseNotice, southLinks, spokenHour } from './steg.ts'

const fx = (f: string) => readFileSync(new URL(`../test/fixtures/${f}`, import.meta.url), 'utf8')

// The six South notices published from 26 Aug to 3 Sep 2026, newest first, as STEG wrote them.
const expected = [
  { date: '2026-09-03', window: '13:00–17:00', start: 13, end: 17, block: 2, has: 'دوز' },
  { date: '2026-09-01', window: '13:00–18:00', start: 13, end: 18, block: null, has: 'قبلي' },
  { date: '2026-08-28', window: '21:00–24:00', start: 21, end: 24, block: null, has: 'جمنة' },
  { date: '2026-08-28', window: '09:00–18:00', start: 9, end: 18, block: null, has: 'راس العين' },
  { date: '2026-08-27', window: '09:30–18:00', start: 9, end: 18, block: null, has: 'جنعورة' },
  { date: '2026-08-26', window: '11:30–18:00', start: 11, end: 18, block: 2, has: 'النزلة' },
]
expected.forEach((e, i) => {
  const n = parseNotice(fx(`steg-south-${String(i).padStart(2, '0')}.html`))
  assert.ok(n, `notice ${i} parsed`)
  assert.equal(n.date, e.date, `date ${i}`)
  assert.equal(n.window, e.window, `window ${i}`)
  assert.equal(n.start, e.start); assert.equal(n.end, e.end)
  assert.equal(n.maxBlockHours, e.block, `max block ${i}`)
  assert.ok(n.intermittent, `intermittent ${i}`)
  assert.ok(n.localities.includes(e.has) && n.localities.length >= 7, `localities ${i}: ${n.localities}`)
})

// Listing pages 0-4: exactly those six South notices, the South-West ones excluded.
const links = [0, 1, 2, 3, 4].flatMap(p => southLinks(fx(`steg-news-p${p}.html`)))
assert.equal(links.length, 6)
assert.ok(links.every(l => l.url.startsWith('https://www.steg.com.tn/fr/news/') && /\d{2}\/\d{2}\/2026/.test(l.publishedAt)))
// A news item that is not a notice parses to nothing.
assert.equal(parseNotice('<html><body>nothing</body></html>'), null)

assert.equal(spokenHour('الثانية عشر ليلا'), 0)
assert.equal(spokenHour('الثانية بعد الزوال'), 14)
assert.equal(spokenHour('العاشرة ليلا'), 22)
console.log('ok: STEG notices (6 real Kebili notices, windows and localities)')

// Variants STEG could publish (from the adversarial review).
assert.equal(spokenHour('الثانية بعد منتصف الليل'), 2)
assert.equal(spokenHour('منتصف الليل'), 24)
assert.equal(spokenHour('الرابعة عصرا'), 16)
assert.equal(spokenHour('الثالثة إلا ربع بعد الزوال'), 14.75)
assert.equal(spokenHour('13h'), 13)
assert.equal(spokenHour('الساعة ١٧'), 17)
const base = fx('steg-south-00.html')
const swap = (a: string, b: string) => parseNotice(base.replaceAll(a, b))
assert.equal(swap('الخامسة مساءا', 'الرابعة عصرا')?.window, '13:00–16:00', 'afternoon "عصرا"')
assert.equal(swap('03 سبتمبر 2026', '٠٣ سبتمبر ٢٠٢٦')?.date, '2026-09-03', 'Eastern Arabic digits')
assert.equal(swap('بين الساعة الواحدة بعد الزوال و الساعة الخامسة مساءا', 'من الساعة الثامنة ليلا إلى الساعة الثانية بعد منتصف الليل')?.window, '20:00–02:00', 'cut across midnight')
assert.ok(swap('<table', '<table><tr><td colspan="6">المناطق المعنية</td></tr>'), 'title row above the header')
const extra = base.replace('</table>', '<tr><td></td><td></td><td><p>- extra</p></td><td></td><td></td><td></td></tr></table>')
assert.ok(parseNotice(extra)?.localities.includes('extra') && parseNotice(extra)?.localities.includes('دوز'), 'third row continues the same column')
console.log('ok: STEG wording variants')
