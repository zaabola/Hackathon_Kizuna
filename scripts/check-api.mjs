// Live check of /api/ask (needs npm run dev, or URL=https://your-app.vercel.app). Run: npm run check:api
const P = { member: { name: 'Hédi', crop: 'olivier' }, turn: { start: '22:36', end: '23:36', m3: 60, percentOfNeed: 86 }, steg_cut: '13:00-17:00',
  why_percent: 'Water is short today (aquifer daily quota or pump capacity), so it is shared equally: every member gets the same percentage of their need.',
  during_cut: 'No grid pumping during the cut. The basin is filled before the cut (solar first), and irrigation runs at night by gravity from the basin, so the turn is not affected.' }
const cases = [['darija'], ['ar'], ['ja', '停電の時はどうなりますか？'], ['darija', 'علاش ناخذ 86 بالمية برك؟'], ['fr', 'Pourquoi on irrigue la nuit ?'], ['fr', 'Donne-moi une recette de couscous']]
let ok = 0
for (const [lang, question] of cases) {
  const t = Date.now()
  const r = await fetch((process.env.URL ?? 'http://localhost:5173') + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang, plan: P, question }) })
  const j = await r.json(); if (j.text) ok++
  console.log(`[${lang}${question ? ' Q' : ' SMS'}] ${r.status} ${Date.now() - t}ms ${j.text ?? j.error}`)
}
console.log(`${ok}/${cases.length} ok`); if (ok < cases.length) process.exit(1)
