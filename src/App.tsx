import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { plan, surprise, fmtClock, nightOrder, type Crop, type Member, type Plan, type PvType, type SmsLang, type Setup, type Weather } from './planner.ts'
import { loadWeather, DEMO_SETUP, FARM_SETUP, type Mode } from './weather.ts'
import { toE164 } from './phone.ts'
import { noticeFor, type Notice } from './notices.ts'
import { TEMPLATES, SMS_LANGS, pctOf } from './messages.ts'
import { parseSetup } from './setup.ts'
import { OFFERS, MARKET, WHY_NOW, BOX, SMS_TND, COSTS, MARGIN, CRDA_LICENCE, SCENARIOS, offer, value, forecast, type PlanId } from './pricing.ts'
import QRCode from 'qrcode'

type Steg = { source: string; checkedAt: string; notices: Notice[] } | { error: string }
type Lang = 'en' | 'fr' | 'ar' | 'ja' | 'darija'
type Day = Weather & { date: string; source?: string; note?: string }
const r0 = (x: number) => Math.round(x).toLocaleString('en-US')
const hh = (c: number) => `${String(c).padStart(2, '0')}:00`
const vars = (o: Record<string, string | number>) => o as CSSProperties
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
// Solar kWh replace grid kWh: IFI harmonised grid emission factor for intermittent renewables, Tunisia (UNFCCC, 2019).
const CO2_KG_PER_KWH = 0.47
// The GDA's own borehole and families, saved on this device; the day's cut is not saved.
const STORE = 'nouba.setup.v1'
function loadSetup(): Setup {
  try {
    const x = parseSetup(JSON.parse(localStorage.getItem(STORE) ?? 'null'))
    if (x) return { ...x, cut: null }
  } catch { /* private mode or damaged data: start from the demo borehole */ }
  return { ...DEMO_SETUP, cut: null }
}

// Lucide-style stroke icons, inline so there is no icon dependency.
const PATHS = {
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  spark: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  close: 'M18 6 6 18M6 6l12 12',
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z',
  panel: 'M3 3h18v18H3zM8 14l3-3 2 2 3-4',
}
const Icon = ({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) =>
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Numbers glide to their new value (ease-out cubic), so a scenario change reads as a change.
function useTween(target: number, ms = 900) {
  const [v, setV] = useState(reduced() ? target : 0)
  const from = useRef(v)
  useEffect(() => {
    if (reduced()) { setV(target); return }
    const a = from.current, t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), x = a + (target - a) * (1 - (1 - k) ** 3)
      from.current = x; setV(x)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
const Num = ({ v, f = r0 }: { v: number; f?: (x: number) => string }) => <>{f(useTween(v))}</>

// Sections fade up once when they enter the viewport.
function useReveal(ready: boolean) {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)')
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0.15 })
    els.forEach(e => io.observe(e))
    return () => io.disconnect()
  }, [ready])
}

