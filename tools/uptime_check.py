"""Uptime + data-freshness check (GitHub Actions, every hour). Prints problems, one per line, to the file named
in argv[1]; an empty file means everything is fine. Standard library only.

Checks: the API answers and its database is reachable; water temp / chlorophyll / wind were refreshed recently;
the chart helper answers. Render's free plan sleeps, so the first call may take up to a minute (that's normal)."""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = os.environ.get("API_URL", "").rstrip("/")
CHART = os.environ.get("CHART_HELPER_URL", "").rstrip("/")
MAX_AGE_H = {"sst": 40, "chl": 40, "wind": 14}   # jobs run twice a day (sst/chl) and every 6 h (wind), plus slack


def get(url: str, timeout: int = 90, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "channelnav-uptime"}), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:  # timeout, DNS, connection refused
            last = e
            time.sleep(10 * (i + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def age_h(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - t).total_seconds() / 3600


def check() -> list[str]:
    problems: list[str] = []
    if not API:
        return ["API_URL is not set for the uptime check"]
    try:
        code, body = get(f"{API}/health")
        if code != 200:
            problems.append(f"API /health answered {code} (Render may be down or redeploying)")
        else:
            db = json.loads(body).get("database")
            if db != "ok":
                problems.append(f"API is up but the database check says: {db}")
    except Exception as e:
        return [f"API did not answer at all: {e}"]

    try:
        code, body = get(f"{API}/layers")
        if code != 200:
            problems.append(f"/layers answered {code} (the app's map options would be empty)")
        else:
            layers = {l.get("key"): l for l in json.loads(body).get("layers", [])}
            for key, limit in MAX_AGE_H.items():
                l = layers.get(key)
                if not l or l.get("available") is False:
                    problems.append(f"{key}: no data published")
                    continue
                a = age_h(l.get("updated_at"))
                if a is not None and a > limit:
                    problems.append(f"{key}: last updated {a:.0f} h ago (expected within {limit} h) — check the Ocean data workflow")
    except Exception as e:
        problems.append(f"/layers failed: {e}")

    if CHART:
        try:
            # A small Long Beach tile; 200 (picture) or 204 (nothing to draw) both mean it's working.
            code, _ = get(f"{CHART}/chart?bbox=-13163000,3990000,-13153000,4000000&layers=&ls=1&cs=0&ps=2", timeout=40, tries=2)
            if code not in (200, 204):
                problems.append(f"Chart helper answered {code}")
        except Exception as e:
            problems.append(f"Chart helper did not answer: {e}")
    return problems


if __name__ == "__main__":
    out = check()
    print("\n".join(out) if out else "All good")
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w") as f:
            f.write("\n".join(out))
