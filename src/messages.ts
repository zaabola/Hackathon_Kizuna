// The SMS each family receives, shared by the app and the autopilot so both send exactly the same words.
import { fmtClock, type SmsLang, type Turn } from './planner.ts'

const r0 = (x: number) => Math.round(x).toLocaleString('en-US')
// A family whose need is zero (rain covered it) is fully served.
export const pctOf = (x: { allot: number; need: number }) => (x.need > 0 ? Math.round(x.allot / x.need * 100) : 100)

export const SMS_LANGS: [SmsLang, string][] = [['ar', 'العربية'], ['fr', 'Français'], ['en', 'English'], ['ja', '日本語']]

export const TEMPLATES: Record<SmsLang, (t: Turn, pct: number, cut: [string, string] | null) => string> = {
  en: (t, pct, cut) => `NOUBA – ${t.name}: your water turn tonight is ${fmtClock(t.start)} to ${fmtClock(t.end)}, ${r0(t.allot)} m³ (${pct} % of your need).${cut ? ` STEG cut ${cut[0]}–${cut[1]}: the basin is filled before it; if the cut changes, you will get a new message.` : ''}`,
  fr: (t, pct, cut) => `NOUBA – ${t.name} : votre tour d'eau cette nuit de ${fmtClock(t.start)} à ${fmtClock(t.end)}, ${r0(t.allot)} m³ (${pct} % du besoin).${cut ? ` Coupure STEG ${cut[0]}–${cut[1]} : le bassin est rempli avant ; si la coupure change, vous recevrez un nouveau SMS.` : ''}`,
  ar: (t, pct, cut) => `نوبة – ${t.name}: نوبتك في السقي الليلة من ${fmtClock(t.start)} إلى ${fmtClock(t.end)}، ${r0(t.allot)} م³ (${pct}٪ من حاجتك).${cut ? ` انقطاع الكهرباء من ${cut[0]} إلى ${cut[1]}: يُملأ الحوض قبل الانقطاع، وإذا تغيّر الانقطاع نرسل لك رسالة جديدة.` : ''}`,
  ja: (t, pct, cut) => `NOUBA – ${t.name}さん：今夜の給水は${fmtClock(t.start)}〜${fmtClock(t.end)}、${r0(t.allot)}m³（必要量の${pct}%）です。${cut ? `${cut[0]}〜${cut[1]}の停電前に貯水池に水をためます。停電時間が変わった場合は、再度お知らせします。` : ''}`,
}

// Put in front of a message re-sent because STEG changed the cut after the first one.
export const UPDATE: Record<SmsLang, string> = { en: 'Update: ', fr: 'Mise à jour : ', ar: 'تحديث: ', ja: '更新：' }
