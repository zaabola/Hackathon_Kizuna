import json
from typing import Any
import httpx

from app.config import get_settings


class LLMUnavailableError(RuntimeError):
    """Raised when the configured OpenAI-compatible LLM server is unreachable or errors."""


async def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.1,
    max_tokens: int = 1200,
    json_schema: dict[str, Any] | None = None,
) -> str:
    """Call an OpenAI-compatible /v1/chat/completions endpoint (vLLM / Ollama / etc.)."""
    settings = get_settings()
    url = f"{settings.llm_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_schema is not None:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "nouba_output",
                "strict": True,
                "schema": json_schema,
            },
        }

    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 400 and json_schema is not None:
                # Fallback for servers that only support json_object
                payload["response_format"] = {"type": "json_object"}
                resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception as exc:
        raise LLMUnavailableError(f"LLM request failed: {exc}") from exc


def parse_json_content(raw_text: str) -> dict[str, Any]:
    """Extract JSON object from LLM output, stripping markdown code fences if present."""
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)
