from app.schemas.plan import BoreholeConfig, CutWindow, FamilyInput
from app.services.comparison import compute_fixed_rotation_comparisons, simulate_surprise_cut
from app.services.plan_verifier import assemble_hourly_plan, build_deterministic_plan
from app.services.weather_service import load_saved_heatwave


def test_demo_day_comparison_250_vs_500():
    borehole = BoreholeConfig(pump_power_kw=22.0, pump_flow_m3_h=50.0, daily_quota_m3=500.0)
    families = [FamilyInput(id=f"f{i}", name=f"Fam {i}", crop="date_palm", area_ha=1.2) for i in range(5)]
    cut_hours = CutWindow(start_hour=12, end_hour=17).to_hours()

    comps = compute_fixed_rotation_comparisons(families, borehole, cut_hours, daily_target_m3=500.0)
    clock = next(c for c in comps if c.mode == "clock_running")
    paused = next(c for c in comps if c.mode == "bailiff_paused")

    assert clock.water_delivered_m3 == 250.0
    assert clock.families_left_short == 3
    assert paused.water_delivered_m3 == 500.0
    assert paused.electricity_cost_tnd > 30.0  # Runs into 19:00-22:00 peak


def test_surprise_cut_stress_test():
    weather = load_saved_heatwave().hourly
    borehole = BoreholeConfig(initial_basin_m3=100.0)
    cut_hours = CutWindow(start_hour=12, end_hour=17).to_hours()
    s_p, g_p = build_deterministic_plan(weather, borehole, cut_hours, target_volume_m3=500.0)
    hourly_plan = assemble_hourly_plan(s_p, g_p, [0.0] * 24, weather, borehole, cut_hours)

    res = simulate_surprise_cut(hourly_plan, borehole, CutWindow(start_hour=9, end_hour=11))
    assert res.surprise_cut_label == "09:00-11:00"
    assert res.water_still_delivered_m3 > 0
