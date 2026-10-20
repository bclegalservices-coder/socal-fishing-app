-- Data-source registry seed. Verify each row against current official docs before enabling
-- (master spec §63), then set last_verified_at.

insert into data_sources (name, provider, product, endpoint, docs_url, attribution, update_freq, commercial_notes, enabled)
values
  ('NOAA Chart Display Service', 'NOAA Office of Coast Survey', 'ENC with paper-chart symbology',
   'https://gis.charttools.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer',
   'https://nauticalcharts.noaa.gov/data/gis-data-and-services.html',
   'NOAA Office of Coast Survey. Not for navigation.', 'Weekly (Fridays)',
   'U.S. government data, public domain. Do not imply NOAA endorsement.', true)
on conflict (name) do nothing;

-- ONE clearly-labeled dev row so search can be tested end to end. Delete before launch.
insert into fishing_spots (canonical_name, alternate_names, geom, region, spot_type, source_name, source_license, status, description)
values ('DEV TEST SPOT - not a real fishing spot', array['dev','test'],
        st_makepoint(-117.95, 33.50)::geography, 'socal', 'other',
        'Developer placeholder', 'n/a (dev only)', 'active',
        'Exists only to test search. Delete before launch.');
