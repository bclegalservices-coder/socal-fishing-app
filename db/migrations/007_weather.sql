-- 007: Weather page + "Can my boat handle it?"
-- * Weather becomes a sponsor slot ("Marine forecast presented by ___"): inventory counts weather views.
-- * Boat mix for the media kit: which boats our anglers run (from the anonymous 'boat_set' event —
--   type, length band and comfort only; no names, no locations).
-- Safe to run more than once.

create or replace function admin_inventory(days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since date := la_day(now()) - days;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  -- "Opportunities" = how often each sponsor slot was shown or could have been (screen views), last `days` days.
  return jsonb_build_object(
    'days', days,
    'app_opens', (select count(*) from app_events where day > since and name = 'app_open'),
    'intro_eligible_opens', (select count(*) from app_events where day > since and name = 'app_open' and coalesce((props->>'stopped')::boolean, false)),
    'today_views', (select count(*) from app_events where day > since and name = 'screen_view' and props->>'screen' = 'today'),
    'catch_map_views', (select count(*) from app_events where day > since and name = 'layer_on' and props->>'layer' = 'catches')
                       + (select count(*) from app_events where day > since and name = 'catch_map_view'),
    'sst_views', (select count(*) from app_events where day > since and name = 'layer_on' and props->>'layer' = 'sst'),
    'reports_views', (select count(*) from app_events where day > since and name = 'screen_view' and props->>'screen' = 'community_reports'),
    'forum_views', (select count(*) from app_events where day > since and name = 'screen_view' and props->>'screen' = 'community_forum'),
    'weather_views', (select count(*) from app_events where day > since and name = 'weather_view'),
    'served', (select coalesce(jsonb_agg(x), '[]') from (select placement::text k, count(*) filter (where event = 'impression') imp,
               count(*) filter (where event = 'click') clk from ad_events where la_day(at) > since group by 1) x)
  );
end $$;

create or replace function admin_boat_mix() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  -- Each install's LATEST boat choice, so changing your boat doesn't double count.
  return (with latest as (
      select distinct on (install_id) props->>'boat_type' boat_type, props->>'length_band' length_band
      from app_events where name = 'boat_set' order by install_id, at desc)
    select jsonb_build_object(
      'total', (select count(*) from latest),
      'types', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select boat_type k, count(*) n from latest group by 1) x),
      'lengths', (select coalesce(jsonb_agg(x order by x.k), '[]') from (select length_band k, count(*) n from latest group by 1) x)));
end $$;
