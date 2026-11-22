# NOUBA · نوبة · 絆

**Every drop, every kilowatt, everyone takes a turn.**
A pumping planner for a shared oasis borehole run by a farmers' association (GDA). It plans around STEG power cuts, respects the aquifer quota, uses the basin as a water "battery", shares the water fairly at night, and sends every family its turn by SMS or WhatsApp.

Hackathon KIZUNA 2026 (Tunisia × Japan) · themes **water + energy + agriculture** in one system.

## The numbers

Demo: Kebili, 26 July 2026, last day of the INM heatwave of 23–26 July (INM Kebili station up to 48.1 °C; ERA5 reanalysis via Open-Meteo: 48.4 °C, 5 % minimum humidity, 6 m/s wind). STEG cut window 12:00–17:00 (Kebili notice of 3 Aug 2026, planned as a continuous cut, the worst case). Same borehole, pump and grid-tied panels in every column.

| | Fixed rotation, clock keeps running | Fixed rotation, bailiff pauses the turn | **NOUBA** |
|---|---|---|---|
| Water delivered | 250 m³, 3 of 5 families short | 500 m³, but in the daytime until 23:00 | **500 m³ at night, every family at 59 % of its need** |
| STEG electricity (before VAT) | fewer m³ delivered | 73 millimes/m³ | **33 millimes/m³** |
| Aquifer withdrawal | not controlled | not controlled | **≤ quota (500 m³)** |

**Unannounced cut** (79.7 % of cuts in a 2026 survey): NOUBA, planning without knowing about it, still delivers 500 m³; the basin absorbs the shock and tomorrow's reserve drops from 250 to 65 m³.

> Need (852 m³) exceeds the quota (500 m³): water is scarce, as it really is. NOUBA does not create water; it decides **when** to pump and **who** gets how much, fairly.

## Business model

Free to plan, paid to automate, and needed to stay legal. Launch prices are hypotheses for the pilot.

| Buyer | Offer | Why they pay |
|---|---|---|
| Farmers with their own well | Well Pro, 15 TND/month + NOUBA Box 199 TND once | Law 18/2026 (Oct 2026) regularises unlicensed wells for 3,500 DT and requires meters on pumped volumes and a digital platform: the box logs pumping against the quota. On grid wells, a year is paid by about 19 cut days of electricity saving (7.5 kW pump) |
| GDAs (shared boreholes) | GDA, 49 TND/borehole/month | Fair night turns (+250 m³ for the families on the demo cut day), a per-family water-fee ledger, a year paid by about 29 cut days of saving |
| CRDA, DGGREE | Aquifer quota dashboard, about 24,000 TND per governorate per year | They must check regularised wells and quotas |
| STEG, installers | Pilot, white label | Every box is an outage sensor; STEG wants 300 MW off the 2027 peak. Installers sell and fit the box for 20 % |

- **Why now**: summer 2026 cuts damaged pumps in Kebili; law 18/2026; STEG's 300 MW target; JICA × S2T startup programme from December 2026.
- **Market (sourced)**: 35,428 deep boreholes (21,279 unlicensed, 9,252 in Kebili), 1,358 irrigation GDAs (ONAGRI 2021); Kebili's 298,000 t of dates feed about 50,000 families.
- **Unit economics**: messages are free (Telegram bot, WhatsApp links; SMS at most 1.32 TND/month); box parts about 70 TND; margin per well at least 91 %.
- **3-year forecast** (in the app, three scenarios): base case 4,000 wells and 150 GDAs in year 3, 1.13 M TND revenue, profitable from year 2. Ask: 70k TND, enough even in the prudent case.
- **Traction, live**: *Reserve your pilot* takes real reservations behind a QR code; the counter updates during the pitch.

## What it does

