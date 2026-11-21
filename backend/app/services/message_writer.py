import asyncio
import json
import re
from functools import lru_cache
from urllib.parse import quote

from app.config import get_settings
from app.schemas.messages import FamilyMessageItem, LanguageCode
from app.schemas.plan import NightTurn, PlanResponse
from app.services.llm_client import LLMUnavailableError, chat_completion


@lru_cache
def load_templates() -> dict[str, str]:
    settings = get_settings()
    return json.loads((settings.data_dir / "message_templates.json").read_text(encoding="utf-8"))


def build_send_links(phone: str, text: str) -> tuple[str, str]:
    """Return (whatsapp_url, sms_url) pre-addressed to the family's phone number."""
    digits = re.sub(r"\D+", "", phone or "")
    encoded = quote(text, safe="")
    if digits:
        whatsapp_url = f"https://wa.me/{digits}?text={encoded}"
        sms_url = f"sms:+{digits}?body={encoded}"
    else:
        whatsapp_url = f"https://wa.me/?text={encoded}"
        sms_url = f"sms:?body={encoded}"
    return whatsapp_url, sms_url


def render_template_message(
    turn: NightTurn,
    language: LanguageCode,
    quota_m3: float,
    cut_window_label: str,
) -> str:
    templates = load_templates()
    tmpl = templates.get(language, templates["en"])
    return tmpl.format(
        family_name=turn.family_name,
        start_time=turn.start_time,
        end_time=turn.end_time,
        volume_m3=round(turn.allocated_m3, 1),
        share_pct=round(turn.share_pct, 1),
        quota_m3=round(quota_m3, 1),
        cut_window=cut_window_label,
    )


def _message_preserves_facts(text: str, turn: NightTurn) -> bool:
    """Verify the LLM message kept the exact start_time, end_time, and volume."""
    vol_str = str(round(turn.allocated_m3, 1))
    vol_int = str(int(round(turn.allocated_m3)))
    has_times = turn.start_time in text and turn.end_time in text
    has_vol = vol_str in text or vol_int in text
    return has_times and has_vol


async def _generate_one_message(
    turn: NightTurn,
    language: LanguageCode,
    quota_m3: float,
    cut_window_label: str,
) -> FamilyMessageItem:
    fallback_text = render_template_message(turn, language, quota_m3, cut_window_label)
    prompt = [
        {
            "role": "system",
            "content": (
                "You write short, clear, polite irrigation SMS messages for farming families in Kebili, Tunisia.\n"
                f"Target language: {language} (if tn-darija, use natural Tunisian Arabic script like "
                "'نوبتك الليلة من 21:00 لـ 23:45، الكمية 125 م³').\n"
                "You MUST keep the exact start time, end time, and volume in m3 unchanged. Keep it under 280 characters."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Rewrite this message naturally in {language} without changing any numbers or times:\n"
                f"{fallback_text}"
            ),
        },
    ]
    try:
        llm_text = (await chat_completion(prompt, temperature=0.2, max_tokens=220)).strip()
        if _message_preserves_facts(llm_text, turn):
            wa_url, sms_url = build_send_links(turn.phone, llm_text)
            return FamilyMessageItem(
                family_id=turn.family_id,
                family_name=turn.family_name,
                phone=turn.phone,
                language=language,
                text=llm_text,
                source="llm",
                whatsapp_url=wa_url,
                sms_url=sms_url,
            )
    except LLMUnavailableError:
        pass

    wa_url, sms_url = build_send_links(turn.phone, fallback_text)
    return FamilyMessageItem(
        family_id=turn.family_id,
        family_name=turn.family_name,
        phone=turn.phone,
        language=language,
        text=fallback_text,
        source="template",
        whatsapp_url=wa_url,
        sms_url=sms_url,
    )


async def generate_family_messages(
    plan: PlanResponse,
    language: LanguageCode,
    cut_window_label: str,
) -> list[FamilyMessageItem]:
    """Generate SMS/WhatsApp-ready messages concurrently (batched by vLLM), with verified template fallback."""
    quota_m3 = plan.daily_quota_m3
    tasks = [
        _generate_one_message(turn, language, quota_m3, cut_window_label)
        for turn in plan.night_turns
    ]
    return list(await asyncio.gather(*tasks))
