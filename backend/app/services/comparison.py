from app.schemas.plan import (
    BoreholeConfig,
    CutWindow,
    FamilyInput,
    FixedRotationSummary,
    HourlyPlanEntry,
    SurpriseCutResult,
)
from app.services.plan_verifier import load_tariff_map


def compute_fixed_rotation_comparisons(
    families: list[FamilyInput],
    borehole: BoreholeConfig,
    cut_hours: set[int],
    daily_target_m3: float = 500.0,
) -> list[FixedRotationSummary]:
    """
    Compare NOUBA against traditional fixed rotation:
    1) clock_running: fixed hours starting at 12:00; turns in cut hours are lost.
    2) bailiff_paused: bailiff pauses during cut and resumes after, slipping into 19:00-22:00 peak.
    """
    tariffs = load_tariff_map()
    n_fam = max(1, len(families))
    flow = borehole.pump_flow_m3_h
    hours_needed = min(12, max(1, int(round(daily_target_m3 / flow)))) if flow > 0 else 10
    start_hour = 12
    kwh_per_hour = borehole.pump_power_kw

    # Mode 1: Clock keeps running (12:00 .. 12:00 + hours_needed)
    delivered_clock = 0.0
    cost_clock_millimes = 0.0
    hours_per_fam = hours_needed / n_fam
    fam_short_clock = 0

    for i in range(n_fam):
        fam_start = start_hour + i * hours_per_fam
        fam_end = fam_start + hours_per_fam
        fam_delivered = 0.0
        for h in range(int(fam_start), min(24, int(fam_end + 0.999))):
            overlap = min(fam_end, h + 1) - max(fam_start, h)
            if overlap <= 0:
                continue
            if h not in cut_hours:
                fam_delivered += overlap * flow
                cost_clock_millimes += overlap * kwh_per_hour * tariffs[h]
        delivered_clock += fam_delivered
        if fam_delivered < hours_per_fam * flow * 0.95:
            fam_short_clock += 1

    # Mode 2: Bailiff pauses during cut and resumes after (can wrap past midnight)
    delivered_paused = 0.0
    cost_paused_millimes = 0.0
    h_cursor = start_hour
    pumped_hours = 0
    last_hour = start_hour
    while pumped_hours < hours_needed and h_cursor < start_hour + 24:
        hr = h_cursor % 24
        if hr not in cut_hours:
            delivered_paused += flow
            cost_paused_millimes += kwh_per_hour * tariffs[hr]
            pumped_hours += 1
            last_hour = hr
        h_cursor += 1

    return [
        FixedRotationSummary(
            mode="clock_running",
            water_delivered_m3=round(delivered_clock, 1),
            families_left_short=fam_short_clock,
            total_families=n_fam,
            electricity_cost_tnd=round(cost_clock_millimes / 1000.0, 2),
            irrigation_period=f"{start_hour:02d}:00-{(start_hour + hours_needed) % 24:02d}:00 (direct)",
            aquifer_controlled=False,
        ),
        FixedRotationSummary(
            mode="bailiff_paused",
            water_delivered_m3=round(delivered_paused, 1),
            families_left_short=0 if pumped_hours == hours_needed else n_fam,
            total_families=n_fam,
            electricity_cost_tnd=round(cost_paused_millimes / 1000.0, 2),
            irrigation_period=f"{start_hour:02d}:00-{(last_hour + 1) % 24:02d}:00 (afternoon & peak)",
            aquifer_controlled=False,
        ),
    ]


def simulate_surprise_cut(
    hourly_plan: list[HourlyPlanEntry],
    borehole: BoreholeConfig,
    surprise_window: CutWindow | None = None,
) -> SurpriseCutResult:
    """Stress-test the planned schedule against an unannounced power cut."""
    window = surprise_window or CutWindow(start_hour=9, end_hour=11)
    surprise_hours = window.to_hours()
    label = f"{window.start_hour:02d}:00-{window.end_hour:02d}:00"

    planned_total = sum(e.total_pump_m3 for e in hourly_plan)
    lost_m3 = 0.0
    for e in hourly_plan:
        if e.hour in surprise_hours:
            if borehole.solar_type == "grid_tied_anti_islanding":
                lost_m3 += e.total_pump_m3
            else:
                lost_m3 += e.grid_pump_m3

    lost_m3 = round(lost_m3, 1)
    remaining_pumped = max(0.0, round(planned_total - lost_m3, 1))
    available_with_initial = round(remaining_pumped + borehole.initial_basin_m3, 1)
    reserve_used = min(borehole.initial_basin_m3, lost_m3)
    remaining_basin = max(0.0, round(borehole.initial_basin_m3 - reserve_used, 1))

    if lost_m3 == 0:
        notes = f"No pumping was scheduled during {label}; 100% of night turns remain protected."
    elif available_with_initial >= planned_total:
        notes = f"Basin reserve absorbs the {lost_m3} m³ loss during {label}; all night turns stay intact."
    else:
        notes = (
            f"An unannounced cut at {label} drops pumping by {lost_m3} m³. "
            f"{available_with_initial} m³ still reaches families tonight; NOUBA re-plans remaining non-cut hours."
        )

    return SurpriseCutResult(
        surprise_cut_label=label,
        pumping_lost_m3=lost_m3,
        water_still_delivered_m3=available_with_initial,
        reserve_used_m3=round(reserve_used, 1),
        remaining_basin_m3=remaining_basin,
        notes=notes,
    )