export default function App() {
  const [mode, setMode] = useState<Mode>('canicule')
  const [w, setW] = useState<Day | null>(null)
  const [s, setS] = useState<Setup>(loadSetup)
  const [steg, setSteg] = useState<Steg | null>(null)
  const touched = useRef(false) // the user picked a cut by hand: stop applying STEG notices
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)
  const [panel, setPanel] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const opener = useRef<HTMLButtonElement>(null)
  // One PIN (SEND_PIN on the server) unlocks sending, saving the families for the autopilot and driving it.
  const [pin, setPin] = useState(() => { try { return localStorage.getItem('nouba.pin') ?? '' } catch { return '' } })
  const [sync, setSync] = useState<'off' | 'saved' | 'wrong-pin' | 'locked' | 'error'>('off')
  const pulled = useRef(false)
  // A cut that starts and ends at the same hour is no cut.
  const set = (patch: Partial<Setup>) => setS(prev => {
    const n = { ...prev, ...patch }
    return n.cut && n.cut[0] === n.cut[1] ? { ...n, cut: null } : n
  })
  const pickCut = (cut: Setup['cut']) => { touched.current = true; set({ cut }) }
  // Members are edited by identity: the rotated view keeps the same objects as the saved list.
  const editMember = (m: Member, patch: Partial<Member>) => setS(prev => ({ ...prev, members: prev.members.map(x => (x === m ? { ...x, ...patch } : x)) }))
  const removeMember = (m: Member) => setS(prev => ({ ...prev, members: prev.members.filter(x => x !== m) }))
  const addMember = () => setS(prev => {
    let n = prev.members.length + 1
    while (prev.members.some(x => x.name === `Family ${n}`)) n++
    return { ...prev, members: [...prev.members, { name: `Family ${n}`, crop: 'palmier', ha: 1, phone: '' }] }
  })

  useEffect(() => {
    try { const { cut: _cut, ...keep } = s; localStorage.setItem(STORE, JSON.stringify(keep)) } catch { /* storage full or disabled */ }
  }, [s])
  // With the PIN, the autopilot's families (phones included) replace the ones on this device, then every change is saved back.
  useEffect(() => {
    try { localStorage.setItem('nouba.pin', pin) } catch { /* kept for this visit only */ }
    pulled.current = false
    if (!pin) { setSync('off'); return }
    // Checked once typing stops: every partial PIN would count as a wrong one and lock the GDA out for a minute.
    let live = true
    const t = setTimeout(() => fetch('/api/setup', { headers: { 'x-pin': pin } }).then(async r => {
      if (!live) return
      if (!r.ok) return setSync(r.status === 401 ? 'wrong-pin' : r.status === 429 ? 'locked' : 'error')
      const server = parseSetup((await r.json()).setup)
      if (!live) return
      // No families on the server yet: this device's families go up at once.
      setS(prev => server ? { ...server, cut: prev.cut } : { ...prev })
      pulled.current = true; setSync('saved')
    }).catch(() => { if (live) setSync('error') }), 900)
    return () => { live = false; clearTimeout(t) }
  }, [pin])
  useEffect(() => {
    if (!pin || !pulled.current) return
    const t = setTimeout(() => {
      fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin, setup: s }) })
        .then(r => setSync(r.ok ? 'saved' : r.status === 401 ? 'wrong-pin' : r.status === 429 ? 'locked' : 'error')).catch(() => setSync('error'))
    }, 800)
    return () => clearTimeout(t)
  }, [s, pin])
  useEffect(() => {
    fetch('/api/steg').then(r => r.json()).then(setSteg).catch(() => setSteg({ error: 'unreachable' }))
  }, [])
  useEffect(() => { touched.current = false }, [mode])
  // The day's cut comes directly from steg.com.tn for today's Tunis calendar date (or tomorrow); if STEG announced none, there is no cut unless entered manually.
  const todayTunis = new Date(Date.now() + 3600_000 + (mode === 'tomorrow' ? 864e5 : 0)).toISOString().slice(0, 10)
  const liveNotices = steg && 'notices' in steg ? steg.notices : null
  const latestCut = liveNotices?.[0]
  const stegCutToday = liveNotices ? noticeFor(liveNotices, todayTunis) : undefined
  const autoCut = (): Setup['cut'] => stegCutToday ? [stegCutToday.start, stegCutToday.end % 24] : null
  useEffect(() => { if (w && !touched.current) set({ cut: autoCut() }) }, [w, steg, mode])

  useEffect(() => {
    let live = true // a late answer for the previous mode must not overwrite this one
    setW(null); setFailed(false)
    loadWeather(mode).then(d => live && setW(d)).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [mode, reload])
  useEffect(() => {
    if (panel) document.querySelector<HTMLButtonElement>('.panel .close')?.focus()
    else opener.current?.focus({ preventScroll: true })
  }, [panel])
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(false)
    addEventListener('keydown', esc); return () => removeEventListener('keydown', esc)
  }, [])
  // The night order rotates every day, so nobody always gets the 03:00 slot.
  const view = useMemo(() => ({ ...s, members: w ? nightOrder(s.members, w.date) : s.members }), [s, w])
  const p = useMemo(() => (w ? plan(w, view) : null), [w, view])
  useReveal(!!p)
  const isDark = theme ? theme === 'dark' : typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches

  return (
    <div className="app">
      <header className="mobilebar" {...(panel ? { inert: '' } : {})}>
        <span className="brand-sm"><span className="mark" aria-hidden="true">絆</span> NOUBA</span>
        <button ref={opener} className="ghost-btn" aria-expanded={panel} aria-controls="panel" onClick={() => setPanel(true)}><Icon name="sliders" /> Settings</button>
      </header>

      <aside id="panel" className={`panel ${panel ? 'open' : ''}`} aria-label="Scenario settings" role={panel ? 'dialog' : undefined} aria-modal={panel || undefined}>
        <div className="panel-brand">
          <span className="mark lg" aria-hidden="true">絆</span>
          <div><p className="wordmark">NOUBA <span lang="ar">نوبة</span></p><p className="tagline">Every drop, every kilowatt, everyone takes a turn.</p></div>
          <button className="ghost-btn close" aria-label="Close settings" onClick={() => setPanel(false)}><Icon name="close" /></button>
        </div>

        <div className="group">
          <h3>1 · Borehole type <span>{plural(s.members.length, 'family', 'families')}</span></h3>
          <div className="seg dark" role="group" aria-label="Borehole type">
            <button aria-pressed={s.members.length > 1} onClick={() => { touched.current = false; setS({ ...DEMO_SETUP, cut: autoCut() }) }}>Shared GDA (5)</button>
            <button aria-pressed={s.members.length === 1} onClick={() => { touched.current = false; setS({ ...FARM_SETUP, cut: autoCut() }) }}>Single farm (1)</button>
          </div>
        </div>

        <div className="group">
          <h3>2 · Weather &amp; STEG cut</h3>
          <div className="seg dark" role="group" aria-label="Simulated day">
            <button aria-pressed={mode === 'canicule'} onClick={() => setMode('canicule')}>Heatwave 48 °C</button>
            <button aria-pressed={mode === 'today'} onClick={() => setMode('today')}>Today</button>
            <button aria-pressed={mode === 'tomorrow'} onClick={() => setMode('tomorrow')}>Tomorrow</button>
          </div>
          {w && <p className="meta">Kebili {mode === 'canicule' ? `${w.date} (archive)` : todayTunis} · max {Math.max(...w.temp).toLocaleString('en-US', { maximumFractionDigits: 1 })} °C · ET0 {w.et0.reduce((a, b) => a + b, 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} mm/day</p>}
          <p className="meta">{!steg ? 'Checking steg.com.tn news…' : 'error' in steg ? 'steg.com.tn unreachable: no cut applied.' : <>
            {stegCutToday ? <><b>STEG news:</b> cut announced {stegCutToday.window} for {todayTunis}.</> : <><b>STEG news:</b> no power cut announced for {todayTunis}.</>}
            {latestCut && <><br />Last cut: <b>{longDate(latestCut.date)} ({latestCut.window})</b><br />
              Source: <a className="panel-link" href={latestCut.url} target="_blank" rel="noopener noreferrer">STEG notice ({latestCut.date}) ↗</a> · <a className="panel-link" href={steg.source} target="_blank" rel="noopener noreferrer">steg.com.tn ↗</a></>}
          </>}</p>
          <label className="check"><input type="checkbox" checked={!!s.cut} onChange={e => pickCut(e.target.checked ? [12, 17] : null)} /> Manual power cut</label>
          {s.cut && <div className="hours">
            <label>from <input type="number" min={0} max={23} value={s.cut[0]} onChange={e => e.target.value !== '' && pickCut([clampH(e.target.value), s.cut![1]])} /> h</label>
            <label>to <input type="number" min={0} max={23} value={s.cut[1]} onChange={e => e.target.value !== '' && pickCut([s.cut![0], clampH(e.target.value)])} /> h</label>
          </div>}
        </div>

        <div className="group">
          <h3>3 · Pump energy <span>{s.pumpKw} kW · {s.pumpM3h} m³/h</span></h3>
          <div className="options grid2" role="radiogroup" aria-label="Pump energy">
            {([['reseau', 'Grid-tied solar', 'panel'], ['hybride', 'Hybrid solar', 'sun'], ['isole', 'Off-grid solar', 'sun'], ['aucun', 'STEG grid only', 'plug']] as [PvType, string, keyof typeof PATHS][]).map(([v, l, ic]) =>
              <label key={v} className="option"><input type="radio" name="pv" checked={s.pv === v} onChange={() => set({ pv: v })} /><Icon name={ic} /> {l}</label>)}
          </div>
          <p className="meta">{{
            aucun: 'Pump runs on the STEG grid only.',
            reseau: 'Grid-tied inverter: stops during a STEG cut (anti-islanding).',
            hybride: 'Hybrid inverter: keeps pumping on solar during a cut, with grid backup.',
            isole: 'Off-grid solar pump: never cut, zero bill, no night pumping.',
          }[s.pv]}</p>
          {s.pv !== 'aucun' && <Slider label="Solar power" unit="kWc" min={5} max={60} value={s.pvKwp} onChange={v => set({ pvKwp: v })} />}
          <Slider label="Daily water quota" unit="m³" min={100} max={1000} step={10} value={s.quotaM3} onChange={v => set({ quotaM3: v })} />
        </div>

        <details className="adv">
          <summary>Advanced borehole specs <span>{s.basinM3} m³ basin · {Math.round(s.efficiency * 100)}%</span></summary>
          <div className="adv-body">
            <Slider label="Basin capacity" unit="m³" min={100} max={1500} step={50} value={s.basinM3} onChange={v => set({ basinM3: v, basinStartM3: Math.min(s.basinStartM3, v) })} />
            <Slider label="Level at 06:00" unit="m³" min={0} max={s.basinM3} step={10} value={s.basinStartM3} onChange={v => set({ basinStartM3: v })} />
            <div className="fields">
              <Field label="Pump power" unit="kW" min={1} max={200} value={s.pumpKw} onChange={v => set({ pumpKw: v })} />
              <Field label="Pump flow" unit="m³/h" min={1} max={500} value={s.pumpM3h} onChange={v => set({ pumpM3h: v })} />
              <Field label="Basin outlet" unit="m³/h" min={5} max={500} value={s.outletM3h} onChange={v => set({ outletM3h: v })} />
              <Field label="Efficiency" unit="%" min={30} max={95} value={Math.round(s.efficiency * 100)} onChange={v => set({ efficiency: v / 100 })} />
              <Field label="Water fee" unit="mill/m³" min={0} max={5000} value={Math.round((s.feeM3 ?? 0) * 1000)} onChange={v => set({ feeM3: v / 1000 })} />
            </div>
            <p className="meta">Saved on this device only.</p>
          </div>
        </details>

        <div className="panel-foot">
          <span>KIZUNA 2026 · ESPRIT<br />Tunisia × Japan</span>
          <button className="ghost-btn round" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}><Icon name={isDark ? 'sun' : 'moon'} /></button>
        </div>
      </aside>
      {panel && <div className="scrim" onClick={() => setPanel(false)} aria-hidden="true" />}

      <main {...(panel ? { inert: '' } : {})}>
        <span className="thread" aria-hidden="true" />
        {!p || !w ? <section className="hero">{failed
          ? <p className="loading">Weather unavailable. <button className="primary" onClick={() => setReload(r => r + 1)}>Try again</button></p>
          : <p className="loading">Loading Kebili weather…</p>}</section> : <>
          <Hero p={p} s={view} w={w} />
          <Value p={p} s={view} />
          <Live pin={pin} setPin={setPin} sync={sync} />
          <DaySection p={p} s={view} w={w} checkDate={todayTunis} steg={steg} pick={pickCut} />
          <Night p={p} s={view} edit={editMember} remove={removeMember} add={addMember} />
          <Sms p={p} s={view} date={w.date} edit={editMember} pin={pin} setPin={setPin} />
          <Market />
          <PrintSheet p={p} s={view} date={w.date} />
        </>}
        <footer>
          <div className="seigaiha" aria-hidden="true" />
          <p><b>Sources.</b> Weather from Open-Meteo: the archive is the ERA5 reanalysis (~25 km grid), today is a forecast; hourly FAO-56 ET0 and irradiance on panels tilted 30° to the south.
            INM Kebili station: up to 48.1 °C during the 23–26 July 2026 heatwave (INM monthly climate bulletin, July 2026).
            STEG load shedding announced in Kebili governorate: 12:00–17:00 window, cuts of up to 2 h each (Le Temps, 3 Aug 2026); 20:00–02:00 (Businessnews, 31 Aug 2026).
            Sudden cuts damaged irrigation pumps in Kebili (Kapitalis, 25 Jul 2026); 79.7 % of cuts were unannounced in a survey of 325 exporters (L'Économiste Maghrébin, 20 Nov 2026).
            STEG low-voltage irrigation tariff, 3 time slots, before VAT, since 1 May 2022: day 140, evening peak 391 (19:00–22:00 in summer), night 116 millimes/kWh.
            CO₂ avoided: solar kWh × 0.47 kg, the IFI harmonised grid emission factor for solar in Tunisia (UNFCCC, 2019).
            Crop factors: FAO-56 Table 12, adjusted for dry, windy air (Eq. 62) with the day's humidity and wind. At least 2,500 solar irrigation systems in the Kebili region (MASSIRE project, CIRAD); overexploited aquifers (Mekki et al. 2022).</p>
          <p><b>Assumptions to confirm.</b> Demo borehole (Complexe Terminal aquifer, about 100 m total head): 22 kW pump, 50 m³/h; 600 m³ basin, 60 m³/h outlet;
            overall efficiency (canals × field) {Math.round(s.efficiency * 100)} %; 30 kWp of panels, 80 % performance; a pump on solar alone starts at 40 % of its power.
            The five families are fictional: those whose turn is tonight, with today's need (a real turn adds up the days since the last one); the order rotates every night.
            Fixed rotation (today's practice): back-to-back turns from 08:00, same pump and panels, no basin, in two versions: the clock keeps running through a cut, or the water bailiff pauses the turn.</p>
          <p><b>The Japan link.</b> In Japan, when water runs short, irrigation associations (土地改良区) share a reservoir by turns: 番水 (bansui). The oasis nouba follows the same principle; NOUBA makes it calculable, building on JICA's water-saving work in southern Tunisian oases.</p>
          <p className="sign"><span className="mark" aria-hidden="true">絆</span> Hackathon KIZUNA 2026 · Tunisia × Japan · 赤い糸, the red thread that binds</p>
        </footer>
      </main>
    </div>
  )
}

const clampH = (v: string) => Math.max(0, Math.min(23, Math.round(Number(v) || 0)))

// Typing is free; a value outside the range is pulled back when the field is left, not on every keystroke.
function Field(props: { label: string; unit: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])
  const inRange = (n: number) => Number.isFinite(n) && n >= props.min && n <= props.max
  return <label className="field-num"><span>{props.label}</span>
    <span className="num-wrap"><input type="number" min={props.min} max={props.max} value={text}
      onChange={e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && inRange(n)) props.onChange(n) }}
      onBlur={() => { const n = Number(text); const v = text === '' || !Number.isFinite(n) ? props.value : Math.max(props.min, Math.min(props.max, n)); props.onChange(v); setText(String(v)) }} />{props.unit}</span></label>
}

