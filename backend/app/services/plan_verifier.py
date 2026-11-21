import json
import math
from dataclasses import dataclass
from functools import lru_cache

OPERATIONAL_HOURS: list[int] = list(range(6, 24)) + list(range(0, 6))

from app.config import get_settings
from app.schemas.plan import (
    BoreholeConfig,
    FamilyInput,
    HourlyPlanEntry,
    HourlyWeather,
    NightTurn,
)


@lru_cache
def load_tariff_map() -> dict[int, int]:
    """Return hour (0..23) -> tariff in millimes/kWh."""
    settings = get_settings()
    raw = json.loads((settings.data_dir / "steg_tariffs.json").read_text(encoding="utf-8"))
    mapping: dict[int, int] = {}
    for slot in raw["slots"].values():
        rate = int(slot["rate_millimes"])
        for h in slot["hours"]:
            mapping[int(h)] = rate
    return mapping


def compute_hourly_solar_kw(
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
) -> list[float]:
    """Estimate available PV power (kW) per hour, honoring anti-islanding."""
    out: list[float] = []
    for h in weather:
        if h.hour in cut_hours and borehole.solar_type == "grid_tied_anti_islanding":
            out.append(0.0)
            continue
        # Simple tilted irradiance factor (~1.05 at Kebili latitude) & 0.85 system derating
        kw = borehole.solar_kw * min(1.0, (h.solar_wm2 / 1000.0) * 1.05) * 0.85
        out.append(round(kw, 2))
    return out


def max_solar_pump_m3(solar_kw: float, borehole: BoreholeConfig) -> float:
    """Maximum m3/h pumpable from solar alone in a given hour."""
    if borehole.pump_power_kw <= 0:
        return 0.0
    ratio = min(1.0, max(0.0, solar_kw / borehole.pump_power_kw))
    return round(borehole.pump_flow_m3_h * ratio, 2)


@dataclass
class VerificationResult:
    valid: bool
    errors: list[str]


def verify_raw_hourly_pump(
    solar_pumps: list[float],
    grid_pumps: list[float],
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
) -> VerificationResult:
    """Check hard physical, STEG cut, aquifer quota, and basin invariants."""
    errors: list[str] = []
    if len(solar_pumps) != 24 or len(grid_pumps) != 24:
        return VerificationResult(False, ["Hourly arrays must have exactly 24 entries."])

    solar_kws = compute_hourly_solar_kw(weather, borehole, cut_hours)
    total_pumped = 0.0
    for h in range(24):
        s_m3 = solar_pumps[h]
        g_m3 = grid_pumps[h]
        if not (math.isfinite(s_m3) and math.isfinite(g_m3)):
            errors.append(f"Hour {h}: non-finite pumping value.")
            continue
        if s_m3 < -1e-3 or g_m3 < -1e-3:
            errors.append(f"Hour {h}: negative pumping ({s_m3}, {g_m3}).")
        if h in cut_hours and g_m3 > 0.05:
            errors.append(f"Hour {h}: grid pumping ({g_m3} m3) inside STEG cut window.")
        s_cap = max_solar_pump_m3(solar_kws[h], borehole)
        if s_m3 > s_cap + 0.2:
            errors.append(f"Hour {h}: solar pumping ({s_m3} m3) exceeds available solar ({s_cap} m3).")
        if s_m3 + g_m3 > borehole.pump_flow_m3_h + 0.2:
            errors.append(f"Hour {h}: total pumping exceeds pump flow ({borehole.pump_flow_m3_h} m3/h).")
        total_pumped += s_m3 + g_m3

    if total_pumped > borehole.daily_quota_m3 + 0.5:
        errors.append(
            f"Total pumped ({total_pumped:.1f} m3) exceeds daily aquifer quota ({borehole.daily_quota_m3:.1f} m3)."
        )

    # Simulate basin accumulation across the full operational day (06:00 -> 05:59)
    basin = borehole.initial_basin_m3
    for h in OPERATIONAL_HOURS:
        s_m3 = solar_pumps[h] if math.isfinite(solar_pumps[h]) else 0.0
        g_m3 = grid_pumps[h] if math.isfinite(grid_pumps[h]) else 0.0
        basin += s_m3 + g_m3
        if basin > borehole.basin_capacity_m3 + 0.5:
            errors.append(f"Hour {h}: basin overflows ({basin:.1f} > {borehole.basin_capacity_m3} m3).")
            break

    return VerificationResult(len(errors) == 0, errors)


