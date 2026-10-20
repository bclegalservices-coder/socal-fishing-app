"""'Can my boat handle it?' — rates one forecast hour for one boat.

Grounded in published guidance, not guesswork:
  * NWS Western Region Technical Attachment 03-11 (wave steepness): seas under 5 ft are not
    considered hazardous; 5-18 ft are hazardous when steep or very steep; 18 ft+ always are.
    Example: 7 ft at 7 s ("square" seas) is very steep; 20 ft at 20 s is not steep.
  * Small Craft Advisory (NWS Western Region): sustained winds 21-33 kt, and/or hazardous
    (steep) seas.  Gale 34-47 kt, storm 48-63 kt.
  * Boater rule of thumb: swell period (seconds) should be at least 2x the wave height (feet);
    2.5-3x is noticeably more comfortable.
  * Deep-water wavelength L = g*T^2/2pi  ~= 5.12 * T^2 feet; steepness = H / L.

This is guidance for planning, never a guarantee — NWS warnings always win, and the app says so.
"""
from __future__ import annotations

import math

# Comfortable-limit seas (ft) and wind (kt) for a typical example of each boat, and the length that
# typical example has.  A user's own length scales the limit (bigger boat of the same type -> more).
BOAT_TYPES: dict[str, dict] = {
    "kayak":          {"label": "Kayak / SUP",            "seas_ft": 2.0, "wind_kt": 10, "typical_len": 12},
    "skiff":          {"label": "Skiff / jon boat",       "seas_ft": 2.0, "wind_kt": 12, "typical_len": 14},
    "bay":            {"label": "Bay boat / bass boat",   "seas_ft": 3.0, "wind_kt": 15, "typical_len": 19},
    "center_console": {"label": "Center console",         "seas_ft": 4.0, "wind_kt": 17, "typical_len": 23},
    "walkaround":     {"label": "Walkaround / cuddy",     "seas_ft": 4.5, "wind_kt": 18, "typical_len": 25},
    "sportfisher":    {"label": "Sportfisher / express",  "seas_ft": 6.0, "wind_kt": 20, "typical_len": 35},
    "trawler":        {"label": "Trawler / cruiser",      "seas_ft": 6.0, "wind_kt": 20, "typical_len": 38},
    "sailboat":       {"label": "Sailboat",               "seas_ft": 5.0, "wind_kt": 20, "typical_len": 32},
}
SMALL_TYPES = {"kayak", "skiff", "bay"}
COMFORT = {"easygoing": 0.75, "normal": 1.0, "experienced": 1.25}

STEEP_FACTOR = {"gentle": 0.75, "moderate": 1.0, "steep": 1.25, "very_steep": 1.5, "unknown": 1.1}
DIRECTION_FACTOR = {"head": 1.0, "beam": 1.15, "following": 0.95}

LEVELS = ["comfortable", "bumpy", "rough", "stay_in"]
LABELS = {"comfortable": "Comfortable", "bumpy": "Bumpy", "rough": "Rough", "stay_in": "Stay in"}
THRESHOLDS = ((0.6, "comfortable"), (0.9, "bumpy"), (1.35, "rough"))

STAY_IN_WARNINGS = ("gale warning", "storm warning", "hurricane", "hazardous seas warning",
                    "tropical storm warning", "special marine warning")
SCA_WARNINGS = ("small craft advisory",)
NOTE_WARNINGS = ("high surf", "beach hazards", "dense fog")


def wavelength_ft(period_s: float) -> float:
    return 5.12 * period_s ** 2


def steepness(height_ft: float | None, period_s: float | None) -> float | None:
    if not height_ft or not period_s or period_s <= 0:
        return None
    return height_ft / wavelength_ft(period_s)


def steepness_class(height_ft: float | None, period_s: float | None) -> str:
    s = steepness(height_ft, period_s)
    if s is None:
        return "unknown"
    if s >= 0.025:
        return "very_steep"
    if s >= 0.02:
        return "steep"
    if s >= 0.0125:
        return "moderate"
    return "gentle"


