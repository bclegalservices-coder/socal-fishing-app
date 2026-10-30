"""Spotter-plane history (Oct 29): the real flight paths of planes that circled low and slow over the water.

The server already watches the air traffic around the clock. This keeps it checking about every 10 seconds (so each
loop is caught in full) and, whenever a plane becomes a "likely spotter" (air/traffic.py: circling, ≤ 3,000 ft,
40–160 kt, over the water, not a helicopter), records that plane's actual broadcast positions into a "session":
  · the last ~12 minutes before it was flagged (where it came from + its first loops),
  · every position while it keeps working the area (pauses of up to GRACE_S between circles are the same session),
  · ~2 minutes after it leaves (which way it went).
Sessions are saved to the database (table spotter_sessions, migration 015) so a server restart loses nothing, and
kept 48 hours. Phones read them from GET /air/history?hours=12 and draw them colored by time.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import time

EVERY_S = 10                 # how often the server checks the planes
GRACE_S = 6 * 60             # a pause this long between circles is still the same session
EXIT_S = 2 * 60              # keep this much of the flight after it stops working the area
LEAD_S = 12 * 60             # how much of the path before it was flagged
MERGE_S = 15 * 60            # same plane back over the same spot within this → same session
MERGE_NM = 3.0
KEEP_H = 48
WORK_NM = 3.0                # points within this of the loop center count as "working the spot"
MAX_POINTS = 2500            # per session (≈ 7 h at one point every 10 s)


def nm(a_lat, a_lon, b_lat, b_lon) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lon - a_lon) / 2) ** 2
    return 2 * 3440.065 * math.asin(min(1, math.sqrt(h)))


def _median(v):
    s = sorted(v); n = len(s)
    return (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2) if n else None


class Recorder:
    """Pure bookkeeping (no network, no database) so it is tested on its own."""

    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.active: dict[str, str] = {}          # hex -> session id
        self.dirty: set[str] = set()              # sessions to save
        self.since: float | None = None           # when this server started recording (gaps before it: asleep / restarting)

    # ---- feeding it
    def observe(self, planes: list[dict], paths: dict, now: float) -> None:
        """planes: TRACKER.snapshot()["planes"]; paths: TRACKER.paths {hex: [(t, lat, lon, alt, gs, track), …]}."""
        by_hex = {p["hex"]: p for p in planes}
        for p in planes:
            if not p.get("spotter"):
                continue
            hx = p["hex"]
            sid = self.active.get(hx)
            if sid is None:
                sid = self._reopen(hx, p, now) or self._open(hx, p, paths.get(hx) or [], now)
                self.active[hx] = sid
            s = self.sessions[sid]
            s["last_spot"] = now
            s["circles"] = max(s["circles"], float(p.get("circles") or 0))
            for k in ("reg", "callsign", "type", "desc", "owner", "year"):
                if p.get(k):
                    s[k] = p[k]
        for hx, sid in list(self.active.items()):
            s = self.sessions[sid]
            self._append(s, paths.get(hx) or [])
            p = by_hex.get(hx)
            gone = p is None and (not s["points"] or now - s["points"][-1][2] > GRACE_S)
            if gone or now - s["last_spot"] > GRACE_S:
                self._close(s)
                del self.active[hx]
            self.dirty.add(sid)
        for sid in [k for k, s in self.sessions.items() if now - s["last_t"] > KEEP_H * 3600]:
            self.sessions.pop(sid, None); self.dirty.discard(sid)

    def _open(self, hx: str, p: dict, path, now: float) -> str:
        sid = f"{hx}-{int(now)}"
        self.sessions[sid] = {"id": sid, "hex": hx, "reg": p.get("reg"), "callsign": p.get("callsign"), "type": p.get("type"),
                              "desc": p.get("desc"), "owner": p.get("owner"), "year": p.get("year"),
                              "first_spot": now, "last_spot": now, "circles": 0.0, "points": [], "last_t": now, "active": True}
        s = self.sessions[sid]
        self._append(s, [q for q in path if now - q[0] <= LEAD_S])
        return sid

    def _reopen(self, hx: str, p: dict, now: float) -> str | None:
        """The same plane back over (nearly) the same spot soon after → keep it as one session."""
        best = None
        for s in self.sessions.values():
            if s["hex"] != hx or s["active"] or now - s["last_spot"] > MERGE_S:
                continue
            c = center(s)
            if c and nm(c[1], c[0], p["lat"], p["lon"]) <= MERGE_NM and (best is None or s["last_spot"] > best["last_spot"]):
                best = s
        if best is None:
            return None
        best["active"] = True
        return best["id"]

    def _append(self, s: dict, path) -> None:
        last = s["points"][-1][2] if s["points"] else -1
        for q in path:
            t = q[0]
            if t <= last + 1:
                continue
            if s["points"] and not s["active"]:
                break
            s["points"].append([round(q[2], 5), round(q[1], 5), int(t), None if q[3] is None else int(q[3])])
            last = t
        if len(s["points"]) > MAX_POINTS:                        # very long session: thin the oldest half
            half = len(s["points"]) // 2
            s["points"] = s["points"][:half:2] + s["points"][half:]
        if s["points"]:
            s["last_t"] = s["points"][-1][2]

    def _close(self, s: dict) -> None:
        s["active"] = False
        cut = s["last_spot"] + EXIT_S
        s["points"] = [q for q in s["points"] if q[2] <= cut]

    # ---- reading it
    def recent(self, hours: float, now: float) -> list[dict]:
        out = [public(s, now) for s in self.sessions.values() if now - s["last_t"] <= hours * 3600 and len(s["points"]) >= 4]
        return sorted(out, key=lambda x: x["last_t"], reverse=True)

    # ---- saving / loading
    def load(self, rows: list[dict]) -> None:
        for r in rows:
            s = dict(r)
            s["active"] = False                                  # after a restart a session only continues if it's seen again
            self.sessions[s["id"]] = s


def work_points(s: dict) -> list:
    """The part of the path spent working the spot (from the first point that stays near the loop center)."""
    pts = s["points"]
    if not pts:
        return []
    core = [q for q in pts if s["first_spot"] - 60 <= q[2] <= s["last_spot"]] or pts
    c = (_median([q[0] for q in core]), _median([q[1] for q in core]))
    i = len(pts)
    for j in range(len(pts) - 1, -1, -1):                        # walk back from the end while it stays near
        if pts[j][2] > s["last_spot"]:
            continue
        if nm(c[1], c[0], pts[j][1], pts[j][0]) > WORK_NM:
            break
        i = j
    end = max((k for k, q in enumerate(pts) if q[2] <= s["last_spot"]), default=len(pts) - 1)
    return pts[min(i, end):end + 1]


def center(s: dict):
    w = work_points(s)
    if not w:
        return None
    return [round(_median([q[0] for q in w]), 5), round(_median([q[1] for q in w]), 5)]


def public(s: dict, now: float) -> dict:
    w = work_points(s)
    alts = [q[3] for q in w if q[3] is not None]
    start = w[0][2] if w else s["first_spot"]
    end = s["last_spot"]
    return {"id": s["id"], "hex": s["hex"], "reg": s.get("reg"), "callsign": s.get("callsign"), "type": s.get("type"),
            "desc": s.get("desc"), "owner": s.get("owner"), "year": s.get("year"),
            "active": bool(s["active"]), "work_from": int(start), "work_to": int(end), "last_t": int(s["last_t"]),
            "minutes": round((end - start) / 60), "circles": round(float(s.get("circles") or 0), 1),
            "alt_min": min(alts) if alts else None, "alt_max": max(alts) if alts else None,
            "center": center(s), "points": s["points"]}


def as_row(s: dict) -> dict:
    return {k: s.get(k) for k in ("id", "hex", "reg", "callsign", "type", "desc", "owner", "year", "first_spot", "last_spot",
                                   "circles", "last_t", "active")} | {"points": s["points"]}


RECORDER = Recorder()


# ------------------------------------------------------------------ the server loop + database

async def _save(pool, rec: Recorder) -> None:
    if pool is None or not rec.dirty:
        return
    ids = list(rec.dirty); rec.dirty.clear()
    async with pool.connection() as conn:
        for sid in ids:
            s = rec.sessions.get(sid)
            if not s:
                continue
            c = center(s)
            await conn.execute(
                """insert into spotter_sessions (id, hex, data, last_t, center_lon, center_lat, updated_at)
                   values (%s, %s, %s::jsonb, to_timestamp(%s), %s, %s, now())
                   on conflict (id) do update set data = excluded.data, last_t = excluded.last_t,
                     center_lon = excluded.center_lon, center_lat = excluded.center_lat, updated_at = now()""",
                (sid, s["hex"], json.dumps(as_row(s)), s["last_t"], c[0] if c else None, c[1] if c else None))
        await conn.execute(f"delete from spotter_sessions where last_t < now() - interval '{KEEP_H} hours'")


async def _load(pool, rec: Recorder) -> None:
    if pool is None:
        return
    try:
        async with pool.connection() as conn:
            rows = await (await conn.execute(
                f"select data from spotter_sessions where last_t > now() - interval '{KEEP_H} hours'")).fetchall()
        rec.load([r["data"] if isinstance(r["data"], dict) else json.loads(r["data"]) for r in rows])
        print(f"spotter history: {len(rows)} sessions loaded")
    except Exception as e:
        print("spotter history: couldn't load", type(e).__name__, str(e)[:120])


async def loop(pool):
    """Started with the server: checks the planes about every 10 s and records spotter sessions."""
    from .traffic import TRACKER, _depth_lookup, _fetch
    if os.environ.get("AIR_HISTORY", "1") == "0":
        return
    await asyncio.sleep(15)
    RECORDER.since = time.time()
    await _load(pool, RECORDER)
    last_save = 0.0
    while True:
        try:
            await TRACKER.refresh(_fetch)
            now = time.time()
            snap = TRACKER.snapshot(now, _depth_lookup())
            RECORDER.observe(snap["planes"], {h: list(d) for h, d in TRACKER.paths.items()}, now)
            if now - last_save > 60:
                last_save = now
                await _save(pool, RECORDER)
        except Exception as e:                      # never let the recorder die
            print("spotter history:", type(e).__name__, str(e)[:120])
        await asyncio.sleep(EVERY_S)
