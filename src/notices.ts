// A STEG load-shedding notice for Kebili, as api/steg.ts reads it from steg.com.tn (shared with the app).
export interface Notice {
  url: string
  publishedAt: string     // as shown by STEG, "03/09/2026 - 12:37"
  date: string            // YYYY-MM-DD of the cut
  start: number; end: number       // whole hours covering the window (worst case), end 24 = midnight
  window: string          // exact window, "09:30–18:00"
  localities: string[]    // Kebili localities named in the notice
  intermittent: boolean   // "على فترات متقطّعة"
  maxBlockHours: number | null     // "على أن لا تتجاوز ساعتين للفترة الواحدة" -> 2
}

// Two notices can share a date (28 Aug 2026: 09:00-18:00 and 21:00-24:00): the planner takes one window, so it takes
// the one that hits the pumping hours (06:00-18:00) most.
export const noticeFor = (list: Notice[], date: string) => list.filter(n => n.date === date)
  .sort((a, b) => Math.max(0, Math.min(18, b.end) - Math.max(6, b.start)) - Math.max(0, Math.min(18, a.end) - Math.max(6, a.start)))[0]
