from harbors.job import classify, query, summary, to_features


def test_classify_harbor_kinds():
    assert classify({"waterway": "fuel"}) == "fuel"
    assert classify({"amenity": "fuel", "boat": "yes"}) == "fuel"
    assert classify({"amenity": "fuel"}) is None                       # a gas station on land
    assert classify({"amenity": "sanitary_dump_station", "boat": "yes"}) == "pumpout"
    assert classify({"name": "Dock 5 Pump-Out"}) == "pumpout"
    assert classify({"name": "Everyone's Bait Barge"}) == "bait"
    assert classify({"leisure": "slipway"}) == "ramp"
    assert classify({"leisure": "marina", "name": "Cabrillo Marina"}) == "marina"
    assert classify({"man_made": "pier", "floating": "yes"}) == "dock"


def test_features_shapes_and_card_line():
    els = [
        {"type": "node", "id": 1, "lat": 33.7, "lon": -118.27, "tags": {"waterway": "fuel", "name": "Fuel Dock", "fuel:diesel": "yes", "vhf": "16"}},
        {"type": "way", "id": 2, "tags": {"man_made": "pier", "floating": "yes", "name": "Dock C"},
         "geometry": [{"lat": 33.70, "lon": -118.28}, {"lat": 33.701, "lon": -118.28}]},
        {"type": "way", "id": 3, "tags": {"leisure": "marina", "name": "Test Marina", "capacity": "400"},
         "geometry": [{"lat": 33.7, "lon": -118.3}, {"lat": 33.71, "lon": -118.3}, {"lat": 33.71, "lon": -118.29}, {"lat": 33.7, "lon": -118.3}]},
        {"type": "node", "id": 4, "lat": 33.7, "lon": -118.2, "tags": {"amenity": "cafe"}},
    ]
    f = to_features(els)
    kinds = [(x["properties"]["kind"], x["geometry"]["type"]) for x in f]
    assert ("fuel", "Point") in kinds and ("dock", "LineString") in kinds
    assert ("marina", "Polygon") in kinds and ("marina", "Point") in kinds    # outline + tappable dot
    assert not any(k == "cafe" for k, _ in kinds)
    fuel = next(x for x in f if x["properties"]["kind"] == "fuel")
    assert "diesel" in fuel["properties"]["summary"] and "VHF 16" in fuel["properties"]["summary"]
    assert "400 slips" in summary("marina", {"capacity": "400"})
    assert "out tags geom" in query()