def combined_seas(*heights: float | None) -> float | None:
    """Significant height of several wave trains = root of the sum of squares (how NWS combines them)."""
    hs = [h for h in heights if h]
    return round(math.sqrt(sum(h * h for h in hs)), 1) if hs else None


def nws_sca_by_seas(height_ft: float | None, period_s: float | None) -> bool:
    """Seas alone meet the NWS hazardous-seas idea of a Small Craft Advisory (WR TA 03-11)."""
    if not height_ft or height_ft < 5:
        return False
    if height_ft >= 18:
        return True
    return steepness_class(height_ft, period_s) in ("steep", "very_steep")


def relative_direction(course_deg: float | None, waves_from_deg: float | None) -> str | None:
    """Where the seas hit the boat: 'head' (on the bow), 'beam' (the side) or 'following' (the stern)."""
    if course_deg is None or waves_from_deg is None:
        return None
    diff = abs((waves_from_deg - course_deg + 180) % 360 - 180)  # 0 = seas coming straight at the bow
    if diff <= 45:
        return "head"
    if diff >= 135:
        return "following"
    return "beam"


def rule_2x(height_ft: float | None, period_s: float | None) -> dict | None:
    if not height_ft or not period_s:
        return None
    ratio = period_s / height_ft
    verdict = "comfortable" if ratio >= 2.5 else "ok" if ratio >= 2 else "short"
    return {"ratio": round(ratio, 1), "passes": ratio >= 2, "verdict": verdict,
            "text": f"{period_s:g} s period ÷ {height_ft:g} ft = {ratio:.1f}× "
                    + ("(2.5× or more — nicely spaced)" if verdict == "comfortable"
                       else "(meets the 2× rule)" if verdict == "ok" else "(under 2× — short, choppy)")}


def boat_limits(boat: dict | None) -> dict:
    boat = boat or {}
    kind = boat.get("type") if boat.get("type") in BOAT_TYPES else "center_console"
    spec = BOAT_TYPES[kind]
    scale = 1.0
    length = boat.get("length_ft")
    if length:
        scale = max(0.7, min(1.4, (float(length) / spec["typical_len"]) ** 0.7))
    comfort = COMFORT.get(boat.get("comfort") or "normal", 1.0)
    return {"type": kind, "label": spec["label"], "length_ft": length,
            "seas_ft": round(spec["seas_ft"] * scale * comfort, 1),
            "wind_kt": round(spec["wind_kt"] * min(scale, 1.2) * comfort, 1),
            "small": kind in SMALL_TYPES or (length is not None and float(length) < 26)}


def _floor(level: str, minimum: str) -> str:
    return level if LEVELS.index(level) >= LEVELS.index(minimum) else minimum


