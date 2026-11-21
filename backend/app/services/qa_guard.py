import json
import re

from app.schemas.messages import LanguageCode, QAResponse
from app.schemas.plan import PlanResponse
from app.services.llm_client import LLMUnavailableError, chat_completion

TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\b")


def extract_allowed_times(plan: PlanResponse) -> set[str]:
    """Collect only active timestamps present in the day's plan (turns, pumping hours, and cut hours)."""
    allowed: set[str] = set()
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


def build_grounded_fallback_answer(plan: PlanResponse, language: LanguageCode) -> str:
    """Deterministic fallback answer built strictly from the plan."""
    share = plan.night_turns[0].share_pct if plan.night_turns else 100.0
    pumped = round(plan.total_pumped_m3, 1)
    solar_pct = round(plan.solar_share_pct, 1)

    if language in ("ar", "tn-darija"):
        return (
            f"تُضَخ المياه نهاراً في الحوض (نسبة الطاقة الشمسية {solar_pct}%) وتُوزَّع ليلاً بالجاذبية لتقليل التبخر. "
            f"الكمية الإجمالية {pumped} م³، وكل عائلة تحصل على {share}% من حاجتها بالتساوي."
        )
    if language == "fr":
        return (
            f"L'eau est pompée le jour dans le bassin ({solar_pct}% solaire) et distribuée la nuit par gravité "
            f"pour réduire l'évaporation. Total : {pumped} m³, partagé à {share}% du besoin pour chaque famille."
        )
    if language == "ja":
        return (
            f"昼間に太陽光（{solar_pct}%）で貯水池へ汲み上げ、蒸発の少ない夜間に重力で配水します。"
            f"総量 {pumped} m³ を全世帯で公平に必要量の {share}% ずつ分け合います。"
        )
    return (
        f"Water is pumped into the basin during the day ({solar_pct}% solar) and released at night by gravity "
        f"to cut evaporation. Total {pumped} m³ is shared equally at {share}% of each family's need."
    )


async def answer_family_question(
    plan: PlanResponse,
    question: str,
    language: LanguageCode,
) -> QAResponse:
    """Answer a family's question using ONLY the day's plan, rejecting invented times."""
    plan_facts = {
        "total_pumped_m3": plan.total_pumped_m3,
        "total_delivered_m3": plan.total_delivered_m3,
        "solar_share_pct": plan.solar_share_pct,
        "total_cost_tnd": plan.total_cost_tnd,
        "cut_hours": [f"{h:02d}:00" for h in plan.cut_hours],
        "night_turns": [
            {
                "family": t.family_name,
                "start_time": t.start_time,
                "end_time": t.end_time,
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
                "You answer a farming family's question about today's NOUBA irrigation plan.\n"
                f"Respond in language: {language}.\n"
                "STRICT RULE: Use ONLY the numbers and times in the JSON plan below. "
                "Never invent any time, volume, or percentage. Keep it to 2-3 clear sentences."
            ),
        },
        {
            "role": "user",
            "content": f"Plan JSON:\n{json.dumps(plan_facts, ensure_ascii=False)}\n\nQuestion: {question}",
        },
    ]

    try:
        answer = (await chat_completion(messages, temperature=0.1, max_tokens=250)).strip()
        ok, reason = verify_grounded_answer(answer, plan)
        if ok:
            return QAResponse(answer=answer, grounded=True, source="llm")
        return QAResponse(
            answer=build_grounded_fallback_answer(plan, language),
            grounded=True,
            source="fallback",
            rejected_reason=reason,
        )
    except LLMUnavailableError:
        return QAResponse(
            answer=build_grounded_fallback_answer(plan, language),
            grounded=True,
            source="fallback",
        )
