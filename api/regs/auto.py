"""Self-checking automatic updates for fish size and bag limits (Nov 3).

When the weekly check (watch.py) sees that CDFW changed one of its pages, this reads the new numbers off that page
in DIFFERENT ways and only changes a number when the reads agree:

  Way 1 – table reader (no AI): finds the fish's row in the page's tables, uses the column headings
          ("Bag", "Size") to pick the right cells, and pulls the numbers out with fixed rules.
  Way 2 – Claude (Sonnet) reads the whole page like a person and fills in a form: bag limit and minimum size per fish.
  Way 3 – only for fish where ways 1 and 2 disagree (or one found nothing): Claude (Opus, a different model) must
          copy the exact words from the page that state the rule, then give the number. The copied words have to be
          found word-for-word on the page, and the number has to be in them — so it can't invent anything.

A number is accepted only when two of the three ways give the same answer, AND
  * proof check (no AI): that number is printed on the page close to the fish's name,
  * sanity check: it's a believable value (no bag limit jumping 2 → 20, no size of 300 in, never on a protected fish),
  * the old number appears in our wording exactly where it should be replaced.
Anything else stays a yellow "check the official rules" note for a person to look at.

Mode (GitHub variable REGS_AUTO): "preview" (default) = record what it WOULD change, change nothing;
"on" = apply the changes. Every change is listed on the admin page with old → new; job `regs-undo` takes them back.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone

AUTO_KEY = "regs/auto.json"
WAY2_MODEL = os.environ.get("REGS_WAY2_MODEL", "claude-sonnet-5-5")
WAY3_MODEL = os.environ.get("REGS_WAY3_MODEL", "claude-opus-5-5")
FIELDS = ("bag", "size")
FRAC = {"½": 0.5, "¼": 0.25, "¾": 0.75}


# ---------------------------------------------------------------- shared helpers
def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def num(s: str) -> float | None:
    """'10' → 10, '3¼' → 3.25, '10 1/2' → 10.5, '10.5' → 10.5"""
    m = re.match(r"\s*(\d+(?:\.\d+)?)(?:\s?([½¼¾])|\s(\d)/(\d))?", s or "")
    if not m:
        return None
    v = float(m.group(1))
    if m.group(2):
        v += FRAC[m.group(2)]
    elif m.group(3):
        v += int(m.group(3)) / int(m.group(4))
    return v


def names_for(item: dict) -> list[str]:
    """Words that identify the fish on a CDFW page: its name (without the bracket part) and its nicknames."""
    base = re.sub(r"\(.*?\)", "", item["name"]).split(":")[0].strip().lower()
    out = [base] + [a.lower() for a in item.get("aka", []) if len(a) >= 4]
    return [n for n in dict.fromkeys(out) if n]


def _same(a, b) -> bool:
    return a is not None and b is not None and abs(float(a) - float(b)) < 1e-6


# ---------------------------------------------------------------- way 1: table reader (no AI)
def tables(raw_html: str) -> list[list[list[str]]]:
    out = []
    for t in re.findall(r"(?is)<table[^>]*>(.*?)</table>", raw_html):
        rows = []
        for tr in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", t):
            cells = [squash(re.sub(r"<[^>]+>", " ", c)) for c in re.findall(r"(?is)<t[hd][^>]*>(.*?)</t[hd]>", tr)]
            if cells:
                rows.append(cells)
        if rows:
            out.append(rows)
    return out


def bag_from_cell(c: str) -> float | None:
    c = c.lower()
    if re.search(r"\bno (bag )?limit\b|\bnone\b|prohibit", c):
        return None
    m = re.search(r"(\d+)\s*(?:fish|per day|/day|per person|\b)", c)
    return float(m.group(1)) if m else None


def size_from_cell(c: str) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?\s*(?:[½¼¾]|\s\d/\d)?)\s*(?:in\b|inch|\"|”)", c)
    return num(m.group(1)) if m else None


def way1(raw_html: str, items: list[dict]) -> dict:
    found: dict = {}
    for rows in tables(raw_html):
        head = [h.lower() for h in rows[0]]
        bag_col = next((i for i, h in enumerate(head) if "bag" in h or "limit" in h and "size" not in h), None)
        size_col = next((i for i, h in enumerate(head) if "size" in h), None)
        for r in rows[1:]:
            first = r[0].lower()
            for it in items:
                if it["id"] in found or not any(n in first for n in names_for(it)):
                    continue
                v = {}
                if bag_col is not None and bag_col < len(r):
                    v["bag"] = bag_from_cell(r[bag_col])
                if size_col is not None and size_col < len(r):
                    v["size"] = size_from_cell(r[size_col])
                found[it["id"]] = v
    return found


# ---------------------------------------------------------------- ways 2 and 3: Claude, two different methods
def claude(http, model: str, prompt: str, key: str) -> str:
    r = http.post("https://api.anthropic.com/v1/messages", timeout=180,
                  headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                  json={"model": model, "max_tokens": 4000, "messages": [{"role": "user", "content": prompt}]})
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json().get("content", []))


def _json(text: str):
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else {}


def way2(ask, page_text: str, items: list[dict]) -> dict:
    fish = "\n".join(f'- {it["id"]}: {it["name"]}' for it in items)
    prompt = ("Below is the text of an official California Department of Fish and Wildlife recreational fishing page "
              "(Southern California). For each fish listed, read the page and give the DAILY BAG LIMIT (a number of fish "
              "per person per day) and the MINIMUM SIZE in inches. Use null if the page doesn't state it or says no limit. "
              "Answer with JSON only, like {\"barracuda\": {\"bag\": 10, \"size\": 28}}.\n\nFish:\n" + fish +
              "\n\nPAGE TEXT:\n" + page_text[:120000])
    out = {}
    for k, v in (_json(ask(WAY2_MODEL, prompt)) or {}).items():
        if isinstance(v, dict):
            out[k] = {f: (float(v[f]) if isinstance(v.get(f), (int, float)) else None) for f in FIELDS}
    return out


def way3(ask, page_text: str, item: dict, field: str) -> float | None:
    what = "daily bag limit (number of fish per person per day)" if field == "bag" else "minimum size limit in inches"
    prompt = (f"From the official fishing-rules page below, find the {what} for: {item['name']}.\n"
              "Step 1: copy, word for word, the shortest piece of the page (one table row or sentence) that states it. "
              "Step 2: give the number from that exact piece.\n"
              "If the page doesn't state it, use null for both.\nAnswer with JSON only: {\"quote\": \"...\", \"value\": 10}\n\n"
              "PAGE TEXT:\n" + page_text[:120000])
    a = _json(ask(WAY3_MODEL, prompt)) or {}
    quote, value = squash(str(a.get("quote") or "")), a.get("value")
    if not quote or not isinstance(value, (int, float)):
        return None
    if quote.lower() not in squash(page_text).lower():          # it must really be on the page
        return None
    nums = [num(x) for x in re.findall(r"\d+(?:\.\d+)?\s*(?:[½¼¾]|\s\d/\d)?", quote)]
    return float(value) if any(_same(n, value) for n in nums if n is not None) else None


# ---------------------------------------------------------------- checks that use no AI
def proof_on_page(page_text: str, item: dict, value: float) -> bool:
    """The number is printed on the page within ~400 characters after one of the fish's names."""
    t = squash(page_text).lower()
    pats = [str(int(value)) if value == int(value) else str(value)]
    whole, frac = int(value), value - int(value)
    for sym, f in FRAC.items():
        if abs(frac - f) < 1e-6:
            pats += [f"{whole}{sym}", f"{whole} {sym}", f"{whole} {int(f * 4)}/4" if f != 0.5 else f"{whole} 1/2"]
    for n in names_for(item):
        for m in re.finditer(re.escape(n), t):
            window = t[m.start(): m.start() + 400]
            if any(re.search(rf"(?<![\d.]){re.escape(p)}(?![\d])", window) for p in pats):
                return True
    return False


