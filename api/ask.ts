// Vercel function: POST /api/ask { lang, plan, question? } -> { text, provider }
// Writes the SMS a member receives (or answers their question) from the plan JSON only.
// Providers are tried in order; free tiers rate-limit (429/503), so a second provider keeps the demo alive.
// Blind-judged on 2026-11-21 (9 cases x 3 judges): Gemini 3.5 flash-lite best on Darija, Japanese and grounding;
// Groq gpt-oss-120b second, 5x faster (~0.7 s). gemini-3.5-flash / 3.8-flash were too slow (24-60 s).

const LANGS: Record<string, string> = {
  fr: 'French', ar: 'Modern Standard Arabic', darija: 'Tunisian Darija (Tunisian Arabic dialect) written in Arabic script',
  ja: 'Japanese written in kanji and kana (never romaji)', en: 'English',
}

const SYSTEM = `You are NOUBA, the assistant of a shared borehole in a Tunisian oasis (Kebili).
You receive the day's irrigation plan as JSON (times are local, volumes in m³) and write to one farmer.
Answer the question asked first, directly. Rules: every time, volume or name about the plan must come from the JSON, never invent them;
explain the power cut and the share only with the JSON fields during_cut and why_percent; never quote JSON field names;
you may explain general irrigation, water-saving and energy practice (for example why night irrigation loses less water to evaporation);
do not promise a turn swap or extra water (the GDA decides) and do not talk about guarantees; do not mention the date; plain text, no markdown;
an SMS is at most 300 characters; an answer is at most 500 characters.
Only if the question has nothing to do with farming, water or energy, say briefly that you only help with the water turn.`

type Provider = { name: string; key?: string; call: (key: string, user: string) => Promise<string> }

const PROVIDERS: Provider[] = [
  {
    name: 'gemini-3.5-flash-lite', key: process.env.GEMINI_API_KEY,
    async call(key, user) {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
        method: 'POST', signal: AbortSignal.timeout(8_000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'medium' } },
        }),
      })
      if (!r.ok) throw new Error(`gemini ${r.status}`)
      const c = (await r.json()).candidates?.[0]
      if (c?.finishReason !== 'STOP') throw new Error(`gemini ${c?.finishReason ?? 'empty'}`)
      return (c.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim()
    },
  },
  {
    name: 'groq/gpt-oss-120b', key: process.env.GROQ_API_KEY,
    async call(key, user) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(8_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b', reasoning_effort: 'low', max_completion_tokens: 2048,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        }),
      })
      if (!r.ok) throw new Error(`groq ${r.status}`)
      const c = (await r.json()).choices?.[0]
      if (c?.finish_reason !== 'stop') throw new Error(`groq ${c?.finish_reason ?? 'empty'}`)
      return (c.message?.content ?? '').trim()
    },
  },
]

const CLOCK = /\b\d{1,2}:\d{2}\b/g

// Rejects the failure modes the blind judges found: leaked JSON keys or placeholders, mistranslations of
// "gravity" (shrimp, locusts), Japanese turned into romaji, runaway length, and any clock time not in the plan.
export function acceptable(text: string, lang: string, isSms: boolean, planJson = '') {
  if (!text || text.length > (isSms ? 400 : 650)) return false
  if (planJson && (text.match(CLOCK) ?? []).some(t => !planJson.includes(t.padStart(5, '0')))) return false
  if (/[{}]|during_cut|why_percent|steg_cut|all_turns|percentOfNeed/.test(text)) return false
  if (/جمبري|جراد/.test(text)) return false
  if (lang === 'ja' && !/[぀-ヿ一-鿿]/.test(text)) return false
  return true
}

export async function POST(req: Request) {
  let body: { lang?: string; plan?: unknown; question?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'bad request' }, { status: 400 })
  const lang = Object.hasOwn(LANGS, body.lang ?? '') ? LANGS[body.lang!] : undefined
  const planJson = JSON.stringify(body.plan ?? null)
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 300) : ''
  if (!lang || planJson.length > 6000 || planJson === 'null') return Response.json({ error: 'bad request' }, { status: 400 })

  // The question goes before the plan: otherwise the model describes the plan and skips the question.
  const task = question
    ? `The farmer asks: """${question}"""\nAnswer that question directly, in ${lang}.`
    : `Write the SMS for this member in ${lang}: their water turn (start-end), volume, and one short line about the STEG cut if there is one.`
  const user = `${task}\n\nPLAN:\n${planJson}`

  const errors: string[] = []
  // Two passes over the providers: a 503/429 is often gone a second later.
  const t0 = Date.now()
  for (const p of [...PROVIDERS, ...PROVIDERS]) {
    if (Date.now() - t0 > 18_000) { errors.push('deadline'); break } // stay under Vercel's 30 s maxDuration
    if (!p.key) { errors.push(`${p.name} no key`); continue }
    try {
      const text = await p.call(p.key, user)
      if (acceptable(text, body.lang!, !question, planJson)) return Response.json({ text, provider: p.name })
      errors.push(`${p.name} rejected output`)
    } catch (e) { errors.push(e instanceof Error ? e.message : String(e)) }
  }
  return Response.json({ error: errors.join('; ') }, { status: 502 })
}
