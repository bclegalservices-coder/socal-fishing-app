"""Direct-sponsorship ad server (plan: 'Ads, sponsorships and optional Pro').
Contextual only: ads are chosen by placement, section, what's on screen (tags) and the COARSE area the phone is in
(e.g. "Orange County") — never by who you are or where you are exactly. The phone enforces per-day frequency caps;
events carry no identity."""
import random

PLACEMENTS = {"banner_dashboard", "banner_reports", "banner_community", "sponsor_intro", "presented_by", "catch_map_open"}
EVENTS = {"impression", "click", "call", "directions", "coupon_open", "coupon_save", "video_start", "video_complete"}

PICK_SQL = """
select id, name, placement::text, presented_by_section, creative_url, click_url, headline, context_tags, max_per_user_per_day,
       creative, areas, (select name from advertisers a where a.id = c.advertiser_id) advertiser
from ad_campaigns c
where active and now() between starts_at and ends_at and placement::text = %(placement)s
  and (%(section)s::text is null or presented_by_section = %(section)s)
  and (region is null or region = %(region)s)
  and (areas is null or %(area)s::text = any(areas))"""

# What the phone needs to draw each format. Nothing about the advertiser account is sent.
CREATIVE_KEYS = ("kind", "media_url", "poster_url", "html_url", "pdf_url", "width", "height", "duration_s",
                 "headline", "body", "cta_label", "logo_url", "action_type", "action_value", "advertiser_logo")


def choose(rows: list[dict], tags: list[str], rng: random.Random | None = None) -> dict | None:
    """Prefer campaigns whose context tags match what's on screen; otherwise rotate fairly."""
    if not rows:
        return None
    rng = rng or random.Random()
    tagset = {t.lower() for t in tags}
    scored = [(len(tagset & {t.lower() for t in (r.get("context_tags") or [])}), r) for r in rows]
    best = max(s for s, _ in scored)
    pool = [r for s, r in scored if s == best]
    return rng.choice(pool)


def shape(row: dict) -> dict:
    """Public ad payload. Older campaigns (no creative record) become a simple image ad."""
    c = row.get("creative") or {}
    creative = {k: c.get(k) for k in CREATIVE_KEYS if c.get(k) is not None}
    if not creative.get("kind"):
        creative = {"kind": "image", "media_url": row.get("creative_url"),
                    "action_type": "website" if row.get("click_url") else "none", "action_value": row.get("click_url")}
    return {
        "id": row["id"], "placement": row["placement"], "presented_by_section": row.get("presented_by_section"),
        "creative_url": row.get("creative_url"), "click_url": row.get("click_url"), "headline": row.get("headline"),
        "advertiser": row.get("advertiser"), "max_per_user_per_day": row.get("max_per_user_per_day") or 3,
        "creative": creative,
    }


async def pick(pool, placement: str, section: str | None, tags: list[str], region: str = "socal", area: str | None = None) -> dict | None:
    if pool is None or placement not in PLACEMENTS:
        return None
    async with pool.connection() as conn:
        rows = await (await conn.execute(PICK_SQL, {"placement": placement, "section": section, "region": region, "area": area})).fetchall()
    ad = choose(rows, tags)
    return shape(ad) if ad else None


async def log_event(pool, campaign_id: int, event: str, placement: str, context: str | None, device_day_hash: str | None, area: str | None = None):
    if pool is None or event not in EVENTS or placement not in PLACEMENTS or campaign_id <= 0:
        return
    async with pool.connection() as conn:
        await conn.execute("insert into ad_events (campaign_id, event, placement, context, device_day_hash, area) values (%s, %s, %s::ad_placement, %s, %s, %s)",
                           (campaign_id, event, placement, (context or "")[:80], (device_day_hash or "")[:64], area))
