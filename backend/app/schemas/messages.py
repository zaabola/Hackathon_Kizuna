from typing import Literal
from pydantic import BaseModel, Field
from app.schemas.plan import PlanResponse


LanguageCode = Literal["ar", "tn-darija", "fr", "en", "ja"]


class FamilyMessageRequest(BaseModel):
    plan: PlanResponse
    language: LanguageCode = "tn-darija"
    cut_window_label: str = "12:00-17:00"


class FamilyMessageItem(BaseModel):
    family_id: str
    family_name: str
    language: LanguageCode
    text: str
    source: Literal["llm", "template"]


class FamilyMessageResponse(BaseModel):
    messages: list[FamilyMessageItem]


class QARequest(BaseModel):
    plan: PlanResponse
    question: str = Field(..., min_length=2, max_length=400)
    language: LanguageCode = "en"


class QAResponse(BaseModel):
    answer: str
    grounded: bool
    source: Literal["llm", "fallback"]
    rejected_reason: str | None = None
