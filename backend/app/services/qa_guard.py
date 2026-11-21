import json
import re

from app.schemas.messages import LanguageCode, QAResponse
from app.schemas.plan import PlanResponse
from app.services.llm_client import LLMUnavailableError, chat_completion

TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\b")


def extract_allowed_times(plan: PlanResponse) -> set[str]:
    """Collect active timestamps in today's plan plus official STEG peak & night window boundaries."""
    allowed: set[str] = {"19:00", "22:00", "21:00", "06:00"}
    for t in plan.night_turns:
        allowed.add(t.start_time)
        allowed.add(t.end_time)
    for h in plan.hourly_plan:
        if h.is_cut or h.total_pump_m3 > 0 or h.gravity_release_m3 > 0:
            allowed.add(f"{h.hour:02d}:00")
            allowed.add(f"{(h.hour + 1) % 24:02d}:00")
    return allowed


def verify_grounded_answer(answer: str, plan: PlanResponse) -> tuple[bool, str | None]:
    """Reject any answer that invents a timestamp not in the plan."""
    allowed_times = extract_allowed_times(plan)
    found_times = TIME_RE.findall(answer)
    for ts in found_times:
        normalized = ts.zfill(5) if len(ts) == 4 else ts
        if normalized not in allowed_times:
            return False, f"Invented time '{ts}' not found in the day's plan."
    return True, None


def _format_cut_range(cut_hours: list[int]) -> str:
    if not cut_hours:
        return "none"
    return f"{cut_hours[0]:02d}:00-{(cut_hours[-1] + 1) % 24:02d}:00"


def build_grounded_fallback_answer(
    plan: PlanResponse,
    language: LanguageCode,
    question: str = "",
) -> str:
    """Question-aware deterministic fallback answer built strictly from the plan."""
    q = question.lower()
    share = plan.night_turns[0].share_pct if plan.night_turns else 100.0
    pumped = round(plan.total_pumped_m3, 1)
    need = round(plan.total_need_m3, 1)
    quota = round(plan.daily_quota_m3, 1)
    solar_pct = round(plan.solar_share_pct, 1)
    cost = round(plan.total_cost_tnd, 2)
    max_temp = round(max((h.temp_c for h in plan.weather.hourly), default=40.0), 1)
    cut_range = _format_cut_range(plan.cut_hours)

    asks_shortage = any(k in q for k in ("%", "short", "less", "quota", "only", "pourquoi", "moins", "علاش", "لماذا", "نقص", "حصة", "少ない"))
    asks_night = any(k in q for k in ("night", "tonight", "evening", "nuit", "soir", "الليلة", "ليل", "今夜", "夜"))
    asks_cost = any(k in q for k in ("cost", "price", "tnd", "solar", "electric", "coût", "solaire", "سعر", "شمس", "電気", "コスト"))
    asks_cut = any(k in q for k in ("cut", "steg", "power", "coupure", "انقطاع", "قصان", "ضوء", "停電"))

    if language in ("ar", "tn-darija"):
        if asks_shortage:
            return (
                f"السبب هو أن حاجة العائلات اليوم تبلغ {need} م³ بسبب الحرارة ({max_temp} °C)، لكن الحصة اليومية لحماية البئر محددة بـ {quota} م³. "
                f"لذلك يوزع نوبة الكمية المتاحة ({pumped} م³) بالتساوي بحيث تأخذ كل عائلة نفس النسبة ({share}%)."
            )
        if asks_night or asks_cut:
            return (
                f"السبب هو أن الحرارة نهاراً تصل إلى {max_temp} °C مما يزيد التبخر، كما يوجد انقطاع STEG ({cut_range}) وذروة غالية بين 19:00 و22:00. "
                f"لذلك نضخ المياه بالطاقة الشمسية ({solar_pct}%) في الحوض نهاراً ونوزعها ليلاً بالجاذبية بدون كهرباء."
            )
        if asks_cost:
            return (
                f"التكلفة اليوم هي {cost} دينار لأن {solar_pct}% من الضخ ({pumped} م³) يتم بالطاقة الشمسية مع تجنب ساعات الذروة (19:00-22:00)."
            )
        return (
            f"السبب في خطة اليوم: الحرارة ({max_temp} °C) وانقطاع STEG ({cut_range}) وحدّ البئر ({quota} م³). "
            f"نضخ {pumped} م³ ({solar_pct}% شمسي) في الحوض نهاراً ونوزعها ليلاً بالجاذبية بنسبة عادلة {share}% لكل عائلة."
        )

    if language == "fr":
        if asks_shortage:
            return (
                f"Parce que le besoin total aujourd'hui est de {need} m³ (pic à {max_temp} °C), alors que le quota de la nappe limite le pompage à {quota} m³. "
                f"NOUBA partage donc les {pumped} m³ disponibles à parts égales : chaque famille reçoit exactement {share}% de son besoin."
            )
        if asks_night or asks_cut:
            return (
                f"Parce qu'il fait jusqu'à {max_temp} °C le jour (forte évaporation), que la STEG coupe le courant ({cut_range}) et que la pointe 19:00-22:00 coûte cher. "
                f"NOUBA remplit le bassin au solaire ({solar_pct}%) avant la coupure puis distribue la nuit par gravité sans électricité."
            )
        if asks_cost:
            return (
                f"La facture est limitée à {cost} TND car {solar_pct}% des {pumped} m³ sont pompés au solaire en évitant la pointe STEG 19:00-22:00."
            )
        return (
            f"Ce plan répond à trois contraintes : la chaleur ({max_temp} °C), la coupure STEG ({cut_range}) et le quota ({quota} m³). "
            f"L'eau ({pumped} m³, {solar_pct}% solaire) est stockée dans le bassin puis répartie la nuit par gravité à {share}% du besoin par famille."
        )

    if language == "ja":
        if asks_shortage:
            return (
                f"猛暑（最高 {max_temp} °C）により全世帯の必要水量が {need} m³ に達する一方、帯水層保護の上限が {quota} m³ のためです。"
                f"利用可能な {pumped} m³ を全世帯で公平に必要量の {share}% ずつ分配しています。"
            )
        return (
            f"日中は {max_temp} °C で蒸発が多く、停電（{cut_range}）と高単価帯（19:00-22:00）もあるためです。"
            f"太陽光（{solar_pct}%）で貯水池に {pumped} m³ 貯め、夜間に重力で全世帯へ公平に {share}% ずつ配水します。"
        )

    # English
    if asks_shortage:
        return (
            f"Because total crop water need today is {need} m³ due to {max_temp} °C heat, while the aquifer quota caps pumping at {quota} m³. "
            f"To stay fair and protect the aquifer, NOUBA shares the available {pumped} m³ equally so every family receives {share}% of its need."
        )
    if asks_night or asks_cut:
        return (
            f"Because daytime heat reaches {max_temp} °C (causing heavy evaporation), STEG cuts power during {cut_range}, and 19:00-22:00 is the expensive peak tariff. "
            f"Pumping into the basin on solar ({solar_pct}%) before the cut and releasing at night by gravity saves water, avoids peak rates, and needs no electricity at night."
        )
    if asks_cost:
        return (
            f"Electricity costs only {cost} TND today because {solar_pct}% of the {pumped} m³ is pumped on solar power and NOUBA avoids the expensive 19:00-22:00 STEG peak slot."
        )
    return (
        f"Today's plan is driven by {max_temp} °C heat (total need {need} m³), the STEG cut ({cut_range}), and the {quota} m³ aquifer quota. "
        f"NOUBA pumps {pumped} m³ ({solar_pct}% solar) into the basin before the cut and releases it at night by gravity so every family gets an equal {share}% share."
    )


