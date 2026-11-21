import pytest
from app.schemas.plan import BoreholeConfig, CutWindow, FamilyInput
from app.services.fao56 import compute_family_needs
from app.services.plan_verifier import (
    assemble_hourly_plan,
    build_deterministic_plan,
    build_night_turns,
    verify_raw_hourly_pump,
)
from app.services.weather_service import load_saved_heatwave

CUT_WINDOWS = [
    CutWindow(start_hour=12, end_hour=17),
    CutWindow(start_hour=20, end_hour=2),
    CutWindow(start_hour=8, end_hour=12),
    CutWindow(start_hour=14, end_hour=16),
    CutWindow(start_hour=0, end_hour=0),
]
SOLAR_TYPES = ["grid_tied_anti_islanding", "hybrid"]
QUOTAS = [250.0, 400.0, 500.0, 600.0]
SOLAR_KWS = [0.0, 15.0, 30.0]
FAMILY_COUNTS = [2, 5]
AREAS = [0.8, 1.5]

SCENARIOS = [
    (cw, st, q, skw, fc, area)
    for cw in CUT_WINDOWS
    for st in SOLAR_TYPES
    for q in QUOTAS
    for skw in SOLAR_KWS
    for fc in FAMILY_COUNTS
    for area in AREAS
]  # 5 * 2 * 4 * 3 * 2 * 2 = 480 scenarios


@pytest.mark.parametrize("cw,solar_type,quota,solar_kw,fam_count,area", SCENARIOS)
def test_480_planning_scenarios(cw, solar_type, quota, solar_kw, fam_count, area):
    assert len(SCENARIOS) == 480
    weather = load_saved_heatwave().hourly
    borehole = BoreholeConfig(
        solar_type=solar_type,
        daily_quota_m3=quota,
        solar_kw=solar_kw,
        basin_capacity_m3=600.0,
    )
    families = [
        FamilyInput(id=f"f{i}", name=f"Fam {i}", crop="date_palm", area_ha=area)
        for i in range(fam_count)
    ]
    cut_hours = cw.to_hours()
    needs = compute_family_needs(families, weather)
    s_p, g_p = build_deterministic_plan(weather, borehole, cut_hours, sum(needs.values()))

    ver = verify_raw_hourly_pump(s_p, g_p, weather, borehole, cut_hours)
    assert ver.valid, f"Scenario failed: {ver.errors}"

    total_pumped = sum(s_p) + sum(g_p)
    assert total_pumped <= quota + 0.01

    turns, rel = build_night_turns(families, needs, total_pumped, borehole.gravity_release_m3_h)
    hp = assemble_hourly_plan(s_p, g_p, rel, weather, borehole, cut_hours)
    assert all(0.0 <= e.basin_level_m3 <= borehole.basin_capacity_m3 + 0.01 for e in hp)
    if turns:
        shares = {t.share_pct for t in turns}
        assert len(shares) == 1