1. **Need**: hourly FAO-56 ET0 (Open-Meteo) × FAO-56 crop factor adjusted for dry, windy air (Eq. 62) × area ÷ overall efficiency (70 %).
2. **Energy**: each hour is solar / grid day / peak / night / cut, for 4 setups: grid only, grid-tied solar (stops in a cut), hybrid solar, standalone solar. Irradiance on panels tilted 30° south.
3. **Pumping**: greedy, cheapest energy first (real STEG irrigation tariff), never in a cut, never above the quota, never overflowing the basin.
4. **Basin = battery**: filled before the cut, released at night by gravity, finishing at 06:00.
5. **Fair turns**: equal percentage of need under shortage; the order rotates every night.
6. **Stress test**: shows what an unannounced cut would cost.
7. **Messages**: templates in English, Arabic, French and Japanese; Tunisian Darija and free answers by AI (Gemini, Groq as backup). Any clock time not in the plan is rejected.
8. **Live STEG notices**: `/api/steg` reads STEG's Kebili load-shedding notices straight from steg.com.tn (the "قبلي" column, hours written in Arabic words) and applies the notice for the planned date; if STEG announced none, there is no cut.
9. **Telegram bot (automatic, free)**: each family scans its QR code once; the bot replies at once with tonight's turn, answers questions from the plan, and the autopilot sends the turns every evening (`TELEGRAM_BOT_TOKEN` from @BotFather). **Real SMS (optional)**: `/api/send` sends through an Android phone with a Tunisian SIM ([SMS Gateway for Android](https://sms-gate.app), cloud mode), PIN-protected, Tunisian mobiles only, with live delivery tracking (Queued → Sent → Delivered). "Send tonight's turns to all families" sends every family its turn. WhatsApp and SMS-app links remain as a fallback.
10. **Your own borehole**: families (name, crop, area, phone) and pump, outlet and efficiency are editable and saved on the device.
11. **Why it pays** and **Reserve your pilot**: savings, payback and peak relief computed from the day's plan; offers, sourced market, unit economics and live pilot reservations with a QR code.
12. **Single farm** or **shared borehole (GDA)** presets. **Today / Tomorrow / Heatwave**, **CO₂ avoided** (solar kWh × 0.47 kg, IFI grid factor) and a **printable night schedule** for the borehole.

## Run and test

```bash
npm install
cp .env.example .env.local   # GEMINI_API_KEY (GROQ_API_KEY optional); SMSGATE_USER, SMSGATE_PASS, SEND_PIN for real SMS
npm run dev                  # http://localhost:5173: app, planner and /api/ask
npm test                     # 480 planner scenarios, AI output filter, 6 real STEG notices, SMS endpoint guards
npm run check:api            # live check of the assistant (6 questions, 5 languages)
npm run dev:lan              # open it from a phone on the same Wi-Fi (the QR code follows)
npm run share                # public link for any phone (needs cloudflared installed)
```

Deploy on Vercel (`api/` becomes a serverless function). Set `GEMINI_API_KEY`, `GROQ_API_KEY`, `SMSGATE_USER`, `SMSGATE_PASS` and `SEND_PIN` as Vercel environment variables, never in the browser.

**Real SMS in 5 minutes**: install "SMS Gateway for Android" on an Android phone with a Tunisian SIM, switch on *Cloud server*, press *Start*, copy the username and password into `SMSGATE_USER` / `SMSGATE_PASS`, choose a `SEND_PIN`, restart `npm run dev`. `GET /api/send` then returns `{"sms":true}`.

## Structure

- `src/planner.ts`: the engine (no dependencies), tested by `src/planner.test.ts`
- `src/weather.ts`: live Open-Meteo, real offline copies (`public/*.json`), demo borehole
- `src/App.tsx`: one page, mobile first, right-to-left for Arabic
- `api/ask.ts`: AI function (keys on the server, inputs validated, outputs filtered)

## Sources

- Weather: Open-Meteo (archive = ERA5 reanalysis, ~25 km grid; today = forecast). INM monthly climate bulletin, July 2026.
- STEG cuts: Le Temps (3 Aug 2026), Businessnews (31 Aug 2026). STEG low-voltage irrigation tariff, 3 slots, before VAT, since 1 May 2022: day 140, evening peak 391 (19:00–22:00 in summer), night 116 millimes/kWh.
- Kapitalis (25 Jul 2026); L'Économiste Maghrébin (20 Nov 2026); HRW (6 Oct 2026).
- FAO Irrigation Paper 56 (Table 12, Eq. 62); MASSIRE project (CIRAD); Mekki et al. 2022.

## Assumptions and limits

Demo borehole (Complexe Terminal aquifer, about 100 m total head): 22 kW pump for 50 m³/h, 600 m³ basin, 60 m³/h outlet, 70 % overall efficiency, 30 kWp of panels (80 % performance; solar alone starts the pump at 40 % of its power). The five families are fictional: those whose turn is tonight, with today's need. Summer tariff calendar used all year. Greedy algorithm, not optimal in every case. Next step: a pilot on a real Kebili borehole, recalibrated daily from the water meter (kaizen).
