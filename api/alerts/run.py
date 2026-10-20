"""python -m alerts.run   — checks every subscription and sends push alerts via Expo.
Runs hourly from GitHub Actions. Needs DATABASE_URL (server connection; bypasses RLS) and storage env vars."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
import psycopg
from psycopg.rows import dict_row

from conditions.service import latest_grid
from conditions import weather
from . import engine

EXPO = "https://exp.host/--/api/v2/push/send"


def cells_near(g, lat, lon, radius_nm):
    dlat = radius_nm / 60
    dlon = radius_nm / (60 * max(0.2, np.cos(np.radians(lat))))
    ii = (g.lats >= lat - dlat) & (g.lats <= lat + dlat)
    jj = (g.lons >= lon - dlon) & (g.lons <= lon + dlon)
    return g.values[np.ix_(ii, jj)].ravel().tolist()


def send_expo(messages: list[dict]):
    with httpx.Client(timeout=30) as http:
        for i in range(0, len(messages), 100):
            r = http.post(EXPO, json=messages[i:i + 100], headers={"Accept": "application/json"})
            print("expo", r.status_code, r.text[:200])


def broadcasts(db):
    """Admin push broadcasts (max one per 24 h, enforced by the database)."""
    for b in db.execute("select * from broadcasts where status = 'pending' order by created_at").fetchall():
        tokens = [r["token"] for r in db.execute("select token from push_tokens").fetchall()]
        send_expo([{"to": t, "title": b["title"], "body": b["body"], "sound": "default", "data": {"kind": "broadcast"}} for t in tokens])
        db.execute("update broadcasts set status = 'sent', sent_at = now(), sent_count = %s where id = %s", (len(tokens), b["id"]))
        print(f"broadcast {b['id']} sent to {len(tokens)} devices")


def metrics(db):
    """Keep today's and yesterday's dashboard numbers fresh (hourly); purge old raw events once a day."""
    db.execute("select refresh_metrics_range(la_day(now()) - 1, la_day(now()))")
    if datetime.now(timezone.utc).hour == 10:
        print("purged", db.execute("select purge_old_events() n").fetchone()["n"], "old events")


def main():
    now = datetime.now(timezone.utc)
    db = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row, prepare_threshold=None, autocommit=True)
    for step in (metrics, broadcasts):
        try:
            step(db)
        except Exception as e:  # never let one step block alerts
            print(f"{step.__name__} failed: {e}")
    subs = db.execute("select s.*, (select count(*) from notification_log n where n.user_id = s.user_id and n.sent_at > now() - interval '24 hours') sent_today "
                      "from alert_subscriptions s where s.active").fetchall()
    if not subs:
        print("no subscriptions"); return
    catches = db.execute("select species_code, caught_at, quantity, verified, st_y(public_geom::geometry) lat, st_x(public_geom::geometry) lon "
                         "from public_catches where caught_at > now() - interval '12 hours' and public_geom is not null").fetchall()
    sst, sst_meta = latest_grid("sst")
    image_date = (sst_meta or {}).get("entry", {}).get("date", "")
    outbox: list[tuple[dict, str]] = []
    for s in subs:
        s["params"] = s["params"] or {}
        if not engine.can_send(s, s["sent_today"], now) and s["kind"] != "weather":
            continue
        msg, state = None, s.get("state") or {}
        c = s["params"].get("center")
        if s["kind"] == "species":
            msg = engine.species_alert(s, catches, now)
        elif s["kind"] == "activity":
            msg = engine.activity_alert(s, catches, now)
        elif s["kind"] == "sst" and sst is not None and c:
            msg = engine.sst_alert(s, cells_near(sst, c[1], c[0], float(s["params"].get("radius_nm", 20))), image_date, now)
        elif s["kind"] == "weather" and c and s["sent_today"] < engine.MAX_PER_DAY:
            try:
                al = asyncio.run(weather.alerts(c[1], c[0]))
            except Exception as e:
                print("weather fetch failed", e); continue
            msg, ids = engine.weather_alert(s, al)
            state = {**state, "seen": ids}
            db.execute("update alert_subscriptions set state = %s where id = %s", (json.dumps(state), s["id"]))
        if msg:
            outbox.append((s, msg))
    if not outbox:
        print("nothing to send"); return
    tokens = {}
    for r in db.execute("select user_id, token from push_tokens where user_id = any(%s)", ([s["user_id"] for s, _ in outbox],)).fetchall():
        tokens.setdefault(r["user_id"], []).append(r["token"])
    messages = []
    for s, msg in outbox:
        for t in tokens.get(s["user_id"], []):
            messages.append({"to": t, "title": {"species": "Catch alert", "activity": "Bite alert", "sst": "Water temp alert", "weather": "Marine warning"}[s["kind"]],
                             "body": msg, "sound": "default", "data": {"kind": s["kind"], "subscription": str(s["id"])}})
        db.execute("update alert_subscriptions set last_sent_at = now() where id = %s", (s["id"],))
        db.execute("insert into notification_log (user_id, subscription_id, body) values (%s, %s, %s)", (s["user_id"], s["id"], msg))
    send_expo(messages)
    print(f"sent {len(messages)} notifications for {len(outbox)} alerts")


if __name__ == "__main__":
    main()
