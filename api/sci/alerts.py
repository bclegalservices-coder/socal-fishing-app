"""San Clemente Island closure push alerts (Oct 28).

Admin → San Clemente sets which sections (A–F) the Navy has closed, optionally with a start ("from") and end
("until") time, in app_config key "sci_closures":
    {"sections": {"A": {"closed": true, "from": iso|null, "until": iso|null}, ...}, "note": "...", "updated_at": iso}
Every minute the server works out what's closed right now and what closes within the next 18 hours, and tells
everyone with a "San Clemente closures" alert:
  · "San Clemente Island: Sections A and B now CLOSED for Navy training until 4:00 PM. …"
  · "San Clemente Island: Section A reopened."  /  "… all sections open again."
  · "Heads up: San Clemente Section D closes Sat 6:00 AM–4:00 PM for Navy training."
Section G and Wilson Cove are always restricted (no alerts needed). Free for everyone (safety), no daily cap
beyond one message per change. Shapes and the same rules for the app: mobile/src/sci.ts.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

SWITCHABLE = ["A", "B", "C", "D", "E", "F"]
HEADS_UP = timedelta(hours=18)
EVERY_S = 60
FACSFAC = "619-545-4742"

try:
    from zoneinfo import ZoneInfo
    PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:                                   # no time zone data on the server: close enough
    PACIFIC = timezone(timedelta(hours=-7))


def _t(iso):
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def status(sec: str, cfg: dict | None, now: datetime) -> str:
    s = ((cfg or {}).get("sections") or {}).get(sec) or {}
    if not s.get("closed"):
        return "open"
    f, u = _t(s.get("from")), _t(s.get("until"))
    if u and now >= u:
        return "open"
    if f and now < f:
        return "scheduled"
    return "closed"


def when(d: datetime | None, now: datetime) -> str:
    if not d:
        return ""
    loc, today = d.astimezone(PACIFIC), now.astimezone(PACIFIC)
    t = loc.strftime("%I:%M %p").lstrip("0")
    return t if loc.date() == today.date() else f"{loc.strftime('%a')} {t}"


def names(ids: list[str]) -> str:
    s = "Section" + ("s " if len(ids) > 1 else " ")
    return s + (ids[0] if len(ids) == 1 else ", ".join(ids[:-1]) + " and " + ids[-1])


def decide(subs: list[dict], cfg: dict | None, now: datetime) -> list[tuple[dict, str, dict]]:
    """[(subscription, text, new_state)] — pure, so it's tested without a database or network."""
    secs = (cfg or {}).get("sections") or {}
    closed = [k for k in SWITCHABLE if status(k, cfg, now) == "closed"]
    soon = [k for k in SWITCHABLE if status(k, cfg, now) == "scheduled" and _t(secs[k].get("from")) - now <= HEADS_UP]
    note = ((cfg or {}).get("note") or "").strip()
    out = []
    for s in subs:
        if s.get("kind") != "sci" or not s.get("active", True):
            continue
        st = dict(s.get("state") or {})
        prev = st.get("closed")
        if prev is None and not st.get("ready"):        # brand-new alert: start from what's closed now, but say so if any
            prev = []
        prev = list(prev or [])
        warned = [w for w in st.get("warned", []) if _t(w.split("@", 1)[1]) and _t(w.split("@", 1)[1]) > now - timedelta(days=2)]
        parts = []
        newly = [k for k in closed if k not in prev]
        opened = [k for k in prev if k not in closed]
        if newly:
            untils = [_t(secs[k].get("until")) for k in newly]
            u = max(untils) if all(untils) else None
            parts.append(f"{names(newly)} now CLOSED for Navy training{f' until {when(u, now)}' if u else ''}.")
        if opened:
            parts.append("All sections open again (G and Wilson Cove always need permission)." if not closed
                         else f"{names(opened)} reopened; {names(closed)} still closed.")
        new_soon = [k for k in soon if f"{k}@{secs[k].get('from')}" not in warned]
        heads = ""
        if new_soon:
            f = _t(secs[new_soon[0]].get("from")); u = _t(secs[new_soon[0]].get("until"))
            heads = f"Heads up: {names(new_soon)} {'closes' if len(new_soon) == 1 else 'close'} {when(f, now)}{f'–{when(u, f)}' if u else ''} for Navy training."
            warned += [f"{k}@{secs[k].get('from')}" for k in new_soon]
        new_state = {**st, "closed": closed, "warned": warned, "ready": True}
        if not parts and not heads:
            if new_state != st:
                out.append((s, "", new_state))           # bookkeeping only (e.g. a closure ended quietly) — no push
            continue
        text = "San Clemente Island: " + " ".join(parts + ([heads] if heads else []))
        if newly:
            text += f" Ask FACSFAC {FACSFAC} / VHF 16 before going in."
        if note and (newly or heads):
            text += f" ({note[:80]})"
        out.append((s, text, new_state))
    return out


async def tick(pool, send) -> int:
    if pool is None:
        return 0
    async with pool.connection() as conn:
        subs = await (await conn.execute(
            "select id, user_id, kind, params, state, active from alert_subscriptions where active and kind = 'sci'")).fetchall()
        if not subs:
            return 0
        row = await (await conn.execute("select value from app_config where key = 'sci_closures'")).fetchone()
        cfg = row["value"] if row else None
        if isinstance(cfg, str):
            try:
                cfg = json.loads(cfg)
            except ValueError:
                cfg = None
        todo = decide([dict(s) for s in subs], cfg if isinstance(cfg, dict) else None, datetime.now(timezone.utc))
        pushes = [(s, text) for s, text, _ in todo if text]
        toks: dict = {}
        if pushes:
            users = list({s["user_id"] for s, _ in pushes})
            for r in await (await conn.execute("select user_id, token from push_tokens where user_id = any(%s)", (users,))).fetchall():
                toks.setdefault(r["user_id"], []).append(r["token"])
        msgs = []
        for s, text, state in todo:
            if text:
                await conn.execute("update alert_subscriptions set state = %s::jsonb, last_sent_at = now() where id = %s", (json.dumps(state), s["id"]))
                await conn.execute("insert into notification_log (user_id, subscription_id, body) values (%s, %s, %s)", (s["user_id"], s["id"], text))
                for t in toks.get(s["user_id"], []):
                    msgs.append({"to": t, "title": "San Clemente Island", "body": text, "sound": "default", "data": {"type": "sci"}})
            else:
                await conn.execute("update alert_subscriptions set state = %s::jsonb where id = %s", (json.dumps(state), s["id"]))
    if msgs:
        await send(msgs)
    return len(pushes)


async def loop(pool):
    """Started with the server: checks the San Clemente status every minute."""
    from air.alerts import _send_expo
    if os.environ.get("SCI_ALERTS", "1") == "0":
        return
    await asyncio.sleep(30)
    while True:
        try:
            n = await tick(pool, _send_expo)
            if n:
                print(f"san clemente alerts sent: {n}")
        except Exception as e:                      # never let the watcher die
            print("san clemente watcher:", type(e).__name__, str(e)[:120])
        await asyncio.sleep(EVERY_S)