function Slider(props: { label: string; unit: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  const pct = (props.value - props.min) / (props.max - props.min) * 100
  return <label className="slider"><span>{props.label} <b>{r0(props.value)} {props.unit}</b></span>
    <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} style={vars({ '--pct': `${pct}%` })} onChange={e => props.onChange(Number(e.target.value))} /></label>
}

const Kicker = ({ n, children }: { n: string; children: ReactNode }) =>
  <p className="kicker"><span className="knot" aria-hidden="true" /><span className="kn" lang="ja" aria-hidden="true">{n}</span>{children}</p>

function Families({ s, lost }: { s: Setup; lost: number[] }) {
  return <ul className="families">{s.members.map((m, k) => {
    const out = lost[k] > 1
    return <li key={k} className={out ? 'out' : ''} style={vars({ '--k': k })} title={m.name}>
      <span aria-hidden="true">{(m.name.trim() || '?')[0]}</span><span className="sr">{m.name}: {out ? 'loses part of its water' : 'served'}</span></li>
  })}</ul>
}

function Hero({ p, s, w }: { p: Plan; s: Setup; w: Day }) {
  const fixed = p.baseline, paused = p.paused, n = s.members.length, pct = pctOf({ allot: p.delivered, need: p.need })
  const x = s.cut ? surprise(w, s, s.cut) : null
  const mill = (c: number, v: number) => (v > 1 ? r0(c / v * 1000) : '—')
  return <section className="hero reveal in" aria-labelledby="title">
    <span className="watermark" aria-hidden="true">絆</span>
    <Kicker n="一">The finding · {n > 1 ? 'one shared borehole' : 'one farm borehole'}, Kebili oasis</Kicker>
    <h1 id="title">
      <span className="line"><span>{s.cut ? `STEG cut announced: ${hh(s.cut[0])} – ${hh(s.cut[1])}.` : 'No power cut announced.'}</span></span>
      <span className="line"><span><em>Who loses their water turn?</em></span></span>
    </h1>
    <div className="duel">
      <div className="side old">
        <p className="side-label">Fixed rotation</p>
        <p className="big"><Num v={fixed.delivered} /><small>m³</small></p>
        <p className="side-sub">delivered to the fields</p>
        <Families s={s} lost={fixed.lostBy} />
        <p className="side-sub">{fixed.losers.length ? n === 1 ? <><b className="red">Your farm</b> loses part of its water</> : <><b className="red">{plural(fixed.losers.length, 'family', 'families')} of {n}</b> {fixed.losers.length > 1 ? 'lose part of their' : 'loses part of its'} water</> : 'No family hit by this cut'}</p>
      </div>
      <div className="vs" aria-hidden="true"><span>VS</span></div>
      <div className="side new">
        <p className="side-label">With NOUBA</p>
        <p className="big"><Num v={p.delivered} /><small>m³</small></p>
        <p className="side-sub">delivered, same pump, same panels</p>
        <Families s={s} lost={s.members.map(() => 0)} />
        <p className="side-sub">{p.delivered < 1 && p.need >= 1 ? <b className="red">No water delivered</b> : <><b className="green">No family left without water</b> · each gets {pct} % of its need</>}</p>
      </div>
    </div>
    <div className="nuance">
      <p><b>What if the water bailiff pauses the turn during the cut?</b> The fixed rotation also delivers {r0(paused.delivered)} m³, but in the daytime heat until {fmtClock(paused.end)}, for {mill(paused.cost, paused.delivered)} millimes/m³ of electricity. NOUBA: {mill(p.cost, p.delivered)} millimes/m³, at night, by gravity.</p>
      {x && <p><b>What if the cut is not announced?</b> NOUBA, planning without knowing about it, still delivers {r0(x.delivered)} m³ of {r0(x.planned)}: the basin absorbs the shock, and tomorrow's reserve drops from {r0(x.plannedEnd)} to {r0(x.endLevel)} m³.</p>}
    </div>
    <p className="lead">NOUBA plans the borehole hour by hour: it pumps on solar before the cut, fills the basin, then releases the water at night in equal shares, never above the aquifer quota. A fixed timer cannot know that the cut, the evaporation and the quota change every day; NOUBA recalculates everything in a second.</p>
    <p className="cues"><a className="scroll-cue" href="#value">What it saves <span aria-hidden="true">↓</span></a><a className="scroll-cue" href="#reserve">Reserve a pilot</a></p>
  </section>
}

function DaySection({ p, s, w, checkDate, steg, pick }: { p: Plan; s: Setup; w: Day; checkDate: string; steg: Steg | null; pick: (c: Setup['cut']) => void }) {
  const [hot, setHot] = useState<number | null>(null)
  const scale = Math.max(s.pumpM3h, s.outletM3h)
  const ys = p.hours.map(h => 100 - h.level / s.basinM3 * 92)
  const line = ys.map((y, i) => `${i ? 'L' : 'M'}${i + 0.5},${y.toFixed(2)}`).join(' ')
  const area = `M0,100 L0,${ys[0].toFixed(2)} ${line.replace('M', 'L')} L24,${ys[23].toFixed(2)} L24,100 Z`
  const firstCut = p.hours.findIndex(h => h.cut)
  const kwh = p.solarKwh + p.gridKwh, ok = p.pumped <= s.quotaM3 + 1e-6
  const live = steg && 'notices' in steg ? steg.notices : null
  const latest = live?.[0], onDate = live ? noticeFor(live, checkDate) : undefined
  const sameDay = live?.filter(n => n.date === checkDate).length ?? 0
  const presets: [string, [number, number] | null][] = [
    ...(live ?? []).slice(0, 3).map(n => [`${n.window} · ${longDate(n.date)}`, [n.start, n.end % 24]] as [string, [number, number]]),
    ['No cut', null]]
  const h = hot !== null ? p.hours[hot] : null
  return <section id="day" className="day reveal" aria-labelledby="day-title">
    <div className="sec-head">
      <Kicker n="二">The borehole's day · 06:00 → 06:00</Kicker>
      <h2 id="day-title">The sun fills the basin.<br />At night, the water flows to the fields.</h2>
      <div className="chips" role="group" aria-label="STEG power cut">
        {presets.map(([label, cut]) => <button key={label} className="chip" aria-pressed={cut ? s.cut?.[0] === cut[0] && s.cut?.[1] === cut[1] : !s.cut} onClick={() => pick(cut)}>
          {cut && <Icon name="zap" size={15} />}{label}</button>)}
      </div>
      <p className="chips-note">{live
        ? <>Read live from <a href={(steg as { source: string }).source} target="_blank" rel="noopener noreferrer">steg.com.tn</a>: {onDate
          ? <b>STEG notice for Kebili on {longDate(checkDate)} ({onDate.window}), applied{sameDay > 1 ? `; ${sameDay} notices that day, the one over the pumping hours is used` : ''}.</b>
          : <><b>no STEG power cut announced for Kebili on {longDate(checkDate)} ({checkDate})</b> — no cut applied unless you enter one manually in the sidebar.</>}{latest ? <> Last Kebili power cut on steg.com.tn: <b>{longDate(latest.date)} ({latest.window})</b>{latest.maxBlockHours ? `, cuts of up to ${latest.maxBlockHours} h` : ''}, in <span lang="ar">{latest.localities.slice(0, 6).join('، ')}</span> (<a href={latest.url} target="_blank" rel="noopener noreferrer">see official STEG notice ↗</a>).</> : ''}</>
        : steg ? 'steg.com.tn could not be read: no power cut applied unless you enter one manually.' : 'Reading STEG notices for Kebili from steg.com.tn…'}
        {' '}STEG does not say which hours inside the window are cut, so NOUBA plans the worst case: the whole window.</p>
    </div>

    <div className="ribbon" onMouseLeave={() => setHot(null)}>
      <div className="sky" aria-hidden="true">{w.rad.map((r, i) => <i key={i} style={vars({ '--sun': Math.min(1, r / 850) })} />)}</div>
      <div className="plot" role="img" aria-label={`Pumping before the cut, no grid pumping during the cut, night irrigation from ${fmtClock(p.turns[0].start)} to ${fmtClock(p.turns.at(-1)!.end)}`}>
        <span className="lane up">↑ pumped into the basin</span>
        <span className="lane down">↓ released to the fields</span>
        {p.hours.map((x, i) => <div key={i} className={`col ${x.cut ? 'cut' : ''} ${hot === i ? 'hot' : ''}`} style={vars({ '--i': i })} onMouseEnter={() => setHot(i)} onClick={() => setHot(i)}>
          {i === firstCut && <span className="cut-tag"><Icon name="zap" size={13} /> STEG cut</span>}
          <div className="half up"><i className="b solar" style={vars({ '--v': x.solar / scale })} /><i className="b grid" style={vars({ '--v': x.grid / scale, '--off': x.solar / scale })} /></div>
          <div className="half down"><i className="b irr" style={vars({ '--v': x.irr / scale })} /></div>
        </div>)}
        {h && hot !== null && <div className="tip" style={vars({ '--x': `${(hot + 0.5) / 24 * 100}%` })}>
          <b>{hh(h.clock)}{h.cut ? ' · cut' : ''}</b>
          <span><i className="sw solar" />Solar {r0(h.solar)} m³</span><span><i className="sw grid" />Grid {r0(h.grid)} m³</span>
          <span><i className="sw irr" />Irrigation {r0(h.irr)} m³</span><span><i className="sw level" />Basin {r0(h.level)} m³</span>
        </div>}
      </div>
      <div className="basin">
        <span className="basin-label">Basin · {r0(s.basinM3)} m³, the water "battery"</span>
        <svg viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--s-level)" stopOpacity=".55" /><stop offset="1" stopColor="var(--s-level)" stopOpacity=".08" /></linearGradient></defs>
          <path className="area" d={area} fill="url(#water)" />
          <path className="edge" d={line} fill="none" stroke="var(--s-level)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="ticks" aria-hidden="true">{p.hours.map((x, i) => <span key={i}>{i % 3 === 0 ? hh(x.clock) : ''}</span>)}</div>
    </div>

    <ul className="key">
      <li><i className="sw solar" />Solar pumping</li><li><i className="sw grid" />Grid pumping</li><li><i className="sw irr" />Irrigation (nouba)</li><li><i className="sw level" />Basin level</li>
      {s.cut && <li><i className="sw cut" />Cut: no grid pumping{s.pv === 'reseau' ? ', solar inverter stopped' : s.pv === 'hybride' || s.pv === 'isole' ? ', solar keeps running' : ''}</li>}
    </ul>

    <dl className="stats">
      <div><dt>Solar share</dt><dd><Num v={kwh ? p.solarKwh / kwh * 100 : 0} /> %</dd><dd className="sub">{r0(p.solarKwh)} kWh solar · {r0(p.gridKwh)} kWh grid · ≈ {r0(p.solarKwh * CO2_KG_PER_KWH)} kg CO₂ avoided</dd></div>
      <div><dt>Aquifer</dt><dd className={ok ? 'green' : 'red'}><Num v={p.pumped} /> / {r0(s.quotaM3)} m³</dd><dd className="sub">{ok ? 'Daily quota respected' : 'Quota exceeded'}</dd></div>
      <div><dt>Reserve at 06:00</dt><dd><Num v={p.endLevel} /> m³</dd><dd className="sub">≈ {(p.endLevel / s.outletM3h).toLocaleString('en-US', { maximumFractionDigits: 1 })} h of irrigation with no electricity</dd></div>
      <div><dt>STEG electricity (before VAT)</dt><dd><Num v={p.delivered ? p.cost / p.delivered * 1000 : 0} /> <small>millimes/m³</small></dd><dd className="sub">total {p.cost.toLocaleString('en-US', { maximumFractionDigits: 1 })} TND · paused rotation {p.paused.delivered > 1 ? r0(p.paused.cost / p.paused.delivered * 1000) : '—'} millimes/m³</dd></div>
    </dl>

    <details className="data-table"><summary>See the hour-by-hour data</summary>
      <div className="table"><table>
        <thead><tr><th>Hour</th><th>Solar</th><th>Grid</th><th>Irrigation</th><th>Basin</th></tr></thead>
        <tbody>{p.hours.map(x => <tr key={x.clock} className={x.cut ? 'in-cut' : ''}><td>{hh(x.clock)}{x.cut ? ' · cut' : ''}</td><td>{r0(x.solar)} m³</td><td>{r0(x.grid)} m³</td><td>{r0(x.irr)} m³</td><td>{r0(x.level)} m³</td></tr>)}</tbody>
      </table></div>
    </details>
  </section>
}

