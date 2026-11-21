import { t } from "../i18n";
import type { HourlyPlanEntry, LanguageCode } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  hourly: HourlyPlanEntry[];
  basinCapacity: number;
}

export function PumpingChart({ lang, hourly, basinCapacity }: Props) {
  const width = 720;
  const height = 220;
  const padL = 36;
  const padB = 26;
  const chartW = width - padL - 12;
  const chartH = height - padB - 16;
  const colW = chartW / 24;
  const maxPump = Math.max(50, ...hourly.map((h) => h.total_pump_m3));

  const basinPoints = hourly
    .map((h, i) => {
      const x = padL + i * colW + colW / 2;
      const y = 16 + chartH - (h.basin_level_m3 / Math.max(1, basinCapacity)) * chartH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <section className="card">
      <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t(lang, "pumpingChart")}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
        <span><strong style={{ color: "var(--solar)" }}>■</strong> Solar Pump</span>
        <span><strong style={{ color: "var(--grid)" }}>■</strong> Grid Pump</span>
        <span><strong style={{ color: "var(--cut-border)" }}>■</strong> STEG Cut</span>
        <span><strong style={{ color: "var(--basin)" }}>—</strong> Basin Level</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24-hour pumping and basin level chart" style={{ width: "100%", height: "auto" }}>
        {hourly.map((h, i) => {
          const x = padL + i * colW;
          const sH = (h.solar_pump_m3 / maxPump) * chartH;
          const gH = (h.grid_pump_m3 / maxPump) * chartH;
          return (
            <g key={h.hour}>
              {h.is_cut && (
                <rect x={x} y={16} width={colW - 2} height={chartH} fill="var(--cut-bg)" />
              )}
              {h.solar_pump_m3 > 0 && (
                <rect x={x + 2} y={16 + chartH - sH} width={colW - 6} height={sH} fill="var(--solar)" rx={2} />
              )}
              {h.grid_pump_m3 > 0 && (
                <rect x={x + 2} y={16 + chartH - sH - gH} width={colW - 6} height={gH} fill="var(--grid)" rx={2} />
              )}
              {i % 3 === 0 && (
                <text x={x + colW / 2} y={height - 6} fontSize="10" textAnchor="middle" fill="var(--text-muted)">
                  {String(h.hour).padStart(2, "0")}h
                </text>
              )}
            </g>
          );
        })}
        <polyline fill="none" stroke="var(--basin)" strokeWidth="2.5" points={basinPoints} />
      </svg>
    </section>
  );
}
