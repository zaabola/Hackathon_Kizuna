export type CropType = "date_palm" | "olive" | "vegetables";
export type SolarType = "grid_tied_anti_islanding" | "hybrid";
export type WeatherMode = "live" | "heatwave_2026_07_26";
export type LanguageCode = "ar" | "tn-darija" | "fr" | "en" | "ja";

export interface HourlyWeather {
  hour: number;
  temp_c: number;
  rh_pct: number;
  wind_ms: number;
  et0_mm: number;
  solar_wm2: number;
  rain_mm: number;
}

export interface WeatherResponse {
  location: string;
  date: string;
  source: string;
  is_fallback: boolean;
  hourly: HourlyWeather[];
}

export interface CutWindow {
  start_hour: number;
  end_hour: number;
}

export interface BoreholeConfig {
  pump_power_kw: number;
  pump_flow_m3_h: number;
  solar_kw: number;
  solar_type: SolarType;
  basin_capacity_m3: number;
  initial_basin_m3: number;
  daily_quota_m3: number;
  gravity_release_m3_h: number;
}

export interface FamilyInput {
  id: string;
  name: string;
  phone: string;
  oasis_sector?: string;
  plot_code?: string;
  crop: CropType;
  area_ha: number;
}

export interface PlanRequest {
  weather_mode: WeatherMode;
  cut_windows: CutWindow[];
  borehole: BoreholeConfig;
  families: FamilyInput[];
  rotation_offset: number;
  surprise_cut_window?: CutWindow | null;
}

export interface HourlyPlanEntry {
  hour: number;
  is_cut: boolean;
  solar_kw_available: number;
  tariff_millimes: number;
  solar_pump_m3: number;
  grid_pump_m3: number;
  total_pump_m3: number;
  gravity_release_m3: number;
  basin_level_m3: number;
  cost_millimes: number;
}

export interface NightTurn {
  family_id: string;
  family_name: string;
  phone: string;
  crop: CropType;
  need_m3: number;
  allocated_m3: number;
  share_pct: number;
  start_time: string;
  end_time: string;
}

export interface FixedRotationSummary {
  mode: "clock_running" | "bailiff_paused";
  water_delivered_m3: number;
  families_left_short: number;
  total_families: number;
  electricity_cost_tnd: number;
  irrigation_period: string;
  aquifer_controlled: boolean;
}

export interface SurpriseCutResult {
  surprise_cut_label: string;
  pumping_lost_m3: number;
  water_still_delivered_m3: number;
  reserve_used_m3: number;
  remaining_basin_m3: number;
  notes: string;
}

export interface PlanResponse {
  weather: WeatherResponse;
  cut_hours: number[];
  daily_quota_m3: number;
  basin_capacity_m3: number;
  hourly_plan: HourlyPlanEntry[];
  night_turns: NightTurn[];
  total_need_m3: number;
  total_pumped_m3: number;
  total_delivered_m3: number;
  total_solar_m3: number;
  total_grid_m3: number;
  solar_share_pct: number;
  total_cost_tnd: number;
  planner_source: "llm" | "llm_repaired" | "fallback";
  llm_reasoning: string;
  warnings: string[];
  comparisons: FixedRotationSummary[];
  surprise_cut: SurpriseCutResult;
}

export interface FamilyMessageItem {
  family_id: string;
  family_name: string;
  phone: string;
  language: LanguageCode;
  text: string;
  source: "llm" | "template";
  whatsapp_url: string;
  sms_url: string;
}

export interface QAResponse {
  answer: string;
  grounded: boolean;
  source: "llm" | "fallback";
  rejected_reason?: string | null;
}

export interface HealthResponse {
  status: string;
  llm_connected: boolean;
  llm_model: string;
}