def sane(item: dict, field: str, old: float, new: float) -> str | None:
    """Why a change is NOT believable (None = fine)."""
    if item.get("status") == "prohibited" or item.get("group") == "prohibited":
        return "protected fish are never changed automatically"
    if field == "bag":
        if not (0 <= new <= 60):
            return "bag limit out of range"
        if old and (new > old * 3 + 1 or new < old / 3 - 1):
            return f"bag limit jump too big ({old:g} → {new:g})"
    if field == "size":
        if not (1 <= new <= 80):
            return "size out of range"
        if old and abs(new - old) > max(6, old * 0.4):
            return f"size change too big ({old:g} → {new:g} in)"
    return None


def reword(text: str, old: float, new: float) -> str | None:
    """Swap the old number for the new one in our wording (first time it appears as its own number)."""
    o = f"{old:g}"
    n = f"{int(new)}" if new == int(new) else f"{new:g}"
    if not re.search(rf"(?<![\d.]){re.escape(o)}(?![\d.])", text):
        return None
    return re.sub(rf"(?<![\d.]){re.escape(o)}(?![\d.])", n, text, count=1)


# ---------------------------------------------------------------- the decision
def decide(item: dict, field: str, w1, w2, w3_fn) -> tuple[float | None, dict]:
    """Two of three must agree. Way 3 is asked only when ways 1 and 2 don't."""
    reads = {"way1": w1, "way2": w2}
    if _same(w1, w2):
        return float(w1), reads
    w3 = w3_fn()
    reads["way3"] = w3
    for a in (w1, w2):
        if _same(a, w3):
            return float(w3), reads
    return None, reads