// Night window 18:00 -> 06:00: each family's turn sits at its real time.
const nightPos = (clock: number) => ((clock - 18 + 24) % 24) / 12
const CROPS: Record<Crop, string> = { palmier: 'Date palm', olivier: 'Olive', tomate: 'Vegetables' }

function Night({ p, s, edit, remove, add }: { p: Plan; s: Setup; edit: (m: Member, patch: Partial<Member>) => void; remove: (m: Member) => void; add: () => void }) {
  return <section className="night reveal" aria-labelledby="night-title">
    <div className="stars" aria-hidden="true" />
    <div className="inner">
      <Kicker n="三">The night of turns · 18:00 → 06:00</Kicker>
      <h2 id="night-title">Everyone takes a turn,<br />in equal shares.</h2>
      {p.warnings.map(m => <p key={m} className="night-note" role="status">{m}</p>)}
      <p className="night-sub">{s.members.length > 1 ? `The order rotates every night: tonight, ${s.members[0].name} goes first.` : 'One farm: the whole night is its turn.'}{s.members.length > 1 && (s.feeM3 ?? 0) > 0 ? ` Water fees for the GDA tonight: ${(p.delivered * s.feeM3!).toLocaleString('en-US', { maximumFractionDigits: 1 })} TND, family by family on the printed schedule.` : ''}</p>
      <div className="gantt">
        <div className="g-scale" aria-hidden="true">{[18, 21, 0, 3, 6].map((c, k) => <span key={c} style={vars({ '--x': `${k * 25}%` })}>{hh(c)}</span>)}</div>
        {p.turns.map((t, k) => {
          const a = nightPos(t.start), b = nightPos(t.end) || (t.allot > 0 ? 1 : 0), lost = p.baseline.lostBy[k]
          return <div key={k} className="g-row" style={vars({ '--k': k })}>
            <div className="g-who"><b>{t.name}</b><span>{CROPS[t.crop]} · {s.members[k].ha.toLocaleString('en-US')} ha</span></div>
            <div className="g-track" style={vars({ '--a': `${a * 100}%`, '--w': `${Math.max(0, b - a) * 100}%` })}>
              {t.allot >= 1 && <i className="g-bar">{b - a >= 0.18 && <span>{fmtClock(t.start)} → {fmtClock(t.end)}</span>}</i>}
              {t.allot >= 1 && <span className={`g-time ${b - a >= 0.18 ? 'narrow' : ''}`}>{fmtClock(t.start)} → {fmtClock(t.end)}</span>}</div>
            <div className="g-vol"><b>{r0(t.allot)} m³</b><span className={lost > 1 ? 'lost' : ''}>fixed rotation {r0(t.allot - lost)} m³</span></div>
          </div>
        })}
      </div>
      <div className="night-actions">
        <details className="edit"><summary>Edit the families (name, crop, area, phone, SMS language)</summary>
          <div className="edit-grid">{s.members.map((m, k) => <div key={k} className="edit-row">
            <input aria-label={`Name of family ${k + 1}`} value={m.name} maxLength={40} onChange={e => edit(m, { name: e.target.value })} />
            <select aria-label={`Crop of ${m.name}`} value={m.crop} onChange={e => edit(m, { crop: e.target.value as Crop })}>
              {Object.entries(CROPS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <label><input aria-label={`Area of ${m.name}`} type="number" min={0.1} max={20} step={0.1} value={m.ha}
              onChange={e => e.target.value !== '' && edit(m, { ha: Math.max(0.1, Math.min(20, Number(e.target.value))) })} /> ha</label>
            <input aria-label={`Phone of ${m.name}`} type="tel" inputMode="tel" placeholder="+216 98 123 456" value={m.phone ?? ''}
              aria-invalid={!!m.phone && !toE164(m.phone)} onChange={e => edit(m, { phone: e.target.value })} />
            <select aria-label={`SMS language of ${m.name}`} value={m.lang ?? 'ar'} onChange={e => edit(m, { lang: e.target.value as SmsLang })}>
              {SMS_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="ghost-link small" aria-label={`Remove ${m.name}`} disabled={s.members.length <= 1} onClick={() => remove(m)}>Remove</button>
          </div>)}</div>
          <button className="ghost-link small" disabled={s.members.length >= 12} onClick={add}>+ Add a family</button>
        </details>
        <button className="ghost-link" onClick={() => window.print()}>Print tonight's schedule</button>
      </div>
    </div>
  </section>
}


// Same plan + language + question = same answer: repeated demo clicks don't spend the free-tier quota.
const answers = new Map<string, string>()

type Delivery = { state: string; name: string; to: string; id?: string; error?: string }
const STATE_TEXT: Record<string, string> = {
  Sending: 'Sending…', Pending: 'Queued on the gateway phone', Processed: 'Handed to the SIM', Sent: 'Sent by the operator',
  Delivered: 'Delivered ✓', Failed: 'Failed',
}

function Sms({ p, s, date, edit, pin, setPin }: { p: Plan; s: Setup; date: string; edit: (m: Member, patch: Partial<Member>) => void; pin: string; setPin: (v: string) => void }) {
  const [who, setWho] = useState(0)
  const [lang, setLang] = useState<Lang>('en')
  const [question, setQuestion] = useState('')
  const [ai, setAi] = useState<{ text: string; err?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [gate, setGate] = useState<boolean | null>(null)
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({})
  const k = Math.min(who, p.turns.length - 1)
  const t = p.turns[k], member = s.members[k]
  const pct = pctOf(t)
  const cut: [string, string] | null = s.cut ? [fmtClock(s.cut[0]), fmtClock(s.cut[1])] : null
  useEffect(() => setAi(null), [who, lang, t.start, t.end, Math.round(t.allot), s.cut?.[0], s.cut?.[1]])
  useEffect(() => { fetch('/api/send').then(r => r.json()).then(j => setGate(!!j.sms)).catch(() => setGate(false)) }, [])

  async function ask(q?: string) {
    setBusy(true)
    const brief = {
      date, member: { name: t.name, crop: t.crop }, turn: { start: fmtClock(t.start), end: fmtClock(t.end), m3: Math.round(t.allot), percentOfNeed: pct },
      steg_cut: cut ? `${cut[0]}-${cut[1]}` : 'none', basin_end_m3: Math.round(p.endLevel), aquifer_quota_m3: s.quotaM3,
      why_percent: pct >= 100 ? 'Full need covered.' : p.warnings.some(m => m.startsWith('Aquifer quota'))
        ? "Today's total need is larger than the aquifer's daily quota, so the quota is shared equally: every family gets the same percentage of its need."
        : 'Pumping is limited today (power cut, sunlight or basin size), so the water is shared equally: every family gets the same percentage of its need.',
      during_cut: p.warnings.some(m => m.startsWith('Basin empty') || m.startsWith('Pump limited'))
        ? "The cut reduces today's water; what remains is shared equally between the families."
        : 'No grid pumping during the cut. The basin is filled before the cut (solar first) and irrigation runs at night by gravity from the basin, so the announced cut does not move the turn. If the cut changes or is longer than announced, NOUBA recalculates the plan and a new message is sent.',
      all_turns: p.turns.map(x => ({ name: x.name, start: fmtClock(x.start), end: fmtClock(x.end) })),
    }
    const body = JSON.stringify({ lang, plan: brief, question: q })
    const busyMsg = { text: 'The assistant is busy, try again in a moment. The message templates (English, العربية, Français, 日本語) still work.', err: true }
    try {
      let text = answers.get(body)
      if (!text) {
        const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        const j = await r.json()
        if (r.ok && j.text) answers.set(body, (text = j.text as string))
      }
      setAi(text ? { text } : busyMsg)
    } catch { setAi(busyMsg) }
    setBusy(false)
  }

  // Follows one message until the operator reports it delivered or failed (about one minute at most).
  async function track(key: string, id: string) {
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const j = await (await fetch(`/api/send?id=${encodeURIComponent(id)}`)).json()
        if (j.state) setDelivery(d => ({ ...d, [key]: { ...d[key], state: j.state, error: j.reason ?? undefined } }))
        if (j.state === 'Delivered' || j.state === 'Failed') return
      } catch { /* network blip: keep polling */ }
    }
  }

  // Real SMS: the server hands each message to the GDA's Android gateway phone, which sends it from its SIM.
  async function sendReal(batch: { key: string; name: string; to: string; text: string }[]) {
    setSending(true)
    setDelivery(d => ({ ...d, ...Object.fromEntries(batch.map(b => [b.key, { state: 'Sending', name: b.name, to: b.to }])) }))
    try {
      const r = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin, messages: batch.map(({ to, text }) => ({ to, text })) }) })
      const j = await r.json()
      if (!r.ok) {
        setDelivery(d => ({ ...d, ...Object.fromEntries(batch.map(b => [b.key, { state: 'Failed', name: b.name, to: b.to, error: String(j.error ?? 'error') }])) }))
        return
      }
      j.results.forEach((res: { ok: boolean; id?: string; state?: string; error?: string }, i: number) => {
        const { key, to, name } = batch[i]
        setDelivery(d => ({ ...d, [key]: res.ok ? { state: res.state ?? 'Pending', name, to, id: res.id } : { state: 'Failed', name, to, error: res.error } }))
        if (res.ok && res.id) track(key, res.id)
      })
    } catch {
      setDelivery(d => ({ ...d, ...Object.fromEntries(batch.map(b => [b.key, { state: 'Failed', name: b.name, to: b.to, error: 'network error' }])) }))
    } finally { setSending(false) }
  }

  const message = lang === 'darija' ? (ai && !ai.err ? ai.text : '') : TEMPLATES[lang](t, pct, cut)
  const to = toE164(member?.phone ?? '')
  const typed = !!member?.phone?.trim()
  const everyone = p.turns.map((x, i) => ({ key: `${x.name}|${s.members[i]?.phone ?? ''}`, name: x.name, to: toE164(s.members[i]?.phone ?? ''), text: TEMPLATES[s.members[i]?.lang ?? 'ar'](x, pctOf(x), cut) }))
  const reachable = everyone.filter(e => e.to) as { key: string; name: string; to: string; text: string }[]
  const smsHref = `sms:${to ?? ''}?&body=${encodeURIComponent(message)}`
  const waHref = `https://wa.me/${(to ?? '').replace('+', '')}?text=${encodeURIComponent(message)}`
  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }

  const rtl = lang === 'ar' || lang === 'darija'
  const shown = Object.entries(delivery)
  return <section className="sms reveal" aria-labelledby="sms-title" aria-label="Message to the families">
    <div className="sms-copy">
      <Kicker n="四">The message · no sensors, no app to install</Kicker>
      <h2 id="sms-title">One message, in each family's language.</h2>
      <p className="lead">Readable on the simplest phone. Reliable templates in English, Arabic, French and Japanese; Tunisian Darija and free answers are written by AI.</p>
      <div className="sms-controls">
        <label className="field">Family
          <select value={k} onChange={e => setWho(Number(e.target.value))}>{p.turns.map((x, i) => <option key={i} value={i}>{x.name}</option>)}</select></label>
        <div className="field">Language
          <div className="seg" role="group" aria-label="Language">
            {([['en', 'English'], ['ar', 'العربية'], ['darija', 'دارجة'], ['fr', 'Français'], ['ja', '日本語']] as [Lang, string][]).map(([v, l]) =>
              <button key={v} aria-pressed={lang === v} onClick={() => setLang(v)} lang={v === 'darija' ? 'ar' : v}>{l}{v === 'darija' && <Icon name="spark" size={14} />}</button>)}
          </div></div>
      </div>
      {lang === 'darija' && <button className="primary" disabled={busy} onClick={() => ask()}><Icon name="spark" size={16} /> Write in Darija</button>}

      <div className="send">
        <label className="field grow">{t.name}'s phone number
          <input type="tel" inputMode="tel" autoComplete="off" placeholder="+216 98 123 456" value={member?.phone ?? ''}
            onChange={e => member && edit(member, { phone: e.target.value })} aria-invalid={typed && !to} aria-describedby="send-help" /></label>
        {gate && <label className="field">Sending PIN
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" /></label>}
        <div className="send-buttons">
          <button className="primary" disabled={!gate || !to || !message || !pin || sending} onClick={() => sendReal([{ key: `${t.name}|${member?.phone ?? ''}`, name: t.name, to: to!, text: message }])}>
            <Icon name="send" size={16} /> Send SMS now</button>
          <button className="primary alt" disabled={!gate || !reachable.length || !pin || sending} onClick={() => sendReal(reachable)}>
            Send tonight's turns to {reachable.length} of {everyone.length} families, each in its language</button>
        </div>
        <p id="send-help" className="hint">{typed && !to ? 'This number is not valid: type 8 digits (98 123 456) or an international number (+216 98 123 456).'
          : gate ? 'Real SMS, sent from the GDA\'s Android gateway phone. The status below updates until the operator confirms delivery.'
            : gate === false ? 'Automatic SMS is off: no SMS gateway is connected to this server. The links below open your own phone\'s apps instead.' : 'Checking the SMS gateway…'}</p>
        {shown.length > 0 && <ul className="delivery" aria-live="polite">{shown.map(([key, d]) =>
          <li key={key} className={`st-${d.state.toLowerCase()}`}><b>{d.name}</b><span>{d.to}</span>
            <span className="st">{STATE_TEXT[d.state] ?? d.state}{d.state === 'Failed' ? ': not sent, use the WhatsApp link' : ''}</span></li>)}</ul>}
        <div className="send-buttons links">
          {message ? <a className="ghost-link" href={waHref} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a> : <button className="ghost-link" disabled>Open in WhatsApp</button>}
          {message ? <a className="ghost-link" href={smsHref}>Open my SMS app</a> : <button className="ghost-link" disabled>Open my SMS app</button>}
          <button className="ghost-link" disabled={!message} onClick={copy}>{copied ? 'Copied' : 'Copy text'}</button>
        </div>
        {!to && !typed && <p className="hint">No number: WhatsApp and the SMS app open so you can pick a contact. These links work on a phone; on a computer, use "Send SMS now".</p>}
      </div>

      <form className="ask" onSubmit={e => { e.preventDefault(); if (question.trim()) ask(question) }}>
        <label className="field grow">A family's question
          <input aria-label="A family's question" maxLength={300} placeholder="e.g. why at night?" value={question} onChange={e => setQuestion(e.target.value)} /></label>
        <button className="primary" disabled={busy || !question.trim()}><Icon name="spark" size={16} /> Ask NOUBA</button>
      </form>
    </div>
    <div className="device" aria-live="polite">
      <div className="notch" aria-hidden="true" />
      <div className="device-bar"><span className="mark" aria-hidden="true">絆</span><div><b>NOUBA</b><span>Kebili GDA</span></div></div>
      <div className="phone" dir={rtl ? 'rtl' : 'ltr'} lang={lang === 'darija' ? 'ar' : lang}>
        <span className="day-chip" lang="en">Today · SMS</span>
        {lang === 'darija'
          ? <p key={ai?.text ?? 'ghost'} className={ai ? (ai.err ? 'bubble err' : 'bubble') : 'bubble ghost'} lang={ai && !ai.err ? 'ar' : 'en'} dir={ai && !ai.err ? 'rtl' : 'ltr'}>{ai?.text ?? (busy ? '…' : 'Darija is written by AI (beta). Press "Write in Darija".')}</p>
          : <p key={`${lang}-${who}`} className="bubble">{TEMPLATES[lang](t, pct, cut)}</p>}
        {lang !== 'darija' && ai && <p className={ai.err ? 'bubble err' : 'bubble ai'}>{ai.text}</p>}
        {busy && <p className="typing" aria-label="Writing"><i /><i /><i /></p>}
      </div>
    </div>
  </section>
}

