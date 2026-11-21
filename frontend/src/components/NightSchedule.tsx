import { t } from "../i18n";
import type { LanguageCode, NightTurn } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  turns: NightTurn[];
}

export function NightSchedule({ lang, turns }: Props) {
  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t(lang, "nightSchedule")}</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Family</th>
              <th>Crop</th>
              <th>Window</th>
              <th>Allocated</th>
              <th>Need</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {turns.map((turn) => (
              <tr key={turn.family_id}>
                <td><strong>{turn.family_name}</strong></td>
                <td>{turn.crop.replace("_", " ")}</td>
                <td>{turn.start_time} – {turn.end_time}</td>
                <td><strong>{turn.allocated_m3} m³</strong></td>
                <td>{turn.need_m3} m³</td>
                <td><span className="badge">{turn.share_pct}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
