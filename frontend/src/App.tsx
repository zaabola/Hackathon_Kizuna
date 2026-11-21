import { useEffect, useState } from "react";
import { fetchHealth, generateMessages, generatePlan } from "./api/client";
import { ComparisonCards } from "./components/ComparisonCards";
import { FamilyMessages } from "./components/FamilyMessages";
import { FamilyQA } from "./components/FamilyQA";
import { HeaderBar } from "./components/HeaderBar";
import { InputsPanel } from "./components/InputsPanel";
import { NightSchedule } from "./components/NightSchedule";
import { PumpingChart } from "./components/PumpingChart";
import { SurpriseCutTest } from "./components/SurpriseCutTest";
import { isRtlLanguage } from "./i18n";
import type {
  BoreholeConfig,
  CutWindow,
  FamilyInput,
  FamilyMessageItem,
  HealthResponse,
  LanguageCode,
  PlanResponse,
  WeatherMode,
} from "./types/nouba";

const DEFAULT_BOREHOLE: BoreholeConfig = {
  pump_power_kw: 22,
  pump_flow_m3_h: 50,
  solar_kw: 30,
  solar_type: "grid_tied_anti_islanding",
  basin_capacity_m3: 600,
  initial_basin_m3: 0,
  daily_quota_m3: 500,
  gravity_release_m3_h: 60,
};

const DEFAULT_FAMILIES: FamilyInput[] = [
  { id: "f1", name: "Fatma", crop: "date_palm", area_ha: 1.4 },
  { id: "f2", name: "Ali", crop: "date_palm", area_ha: 1.2 },
  { id: "f3", name: "Salma", crop: "date_palm", area_ha: 1.1 },
  { id: "f4", name: "Hedi", crop: "olive", area_ha: 1.8 },
  { id: "f5", name: "Noura", crop: "vegetables", area_ha: 0.9 },
];

export function App() {
  const [lang, setLang] = useState<LanguageCode>("en");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [weatherMode, setWeatherMode] = useState<WeatherMode>("heatwave_2026_07_26");
  const [cutWindow, setCutWindow] = useState<CutWindow>({ start_hour: 12, end_hour: 17 });
  const [borehole, setBorehole] = useState<BoreholeConfig>(DEFAULT_BOREHOLE);
  const [families, setFamilies] = useState<FamilyInput[]>(DEFAULT_FAMILIES);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [messages, setMessages] = useState<FamilyMessageItem[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dir = isRtlLanguage(lang) ? "rtl" : "ltr";
    document.documentElement.lang = lang === "tn-darija" ? "ar" : lang;
  }, [lang]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
    void handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cutLabel = `${String(cutWindow.start_hour).padStart(2, "0")}:00-${String(cutWindow.end_hour).padStart(2, "0")}:00`;

  const handleGenerate = async () => {
    setLoadingPlan(true);
    setError(null);
    try {
      const nextPlan = await generatePlan({
        weather_mode: weatherMode,
        cut_windows: [cutWindow],
        borehole,
        families,
        rotation_offset: 0,
      });
      setPlan(nextPlan);
      setLoadingMsgs(true);
      const msgRes = await generateMessages(nextPlan, lang, cutLabel);
      setMessages(msgRes.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate plan");
    } finally {
      setLoadingPlan(false);
      setLoadingMsgs(false);
    }
  };

  const handleRefreshMessages = async (targetLang: LanguageCode = lang) => {
    if (!plan) return;
    setLoadingMsgs(true);
    setError(null);
    try {
      const msgRes = await generateMessages(plan, targetLang, cutLabel);
      setMessages(msgRes.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh messages");
    } finally {
      setLoadingMsgs(false);
    }
  };

  const handleLangChange = (nextLang: LanguageCode) => {
    setLang(nextLang);
    void handleRefreshMessages(nextLang);
  };

  return (
    <main className="container">
      <HeaderBar
        lang={lang}
        onLangChange={handleLangChange}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
        health={health}
      />

      <InputsPanel
        lang={lang}
        weatherMode={weatherMode}
        onWeatherModeChange={setWeatherMode}
        cutWindow={cutWindow}
        onCutWindowChange={setCutWindow}
        borehole={borehole}
        onBoreholeChange={setBorehole}
        families={families}
        onFamiliesChange={setFamilies}
        loading={loadingPlan}
        onGenerate={handleGenerate}
      />

      {error && <div className="warn-box" role="alert">{error}</div>}

      {plan && (
        <>
          {plan.warnings.length > 0 && (
            <div className="warn-box" role="status">
              {plan.warnings.join(" ")}
            </div>
          )}

          <section className="card">
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem" }}>
              <div>
                <strong>Weather:</strong> {plan.weather.source} ({plan.weather.date})
              </div>
              <span className="badge">Planner: {plan.planner_source}</span>
            </div>
            <p style={{ margin: "0.5rem 0 0 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              {plan.llm_reasoning}
            </p>
          </section>

          <PumpingChart lang={lang} hourly={plan.hourly_plan} basinCapacity={plan.basin_capacity_m3} />
          <NightSchedule lang={lang} turns={plan.night_turns} />
          <ComparisonCards lang={lang} plan={plan} />
          <SurpriseCutTest lang={lang} surprise={plan.surprise_cut} />
          <FamilyMessages
            lang={lang}
            messages={messages}
            loading={loadingMsgs}
            onRefresh={() => void handleRefreshMessages()}
          />
          <FamilyQA lang={lang} plan={plan} />
        </>
      )}
    </main>
  );
}
