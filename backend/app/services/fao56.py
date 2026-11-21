from app.schemas.plan import CropType, FamilyInput, HourlyWeather

# FAO-56 Table 12 mid-season Kc and representative crop height (m)
CROP_PARAMS: dict[CropType, tuple[float, float]] = {
    "date_palm": (0.95, 8.0),
    "olive": (0.65, 4.0),
    "vegetables": (1.05, 0.5),
}


def compute_adjusted_kc(crop: CropType, wind_ms: float, rh_min_pct: float) -> float:
    """FAO-56 Eq. 62 climate adjustment for arid, windy conditions."""
    kc_table, height_m = CROP_PARAMS[crop]
    u2 = max(1.0, min(6.0, wind_ms))
    rh_min = max(5.0, min(80.0, rh_min_pct))
    adj = (0.04 * (u2 - 2.0) - 0.004 * (rh_min - 45.0)) * ((height_m / 3.0) ** 0.3)
    return round(max(0.4, kc_table + adj), 3)


def compute_family_needs(
    families: list[FamilyInput],
    hourly_weather: list[HourlyWeather],
) -> dict[str, float]:
    """Compute daily water need (m3) per family from hourly ET0, rain, crop, and area."""
    total_et0_mm = sum(h.et0_mm for h in hourly_weather)
    total_rain_mm = sum(h.rain_mm for h in hourly_weather)
    effective_rain_mm = total_rain_mm * 0.8

    daytime = [h for h in hourly_weather if 6 <= h.hour <= 18] or hourly_weather
    avg_wind = sum(h.wind_ms for h in daytime) / len(daytime)
    rh_min = min(h.rh_pct for h in hourly_weather)

    needs: dict[str, float] = {}
    for fam in families:
        kc_adj = compute_adjusted_kc(fam.crop, avg_wind, rh_min)
        net_mm = max(0.0, total_et0_mm * kc_adj - effective_rain_mm)
        # 1 mm over 1 ha = 10 m3
        needs[fam.id] = round(net_mm * 10.0 * fam.area_ha, 2)
    return needs
