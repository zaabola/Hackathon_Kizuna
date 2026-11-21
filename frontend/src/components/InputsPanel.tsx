import { t } from "../i18n";
import type { BoreholeConfig, CropType, CutWindow, FamilyInput, LanguageCode, SolarType, WeatherMode } from "../types/nouba";

interface Props {
  lang: LanguageCode;
  weatherMode: WeatherMode;
  onWeatherModeChange: (m: WeatherMode) => void;
  cutWindow: CutWindow;
  onCutWindowChange: (cw: CutWindow) => void;
  borehole: BoreholeConfig;
  onBoreholeChange: (b: BoreholeConfig) => void;
  families: FamilyInput[];
  onFamiliesChange: (f: FamilyInput[]) => void;
  loading: boolean;
  onGenerate: () => void;
}

export function InputsPanel({
  lang,
  weatherMode,
  onWeatherModeChange,
  cutWindow,
  onCutWindowChange,
  borehole,
  onBoreholeChange,
  families,
  onFamiliesChange,
  loading,
  onGenerate,
}: Props) {
  const updateFamily = (idx: number, patch: Partial<FamilyInput>) => {
    const next = families.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onFamiliesChange(next);
  };

  return (
    <section className="card" aria-label="Planner inputs">
      <div className="grid-3">
        <div>
          <label htmlFor="weather-mode">{t(lang, "weatherMode")}</label>
          <select
            id="weather-mode"
            value={weatherMode}
            onChange={(e) => onWeatherModeChange(e.target.value as WeatherMode)}
          >
            <option value="heatwave_2026_07_26">{t(lang, "heatwaveDay")}</option>
            <option value="live">{t(lang, "liveForecast")}</option>
          </select>
        </div>

        <div>
          <label htmlFor="cut-start">{t(lang, "cutWindow")} (Start / End)</label>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              id="cut-start"
              type="number"
              min={0}
              max={23}
              aria-label="Cut start hour"
              value={cutWindow.start_hour}
              onChange={(e) => onCutWindowChange({ ...cutWindow, start_hour: Number(e.target.value) })}
            />
            <input
              id="cut-end"
              type="number"
              min={0}
              max={24}
              aria-label="Cut end hour"
              value={cutWindow.end_hour}
              onChange={(e) => onCutWindowChange({ ...cutWindow, end_hour: Number(e.target.value) })}
            />
          </div>
        </div>

        <div>
          <label htmlFor="solar-type">Solar System Type</label>
          <select
            id="solar-type"
            value={borehole.solar_type}
            onChange={(e) => onBoreholeChange({ ...borehole, solar_type: e.target.value as SolarType })}
          >
            <option value="grid_tied_anti_islanding">Grid-tied (Anti-islanding)</option>
            <option value="hybrid">Hybrid (Runs during cut)</option>
          </select>
        </div>
      </div>

      <details style={{ marginTop: "0.9rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
          Borehole &amp; Families (Assumed Demo Setup — Editable)
        </summary>
        <div className="grid-3" style={{ marginTop: "0.75rem" }}>
          <div>
            <label htmlFor="quota-m3">Daily Aquifer Quota (m³)</label>
            <input
              id="quota-m3"
              type="number"
              value={borehole.daily_quota_m3}
              onChange={(e) => onBoreholeChange({ ...borehole, daily_quota_m3: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="basin-m3">Basin Capacity (m³)</label>
            <input
              id="basin-m3"
              type="number"
              value={borehole.basin_capacity_m3}
              onChange={(e) => onBoreholeChange({ ...borehole, basin_capacity_m3: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="solar-kw">Solar Array (kW)</label>
            <input
              id="solar-kw"
              type="number"
              value={borehole.solar_kw}
              onChange={(e) => onBoreholeChange({ ...borehole, solar_kw: Number(e.target.value) })}
            />
          </div>
        </div>

        <div style={{ marginTop: "0.75rem", overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Family</th>
                <th>Crop</th>
                <th>Area (ha)</th>
              </tr>
            </thead>
            <tbody>
              {families.map((fam, idx) => (
                <tr key={fam.id}>
                  <td>
                    <input
                      aria-label={`Family ${idx + 1} name`}
                      value={fam.name}
                      onChange={(e) => updateFamily(idx, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Family ${idx + 1} crop`}
                      value={fam.crop}
                      onChange={(e) => updateFamily(idx, { crop: e.target.value as CropType })}
                    >
                      <option value="date_palm">Date Palm</option>
                      <option value="olive">Olive</option>
                      <option value="vegetables">Vegetables</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Family ${idx + 1} area in hectares`}
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={fam.area_ha}
                      onChange={(e) => updateFamily(idx, { area_ha: Number(e.target.value) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={onGenerate}>
          {loading ? t(lang, "generating") : t(lang, "generatePlan")}
        </button>
      </div>
    </section>
  );
}
