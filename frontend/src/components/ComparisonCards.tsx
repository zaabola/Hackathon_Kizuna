import { t } from "../i18n";
import type { LanguageCode, PlanResponse } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  plan: PlanResponse;
}

export function ComparisonCards({ lang, plan }: Props) {
  const clock = plan.comparisons.find((c) => c.mode === "clock_running");
  const paused = plan.comparisons.find((c) => c.mode === "bailiff_paused");

  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t(lang, "comparison")}</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              <th>NOUBA</th>
              <th>Fixed (Clock Running)</th>
              <th>Fixed (Bailiff Paused)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Water Delivered</td>
              <td><strong>{plan.total_delivered_m3} m³</strong></td>
              <td>{clock?.water_delivered_m3 ?? "-"} m³</td>
              <td>{paused?.water_delivered_m3 ?? "-"} m³</td>
            </tr>
            <tr>
              <td>Families Left Short by Cut</td>
              <td><strong>0 of {plan.night_turns.length}</strong></td>
              <td>{clock ? `${clock.families_left_short} of ${clock.total_families}` : "-"}</td>
              <td>{paused ? `${paused.families_left_short} of ${paused.total_families}` : "-"}</td>
            </tr>
            <tr>
              <td>Electricity Cost</td>
              <td><strong>{plan.total_cost_tnd} TND</strong> ({plan.solar_share_pct}% solar)</td>
              <td>{clock?.electricity_cost_tnd ?? "-"} TND</td>
              <td>{paused?.electricity_cost_tnd ?? "-"} TND</td>
            </tr>
            <tr>
              <td>Aquifer Quota</td>
              <td><strong>Protected</strong></td>
              <td>Not controlled</td>
              <td>Not controlled</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