// One printed page for the water bailiff to post at the borehole (hidden on screen).
function PrintSheet({ p, s, date }: { p: Plan; s: Setup; date: string }) {
  return <section className="print-sheet" aria-hidden="true">
    <h2>NOUBA · Night water turns · {longDate(date)}</h2>
    <p>Kebili GDA borehole · STEG cut: {s.cut ? `${hh(s.cut[0])}–${hh(s.cut[1])}` : 'none announced'} · Basin reserve at 06:00: {r0(p.endLevel)} m³ · Aquifer: {r0(p.pumped)} / {r0(s.quotaM3)} m³</p>
    {p.warnings.map(m => <p key={m}><b>{m}</b></p>)}
    <table>
      <thead><tr><th>Order</th><th>Family</th><th>Crop</th><th>Turn</th><th>Volume</th><th>Share of need</th><th>Water fee</th><th>Signature</th></tr></thead>
      <tbody>{p.turns.map((x, i) => <tr key={i}><td>{i + 1}</td><td>{x.name}</td><td>{CROPS[x.crop]}</td><td>{fmtClock(x.start)} → {fmtClock(x.end)}</td>
        <td>{r0(x.allot)} m³</td><td>{pctOf(x)} %</td><td>{(x.allot * (s.feeM3 ?? 0)).toFixed(3)} TND</td><td></td></tr>)}</tbody>
    </table>
    <p className="small">Planned by NOUBA from Open-Meteo weather data and STEG notices. Every family gets the same share of its need; the order rotates every night.</p>
  </section>
}