async def answer_family_question(
    plan: PlanResponse,
    question: str,
    language: LanguageCode,
) -> QAResponse:
    """Answer a family's 'why' question directly using today's plan facts, rejecting invented times."""
    max_temp = round(max((h.temp_c for h in plan.weather.hourly), default=0.0), 1)
    min_rh = round(min((h.rh_pct for h in plan.weather.hourly), default=0.0), 1)
    max_wind = round(max((h.wind_ms for h in plan.weather.hourly), default=0.0), 1)
    shortage_m3 = round(max(0.0, plan.total_need_m3 - plan.total_delivered_m3), 1)

    plan_facts = {
        "weather_summary": {
            "date": plan.weather.date,
            "source": plan.weather.source,
            "max_temp_c": max_temp,
            "min_humidity_pct": min_rh,
            "max_wind_ms": max_wind,
        },
        "aquifer_and_water_balance": {
            "daily_quota_m3": plan.daily_quota_m3,
            "basin_capacity_m3": plan.basin_capacity_m3,
            "total_crop_need_m3": plan.total_need_m3,
            "total_pumped_m3": plan.total_pumped_m3,
            "total_delivered_m3": plan.total_delivered_m3,
            "shortage_m3": shortage_m3,
            "equal_share_pct": plan.night_turns[0].share_pct if plan.night_turns else 100.0,
        },
        "energy_and_cuts": {
            "steg_cut_window": _format_cut_range(plan.cut_hours),
            "steg_peak_tariff_window": "19:00-22:00 (391 millimes/kWh)",
            "solar_share_pct": plan.solar_share_pct,
            "total_cost_tnd": plan.total_cost_tnd,
        },
        "planner_reasoning": plan.llm_reasoning,
        "comparisons": [c.model_dump() for c in plan.comparisons],
        "surprise_cut": plan.surprise_cut.model_dump(),
        "night_turns": [
            {
                "family": t.family_name,
                "start_time": t.start_time,
                "end_time": t.end_time,
                "need_m3": t.need_m3,
                "allocated_m3": t.allocated_m3,
                "share_pct": t.share_pct,
            }
            for t in plan.night_turns
        ],
    }

    messages = [
        {
            "role": "system",
            "content": (
                "You are NOUBA's transparent irrigation advisor for Kebili farming families.\n"
                f"Respond in language: {language}.\n"
                "IMPORTANT: Directly answer the user's specific question and clearly explain the CAUSE / REASON ('why').\n"
                "- Do NOT just recite the schedule without explaining WHY.\n"
                "- Explain the real physical/fairness reasons from the JSON: e.g., daytime heat/evaporation, STEG power cut, "
                "expensive 19:00-22:00 peak tariff, aquifer daily quota vs total crop need, equal percentage sharing, or gravity basin storage.\n"
                "- STRICT FACT RULE: Only cite numbers and HH:MM times that exist in the JSON plan. Keep it clear, friendly, and 2-4 sentences."
            ),
        },
        {
            "role": "user",
            "content": f"Plan Facts JSON:\n{json.dumps(plan_facts, ensure_ascii=False)}\n\nFamily Question: {question}",
        },
    ]

    try:
        answer = (await chat_completion(messages, temperature=0.2, max_tokens=300)).strip()
        ok, reason = verify_grounded_answer(answer, plan)
        if ok:
            return QAResponse(answer=answer, grounded=True, source="llm")
        return QAResponse(
            answer=build_grounded_fallback_answer(plan, language, question),
            grounded=True,
            source="fallback",
            rejected_reason=reason,
        )
    except LLMUnavailableError:
        return QAResponse(
            answer=build_grounded_fallback_answer(plan, language, question),
            grounded=True,
            source="fallback",
        )
