import { t } from "../i18n";
import type { BoreholeConfig, CropType, CutWindow, FamilyInput, LanguageCode, PlanResponse, SolarType, WeatherMode } from "../types/nouba";

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
  onLoadFullCsv: () => void;
  onExportPlanCsv: () => void;
  plan: PlanResponse | null;
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
  onLoadFullCsv,
  onExportPlanCsv,
  plan,
}: Props) {
  const updateFamily = (idx: number, patch: Partial<FamilyInput>) => {
    const next = families.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onFamiliesChange(next);
  };

  const addFamily = () => {
    const nextIdx = families.length + 1;
    onFamiliesChange([
      ...families,
      {
        id: `f${nextIdx}`,
        name: `Family ${nextIdx}`,
        phone: "+216 55 548 015",
        oasis_sector: "Douz Nord",
        plot_code: `P-${nextIdx}`,
        crop: "date_palm",
        area_ha: 1.0,
      },
    ]);
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return;
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idxOf = (key: string) => headers.indexOf(key);

    const parsed: FamilyInput[] = [];
    for (let i = 1; i < lines.length && parsed.length < 50; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const name = cols[idxOf("name")] || cols[idxOf("family_name")] || `Family ${i}`;
      const rawCrop = (cols[idxOf("crop")] || "date_palm") as CropType;
      const crop: CropType =
        rawCrop === "olive" || rawCrop === "vegetables" || rawCrop === "date_palm" ? rawCrop : "date_palm";
      const area = parseFloat(cols[idxOf("area_ha")] || "1.0");
      parsed.push({
        id: cols[idxOf("id")] || `f${i}`,
        name,
        phone: cols[idxOf("phone")] || "+216 55 548 015",
        oasis_sector: idxOf("oasis_sector") >= 0 ? cols[idxOf("oasis_sector")] : "",
        plot_code: idxOf("plot_code") >= 0 ? cols[idxOf("plot_code")] : "",
        crop,
        area_ha: Number.isFinite(area) && area > 0 ? area : 1.0,
      });
    }
    if (parsed.length > 0) onFamiliesChange(parsed);
    e.target.value = "";
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
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.92rem" }}>
          Borehole &amp; Families ({families.length} families loaded — Editable &amp; CSV Import/Export)
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.85rem" }}>
          <button type="button" className="btn" onClick={onLoadFullCsv}>
            Load 25-Family Kebili CSV
          </button>
          <a className="btn" href="/api/families/csv" download="kebili_borehole_families.csv">
            Download 25-Family CSV
          </a>
          <label className="btn" style={{ marginBottom: 0, cursor: "pointer" }}>
            Upload CSV
            <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} style={{ display: "none" }} />
          </label>
          {plan && (
            <button type="button" className="btn" onClick={onExportPlanCsv}>
              Export Plan CSV
            </button>
          )}
          <button type="button" className="btn" onClick={addFamily}>
            + Add Family
          </button>
        </div>

        <div style={{ marginTop: "0.75rem", overflowX: "auto", maxHeight: "340px", overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Family</th>
                <th>Phone</th>
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
                    <input
                      aria-label={`Family ${idx + 1} phone`}
                      value={fam.phone}
                      onChange={(e) => updateFamily(idx, { phone: e.target.value })}
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