def build_night_turns(
    families: list[FamilyInput],
    needs: dict[str, float],
    available_water_m3: float,
    gravity_rate_m3_h: float,
    rotation_offset: int = 0,
    start_hour: int = 21,
) -> tuple[list[NightTurn], list[float]]:
    """
    Share available water equally as a % of each family's need, rotate turn order,
    and compute 24h gravity release array (starting at start_hour, e.g. 21:00).
    """
    total_need = sum(needs.values())
    share_ratio = min(1.0, available_water_m3 / total_need) if total_need > 0 else 0.0
    share_pct = round(share_ratio * 100.0, 1)

    n = len(families)
    offset = rotation_offset % n if n > 0 else 0
    rotated = families[offset:] + families[:offset]

    turns: list[NightTurn] = []
    hourly_release = [0.0] * 24
    current_minute = start_hour * 60

    for fam in rotated:
        need = needs[fam.id]
        alloc = round(need * share_ratio, 2)
        duration_min = int(round((alloc / gravity_rate_m3_h) * 60)) if gravity_rate_m3_h > 0 else 0

        s_min = current_minute
        e_min = current_minute + duration_min
        current_minute = e_min

        def fmt_time(m: int) -> str:
            m_mod = m % (24 * 60)
            return f"{m_mod // 60:02d}:{m_mod % 60:02d}"

        turns.append(
            NightTurn(
                family_id=fam.id,
                family_name=fam.name,
                phone=fam.phone,
                crop=fam.crop,
                need_m3=round(need, 2),
                allocated_m3=alloc,
                share_pct=share_pct,
                start_time=fmt_time(s_min),
                end_time=fmt_time(e_min),
            )
        )

        # Distribute allocated volume into hourly_release buckets (exact closure)
        remaining = alloc
        cursor = s_min
        last_hr = (s_min // 60) % 24
        while remaining > 1e-4 and cursor < e_min:
            hr = (cursor // 60) % 24
            last_hr = hr
            next_hr_min = ((cursor // 60) + 1) * 60
            chunk_min = min(e_min, next_hr_min) - cursor
            chunk_m3 = min(remaining, (chunk_min / 60.0) * gravity_rate_m3_h)
            hourly_release[hr] = round(hourly_release[hr] + chunk_m3, 2)
            remaining -= chunk_m3
            cursor += chunk_min
        if remaining > 1e-4:
            hourly_release[last_hr] = round(hourly_release[last_hr] + remaining, 2)

    return turns, [round(x, 2) for x in hourly_release]


def assemble_hourly_plan(
    solar_pumps: list[float],
    grid_pumps: list[float],
    hourly_release: list[float],
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
) -> list[HourlyPlanEntry]:
    """Assemble full 24h HourlyPlanEntry list in operational order (06:00 -> 05:00) so water balance closes cleanly."""
    tariffs = load_tariff_map()
    solar_kws = compute_hourly_solar_kw(weather, borehole, cut_hours)
    basin = borehole.initial_basin_m3
    entries: list[HourlyPlanEntry] = []

    for h in OPERATIONAL_HOURS:
        s_m3 = round(max(0.0, solar_pumps[h]), 2)
        g_m3 = round(max(0.0, grid_pumps[h]), 2)
        tot_pump = round(s_m3 + g_m3, 2)
        rel = round(max(0.0, hourly_release[h]), 2)

        basin = max(0.0, round(basin + tot_pump - rel, 2))
        kwh_grid = (g_m3 / borehole.pump_flow_m3_h) * borehole.pump_power_kw if borehole.pump_flow_m3_h > 0 else 0.0
        tariff = tariffs[h]
        cost_millimes = round(kwh_grid * tariff, 2)

        entries.append(
            HourlyPlanEntry(
                hour=h,
                is_cut=h in cut_hours,
                solar_kw_available=solar_kws[h],
                tariff_millimes=tariff,
                solar_pump_m3=s_m3,
                grid_pump_m3=g_m3,
                total_pump_m3=tot_pump,
                gravity_release_m3=rel,
                basin_level_m3=basin,
                cost_millimes=cost_millimes,
            )
        )
    return entries


def build_deterministic_plan(
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
    target_volume_m3: float,
) -> tuple[list[float], list[float]]:
    """
    Deterministic solar-first, cheapest-tariff pumping schedule used as fallback
    when the LLM is offline or as a repair target.
    """
    tariffs = load_tariff_map()
    solar_kws = compute_hourly_solar_kw(weather, borehole, cut_hours)
    target = min(target_volume_m3, borehole.daily_quota_m3, borehole.basin_capacity_m3 - borehole.initial_basin_m3)
    target = max(0.0, target)

    solar_pumps = [0.0] * 24
    grid_pumps = [0.0] * 24
    pumped = 0.0

    # Pass 1: Solar-first during non-cut daytime hours (or any hour if hybrid)
    for h in range(24):
        if pumped >= target - 1e-3:
            break
        if h in cut_hours and borehole.solar_type == "grid_tied_anti_islanding":
            continue
        s_cap = max_solar_pump_m3(solar_kws[h], borehole)
        if s_cap > 0:
            take = min(s_cap, target - pumped)
            solar_pumps[h] = round(take, 2)
            pumped += take

    # Pass 2: Cheapest non-cut grid hours (night 116 -> day 140 -> peak 391), preferring hours <= 20 before night release
    candidate_hours = [h for h in range(24) if h not in cut_hours]
    candidate_hours.sort(key=lambda h: (tariffs[h], 0 if h < 21 else 1, h))

    for h in candidate_hours:
        if pumped >= target - 1e-3:
            break
        headroom = borehole.pump_flow_m3_h - solar_pumps[h]
        if headroom > 0:
            take = min(headroom, target - pumped)
            grid_pumps[h] = round(take, 2)
            pumped += take

    return solar_pumps, grid_pumps


def repair_pumps_to_invariants(
    solar_pumps: list[float],
    grid_pumps: list[float],
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
) -> tuple[list[float], list[float]]:
    """Clamp an LLM-proposed schedule so all hard invariants hold."""
    solar_kws = compute_hourly_solar_kw(weather, borehole, cut_hours)
    s_out = [max(0.0, float(x)) for x in (solar_pumps + [0.0] * 24)[:24]]
    g_out = [max(0.0, float(x)) for x in (grid_pumps + [0.0] * 24)[:24]]

    for h in range(24):
        if h in cut_hours:
            g_out[h] = 0.0
        s_cap = max_solar_pump_m3(solar_kws[h], borehole)
        s_out[h] = min(s_out[h], s_cap)
        if s_out[h] + g_out[h] > borehole.pump_flow_m3_h:
            g_out[h] = max(0.0, borehole.pump_flow_m3_h - s_out[h])

    # Enforce daily quota & basin capacity
    max_allowed = min(borehole.daily_quota_m3, borehole.basin_capacity_m3 - borehole.initial_basin_m3)
    total = sum(s_out) + sum(g_out)
    if total > max_allowed and total > 0:
        scale = max_allowed / total
        s_out = [round(x * scale, 2) for x in s_out]
        g_out = [round(x * scale, 2) for x in g_out]
        # Trim any tiny floating-point rounding overshoot
        excess = round(sum(s_out) + sum(g_out) - max_allowed, 2)
        if excess > 0:
            for arr in (g_out, s_out):
                for idx in range(23, -1, -1):
                    if arr[idx] >= excess:
                        arr[idx] = round(arr[idx] - excess, 2)
                        excess = 0.0
                        break
                if excess <= 0:
                    break
    else:
        s_out = [round(x, 2) for x in s_out]
        g_out = [round(x, 2) for x in g_out]

    return s_out, g_out
