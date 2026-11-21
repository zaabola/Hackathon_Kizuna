from app.schemas.plan import BoreholeConfig, CutWindow, FamilyInput
from app.services.comparison import compute_fixed_rotation_comparisons, simulate_surprise_cut
from app.services.fao56 import compute_family_needs
from app.services.plan_verifier import assemble_hourly_plan, build_deterministic_plan, build_night_turns
from app.services.qa_guard import verify_grounded_answer
from app.services.weather_service import load_saved_heatwave
from app.schemas.plan import PlanResponse


def _sample_plan() -> PlanResponse:
    weather = load_saved_heatwave()
    borehole = BoreholeConfig()
    families = [FamilyInput(id="f1", name="Fatma", crop="date_palm", area_ha=1.2)]
    cut_hours = CutWindow(start_hour=12, end_hour=17).to_hours()
    needs = compute_family_needs(families, weather.hourly)
    s_p, g_p = build_deterministic_plan(weather.hourly, borehole, cut_hours, sum(needs.values()))
    turns, rel = build_night_turns(families, needs, sum(s_p) + sum(g_p), borehole.gravity_release_m3_h)
    hp = assemble_hourly_plan(s_p, g_p, rel, weather.hourly, borehole, cut_hours)
    return PlanResponse(
        weather=weather,
        cut_hours=sorted(cut_hours),
        daily_quota_m3=borehole.daily_quota_m3,
        basin_capacity_m3=borehole.basin_capacity_m3,
        hourly_plan=hp,
        night_turns=turns,
        total_need_m3=sum(needs.values()),
        total_pumped_m3=sum(s_p) + sum(g_p),
        total_delivered_m3=sum(t.allocated_m3 for t in turns),
        total_solar_m3=sum(s_p),
        total_grid_m3=sum(g_p),
        solar_share_pct=80.0,
        total_cost_tnd=10.0,
        planner_source="fallback",
        llm_reasoning="Test",
        warnings=[],
        comparisons=compute_fixed_rotation_comparisons(families, borehole, cut_hours),
        surprise_cut=simulate_surprise_cut(hp, borehole),
    )


def test_qa_guard_rejects_invented_time():
    plan = _sample_plan()
    ok, reason = verify_grounded_answer("Your turn starts at 14:37 today.", plan)
    assert not ok
    assert "14:37" in (reason or "")


def test_qa_guard_rejects_invented_on_the_hour_idle_time():
    plan = _sample_plan()
    ok, reason = verify_grounded_answer("Pumping happens at 03:00 tomorrow.", plan)
    assert not ok
    assert "03:00" in (reason or "")


def test_qa_guard_accepts_plan_time():
    plan = _sample_plan()
    start = plan.night_turns[0].start_time
    ok, reason = verify_grounded_answer(f"Your turn starts at {start} tonight.", plan)
    assert ok
    assert reason is None