def rate(hour: dict, boat: dict | None = None, warnings: list[str] | None = None) -> dict:
    """hour: seas_ft, period_s, wind_kt, gust_kt, waves_from_deg (any may be None).
    boat: type, length_ft, comfort, course_deg (optional).  warnings: active NWS event names."""
    lim = boat_limits(boat)
    seas, period = hour.get("seas_ft"), hour.get("period_s")
    wind, gust = hour.get("wind_kt") or 0, hour.get("gust_kt") or 0
    reasons: list[str] = []

    sclass = steepness_class(seas, period)
    rel = relative_direction((boat or {}).get("course_deg"), hour.get("waves_from_deg"))
    sea_score = 0.0
    if seas is not None:
        eff = seas * STEEP_FACTOR[sclass] * DIRECTION_FACTOR.get(rel, 1.0)
        sea_score = eff / lim["seas_ft"]
        if seas >= lim["seas_ft"]:
            reasons.append(f"Seas {seas:g} ft are at or above the {lim['seas_ft']:g} ft comfort limit for your boat")
        if sclass in ("steep", "very_steep"):
            reasons.append(f"{'Very steep' if sclass == 'very_steep' else 'Steep'} seas: {seas:g} ft every {period:g} s")
        elif sclass == "gentle" and seas >= 2:
            reasons.append(f"Long-period swell ({period:g} s) — rolling, not choppy")
        if rel == "beam" and seas >= 2:
            reasons.append("Seas on the beam on your course — expect rolling")
    else:
        reasons.append("No wave forecast for this point")
    if seas is not None and period is None:
        reasons.append("Wave period not forecast — steepness unknown, rated cautiously")

    wind_eff = max(wind, gust * 0.8)
    wind_score = wind_eff / lim["wind_kt"]
    if wind >= lim["wind_kt"] * 0.75:
        reasons.append(f"Wind {wind:.0f} kt" + (f", gusts {gust:.0f}" if gust > wind + 3 else ""))

    score = max(sea_score, wind_score)
    level = next((lvl for t, lvl in THRESHOLDS if score < t), "stay_in")

    # Official criteria set a floor — the rating can never look better than NWS does.
    sca = (21 <= wind < 34) or nws_sca_by_seas(seas, period)
    if sca:
        level = _floor(level, "stay_in" if lim["small"] else "rough")
        reasons.append("Small Craft Advisory conditions (NWS: 21–33 kt wind or hazardous steep seas)")
    if wind >= 34 or gust >= 40:
        level = "stay_in"
        reasons.append(f"Gale-force wind ({max(wind, gust):.0f} kt)")
    names = [w.lower() for w in (warnings or [])]
    for w in warnings or []:
        lw = w.lower()
        if any(k in lw for k in STAY_IN_WARNINGS):
            level = "stay_in"
            reasons.insert(0, f"NWS {w} in effect")
        elif any(k in lw for k in SCA_WARNINGS):
            level = _floor(level, "stay_in" if lim["small"] else "rough")
            reasons.insert(0, f"NWS {w} in effect")
        elif any(k in lw for k in NOTE_WARNINGS):
            reasons.append(f"NWS {w} — use care at harbor entrances and launch ramps")
    if level == "comfortable" and not reasons:
        reasons.append("Light wind and easy seas for your boat")

    return {"level": level, "label": LABELS[level], "score": round(score, 2),
            "steepness": sclass, "seas_ft": seas, "relative": rel, "reasons": reasons,
            "rule_2x": rule_2x(seas, period), "sca_conditions": sca or any("small craft" in n for n in names),
            "limits": {"seas_ft": lim["seas_ft"], "wind_kt": lim["wind_kt"]}}


def best_window(rated: list[dict], ok_levels=("comfortable", "bumpy"), min_hours: int = 2) -> dict | None:
    """Longest run of consecutive acceptable hours.  rated: [{'t': iso, 'rating': {...}}, ...] in order."""
    best, cur = None, []
    for r in rated + [None]:
        if r is not None and r["rating"]["level"] in ok_levels:
            cur.append(r)
            continue
        if len(cur) >= min_hours and (best is None or len(cur) > len(best)):
            best = cur
        cur = []
    if not best:
        return None
    worst = max(best, key=lambda r: LEVELS.index(r["rating"]["level"]))["rating"]["level"]
    return {"start": best[0]["t"], "end": best[-1]["t"], "hours": len(best), "worst": worst}


def summarize_day(rated: list[dict]) -> dict:
    """One day's verdict: the worst hour sets the color; the best window says when to go."""
    if not rated:
        return {"level": None, "label": "No forecast"}
    worst = max(rated, key=lambda r: LEVELS.index(r["rating"]["level"]))
    best = min(rated, key=lambda r: LEVELS.index(r["rating"]["level"]))
    return {"level": worst["rating"]["level"], "label": LABELS[worst["rating"]["level"]],
            "best_level": best["rating"]["level"], "window": best_window(rated),
            "reasons": worst["rating"]["reasons"][:3]}
