import json
from datetime import datetime, timezone
import httpx

from app.config import get_settings
from app.schemas.plan import HourlyWeather, WeatherMode, WeatherResponse

KEBILI_LAT = 33.7044
KEBILI_LON = 8.9690
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def load_saved_heatwave() -> WeatherResponse:
    """Load the saved Kebili 26 July 2026 ERA5 heatwave reference day."""
    settings = get_settings()
    raw = json.loads((settings.data_dir / "kebili_2026_07_26.json").read_text(encoding="utf-8"))
    return WeatherResponse(
        location=raw["location"],
        date=raw["date"],
        source=raw["source"],
        is_fallback=True,
        hourly=[HourlyWeather(**item) for item in raw["hourly"]],
    )


async def get_weather(mode: WeatherMode) -> WeatherResponse:
    """Return 24-hour Kebili weather from Open-Meteo or saved fallback."""
    if mode == "heatwave_2026_07_26":
        data = load_saved_heatwave()
        data.is_fallback = False
        return data

    params = {
        "latitude": KEBILI_LAT,
        "longitude": KEBILI_LON,
        "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,et0_fao_evapotranspiration,shortwave_radiation,precipitation",
        "wind_speed_unit": "ms",
        "timezone": "Africa/Tunis",
        "forecast_days": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            payload = resp.json()

        hourly_raw = payload["hourly"]
        times = hourly_raw["time"]
        hourly: list[HourlyWeather] = []
        for idx in range(min(24, len(times))):
            hourly.append(
                HourlyWeather(
                    hour=idx,
                    temp_c=float(hourly_raw["temperature_2m"][idx] or 0.0),
                    rh_pct=min(100.0, max(0.0, float(hourly_raw["relative_humidity_2m"][idx] or 0.0))),
                    wind_ms=max(0.0, float(hourly_raw["wind_speed_10m"][idx] or 0.0)),
                    et0_mm=max(0.0, float(hourly_raw["et0_fao_evapotranspiration"][idx] or 0.0)),
                    solar_wm2=max(0.0, float(hourly_raw["shortwave_radiation"][idx] or 0.0)),
                    rain_mm=max(0.0, float(hourly_raw["precipitation"][idx] or 0.0)),
                )
            )
        if len(hourly) < 24:
            raise ValueError("Incomplete hourly forecast from Open-Meteo")
        date_str = times[0].split("T")[0] if times else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return WeatherResponse(
            location="Kebili, Tunisia",
            date=date_str,
            source="Open-Meteo live forecast",
            is_fallback=False,
            hourly=hourly,
        )
    except Exception:
        fallback = load_saved_heatwave()
        fallback.source = "Saved forecast fallback (Open-Meteo unreachable)"
        fallback.is_fallback = True
        return fallback
