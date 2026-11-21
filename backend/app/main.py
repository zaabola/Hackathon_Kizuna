import csv
import io
from pathlib import Path
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.schemas.messages import (
    FamilyMessageRequest,
    FamilyMessageResponse,
    QARequest,
    QAResponse,
)
from app.schemas.plan import FamilyInput, PlanRequest, PlanResponse, WeatherMode, WeatherResponse
from app.services.comparison import (
    compute_fixed_rotation_comparisons,
    simulate_surprise_cut,
)
from app.services.fao56 import compute_family_needs
from app.services.llm_planner import run_llm_planner
from app.services.message_writer import generate_family_messages
from app.services.plan_verifier import assemble_hourly_plan, build_night_turns
from app.services.qa_guard import answer_family_question
from app.services.weather_service import get_weather

app = FastAPI(title="NOUBA — Fair Oasis Borehole Planner", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str | bool]:
    settings = get_settings()
    llm_ok = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{settings.llm_base_url.rstrip('/')}/models")
            llm_ok = r.status_code == 200
    except Exception:
        llm_ok = False

    return {
        "status": "ok",
        "llm_connected": llm_ok,
        "llm_model": settings.llm_model,
    }


@app.get("/api/weather", response_model=WeatherResponse)
async def api_weather(mode: WeatherMode = "heatwave_2026_07_26") -> WeatherResponse:
    return await get_weather(mode)


@app.get("/api/families/sample", response_model=list[FamilyInput])
async def api_sample_families() -> list[FamilyInput]:
    """Return the full 25-family Kebili borehole dataset from CSV."""
    settings = get_settings()
    csv_path = settings.data_dir / "kebili_borehole_families.csv"
    rows: list[FamilyInput] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            rows.append(
                FamilyInput(
                    id=r["id"],
                    name=r["name"],
                    phone=r.get("phone") or "+216 55 548 015",
                    oasis_sector=r.get("oasis_sector", ""),
                    plot_code=r.get("plot_code", ""),
                    crop=r["crop"],  # type: ignore[arg-type]
                    area_ha=float(r["area_ha"]),
                )
            )
    return rows


@app.get("/api/families/csv")
async def api_download_families_csv() -> FileResponse:
    """Download the Kebili borehole & 25-family CSV file."""
    settings = get_settings()
    csv_path = settings.data_dir / "kebili_borehole_families.csv"
    return FileResponse(
        csv_path,
        media_type="text/csv",
        filename="kebili_borehole_families.csv",
    )


@app.post("/api/plan/export-csv", response_class=PlainTextResponse)
async def api_export_plan_csv(plan: PlanResponse) -> PlainTextResponse:
    """Export today's full borehole + family irrigation plan as a downloadable CSV."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "date",
        "weather_source",
        "daily_quota_m3",
        "basin_capacity_m3",
        "total_pumped_m3",
        "solar_share_pct",
        "total_cost_tnd",
        "family_id",
        "family_name",
        "phone",
        "crop",
        "need_m3",
        "allocated_m3",
        "share_pct",
        "start_time",
        "end_time",
    ])
    for turn in plan.night_turns:
        writer.writerow([
            plan.weather.date,
            plan.weather.source,
            plan.daily_quota_m3,
            plan.basin_capacity_m3,
            plan.total_pumped_m3,
            plan.solar_share_pct,
            plan.total_cost_tnd,
            turn.family_id,
            turn.family_name,
            turn.phone,
            turn.crop,
            turn.need_m3,
            turn.allocated_m3,
            turn.share_pct,
            turn.start_time,
            turn.end_time,
        ])
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="nouba_plan_{plan.weather.date}.csv"'},
    )


@app.post("/api/plan", response_model=PlanResponse)
async def api_plan(req: PlanRequest) -> PlanResponse:
    weather = await get_weather(req.weather_mode)
    cut_hours: set[int] = set()
    for w in req.cut_windows:
        cut_hours |= w.to_hours()

    needs = compute_family_needs(req.families, weather.hourly)
    total_need = round(sum(needs.values()), 2)

    solar_pumps, grid_pumps, source, reasoning, warnings = await run_llm_planner(
        weather.hourly, req.borehole, cut_hours, req.families, needs
    )

    total_pumped = round(sum(solar_pumps) + sum(grid_pumps), 2)
    available_water = min(req.borehole.basin_capacity_m3, req.borehole.initial_basin_m3 + total_pumped)

    night_turns, hourly_release = build_night_turns(
        req.families,
        needs,
        available_water,
        req.borehole.gravity_release_m3_h,
        rotation_offset=req.rotation_offset,
    )

    hourly_plan = assemble_hourly_plan(
        solar_pumps, grid_pumps, hourly_release, weather.hourly, req.borehole, cut_hours
    )

    total_solar = round(sum(e.solar_pump_m3 for e in hourly_plan), 2)
    total_grid = round(sum(e.grid_pump_m3 for e in hourly_plan), 2)
    total_delivered = round(sum(t.allocated_m3 for t in night_turns), 2)
    solar_share = round((total_solar / total_pumped) * 100.0, 1) if total_pumped > 0 else 0.0
    total_cost_tnd = round(sum(e.cost_millimes for e in hourly_plan) / 1000.0, 2)

    comparisons = compute_fixed_rotation_comparisons(
        req.families, req.borehole, cut_hours, daily_target_m3=req.borehole.daily_quota_m3
    )
    surprise = simulate_surprise_cut(hourly_plan, req.borehole, req.surprise_cut_window)

    return PlanResponse(
        weather=weather,
        cut_hours=sorted(cut_hours),
        daily_quota_m3=req.borehole.daily_quota_m3,
        basin_capacity_m3=req.borehole.basin_capacity_m3,
        hourly_plan=hourly_plan,
        night_turns=night_turns,
        total_need_m3=total_need,
        total_pumped_m3=total_pumped,
        total_delivered_m3=total_delivered,
        total_solar_m3=total_solar,
        total_grid_m3=total_grid,
        solar_share_pct=solar_share,
        total_cost_tnd=total_cost_tnd,
        planner_source=source,
        llm_reasoning=reasoning,
        warnings=warnings,
        comparisons=comparisons,
        surprise_cut=surprise,
    )


@app.post("/api/messages", response_model=FamilyMessageResponse)
async def api_messages(req: FamilyMessageRequest) -> FamilyMessageResponse:
    msgs = await generate_family_messages(req.plan, req.language, req.cut_window_label)
    return FamilyMessageResponse(messages=msgs)


@app.post("/api/qa", response_model=QAResponse)
async def api_qa(req: QARequest) -> QAResponse:
    return await answer_family_question(req.plan, req.question, req.language)


# Serve built React frontend in single-port production mode (Kaggle / Colab)
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        dist_root = FRONTEND_DIST.resolve()
        candidate = (dist_root / full_path).resolve()
        if full_path and candidate.is_relative_to(dist_root) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist_root / "index.html")
