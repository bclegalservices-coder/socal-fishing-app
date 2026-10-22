-- 011: two new ad placements. Run this one BY ITSELF first (Postgres needs new list values saved before they're used),
-- then run 012.
alter type ad_placement add value if not exists 'banner_weather';
alter type ad_placement add value if not exists 'featured_listing';
