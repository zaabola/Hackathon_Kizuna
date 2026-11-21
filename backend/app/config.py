from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment or .env file."""

    llm_base_url: str = "http://localhost:8000/v1"
    llm_api_key: str = "EMPTY"
    llm_model: str = "Qwen/Qwen2.5-14B-Instruct-AWQ"
    llm_timeout_seconds: float = 60.0
    allow_planner_fallback: bool = True
    port: int = 7860

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def data_dir(self) -> Path:
        return Path(__file__).resolve().parent / "data"


@lru_cache
def get_settings() -> Settings:
    return Settings()
