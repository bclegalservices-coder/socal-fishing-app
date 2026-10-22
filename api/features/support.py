"""In-app feedback and crash reports. Stored in app_feedback / app_errors; read in Admin → Feedback & crashes.
Nothing personal is required: email is optional on feedback; crash reports carry the error, app version and phone type."""
from __future__ import annotations

import hashlib
import random
import re
import time
from datetime import datetime

KINDS = {"bug", "idea", "data", "other"}
_rate: dict[str, list[float]] = {}


def rate_ok(key: str, per_hour: int) -> bool:
    t = time.monotonic()
    hist = [x for x in _rate.get(key, []) if t - x < 3600]
    if len(hist) >= per_hour:
        _rate[key] = hist
        return False
    _rate[key] = hist + [t]
    return True


def _s(v, n: int) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s[:n] if s else None


def clean_feedback(b: dict) -> dict:
    kind = str(b.get("kind") or "other")
    if kind not in KINDS:
        kind = "other"
    msg = _s(b.get("message"), 4000)
    if not msg or len(msg) < 3:
        raise ValueError("Message is empty")
    email = _s(b.get("email"), 200)
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        email = None
    return {"kind": kind, "message": msg, "email": email, "app_version": _s(b.get("app_version"), 30),
            "device": _s(b.get("device"), 60), "area": _s(b.get("area"), 60)}


_NUM = re.compile(r"\b\d+\b|0x[0-9a-f]+", re.I)


def fingerprint(message: str, stack: str | None) -> str:
    """Same crash → same id, even when numbers in the message differ. Uses the message shape + top 3 stack frames."""
    frames = [ln.strip() for ln in (stack or "").splitlines()[1:] if ln.strip()][:3]
    frames = [re.sub(r":\d+(:\d+)?\)?$", "", f) for f in frames]   # drop line:col (changes every build)
    base = _NUM.sub("#", message or "") + "|" + "|".join(frames)
    return hashlib.sha1(base.encode()).hexdigest()[:16]


def clean_errors(b: dict) -> list[dict]:
    items = b.get("errors")
    if not isinstance(items, list):
        raise ValueError("errors must be a list")
    out = []
    for e in items[:20]:
        if not isinstance(e, dict):
            continue
        msg = _s(e.get("message"), 500) or "Unknown error"
        stack = _s(e.get("stack"), 4000)
        at = None
        try:
            at = datetime.fromisoformat(str(e.get("at")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            pass
        out.append({"message": msg, "stack": stack, "fatal": bool(e.get("fatal")), "context": _s(e.get("context"), 200),
                    "app_version": _s(e.get("version"), 30), "os": _s(e.get("os"), 40), "runtime": _s(e.get("runtime"), 40),
                    "happened_at": at, "fingerprint": fingerprint(msg, stack)})
    return out


async def store_feedback(pool, f: dict) -> bool:
    if pool is None:
        return False
    async with pool.connection() as conn:
        await conn.execute("insert into app_feedback (kind, message, email, app_version, device, area) values "
                           "(%(kind)s, %(message)s, %(email)s, %(app_version)s, %(device)s, %(area)s)", f)
    return True


async def store_errors(pool, errs: list[dict]) -> int:
    if pool is None or not errs:
        return 0
    async with pool.connection() as conn:
        for e in errs:
            await conn.execute("insert into app_errors (message, stack, fatal, context, app_version, os, runtime, happened_at, fingerprint) values "
                               "(%(message)s, %(stack)s, %(fatal)s, %(context)s, %(app_version)s, %(os)s, %(runtime)s, %(happened_at)s, %(fingerprint)s)", e)
        if random.random() < 0.02:
            await conn.execute("select prune_app_errors()")
    return len(errs)