def process(store, data: dict, page_key: str, raw_html: str, page_text: str, ask, log=print, now=None, mode: str | None = None) -> dict:
    """Read one changed page three ways and record (preview) or apply (on) the agreed changes."""
    now = now or datetime.now(timezone.utc)
    mode = "on" if (mode or os.environ.get("REGS_AUTO", "")).strip().lower() == "on" else "preview"
    items = [it for it in data["items"] if it.get("src") == page_key and it.get("facts")]
    state = json.loads(store.get(AUTO_KEY) or b"{}") or {}
    state.setdefault("changes", [])
    state.setdefault("verified", {})
    state.setdefault("unsure", {})
    r1 = way1(raw_html, items)
    try:
        r2 = way2(ask, page_text, items) if ask else {}
    except Exception as e:
        log(f"regs auto: way 2 failed ({type(e).__name__}): only checking, nothing changed")
        r2 = {}
    for it in items:
        problems = []
        for field in FIELDS:
            if field not in it["facts"]:
                continue
            old = float(it["facts"][field])
            def w3(it=it, field=field):
                try:
                    return way3(ask, page_text, it, field) if ask else None
                except Exception:
                    return None
            value, reads = decide(it, field, r1.get(it["id"], {}).get(field), r2.get(it["id"], {}).get(field), w3)
            if value is None:
                problems.append(f"{field}: the reads didn't agree {reads}")
                continue
            if not proof_on_page(page_text, it, value):
                problems.append(f"{field}: {value:g} isn't printed near the fish's name on the page")
                continue
            if _same(value, old):
                continue                                              # still the same: confirmed
            why = sane(it, field, old, value)
            text_key = "bag" if field == "bag" else "size"
            new_text = reword(it[text_key], old, value) if not why else None
            if why or new_text is None:
                problems.append(f"{field}: {why or 'could not place the new number in the wording'}")
                continue
            state["changes"] = [c for c in state["changes"] if not (c["id"] == it["id"] and c["field"] == field)]
            state["changes"].append({"id": it["id"], "name": it["name"], "field": field, "old": old, "new": value,
                                     "old_text": it[text_key], "new_text": new_text, "page": page_key, "on": now.date().isoformat(),
                                     "reads": reads, "applied": mode == "on"})
            log(f"regs auto: {it['name']} {field} {old:g} → {value:g} ({'APPLIED' if mode == 'on' else 'preview only'}) reads={reads}")
        if problems:
            state["unsure"][it["id"]] = {"on": now.date().isoformat(), "page": page_key, "why": problems}
            state["verified"].pop(it["id"], None)
            log(f"regs auto: {it['name']}: needs a person — {'; '.join(problems)}")
        else:
            state["verified"][it["id"]] = now.date().isoformat()
            state["unsure"].pop(it["id"], None)
    state["mode"] = mode
    state["updated_at"] = now.isoformat()
    store.put(AUTO_KEY, json.dumps(state).encode(), "application/json")
    return state


def overlay(data: dict, state: dict) -> dict:
    """Apply the automatic changes (only ones marked applied, and only those newer than the hand-checked rules)."""
    by = {it["id"]: it for it in data["items"]}
    for c in state.get("changes", []):
        it = by.get(c["id"])
        if not it or not c.get("applied") or c["on"] <= data["checked"]:
            continue
        key = "bag" if c["field"] == "bag" else "size"
        if it[key] == c["old_text"]:
            it[key] = c["new_text"]
            it.setdefault("facts", {})[c["field"]] = c["new"]
            it["notes"] = [f"Updated automatically from CDFW on {c['on']} (checked 3 ways)."] + [n for n in it["notes"] if not n.startswith("Updated automatically")]
    return data


def undo(store, log=print) -> None:
    """Job `regs-undo`: take back every automatic change (the hand-checked numbers show again)."""
    state = json.loads(store.get(AUTO_KEY) or b"{}") or {}
    n = sum(1 for c in state.get("changes", []) if c.get("applied"))
    for c in state.get("changes", []):
        c["applied"] = False
    store.put(AUTO_KEY, json.dumps(state).encode(), "application/json")
    log(f"regs auto: undid {n} automatic change(s)")
