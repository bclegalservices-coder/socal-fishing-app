"""Fish size and bag limits (Nov 3): the rules file, the weekly CDFW change check, and the app's built-in copy."""
import json
from datetime import datetime, timezone


class _Store:
    def __init__(self): self.d = {}
    def get(self, k): return self.d.get(k)
    def put(self, k, v, ct=None): self.d[k] = v


class _Resp:
    def __init__(self, text, code=200): self.text, self.status_code = text, code
    def raise_for_status(self):
        if self.status_code >= 400: raise RuntimeError(f"HTTP {self.status_code}")


class _Http:
    def __init__(self, pages): self.pages = pages
    def get(self, url):
        v = self.pages.get(url)
        if v is None: return _Resp("", 503)
        return _Resp(v)


def _page(updated, extra=""):
    return f"<html><script>var x=1</script><main><h1>Rules</h1><p>Last updated: {updated}</p><p>{'Barracuda 28 inches. ' * 20}{extra}</p></main></html>"


def test_rules_file_is_complete_and_every_rule_names_its_official_source():
    from regs.watch import load
    d = load()
    ids = [r["id"] for r in d["items"]]
    assert len(ids) == len(set(ids)) and len(ids) > 50
    for r in d["items"]:
        assert r["src"] in d["sources"], r["id"]
        assert r["name"] and r["bag"] and r["group"] in ("fish", "rockfish", "shell", "prohibited", "general"), r["id"]
    by = {r["id"]: r for r in d["items"]}
    assert "28 in" in by["barracuda"]["size"]
    assert by["giant-sea-bass"]["status"] == "prohibited" and by["garibaldi"]["status"] == "prohibited"
    assert by["lobster"]["rule"] == "lobster" and "3¼" in by["lobster"]["size"]
    assert all(s["url"].startswith("https://") for s in d["sources"].values())


def test_weekly_check_flags_a_cdfw_page_that_changed_after_the_rules_were_written():
    from regs.watch import load, payload, run
    d = load()
    urls = {k: s["url"] for k, s in d["sources"].items()}
    st = _Store()
    pages = {u: _page("June 23, 2026") for u in urls.values()}
    pages[urls["southern"]] = _page("October 2, 2026")
    run(st, _Http(pages), log=lambda *a: None, now=datetime(2026, 11, 9, tzinfo=timezone.utc))
    p = payload(st)
    assert p["watch"]["changed"] == {} and p["watch"]["checked_at"].startswith("2026-11-09")   # nothing new since Nov 3
    # next week CDFW posts an in-season rockfish change (new date) and quietly edits the lobster FAQ (same date)
    pages[urls["groundfish"]] = _page("November 12, 2026", "Closed")
    pages[urls["inverts"]] = _page("June 23, 2026", "Lobster now 6 per day")
    del pages[urls["bluefin"]]                                          # and one page doesn't load this week
    run(st, _Http(pages), log=lambda *a: None, now=datetime(2026, 11, 16, tzinfo=timezone.utc))
    p = payload(st)
    assert p["watch"]["changed"] == {"groundfish": "2026-11-12", "inverts": "2026-11-16"}
    m = json.loads(st.get("manifests/regs.json"))
    assert sorted(m["changed"]) == ["groundfish", "inverts"] and m["failed"] == ["bluefin"]
    s = json.loads(st.get("regs/status.json"))
    assert s["pages"]["bluefin"]["ok"] is False and s["pages"]["bluefin"]["hash"]   # kept last week's copy


def test_updated_dates_are_read_in_the_formats_cdfw_uses():
    from regs.watch import updated_date, page_text
    assert updated_date("Page updated June 23, 2026 · More") == "2026-06-23"
    assert updated_date("Last updated: Oct. 2, 2026") == "2026-10-02"
    assert updated_date("Updated 10/02/2026") == "2026-10-02"
    assert updated_date("no date here") is None
    assert "var x" not in page_text("<script>var x=1</script><main>Hello <b>there</b></main>")


def test_app_has_the_same_rules_built_in_for_offline():
    from pathlib import Path
    from regs.sync_app_copy import APP, render
    assert Path(APP).read_text(encoding="utf-8") == render(), "run: python3 api/regs/sync_app_copy.py"


# ---------------- self-checking automatic updates (3 different ways of reading) ----------------
_TABLE = """<html><main><p>Last updated: November 20, 2026</p>
<table><tr><th>Species</th><th>Season</th><th>Bag/Possession Limit</th><th>Minimum Size Limit</th></tr>
<tr><td>California barracuda</td><td>Open year-round</td><td>8 fish</td><td>28 in total length</td></tr>
<tr><td>Yellowtail</td><td>Open year-round</td><td>10/day</td><td>24 in fork length</td></tr>
<tr><td>California halibut</td><td>Open year-round</td><td>50/day</td><td>22 in total length</td></tr>
<tr><td>White seabass</td><td>Open year-round</td><td>3/day</td><td>28 in total length</td></tr>
</table><p>{}</p></main></html>""".format("More rules text. " * 30)


