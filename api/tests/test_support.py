from features import ads, support


def test_feedback_cleaned():
    f = support.clean_feedback({"kind": "hack", "message": "  Fuel dock closed  ", "email": "not-an-email", "device": "ios 18"})
    assert f["kind"] == "other" and f["message"] == "Fuel dock closed" and f["email"] is None and f["device"] == "ios 18"


def test_feedback_empty_rejected():
    try:
        support.clean_feedback({"message": " "})
    except ValueError:
        return
    raise AssertionError("empty message accepted")


def test_crash_fingerprint_ignores_numbers_and_line_numbers():
    a = support.fingerprint("Cannot read index 12", "Error\n at foo (main.jsbundle:100:20)\n at bar (main.jsbundle:5:1)")
    b = support.fingerprint("Cannot read index 99", "Error\n at foo (main.jsbundle:340:2)\n at bar (main.jsbundle:9:9)")
    c = support.fingerprint("Something else", "Error\n at foo (main.jsbundle:100:20)")
    assert a == b and a != c


def test_errors_cleaned_and_capped():
    errs = support.clean_errors({"errors": [{"message": "x" * 900, "fatal": 1, "at": "2026-10-21T10:00:00Z"}] * 30 + ["junk"]})
    assert len(errs) == 20 and len(errs[0]["message"]) == 500 and errs[0]["fatal"] is True and errs[0]["happened_at"].year == 2026


def test_rate_limit():
    k = "test-key-rl"
    assert all(support.rate_ok(k, 3) for _ in range(3)) and not support.rate_ok(k, 3)


def _row(i, tags, action="directions", value="33.72,-118.27"):
    return {"id": i, "placement": "featured_listing", "context_tags": tags, "advertiser": f"Biz {i}",
            "creative": {"kind": "native", "headline": "Fuel", "action_type": action, "action_value": value}}


def test_featured_only_switched_on_kinds_with_position():
    rows = [_row(1, ["fuel"]), _row(2, ["bait"]), _row(3, ["fuel"], action="website", value="https://x.com"), _row(4, ["ramp"])]
    got = ads.featured_from(rows, ["fuel"])
    assert [g["id"] for g in got] == [1] and got[0]["kind"] == "fuel"
    assert {g["id"] for g in ads.featured_from(rows, ["fuel", "bait"])} == {1, 2}


def test_new_placements_known():
    assert "banner_weather" in ads.PLACEMENTS and "featured_listing" in ads.PLACEMENTS