type AutoStatus = {
  now: { date: string; hour: number; minute: number }; saved: boolean; gateway: boolean; autopilot: { enabled: boolean; sendAt: number }
  weather: { date: string; source: string; maxC: number; et0: number }
  steg: { checkedAt: string; source: string; notice: Notice | null; latest: Notice | null } | null
  plan: { date: string; cut: [number, number] | null; turns: { name: string; start: string; end: string; m3: number; pct: number; reach: 'telegram' | 'sms' | null }[] }
  channels: { telegram: boolean; bot: string | null; sms: boolean }; join: { name: string; start: string | null; linked: boolean }[]
  pump: { on: boolean; minutes: number; source: string | null; reason: string; next: string | null }
  valve: { open: boolean; family?: string; until?: string; next?: string | null }
  basinM3: number; sms: { sentFor: string | null; sentAt: string | null; sent: { name: string; via?: string; state: string; error?: string }[] }
  lastRun: string | null; everyMin: number; log: { at: string; msg: string }[]; error?: string
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' })

// 〇 What the system is doing right now, by itself: pump, valve, STEG check, forecast, messages. Refreshes every 20 s.
function Live({ pin, setPin, sync }: { pin: string; setPin: (v: string) => void; sync: string }) {
  const [a, setA] = useState<AutoStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  // With a checked PIN the status also carries each family's QR token.
  const load = () => fetch('/api/autopilot', sync === 'saved' && pin ? { headers: { 'x-pin': pin } } : undefined).then(r => r.json())
    .then(j => setA(j.pump ? j : (x => x ? { ...x, error: 'offline' } : j)))
    .catch(() => setA(x => x ? { ...x, error: 'offline' } : { error: 'offline' } as AutoStatus))
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t) }, [pin, sync])
  async function act(url: string, body: object, label: string) {
    setBusy(label)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin, ...body }) })
      setNote(r.ok ? '' : r.status === 401 ? 'Wrong PIN.' : r.status === 429 ? 'Too many wrong PINs: wait a minute.' : 'Not done, try again.')
    } catch { setNote('No connection to the server.') } finally { setBusy(''); load() }
  }
  if (!a) return <section className="live"><p className="loading">Connecting to the autopilot…</p></section>
  if (a.error && !a.pump) return <section className="live"><p className="loading">The autopilot is not answering; it retries every 20 seconds.</p></section>
  const t = `${String(a.now.hour).padStart(2, '0')}:${String(a.now.minute).padStart(2, '0')}`
  const phones = a.plan.turns.filter(x => x.reach).length
  const sentToday = a.sms.sentFor === a.plan.date
  // Rendered after its first fetch, so after the scroll-reveal observer started: it shows at once instead.
  return <section className="live" aria-labelledby="live-title">
    <Kicker n="〇">Live control · Kebili, {t} Tunis time</Kicker>
    <h2 id="live-title">Running by itself.</h2>
    {a.error && <p className="hint" role="status">The autopilot is not answering: this is its last status, retried every 20 seconds.</p>}
    <div className="live-grid">
      <div className={`tile ${a.pump.on ? 'on' : ''}`}><span>Pump</span><b>{a.pump.on ? `ON · ${a.pump.source}` : 'OFF'}</b>
        <small>{a.pump.reason}{!a.pump.on && a.pump.next ? ` · next start ${a.pump.next}` : ''}</small></div>
      <div className={`tile ${a.valve.open ? 'on' : ''}`}><span>Valve to the fields</span><b>{a.valve.open ? `Open · ${a.valve.family}` : 'Closed'}</b>
        <small>{a.valve.open ? `until ${a.valve.until}` : a.valve.next ? `next: ${a.valve.next}` : 'no turn left tonight'} · basin {a.basinM3} m³</small></div>
      <div className="tile"><span>STEG</span><b>{a.steg ? a.steg.notice ? `Cut ${a.steg.notice.window}` : 'No cut announced' : 'Site unreachable'}</b>
        <small>{a.steg ? <>read <a href={a.steg.source} target="_blank" rel="noopener noreferrer">steg.com.tn</a> at {clock(a.steg.checkedAt)}{a.steg.latest ? ` · last Kebili notice ${longDate(a.steg.latest.date)}` : ''}</> : 'retrying every check'}</small></div>
      <div className="tile"><span>Forecast</span><b>{Math.round(a.weather.maxC)} °C · ET0 {a.weather.et0.toFixed(1)} mm</b><small>{a.weather.source}, live</small></div>
      <div className="tile wide"><span>Messages for tonight</span>
        <b>{!a.autopilot.enabled ? 'Autopilot off' : !a.gateway ? 'Connect the Telegram bot to send' : !phones ? 'Scan a family code to start'
          : sentToday ? `Sent at ${clock(a.sms.sentAt!)} to ${a.sms.sent.length} ${a.sms.sent.length > 1 ? 'families' : 'family'}` : `Sent automatically at ${String(a.autopilot.sendAt).padStart(2, '0')}:00`}</b>
        {sentToday && <ul className="delivery">{a.sms.sent.map((x, k) => <li key={k} className={`st-${x.state.toLowerCase()}`}><b>{x.name}</b><span>{x.via === 'telegram' ? 'Telegram' : 'SMS'}</span><span className="st">{STATE_TEXT[x.state] ?? x.state}{x.error ? `: ${x.error}` : ''}</span></li>)}</ul>}
        {a.channels.bot && (a.join.some(x => x.start) ? <Join bot={a.channels.bot} join={a.join} /> : <p className="hint">Type the PIN below to show each family's QR code.</p>)}
        <small>{phones} of {a.plan.turns.length} families reachable{a.channels.bot ? ` on Telegram @${a.channels.bot}` : ''}{a.channels.sms ? ' or by SMS' : ''} · checked every {a.everyMin} min{a.lastRun ? `, last at ${clock(a.lastRun)}` : ''}</small></div>
    </div>
    <div className="live-controls">
      <label className="field">PIN
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" /></label>
      <label className="field">Autopilot
        <select value={a.autopilot.enabled ? 'on' : 'off'} disabled={!pin} onChange={e => act('/api/setup', { autopilot: { enabled: e.target.value === 'on' } }, 'settings')}>
          <option value="on">On</option><option value="off">Off</option></select></label>
      <label className="field">Send at
        <select value={a.autopilot.sendAt} disabled={!pin} onChange={e => act('/api/setup', { autopilot: { sendAt: Number(e.target.value) } }, 'settings')}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
      <button className="ghost-link" disabled={!pin || !!busy} onClick={() => act('/api/autopilot', { action: 'run' }, 'run')}>{busy === 'run' ? 'Checking…' : 'Check now'}</button>
      <button className="primary" disabled={!pin || !a.gateway || !phones || !!busy} onClick={() => act('/api/autopilot', { action: 'send' }, 'send')}>{busy === 'send' ? 'Sending…' : sentToday ? 'Send tonight\'s messages again' : 'Send tonight\'s messages now'}</button>
    </div>
    <p className="hint">{note && <b>{note} </b>}{{ off: 'Type the PIN to save your families for the autopilot.', saved: 'Families and phones are saved for the autopilot.', 'wrong-pin': 'Wrong PIN: changes stay on this device.', locked: 'Too many wrong PINs: wait a minute, then type it again.', error: 'Could not reach the server: changes stay on this device.' }[sync]}
      {' '}Pump controller: <code>/api/pump</code> (JSON) or <code>/api/pump?format=text</code> (ON / OFF).</p>
    <details className="data-table"><summary>Autopilot log</summary>
      <ul className="log">{a.log.map((l, k) => <li key={k}><time>{clock(l.at)}</time> {l.msg}</li>)}</ul></details>
  </section>
}

// 五 What the plan is worth, from this day's real plan. Water first; money per cut day, never a month of heatwaves.
function Value({ p, s }: { p: Plan; s: Setup }) {
  const v = value(p), o = offer(s.members.length > 1 ? 'gda' : 'pro'), payDays = v.daysToPayYear(o.price!)
  const tnd = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return <section id="value" className="value reveal" aria-labelledby="value-title">
    <Kicker n="五">Why it pays · computed from this day's plan</Kicker>
    <h2 id="value-title">{v.extraM3 >= 1 ? <>+{r0(v.extraM3)} m³ for the {s.members.length > 1 ? 'families' : 'farm'}. <em>{v.tndPerDay >= 0.5 ? `${tnd(v.tndPerDay)} TND off the bill.` : 'Same pump.'}</em></>
      : v.tndPerDay >= 0.5 ? <>{tnd(v.tndPerDay)} TND off today's bill.</> : <>Every turn kept, every day.</>}</h2>
    <dl className="stats">
      <div><dt>Water kept</dt><dd>+<Num v={v.extraM3} /> <small>m³</small></dd>
        <dd className="sub">versus the rotation whose clock runs through the cut{p.baseline.losers.length ? `: ${s.members.length === 1 ? 'the farm keeps its water' : p.baseline.losers.length > 1 ? `${p.baseline.losers.length} families keep their turn` : '1 family keeps its turn'}` : ''}</dd></div>
      <div><dt>Electricity saved</dt><dd><Num v={v.tndPerDay} f={tnd} /> <small>TND</small></dd>
        <dd className="sub">{tnd(p.cost)} TND with NOUBA against {tnd(p.paused.cost)} TND for the paused rotation, same water, STEG tariff before VAT</dd></div>
      <div><dt>A year of {o.name} paid by</dt><dd>{payDays ? <><Num v={payDays} /> <small>days like this</small></> : '—'}</dd>
        <dd className="sub">{o.price} {o.unit}, the subscription alone{v.tndPerDay > 0 ? `; with the ${BOX.price} TND box, the first year takes ${r0((o.price! * 12 + BOX.price) / v.tndPerDay)} days` : ''}. Off-grid wells pay for the quota log instead.</dd></div>
      <div><dt>STEG evening peak</dt><dd><Num v={v.mwPer1000} /> <small>MW</small></dd>
        <dd className="sub">off the 19:00–22:00 peak for every 1,000 pumps planned like this one.{v.peakKwAvoided >= 1 ? ` STEG wants 300 MW shifted by summer 2027: ≈ ${r0(Math.round(300_000 / v.peakKwAvoided / 100) * 100)} boreholes like this one.` : ''}</dd></div>
    </dl>
    <p className="lead">The money that moves the market is the law: since October 2026 a regularised well must meter what it pumps. NOUBA already keeps every pumping hour under the quota; from the pilot, the box's current clamp logs what was really pumped. The same box that saves water and electricity keeps the well legal.</p>
    <a className="scroll-cue" href="#reserve">See the offer <span aria-hidden="true">↓</span></a>
  </section>
}

type Leads = { count: number; units: number; mrr: number; recent: { name: string; region: string; plan: PlanId; at: string }[] }

// 六 The offer and the pilot reservations: the counter reads the server's file, no seeded number.
function Market() {
  const [st, setSt] = useState<Leads | null>(null)
  const [f, setF] = useState({ name: '', phone: '', plan: 'pro' as PlanId, units: 1, region: 'Kebili', consent: false })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState('')
  const url = `${location.origin}/#reserve`
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname)
  const form = useRef<HTMLFormElement>(null)
  const load = () => fetch('/api/leads').then(r => r.json()).then(setSt).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 320 }).then(setQr).catch(() => setQr('')) }, [url])
  const pick = (plan: PlanId) => {
    setF(x => ({ ...x, plan }))
    form.current?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' })
    form.current?.querySelector('input')?.focus({ preventScroll: true })
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })
      const j = await r.json()
      if (!r.ok) setMsg({ ok: false, text: j.error ?? 'Could not save, try again.' })
      else { setMsg({ ok: true, text: `Thank you ${f.name.trim().split(' ')[0]}: your pilot is reserved, we will call you.` }); setSt(j); setF(x => ({ ...x, name: '', phone: '', consent: false })) }
    } catch { setMsg({ ok: false, text: 'No connection to the server, try again.' }) } finally { setBusy(false) }
  }
  return <section id="reserve" className="market reveal" aria-labelledby="market-title">
    <Kicker n="六">The offer · free to plan, paid to automate</Kicker>
    <h2 id="market-title">Reserve your pilot.</h2>
    <div className="offers">{OFFERS.map(o => <article key={o.id} className={`offer ${o.id === 'pro' ? 'best' : ''}`}>
      <p className="offer-who">{o.who}</p>
      <h3>{o.name}</h3>
      <p className="offer-price">{o.price === null ? 'On quote' : o.price === 0 ? '0 TND' : <>{o.price} <small>{o.unit}</small></>}</p>
      <ul>{o.features.map(x => <li key={x}>{x}</li>)}</ul>
      <button className={o.id === 'pro' ? 'primary' : 'ghost-link'} onClick={() => pick(o.id)} aria-label={`Reserve ${o.name}`}>{o.price === null ? 'Talk to us' : 'Reserve'}</button>
    </article>)}</div>
    <div className="biz">
      <div><h3>Why now</h3><ul className="market-facts">{WHY_NOW.map(m => <li key={m.url}>{m.what} <a href={m.url} target="_blank" rel="noopener noreferrer">{m.src}</a></li>)}</ul></div>
      <div><h3>Who can buy</h3><ul className="market-facts">{MARKET.map(m => <li key={m.n}><b>{m.n}</b> {m.what} <a href={m.url} target="_blank" rel="noopener noreferrer">{m.src}</a></li>)}</ul></div>
      <div><h3>What one well costs us</h3><dl className="unit">
        <div><dt>{offer('pro').name}</dt><dd>{offer('pro').price} TND/month</dd></div>
        <div><dt>Messages</dt><dd>0 TND</dd><dd className="sub">Telegram and WhatsApp links are free; by SMS at most {(SMS_TND * 30).toFixed(2)} TND a month</dd></div>
        <div><dt>Margin per well</dt><dd>≥ {Math.round(MARGIN * 100)} %</dd><dd className="sub">after messages (SMS, worst case) and {COSTS.supportPerWell} TND a year of support</dd></div>
        <div><dt>NOUBA Box</dt><dd>{BOX.price} TND</dd><dd className="sub">parts {Math.round(BOX.parts)} TND where the well has Wi-Fi (a 4G board adds about 130 TND); the installer who fits it earns {COSTS.installerShare * 100} %</dd></div>
      </dl><p className="hint">Comparable Tunisian systems sell for 700 to 20,000 TND (<a href="https://kapitalis.com/tunisie/2024/05/10/irwise-une-experience-tunisienne-dirrigation-agricole-intelligente/" target="_blank" rel="noopener noreferrer">Irwise, Kapitalis 2024</a>).</p></div>
    </div>
    <Forecast />
    <div className="reserve">
      <form ref={form} className="reserve-form" onSubmit={submit}>
        <label className="field">Name<input required minLength={2} maxLength={60} autoComplete="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Phone<input required type="tel" inputMode="tel" autoComplete="tel" placeholder="98 123 456" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field">Plan<select value={f.plan} onChange={e => setF({ ...f, plan: e.target.value as PlanId })}>{OFFERS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="field">{f.plan === 'gda' ? 'Boreholes' : 'Pumps'}<input type="number" min={1} max={500} value={f.units} onChange={e => setF({ ...f, units: Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 1))) })} /></label>
        <label className="field">Region<input maxLength={40} autoComplete="address-level1" value={f.region} onChange={e => setF({ ...f, region: e.target.value })} /></label>
        <label className="check consent"><input type="checkbox" required checked={f.consent} onChange={e => setF({ ...f, consent: e.target.checked })} /> NOUBA may call me about a pilot. My number is used for nothing else.</label>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Reserve my pilot'}</button>
        <p role="status" className={msg ? (msg.ok ? 'ok' : 'err') : ''}>{msg?.text}</p>
      </form>
      <div className="traction">
        {qr && <img src={qr} width={160} height={160} alt={`QR code to this page: ${url}`} />}
        <p className="hint">{local ? <>Phones cannot open localhost. Same Wi-Fi: open the app at the Network address of <code>npm run dev:lan</code>. Any network: <code>npm run share</code>. The QR follows the address you open.</>
          : <>Scan to reserve from your phone<br /><b>{url.replace(/^https?:\/\//, '')}</b></>}</p>
        <p className="count" aria-live="polite"><b><Num v={st?.count ?? 0} /></b> {st?.count === 1 ? 'pilot' : 'pilots'} reserved<br />
          <span><Num v={st?.units ?? 0} /> pumps · <Num v={st?.mrr ?? 0} /> TND a month at launch prices</span></p>
        {!!st?.recent.length && <ul className="recent">{st.recent.map((x, k) => <li key={k}><b>{x.name}</b>{x.region && ` · ${x.region}`} · {offer(x.plan).name}</li>)}</ul>}
      </div>
    </div>
  </section>
}

// A family scans its code once: the bot links the chat and answers at once with tonight's turn.
function Join({ bot, join }: { bot: string; join: AutoStatus['join'] }) {
  const [k, setK] = useState(0)
  const [qr, setQr] = useState('')
  const f = join[Math.min(k, join.length - 1)]
  // start is the server's token for that family (shown only with the PIN), never its position in the list.
  const url = f ? `https://t.me/${bot}?start=${f.start}` : ''
  useEffect(() => { if (url) QRCode.toDataURL(url, { margin: 1, width: 280 }).then(setQr).catch(() => setQr('')) }, [url])
  if (!f) return null
  return <div className="join">
    {qr && <img src={qr} width={132} height={132} alt={`QR code: ${f.name} joins NOUBA on Telegram`} />}
    <div>
      <label className="field">Family code<select value={k} onChange={e => setK(Number(e.target.value))}>
        {join.map((x, i) => <option key={x.start} value={i}>{x.name}{x.linked ? ' · linked' : ''}</option>)}</select></label>
      <p className="hint">Scan with the phone camera, press Start in Telegram: tonight's turn arrives at once, and every evening after. Questions typed to the bot are answered from the plan.</p>
      <a className="ghost-link small" href={url} target="_blank" rel="noopener noreferrer">Open in Telegram</a>
    </div>
  </div>
}

// Three years under three scenarios: the jury picks one, every figure follows from the launch prices and costs.
const kTnd = (x: number) => `${x < 0 ? '−' : ''}${Math.round(Math.abs(x) / 1000).toLocaleString('en-US')}k`
function Forecast() {
  const [sc, setSc] = useState<(typeof SCENARIOS)[number]['id']>('base')
  const rows = forecast(SCENARIOS.find(x => x.id === sc)!.scale)
  // The ask is sized on the prudent case, whatever scenario is on screen, rounded up to 10k.
  const ask = Math.ceil(-Math.min(0, ...forecast(SCENARIOS[0].scale).map(r => r.cash)) / 10_000) * 10_000
  const first = rows.find(r => r.profit > 0)
  return <div className="forecast">
    <div className="forecast-head"><h3>3-year forecast, TND</h3>
      <div className="chips" role="group" aria-label="Scenario">{SCENARIOS.map(x =>
        <button key={x.id} className="chip" aria-pressed={sc === x.id} onClick={() => setSc(x.id)}>{x.name}</button>)}</div></div>
    <div className="fc-wrap"><table className="fc">
      <thead><tr><th scope="col">Year</th><th scope="col">Wells</th><th scope="col">GDAs</th><th scope="col">CRDAs</th><th scope="col">Revenue</th><th scope="col">Costs</th><th scope="col">Profit</th><th scope="col">Cash</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.year}><th scope="row">{r.year}</th><td>{r0(r.pro)}</td><td>{r.gda}</td><td>{r.crda}</td>
        <td>{kTnd(r.revenue)}</td><td>{kTnd(r.costs)}</td><td className={r.profit < 0 ? 'neg' : 'pos'}>{kTnd(r.profit)}</td><td className={r.cash < 0 ? 'neg' : ''}>{kTnd(r.cash)}</td></tr>)}</tbody>
    </table></div>
    <p className="hint"><b>{first ? `Profitable in ${first.year.split(' ·')[0].toLowerCase()}` : 'Not profitable within three years'}. Our ask: {kTnd(ask)} TND, enough even in the prudent case.</b> Revenue: subscriptions, boxes at {BOX.price} TND, CRDA quota dashboards at {r0(CRDA_LICENCE)} TND a year. Costs: team, box parts, installers' share, support. Launch hypotheses, to be tested in the pilot.</p>
  </div>
}
