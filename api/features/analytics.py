"""First-party app analytics (no third-party SDK). Anonymous install ID + event names + small properties +
platform/version + a coarse area name. Anything that looks like a location, email or free text is dropped here,
so a buggy or modified app can't leak private data into analytics."""
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LA = ZoneInfo("America/Los_Angeles")
AREAS = {"Los Angeles", "Orange County", "San Diego", "Santa Barbara / Ventura", "Catalina", "San Clemente Island",
         "Channel Islands", "Offshore SoCal", "North Baja", "Other", "Unknown"}
EVENTS = {
    "app_open", "session_end", "screen_view", "layer_on", "preset_used", "conditions_view", "probe_used", "search", "search_pick",
    "go_to_start", "go_to_arrived", "route_saved", "track_started", "track_saved", "spot_saved", "pin_dropped",
    "catch_logged", "catch_filter", "catch_map_view", "cluster_open", "report_flagged", "today_open",
    "forum_post", "forum_comment", "forum_like", "group_created", "group_joined", "group_share_start",
    "alert_created", "offline_update", "offline_area_saved", "import_done", "export_done", "sponsor_click",
    "sign_in", "sign_up", "mpa_alert_shown", "time_slider_play", "compare_hold", "measure_used", "theme_changed",
    "weather_view", "weather_section", "weather_day_open", "boat_set", "tide_date_view", "weather_history_view",
    "group_invite_sent", "group_ping", "group_position_sent", "group_spot_shared", "group_route_shared", "group_catch_shared",
    "group_message", "group_pin_open", "float_plan_start", "float_plan_checkin",
}
BLOCKED_KEYS = re.compile(r"lat|lon|lng|coord|geom|position|email|phone|name|note|text|body|address|token", re.I)
NAME_RE = re.compile(r"^[a-z_]{2,40}$")
MAX_EVENTS = 200
_rate: dict[str, list[float]] = {}


def clean_props(p) -> dict:
    if not isinstance(p, dict):
        return {}
    out = {}
    for k, v in list(p.items())[:12]:
        if not isinstance(k, str) or not NAME_RE.match(k) or BLOCKED_KEYS.search(k):
            continue
        if isinstance(v, bool) or isinstance(v, (int, float)) and abs(v) < 1e9:
            out[k] = v
        elif isinstance(v, str) and len(v) <= 40 and not re.search(r"-?\d{1,3}\.\d{3,}", v):   # no coordinate-looking strings
            out[k] = v
    return out


def clean_batch(body: dict, now: datetime | None = None) -> dict:
    """Validate a batch from the phone. Raises ValueError for anything unusable."""
    now = now or datetime.now(timezone.utc)
    try:
        install = str(uuid.UUID(str(body.get("install_id"))))
    except Exception:
        raise ValueError("bad install_id")
    platform = body.get("platform") if body.get("platform") in ("ios", "android", "web") else None
    version = str(body.get("app_version") or "")[:20] or None
    os_version = str(body.get("os_version") or "")[:20] or None
    device = body.get("device_class") if body.get("device_class") in ("phone", "tablet", "desktop", "unknown") else "unknown"
    area = body.get("area") if body.get("area") in AREAS else "Unknown"
    signed_in = bool(body.get("signed_in"))
    events = []
    for e in (body.get("events") or [])[:MAX_EVENTS]:
        if not isinstance(e, dict) or e.get("name") not in EVENTS:
            continue
        try:
            at = datetime.fromisoformat(str(e.get("at")).replace("Z", "+00:00"))
            if at.tzinfo is None:
                at = at.replace(tzinfo=timezone.utc)
        except Exception:
            at = now
        if at > now + timedelta(minutes=5) or at < now - timedelta(days=7):
            at = now
        events.append({"name": e["name"], "props": clean_props(e.get("props")), "session_id": str(e.get("session_id") or "")[:40] or None,
                       "at": at, "day": at.astimezone(LA).date()})
    return {"install_id": install, "platform": platform, "app_version": version, "os_version": os_version,
            "device_class": device, "area": area, "signed_in": signed_in, "events": events}


def rate_ok(install_id: str, n: int, per_minute: int = 400) -> bool:
    t = time.monotonic()
    hist = [x for x in _rate.get(install_id, []) if t - x < 60]
    if len(hist) + n > per_minute:
        _rate[install_id] = hist
        return False
    _rate[install_id] = hist + [t] * n
    return True


async def store(pool, b: dict) -> int:
    if pool is None or not b["events"]:
        return 0
    first = min(e["at"] for e in b["events"])
    last = max(e["at"] for e in b["events"])
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                """insert into app_installs (install_id, first_seen_at, last_seen_at, platform, app_version, os_version, device_class, area)
                   values (%s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (install_id) do update set
                     first_seen_at = least(app_installs.first_seen_at, excluded.first_seen_at),
                     last_seen_at = greatest(app_installs.last_seen_at, excluded.last_seen_at),
                     platform = coalesce(excluded.platform, app_installs.platform), app_version = coalesce(excluded.app_version, app_installs.app_version),
                     os_version = coalesce(excluded.os_version, app_installs.os_version), device_class = excluded.device_class,
                     area = case when excluded.area <> 'Unknown' then excluded.area else app_installs.area end""",
                (b["install_id"], first, last, b["platform"], b["app_version"], b["os_version"], b["device_class"], b["area"]))
            for day in {e["day"] for e in b["events"]}:
                await conn.execute(
                    """insert into app_daily_active (day, install_id, signed_in) values (%s, %s, %s)
                       on conflict (day, install_id) do update set signed_in = app_daily_active.signed_in or excluded.signed_in""",
                    (day, b["install_id"], b["signed_in"]))
            async with conn.cursor() as cur:
                import json
                await cur.executemany(
                    "insert into app_events (install_id, session_id, name, props, platform, app_version, area, at, day) values (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)",
                    [(b["install_id"], e["session_id"], e["name"], json.dumps(e["props"]), b["platform"], b["app_version"], b["area"], e["at"], e["day"]) for e in b["events"]])
    return len(b["events"])
