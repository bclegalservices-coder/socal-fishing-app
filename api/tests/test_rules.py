from rules.layers import classify_mpa, normalize, RULE_LAYERS


def test_mpa_classification():
    assert classify_mpa("Abalone Cove SMCA", "SMCA")["take"] == "limited"
    assert classify_mpa("Point Vicente SMCA (No-Take)", None)["take"] == "no_take"
    assert classify_mpa("Farnsworth Onshore SMCA", "SMCA")["take"] == "limited"
    assert classify_mpa("Casino Point SMCA (No-Take)", "SMCA (No-Take)")["take"] == "no_take"
    assert classify_mpa("Swami's SMCA", "SMCA")["take"] == "limited"
    assert classify_mpa("Matlahuayl SMR", "SMR")["take"] == "no_take"
    assert classify_mpa("Something", None)["take"] == "unknown"


def test_normalize_mpa_and_wreck():
    mpa = next(l for l in RULE_LAYERS if l["key"] == "mpa")
    f = normalize(mpa, {"type": "Feature", "properties": {"NAME": "Test SMR", "Type": "SMR"},
                        "geometry": {"type": "Polygon", "coordinates": [[[-118.123456789, 33.1], [-118.1, 33.2], [-118.0, 33.1], [-118.123456789, 33.1]]]}})
    p = f["properties"]
    assert p["take"] == "no_take" and p["name"] == "Test SMR" and p["regs"].startswith("https://")
    assert f["geometry"]["coordinates"][0][0][0] == -118.12346
    wr = next(l for l in RULE_LAYERS if l["key"] == "wrecks")
    w = normalize(wr, {"properties": {"OBJNAM": "SS Example", "VALSOU": "10", "_layer_name": "Wreck_point"}, "geometry": {"type": "Point", "coordinates": [-118.2, 33.5]}})
    assert w["properties"]["depth_over_ft"] == 33 and w["properties"]["name"] == "SS Example"
    assert normalize(wr, {"properties": {}, "geometry": None}) is None
