-- Registry rows for Batch 1 sources. Each must be verified (spec §63) before enabling in production:
-- read current docs, confirm the endpoint, terms, commercial use, update frequency; then set last_verified_at.
insert into data_sources (name, provider, product, dataset_id, endpoint, docs_url, attribution, spatial_res, temporal_res, update_freq, commercial_notes, enabled)
values
 ('SST (MUR gap-filled)', 'NASA JPL / NOAA CoastWatch ERDDAP', 'Multi-scale Ultra-high Resolution SST', 'jplMURSST41',
  'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41', 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html',
  'NASA JPL MUR SST via NOAA CoastWatch', '~1 km', 'daily', 'daily, ~1 day latency', 'Interpolated product: label as satellite blend. Verify terms.', true),
 ('Chlorophyll-a (VIIRS)', 'NOAA CoastWatch ERDDAP', 'VIIRS chlorophyll-a daily', 'nesdisVHNnoaa20chlaDaily',
  'https://coastwatch.pfeg.noaa.gov/erddap', 'https://coastwatch.noaa.gov/', 'NOAA CoastWatch', '750 m', 'daily', 'daily',
  'VERIFY dataset ID with `python -m ocean.jobs discover`.', true),
 ('Bathymetry baseline (ETOPO)', 'NOAA NCEI via CoastWatch ERDDAP', 'ETOPO global relief', 'etopo180',
  'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180', 'https://www.ncei.noaa.gov/products/etopo-global-relief-model',
  'NOAA NCEI', '~1.8 km', 'static', 'static', 'Replace with Southern California Coastal Relief Model for detail.', true),
 ('Tide predictions', 'NOAA CO-OPS', 'Data API + Metadata API', null,
  'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter', 'https://tidesandcurrents.noaa.gov/web_services_info.html',
  'NOAA CO-OPS', 'station', '6-minute', 'predictions; observations every 6 min', 'Public domain.', true),
 ('Marine weather', 'National Weather Service', 'api.weather.gov gridpoints + alerts', null,
  'https://api.weather.gov', 'https://www.weather.gov/documentation/services-web-api', 'National Weather Service', '2.5 km', 'hourly', 'several times daily', 'Public domain; User-Agent required.', true),
 ('Buoy observations', 'NOAA NDBC', 'realtime2 standard meteorological', null,
  'https://www.ndbc.noaa.gov/data/realtime2/', 'https://www.ndbc.noaa.gov/', 'NOAA NDBC', 'station', '10-60 min', 'hourly', 'Public domain.', true),
 ('Radar (NEXRAD composite tiles)', 'Iowa Environmental Mesonet', 'nexrad-n0q tiles', null,
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/', 'https://mesonet.agron.iastate.edu/ogc/', 'NOAA NEXRAD via Iowa Environmental Mesonet', '1 km', '5 min', '5 min',
  'VERIFY commercial-use terms; fall back to NOAA nowCOAST.', false)
on conflict (name) do nothing;
