import json
from typing import Literal

from app.config import get_settings
from app.schemas.plan import BoreholeConfig, FamilyInput, HourlyWeather
from app.services.llm_client import LLMUnavailableError, chat_completion, parse_json_content
from app.services.plan_verifier import (
    build_deterministic_plan,
    compute_hourly_solar_kw,
    load_tariff_map,
    max_solar_pump_m3,
    repair_pumps_to_invariants,
    verify_raw_hourly_pump,
)

PLAN_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "solar_pumps": {
            "type": "array",
            "items": {"type": "number"},
            "minItems": 24,
            "maxItems": 24,
        },
        "grid_pumps": {
            "type": "array",
            "items": {"type": "number"},
            "minItems": 24,
            "maxItems": 24,
        },
        "reasoning": {"type": "string"},
    },
    "required": ["solar_pumps", "grid_pumps", "reasoning"],
    "additionalProperties": False,
}


def _build_planner_prompt(
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
    total_need_m3: float,
) -> list[dict[str, str]]:
    tariffs = load_tariff_map()
    solar_kws = compute_hourly_solar_kw(weather, borehole, cut_hours)
    target_m3 = round(
        min(total_need_m3, borehole.daily_quota_m3, borehole.basin_capacity_m3 - borehole.initial_basin_m3),
        2,
    )

    hourly_table = [
        {
            "hour": h.hour,
            "is_cut": h.hour in cut_hours,
            "max_solar_pump_m3": max_solar_pump_m3(solar_kws[h.hour], borehole),
            "grid_tariff_millimes_kwh": tariffs[h.hour],
        }
        for h in weather
    ]

    system_msg = (
        "You are NOUBA, an irrigation pumping planner for a shared oasis borehole in Kebili, Tunisia.\n"
        "Your job is to output a 24-hour pumping schedule as strict JSON with keys: "
        "`solar_pumps` (24 floats), `grid_pumps` (24 floats), and `reasoning` (short string).\n"
        "Hard rules you MUST obey:\n"
        "1. NEVER schedule grid_pumps[h] > 0 when is_cut is true.\n"
        "2. For every hour h: 0 <= solar_pumps[h] <= max_solar_pump_m3[h].\n"
        "3. For every hour h: solar_pumps[h] + grid_pumps[h] <= pump_flow_m3_h.\n"
        "4. Total pumped = sum(solar_pumps) + sum(grid_pumps) <= daily_quota_m3.\n"
        "5. Cumulative pumping before hour 21 + initial_basin_m3 <= basin_capacity_m3 (no overflow).\n"
        "6. Maximize solar_pumps first, avoid evening peak tariff (391 millimes/kWh at 19:00-21:59), "
        "and pump into the basin before 21:00 so gravity release happens at night.\n"
        f"7. Aim to pump target_m3 = {target_m3} m3."
    )

    user_payload = {
        "borehole": {
            "pump_flow_m3_h": borehole.pump_flow_m3_h,
            "pump_power_kw": borehole.pump_power_kw,
            "solar_type": borehole.solar_type,
            "basin_capacity_m3": borehole.basin_capacity_m3,
            "initial_basin_m3": borehole.initial_basin_m3,
            "daily_quota_m3": borehole.daily_quota_m3,
            "target_m3": target_m3,
        },
        "hourly_constraints": hourly_table,
    }

    return [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": json.dumps(user_payload)},
    ]


async def run_llm_planner(
    weather: list[HourlyWeather],
    borehole: BoreholeConfig,
    cut_hours: set[int],
    families: list[FamilyInput],
    needs: dict[str, float],
) -> tuple[list[float], list[float], Literal["llm", "llm_repaired", "fallback"], str, list[str]]:
    """
    Ask the 16GB-VRAM LLM to generate the 24h pumping schedule, verify all invariants,
    attempt 1 self-correction retry if needed, and fall back safely if offline.
    """
    settings = get_settings()
    total_need_m3 = sum(needs.values())
    messages = _build_planner_prompt(weather, borehole, cut_hours, total_need_m3)
    warnings: list[str] = []

    try:
        raw = await chat_completion(messages, temperature=0.1, max_tokens=1000, json_schema=PLAN_JSON_SCHEMA)
        parsed = parse_json_content(raw)
        solar_pumps = [float(x) for x in parsed["solar_pumps"]]
        grid_pumps = [float(x) for x in parsed["grid_pumps"]]
        reasoning = str(parsed.get("reasoning", "")).strip() or "LLM-generated solar-first schedule."

        check = verify_raw_hourly_pump(solar_pumps, grid_pumps, weather, borehole, cut_hours)
        if check.valid:
            return solar_pumps, grid_pumps, "llm", reasoning, warnings

        # 1-shot self-correction retry
        messages.append({"role": "assistant", "content": raw})
        messages.append(
            {
                "role": "user",
                "content": (
                    "Your schedule violated these constraints:\n- "
                    + "\n- ".join(check.errors)
                    + "\nFix the numbers and return the corrected JSON."
                ),
            }
        )
        raw_retry = await chat_completion(messages, temperature=0.05, max_tokens=1000, json_schema=PLAN_JSON_SCHEMA)
        parsed_retry = parse_json_content(raw_retry)
        solar_retry = [float(x) for x in parsed_retry["solar_pumps"]]
        grid_retry = [float(x) for x in parsed_retry["grid_pumps"]]
        reasoning_retry = str(parsed_retry.get("reasoning", reasoning)).strip()

        check_retry = verify_raw_hourly_pump(solar_retry, grid_retry, weather, borehole, cut_hours)
        if check_retry.valid:
            return solar_retry, grid_retry, "llm", reasoning_retry, warnings

        # Deterministic repair if LLM still slightly missed an invariant
        s_fixed, g_fixed = repair_pumps_to_invariants(solar_retry, grid_retry, weather, borehole, cut_hours)
        warnings.append("LLM schedule was clamped by the safety verifier to enforce quota/cut limits.")
        return s_fixed, g_fixed, "llm_repaired", reasoning_retry, warnings

    except (LLMUnavailableError, KeyError, ValueError, TypeError) as exc:
        if not settings.allow_planner_fallback:
            raise
        warnings.append(f"LLM planner unavailable ({exc}); using deterministic solar-first fallback.")
        s_fb, g_fb = build_deterministic_plan(weather, borehole, cut_hours, total_need_m3)
        reasoning_fb = (
            "Fallback schedule: pumps on solar before the STEG cut, fills the basin within quota, "
            "and avoids 19:00-22:00 peak tariffs."
        )
        return s_fb, g_fb, "fallback", reasoning_fb, warnings
