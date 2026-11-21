import { useState } from "react";
import { t } from "../i18n";
import type { HourlyPlanEntry, LanguageCode, PlanResponse } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  plan: PlanResponse;
}

export function PumpingChart({ lang, plan }: Props) {
  const hourly: HourlyPlanEntry[] = plan.hourly_plan;
  const basinCapacity = Math.max(1, plan.basin_capacity_m3);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const width = 820;
  const height = 290;
  const padL = 52;
  const padR = 56;
  const padT = 28;
  const padB = 34;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const colW = chartW / 24;

  const maxFlow = Math.max(
    60,
    ...hourly.map((h) => Math.max(h.total_pump_m3, h.gravity_release_m3))
  );
  const yFlowTicks = [0, Math.round(maxFlow / 2), Math.round(maxFlow)];
  const yBasinTicks = [0, Math.round(basinCapacity / 2), Math.round(basinCapacity)];

  const basinCoords = hourly.map((h, i) => {
    const x = padL + i * colW + colW / 2;
    const y = padT + chartH - (Math.min(h.basin_level_m3, basinCapacity) / basinCapacity) * chartH;
    return { x, y, h };
  });

  const basinLinePoints = basinCoords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const basinAreaPoints =
    `${padL + colW / 2},${padT + chartH} ` +
    basinLinePoints +
    ` ${padL + 23 * colW + colW / 2},${padT + chartH}`;

  const peakBasin = Math.max(...hourly.map((h) => h.basin_level_m3), 0);
  const active = selectedIdx !== null ? hourly[selectedIdx] : null;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0, marginBottom: "0.6rem", fontSize: "1.1rem" }}>
        {t(lang, "pumpingChart")} (06:00 → 05:00 Operational Day)
      </h2>

      {/* Summary KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
          gap: "0.5rem",
          marginBottom: "0.85rem",
        }}
      >
        <div style={{ background: "var(--surface-alt)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Total Pumped</div>
          <strong>{plan.total_pumped_m3} m³</strong>
        </div>
        <div style={{ background: "var(--surface-alt)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Solar Share</div>
          <strong style={{ color: "var(--solar)" }}>{plan.solar_share_pct}%</strong>
        </div>
        <div style={{ background: "var(--surface-alt)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Peak Basin Stored</div>
          <strong style={{ color: "var(--basin)" }}>{peakBasin.toFixed(0)} / {basinCapacity} m³</strong>
        </div>
        <div style={{ background: "var(--surface-alt)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Night Delivered</div>
          <strong style={{ color: "var(--accent)" }}>{plan.total_delivered_m3} m³</strong>
        </div>
        <div style={{ background: "var(--surface-alt)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Electricity Cost</div>
          <strong>{plan.total_cost_tnd} TND</strong>
        </div>
      </div>

      {/* Clear legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
        <span><strong style={{ color: "var(--solar)" }}>■</strong> Solar Pumping (m³/h)</span>
        <span><strong style={{ color: "var(--grid)" }}>■</strong> Grid Pumping (m³/h)</span>
        <span><strong style={{ color: "var(--accent)" }}>■</strong> Night Gravity Release (m³/h)</span>
        <span><strong style={{ color: "var(--basin)" }}>●—</strong> Basin Water Stored (m³)</span>
        <span><strong style={{ color: "var(--cut-border)" }}>░</strong> STEG Power Cut</span>
        <span><strong style={{ color: "#9333ea" }}>░</strong> Peak Tariff (19–22h)</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Operational 24-hour pumping, gravity release, STEG cut, and basin storage chart"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Horizontal gridlines + Left (Flow) & Right (Basin) Y-axes */}
        {yFlowTicks.map((val, idx) => {
          const y = padT + chartH - (val / maxFlow) * chartH;
          const bVal = yBasinTicks[idx];
          return (
            <g key={val}>
              <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
              <text x={padL - 8} y={y + 4} fontSize="10" textAnchor="end" fill="var(--text-muted)">
                {val}
              </text>
              <text x={padL + chartW + 8} y={y + 4} fontSize="10" textAnchor="start" fill="var(--basin)">
                {bVal}
              </text>
            </g>
          );
        })}

        {/* Axis Titles */}
        <text x={8} y={14} fontSize="10" fontWeight="600" fill="var(--text-muted)">
          Flow (m³/h)
        </text>
        <text x={width - 8} y={14} fontSize="10" fontWeight="600" textAnchor="end" fill="var(--basin)">
          Basin (m³)
        </text>

        {/* Soft basin area fill behind bars */}
        <polygon points={basinAreaPoints} fill="var(--basin)" opacity="0.10" />

        {/* Hourly zones & bars */}
        {hourly.map((h, i) => {
          const x = padL + i * colW;
          const isPeak = h.tariff_millimes >= 300;
          const sH = (h.solar_pump_m3 / maxFlow) * chartH;
          const gH = (h.grid_pump_m3 / maxFlow) * chartH;
          const rH = (h.gravity_release_m3 / maxFlow) * chartH;
          const isSelected = selectedIdx === i;

          return (
            <g
              key={h.hour}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => setSelectedIdx(i)}
            >
              {h.is_cut && (
                <rect x={x} y={padT} width={colW - 1} height={chartH} fill="var(--cut-bg)" />
              )}
              {!h.is_cut && isPeak && (
                <rect x={x} y={padT} width={colW - 1} height={chartH} fill="rgba(147, 51, 234, 0.09)" />
              )}
              {isSelected && (
                <rect x={x} y={padT} width={colW - 1} height={chartH} fill="none" stroke="var(--text)" strokeWidth="1.2" />
              )}

              {/* Label first hour of STEG cut or Peak tariff */}
              {h.is_cut && (i === 0 || !hourly[i - 1].is_cut) && (
                <text x={x + 4} y={padT + 12} fontSize="9" fontWeight="700" fill="var(--cut-border)">
                  STEG CUT
                </text>
              )}
              {isPeak && (i === 0 || hourly[i - 1].tariff_millimes < 300) && (
                <text x={x + 3} y={padT + 12} fontSize="9" fontWeight="700" fill="#9333ea">
                  PEAK
                </text>
              )}

              {/* Pump bars (left half of slot if gravity release also active) */}
              {h.solar_pump_m3 > 0 && (
                <rect
                  x={x + 3}
                  y={padT + chartH - sH}
                  width={h.gravity_release_m3 > 0 ? (colW - 8) / 2 : colW - 7}
                  height={sH}
                  fill="var(--solar)"
                  rx={2}
                />
              )}
              {h.grid_pump_m3 > 0 && (
                <rect
                  x={x + 3}
                  y={padT + chartH - sH - gH}
                  width={h.gravity_release_m3 > 0 ? (colW - 8) / 2 : colW - 7}
                  height={gH}
                  fill="var(--grid)"
                  rx={2}
                />
              )}
              {/* Night gravity release bar */}
              {h.gravity_release_m3 > 0 && (
                <rect
                  x={h.total_pump_m3 > 0 ? x + 3 + (colW - 8) / 2 + 1 : x + 3}
                  y={padT + chartH - rH}
                  width={h.total_pump_m3 > 0 ? (colW - 8) / 2 : colW - 7}
                  height={rH}
                  fill="var(--accent)"
                  rx={2}
                  opacity="0.88"
                />
              )}

              {/* X-axis hour label every 2 hours */}
              {i % 2 === 0 && (
                <text x={x + colW / 2} y={height - 10} fontSize="10" textAnchor="middle" fill="var(--text-muted)">
                  {String(h.hour).padStart(2, "0")}:00
                </text>
              )}
            </g>
          );
        })}

        {/* Basin level curve + dots */}
        <polyline fill="none" stroke="var(--basin)" strokeWidth="2.5" points={basinLinePoints} />
        {basinCoords.map((p, i) => (
          <circle
            key={p.h.hour}
            cx={p.x}
            cy={p.y}
            r={selectedIdx === i ? 4.5 : 2.5}
            fill="var(--basin)"
            style={{ pointerEvents: "none" }}
          />
        ))}
      </svg>

      {/* Interactive Hour Inspector */}
      <div
        style={{
          marginTop: "0.6rem",
          padding: "0.55rem 0.75rem",
          borderRadius: 8,
          background: "var(--surface-alt)",
          fontSize: "0.85rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.8rem",
          alignItems: "center",
        }}
      >
        {active ? (
          <>
            <strong>{String(active.hour).padStart(2, "0")}:00–{String((active.hour + 1) % 24).padStart(2, "0")}:00</strong>
            <span>Solar: <strong>{active.solar_pump_m3} m³</strong> ({active.solar_kw_available} kW)</span>
            <span>Grid: <strong>{active.grid_pump_m3} m³</strong></span>
            <span>Night Release: <strong>{active.gravity_release_m3} m³</strong></span>
            <span>Basin: <strong>{active.basin_level_m3} m³</strong></span>
            <span>Tariff: <strong>{active.tariff_millimes} millimes/kWh</strong></span>
            {active.is_cut && <span className="badge" style={{ borderColor: "var(--cut-border)", color: "var(--cut-border)" }}>STEG CUT</span>}
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>
            Hover or tap any hour on the chart to inspect exact solar pumping, grid pumping, gravity release, basin level, and STEG tariff.
          </span>
        )}
      </div>
    </section>
  );
}
