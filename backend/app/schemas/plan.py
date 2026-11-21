from typing import Literal
from pydantic import BaseModel, Field, model_validator


CropType = Literal["date_palm", "olive", "vegetables"]
SolarType = Literal["grid_tied_anti_islanding", "hybrid"]
WeatherMode = Literal["live", "heatwave_2026_07_26"]


class HourlyWeather(BaseModel):
    hour: int = Field(..., ge=0, le=23)
    temp_c: float
    rh_pct: float = Field(..., ge=0, le=100)
    wind_ms: float = Field(..., ge=0)
    et0_mm: float = Field(..., ge=0)
    solar_wm2: float = Field(..., ge=0)
    rain_mm: float = Field(0.0, ge=0)


class WeatherResponse(BaseModel):
    location: str
    date: str
    source: str
    is_fallback: bool
    hourly: list[HourlyWeather]


class CutWindow(BaseModel):
    start_hour: int = Field(..., ge=0, le=23)
    end_hour: int = Field(..., ge=0, le=24)

    def to_hours(self) -> set[int]:
        """Expand start/end into a set of cut hours (0..23), supporting overnight windows."""
        if self.start_hour == self.end_hour:
            return set()
        if self.start_hour < self.end_hour:
            return set(range(self.start_hour, min(self.end_hour, 24)))
        # Overnight window e.g. 20:00 -> 02:00
        return set(range(self.start_hour, 24)) | set(range(0, self.end_hour))


class BoreholeConfig(BaseModel):
    pump_power_kw: float = Field(22.0, gt=0, le=200)
    pump_flow_m3_h: float = Field(50.0, gt=0, le=300)
    solar_kw: float = Field(30.0, ge=0, le=500)
    solar_type: SolarType = "grid_tied_anti_islanding"
    basin_capacity_m3: float = Field(600.0, gt=0, le=5000)
    initial_basin_m3: float = Field(0.0, ge=0, le=5000)
    daily_quota_m3: float = Field(500.0, gt=0, le=5000)
    gravity_release_m3_h: float = Field(60.0, gt=0, le=300)

    @model_validator(mode="after")
    def check_initial_basin(self) -> "BoreholeConfig":
        if self.initial_basin_m3 > self.basin_capacity_m3:
            raise ValueError("initial_basin_m3 cannot exceed basin_capacity_m3")
        return self


class FamilyInput(BaseModel):
    id: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=64)
    phone: str = Field("+216 55 548 015", max_length=32)
    oasis_sector: str = Field("", max_length=64)
    plot_code: str = Field("", max_length=32)
    crop: CropType = "date_palm"
    area_ha: float = Field(..., gt=0, le=100)


class PlanRequest(BaseModel):
    weather_mode: WeatherMode = "heatwave_2026_07_26"
    cut_windows: list[CutWindow] = Field(default_factory=lambda: [CutWindow(start_hour=12, end_hour=17)])
    borehole: BoreholeConfig = Field(default_factory=BoreholeConfig)
    families: list[FamilyInput] = Field(..., min_length=1, max_length=50)
    rotation_offset: int = Field(0, ge=0)
    surprise_cut_window: CutWindow | None = None


class HourlyPlanEntry(BaseModel):
    hour: int = Field(..., ge=0, le=23)
    is_cut: bool
    solar_kw_available: float
    tariff_millimes: int
    solar_pump_m3: float = Field(..., ge=0)
    grid_pump_m3: float = Field(..., ge=0)
    total_pump_m3: float = Field(..., ge=0)
    gravity_release_m3: float = Field(..., ge=0)
    basin_level_m3: float = Field(..., ge=0)
    cost_millimes: float = Field(..., ge=0)


class NightTurn(BaseModel):
    family_id: str
    family_name: str
    phone: str = "+216 55 548 015"
    crop: CropType
    need_m3: float
    allocated_m3: float
    share_pct: float
    start_time: str
    end_time: str


class FixedRotationSummary(BaseModel):
    mode: Literal["clock_running", "bailiff_paused"]
    water_delivered_m3: float
    families_left_short: int
    total_families: int
    electricity_cost_tnd: float
    irrigation_period: str
    aquifer_controlled: bool


class SurpriseCutResult(BaseModel):
    surprise_cut_label: str
    pumping_lost_m3: float
    water_still_delivered_m3: float
    reserve_used_m3: float
    remaining_basin_m3: float
    notes: str


class PlanResponse(BaseModel):
    weather: WeatherResponse
    cut_hours: list[int]
    daily_quota_m3: float
    basin_capacity_m3: float
    hourly_plan: list[HourlyPlanEntry]
    night_turns: list[NightTurn]
    total_need_m3: float
    total_pumped_m3: float
    total_delivered_m3: float
    total_solar_m3: float
    total_grid_m3: float
    solar_share_pct: float
    total_cost_tnd: float
    planner_source: Literal["llm", "llm_repaired", "fallback"]
    llm_reasoning: str
    warnings: list[str]
    comparisons: list[FixedRotationSummary]
    surprise_cut: SurpriseCutResult
