import { t } from "../i18n";
import type { LanguageCode, SurpriseCutResult } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  surprise: SurpriseCutResult;
}

export function SurpriseCutTest({ lang, surprise }: Props) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t(lang, "surpriseCut")} ({surprise.surprise_cut_label})</h2>
      <div className="grid-3" style={{ marginBottom: "0.6rem" }}>
        <div>
          <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Pumping Lost</span>
          <div><strong>{surprise.pumping_lost_m3} m³</strong></div>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Water Still Delivered</span>
          <div><strong>{surprise.water_still_delivered_m3} m³</strong></div>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Tomorrow Reserve Used</span>
          <div><strong>{surprise.reserve_used_m3} m³</strong></div>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted)" }}>{surprise.notes}</p>
    </section>
  );
}
