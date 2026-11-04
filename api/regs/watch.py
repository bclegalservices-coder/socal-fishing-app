"""Fish size and bag limits (Nov 3). The rules themselves are in regs/regs.json, written by hand from the official
CDFW pages listed in it. Every week this job re-reads those CDFW pages and notices when CDFW changes one:
  * a page's "updated" date is newer than the day our rules were last checked, or
  * the page's text is different from last week.
The app then shows a yellow "CDFW changed this rule" note on the affected fish (with the official link), and the
admin page lists the changed pages so the rules file can be updated. Seasons that open and close on known dates
(rockfish months, lobster, grunion) switch by themselves in the app — no job needed for those."""
from __future__ import annotations

import hashlib
import html
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

DATA_FILE = Path(__file__).with_name("regs.json")
STATUS_KEY = "regs/status.json"
MANIFEST_KEY = "manifests/regs.json"
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                      "october", "november", "december"], 1)}


def load() -> dict:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def page_text(raw: str) -> str:
    """The readable words of a web page (no menus' scripts/styles), squeezed to single spaces."""
    raw = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<!--.*?-->", " ", raw)
    main = re.search(r"(?is)<main[^>]*>(.*?)</main>", raw)
    body = main.group(1) if main else raw
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body))).strip()


def updated_date(text: str) -> str | None:
    """The newest 'Updated …' / 'Last updated …' date written on the page, as YYYY-MM-DD."""
    found = []
    for m in re.finditer(r"(?i)updated[:\s]*(?:on\s+)?([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", text):
        mo = MONTHS.get(m.group(1).lower()) or next((v for k, v in MONTHS.items() if k.startswith(m.group(1).lower()[:3])), None)
        if mo:
            found.append(_iso(int(m.group(3)), mo, int(m.group(2))))
    for m in re.finditer(r"(?i)updated[:\s]*(?:on\s+)?(\d{1,2})/(\d{1,2})/(\d{2,4})", text):
        y = int(m.group(3)); y = y + 2000 if y < 100 else y
        found.append(_iso(y, int(m.group(1)), int(m.group(2))))
    found = [f for f in found if f]
    return max(found) if found else None


def _iso(y, m, d):
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def _ask_claude(http):
    """Claude for the self-checking reads (ways 2 and 3), if the server has its own API key (GitHub secret)."""
    import os
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    from .auto import claude
    return lambda model, prompt: claude(http, model, prompt, key)


def run(store, http, log=print, now: datetime | None = None, ask="env", mode: str | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    data = load()
    if ask == "env":
        ask = _ask_claude(http)
    raw = store.get(STATUS_KEY)
    prev = json.loads(raw) if raw else {}
    prev_pages = prev.get("pages", {})
    pages = {}
    for key, src in data["sources"].items():
        old = prev_pages.get(key, {})
        entry = {"url": src["url"], "title": src["title"]}
        try:
            r = http.get(src["url"])
            r.raise_for_status()
            text = page_text(r.text)
            if len(text) < 200:
                raise ValueError("page came back nearly empty")
            h = hashlib.sha256(text.encode()).hexdigest()[:16]
            upd = updated_date(text)
            changed_on = old.get("changed_on")          # once flagged, stays flagged until the rules file is updated
            if not changed_on:
                if upd and upd > data["checked"]:
                    changed_on = upd                        # CDFW's own "updated" date
                elif old.get("hash") and old["hash"] != h:
                    changed_on = now.date().isoformat()     # text changed without a new date: the day we noticed
            entry.update(ok=True, hash=h, page_updated=upd, checked_at=now.isoformat(),
                         changed_on=changed_on if (changed_on and changed_on > data["checked"]) else None,
                         auto_hash=old.get("auto_hash"))
            if entry["changed_on"] and old.get("auto_hash") != h:   # a new version of a changed page: read it 3 ways
                from . import auto
                try:
                    auto.process(store, data, key, r.text, text, ask, log, now, mode)
                    entry["auto_hash"] = h
                except Exception as e:
                    log(f"regs auto: {key}: self-check failed ({type(e).__name__}: {str(e)[:120]}) — flag stays on")
            log(f"regs: {key}: ok, page updated {upd or '?'}{' — CHANGED ' + entry['changed_on'] if entry['changed_on'] else ''}")
        except Exception as e:   # keep last week's answer; the admin page shows the page couldn't be checked
            entry.update({k: old.get(k) for k in ("hash", "page_updated", "changed_on", "auto_hash")}, ok=False,
                         checked_at=old.get("checked_at"), error=f"{type(e).__name__}: {str(e)[:120]}")
            log(f"regs: {key}: could not check ({entry['error']})")
        pages[key] = entry
    status = {"checked_at": now.isoformat(), "rules_version": data["version"], "rules_checked": data["checked"], "pages": pages}
    store.put(STATUS_KEY, json.dumps(status).encode(), "application/json")
    changed = [k for k, p in pages.items() if p.get("changed_on")]
    from .auto import AUTO_KEY
    a = json.loads(store.get(AUTO_KEY) or b"{}") or {}
    fresh = lambda d: d > data["checked"]   # noqa: E731  (anything older was replaced by a hand update)
    store.put(MANIFEST_KEY, json.dumps({"checked_at": status["checked_at"], "rules_checked": data["checked"], "changed": changed,
                                        "failed": [k for k, p in pages.items() if not p.get("ok")],
                                        "auto_mode": a.get("mode", "preview"), "auto_key": bool(ask),
                                        "auto_changes": [c for c in a.get("changes", []) if fresh(c["on"])],
                                        "auto_unsure": {k: v for k, v in a.get("unsure", {}).items() if fresh(v["on"])}}).encode(), "application/json")
    return status


def payload(store) -> dict:
    """What the app downloads: the rules plus which official pages changed since the rules were checked."""
    data = load()
    raw = store.get(STATUS_KEY) if store else None
    st = json.loads(raw) if raw else {}
    pages = st.get("pages", {})
    from .auto import AUTO_KEY, overlay
    a = json.loads(store.get(AUTO_KEY) or b"{}") or {} if store else {}
    data = overlay(data, a)
    data["watch"] = {"checked_at": st.get("checked_at"),
                     "changed": {k: p["changed_on"] for k, p in pages.items() if p.get("changed_on")},
                     "verified": {k: v for k, v in a.get("verified", {}).items() if v > data["checked"]},
                     "unsure": [k for k, v in a.get("unsure", {}).items() if v["on"] > data["checked"]]}
    return data
