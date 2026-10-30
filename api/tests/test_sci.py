from datetime import datetime, timedelta, timezone

from sci.alerts import decide, status

NOW = datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc)     # 11 AM Pacific
H = timedelta(hours=1)
iso = lambda d: d.isoformat()
SUB = {"id": "s1", "user_id": "u1", "kind": "sci", "active": True, "state": {}}


def test_status_starts_and_ends_on_its_own():
    cfg = {"sections": {"A": {"closed": True, "from": iso(NOW + 2 * H), "until": iso(NOW + 6 * H)}, "B": {"closed": True}}}
    assert status("A", cfg, NOW) == "scheduled"
    assert status("A", cfg, NOW + 3 * H) == "closed"
    assert status("A", cfg, NOW + 7 * H) == "open"
    assert status("B", cfg, NOW) == "closed"
    assert status("C", cfg, NOW) == "open"


def test_closed_then_reopened_messages():
    cfg = {"sections": {"A": {"closed": True, "until": iso(NOW + 5 * H)}, "B": {"closed": True, "until": iso(NOW + 5 * H)}}, "note": "SHOBA ops"}
    (s, text, st), = decide([SUB], cfg, NOW)
    assert "Sections A and B now CLOSED" in text and "until 4:00 PM" in text and "619-545-4742" in text and "SHOBA ops" in text
    assert st["closed"] == ["A", "B"]
    assert decide([{**SUB, "state": st}], cfg, NOW + H) == []                                 # nothing changed: quiet
    (s, text, st2), = decide([{**SUB, "state": st}], {"sections": {"B": {"closed": True}}}, NOW + H)
    assert "Section A reopened; Section B still closed." in text
    (s, text, st3), = decide([{**SUB, "state": st2}], {}, NOW + 2 * H)
    assert "All sections open again" in text


def test_heads_up_once_before_a_scheduled_closure():
    cfg = {"sections": {"D": {"closed": True, "from": iso(NOW + 10 * H), "until": iso(NOW + 20 * H)}}}
    (s, text, st), = decide([SUB], cfg, NOW)
    assert text.startswith("San Clemente Island: Heads up: Section D close")
    assert decide([{**SUB, "state": st}], cfg, NOW + H) == []                                 # only warned once
    (s, text, st2), = decide([{**SUB, "state": st}], cfg, NOW + 11 * H)                       # then it actually closes
    assert "Section D now CLOSED" in text
    far = {"sections": {"D": {"closed": True, "from": iso(NOW + 40 * H)}}}
    assert decide([SUB], far, NOW) == [(SUB, "", {"closed": [], "warned": [], "ready": True})]  # too far ahead to warn yet


def test_ignores_other_kinds_and_paused_alerts():
    cfg = {"sections": {"A": {"closed": True}}}
    assert decide([{**SUB, "kind": "spotter"}, {**SUB, "active": False}], cfg, NOW) == []
