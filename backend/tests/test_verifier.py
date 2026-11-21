from app.schemas.plan import BoreholeConfig, CutWindow, FamilyInput
from app.services.plan_verifier import (
    build_deterministic_plan,
    build_night_turns,
    repair_pumps_to_invariants,
    verify_raw_hourly_pump,
)
from app.services.weather_service import load_saved_heatwave


def test_verifier_rejects_grid_pumping_in_cut():
    weather = load_saved_heatwave().hourly
    borehole = BoreholeConfig()
    cut_hours = CutWindow(start_hour=12, end_hour=17).to_hours()
    solar = [0.0] * 24
    grid = [0.0] * 24
    grid[13] = 40.0  # Inside 12-17 cut!

    res = verify_raw_hourly_pump(solar, grid, weather, borehole, cut_hours)
    assert not res.valid
    assert any("STEG cut window" in e for e in res.errors)


def test_repair_enforces_quota_and_cut():
    weather = load_saved_heatwave().hourly
    borehole = BoreholeConfig(daily_quota_m3=500.0)
    cut_hours = CutWindow(start_hour=12, end_hour=17).to_hours()
    solar = [50.0] * 24
    grid = [50.0] * 24

    s_rep, g_rep = repair_pumps_to_invariants(solar, grid, weather, borehole, cut_hours)
    res = verify_raw_hourly_pump(s_rep, g_rep, weather, borehole, cut_hours)
    assert res.valid
    assert sum(s_rep) + sum(g_rep) <= 500.0 + 0.01
    for h in cut_hours:
        assert g_rep[h] == 0.0


def test_equal_shortage_sharing_and_rotation():
    families = [
        FamilyInput(id="f1", name="Fatma", crop="date_palm", area_ha=1.5),
        FamilyInput(id="f2", name="Ali", crop="date_palm", area_ha=1.0),
        FamilyInput(id="f3", name="Salma", crop="olive", area_ha=2.0),
    ]
    needs = {"f1": 200.0, "f2": 150.0, "f3": 150.0}  # total 500
    turns_0, _ = build_night_turns(families, needs, available_water_m3=250.0, gravity_rate_m3_h=50.0, rotation_offset=0)
    turns_1, _ = build_night_turns(families, needs, available_water_m3=250.0, gravity_rate_m3_h=50.0, rotation_offset=1)

    assert all(t.share_pct == 50.0 for t in turns_0)
    assert turns_0[0].family_id == "f1"
    assert turns_1[0].family_id == "f2"


def test_deterministic_fallback_26_july_heatwave():
    weather = load_saved_heatwave().hourly
    borehole = BoreholeConfig()
    cut_hours = CutWindow(start_hour=12, end_hour=17).to_hours()

    s_p, g_p = build_deterministic_plan(weather, borehole, cut_hours, target_volume_m3=850.0)
    res = verify_raw_hourly_pump(s_p, g_p, weather, borehole, cut_hours)
    assert res.valid
    assert round(sum(s_p) + sum(g_p), 1) == 500.0
