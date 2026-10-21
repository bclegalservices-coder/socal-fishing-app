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


def test_dbw_parsing_and_coast_filter():
    from harbors.dbw import is_coastal, kinds_for, merge, parse_county, parse_facility
    county = ('<table><tr><th>Name</th></tr>'
              '<tr><td><a href="https://dbw.parks.ca.gov/BoatingFacilities/f/982">Jankovich Company</a></td><td>Fuel Dock</td><td>Public</td></tr>'
              '<tr><td><a href="/BoatingFacilities/f/1051">Dana Point Ramp</a></td><td>Launch</td><td></td></tr></table>')
    rows = parse_county(county)
    assert [r["id"] for r in rows] == ["982", "1051"] and rows[0]["type"] == "Fuel Dock"
    fac = parse_facility('<p>Facility Address: Berth 74 Main Channel, San Pedro, CA 90731</p><p>Phone (800) 836-5355</p>'
                         '<h3>Services</h3><ul><li>Fuel Sales</li></ul><h3>Environmental Services</h3><ul><li>Pumpout</li></ul>'
                         '<iframe src="https://maps.google.com/maps?q=33.73025339,-118.27501577&z=15&output=embed"></iframe>')
    assert abs(fac["lat"] - 33.73025339) < 1e-6 and fac["phone"] == "(800) 836-5355"
    assert kinds_for(rows[0], fac) == ["fuel", "pumpout"]
    assert is_coastal(-118.275, 33.730)          # LA Harbor
    assert is_coastal(-117.6905, 33.4594)        # Dana Point
    assert is_coastal(-118.326, 33.345)          # Avalon
    assert not is_coastal(-117.35, 33.66)        # Lake Elsinore
    assert not is_coastal(-118.60, 34.52)        # Castaic Lake
    osm = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-118.2751, 33.7303]}, "properties": {"kind": "fuel"}},
           {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-118.20, 33.70]}, "properties": {"kind": "fuel"}}]
    dbw = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-118.27501577, 33.73025339]}, "properties": {"kind": "fuel"}}]
    assert len(merge(osm, dbw)) == 2             # the duplicate OSM point near Jankovich is dropped


def test_extras_only_with_positions():
    from harbors.job import extras
    assert all(f["geometry"]["coordinates"][0] is not None for f in extras())