def _fake_claude(answers_way2, way3_quotes, calls):
    def ask(model, prompt):
        calls.append(model)
        if "copy, word for word" in prompt:                   # way 3: quote then number
            for name, (quote, value) in way3_quotes.items():
                if name in prompt:
                    return json.dumps({"quote": quote, "value": value})
            return json.dumps({"quote": None, "value": None})
        return json.dumps(answers_way2)                       # way 2: fill in the form
    return ask


def _run_auto(mode, way2, way3, calls, store=None):
    from regs import auto
    from regs.watch import load, page_text
    st = store or _Store()
    data = load()
    data["items"] = [i for i in data["items"] if i["id"] in ("barracuda", "yellowtail", "ca-halibut", "white-seabass")]
    for i in data["items"]:
        i["src"] = "southern"
    state = auto.process(st, data, "southern", _TABLE, page_text(_TABLE), _fake_claude(way2, way3, calls),
                         log=lambda *a: None, now=datetime(2026, 11, 23, tzinfo=timezone.utc), mode=mode)
    return st, state


def test_a_number_changes_only_when_two_different_reads_agree_and_it_is_on_the_page():
    calls = []
    way2 = {"barracuda": {"bag": 8, "size": 28}, "yellowtail": {"bag": 12, "size": 24},      # way 2 misreads yellowtail
            "ca-halibut": {"bag": 50, "size": 22}, "white-seabass": {"bag": 3, "size": 28}}
    way3 = {"California yellowtail": ("Yellowtail Open year-round 10/day", 10)}
    st, state = _run_auto("preview", way2, way3, calls)
    ch = {(c["id"], c["field"]): c for c in state["changes"]}
    assert ch[("barracuda", "bag")]["new"] == 8 and ch[("barracuda", "bag")]["new_text"].startswith("8 per day")
    assert ch[("barracuda", "bag")]["applied"] is False                 # preview: recorded, nothing changed yet
    assert "way3" not in ch[("barracuda", "bag")]["reads"]              # ways 1 and 2 agreed: no third read needed
    assert ("yellowtail", "bag") not in ch and "yellowtail" in state["verified"]   # 2 of 3 said 10 = unchanged
    assert calls.count("claude-opus-5-5") == 1                          # third read only for the disagreement
    assert "ca-halibut" in state["unsure"] and "jump" in state["unsure"]["ca-halibut"]["why"][0]   # 5 → 50 refused
    assert "white-seabass" in state["verified"]


def test_third_read_must_quote_the_page_word_for_word():
    calls = []
    way2 = {"barracuda": {"bag": 9, "size": 28}, "yellowtail": {"bag": 10, "size": 24}, "white-seabass": {"bag": 3, "size": 28},
            "ca-halibut": {"bag": 5, "size": 22}}
    way3 = {"California barracuda": ("Barracuda limit is 9 fish per day", 9)}       # made-up quote: not on the page
    _, state = _run_auto("preview", way2, way3, calls)
    assert not any(c["id"] == "barracuda" for c in state["changes"]) and "barracuda" in state["unsure"]


def test_turned_on_the_app_gets_the_new_number_and_undo_takes_it_back():
    from regs import auto, watch
    calls = []
    way2 = {"barracuda": {"bag": 8, "size": 28}, "yellowtail": {"bag": 10, "size": 24}, "white-seabass": {"bag": 3, "size": 28},
            "ca-halibut": {"bag": 5, "size": 22}}
    st, _ = _run_auto("on", way2, {}, calls)
    p = watch.payload(st)
    cuda = next(i for i in p["items"] if i["id"] == "barracuda")
    assert cuda["bag"].startswith("8 per day") and cuda["facts"]["bag"] == 8 and "checked 3 ways" in cuda["notes"][0]
    assert "barracuda" in p["watch"]["verified"]
    auto.undo(st, log=lambda *a: None)
    cuda = next(i for i in watch.payload(st)["items"] if i["id"] == "barracuda")
    assert cuda["bag"].startswith("10 per day")


def test_table_reader_uses_the_column_headings():
    from regs.auto import way1, num
    from regs.watch import load
    items = [i for i in load()["items"] if i["id"] in ("barracuda", "yellowtail")]
    r = way1(_TABLE, items)
    assert r["barracuda"] == {"bag": 8, "size": 28} and r["yellowtail"] == {"bag": 10, "size": 24}
    assert num("3¼") == 3.25 and num("10 1/2") == 10.5
