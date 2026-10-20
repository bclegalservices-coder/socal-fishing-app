-- 006_analytics_admin.sql — first-party app analytics, daily metrics, sponsor reporting, user admin,
-- push broadcasts, app settings and store stats. Run ONCE after 001–005.
--
-- PRIVACY: an anonymous random install ID (made on the phone, not tied to the device or a person), event names,
-- small properties, platform/version, and a COARSE area name ("Orange County", "Offshore") — never coordinates.
-- People can switch it off in the app. Raw events are deleted after 400 days.

-- ===================== raw analytics (server-only tables) =====================
create table if not exists app_installs (
  install_id uuid primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  platform text, app_version text, os_version text, device_class text, area text,
  user_id uuid references auth.users(id) on delete set null
);
create index if not exists app_installs_first_idx on app_installs (first_seen_at);

create table if not exists app_daily_active (
  day date not null,
  install_id uuid not null references app_installs(install_id) on delete cascade,
  signed_in boolean not null default false,
  primary key (day, install_id)
);
create index if not exists app_daily_active_install_idx on app_daily_active (install_id, day);

create table if not exists app_events (
  id bigserial primary key,
  install_id uuid not null,
  user_id uuid,
  session_id text,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  platform text, app_version text, area text,
  at timestamptz not null,                 -- device time (sanity-checked by the API)
  day date not null,                       -- Pacific-time day, for daily metrics
  received_at timestamptz not null default now()
);
create index if not exists app_events_day_name_idx on app_events (day, name);
create index if not exists app_events_install_idx on app_events (install_id, at);

alter table ad_events add column if not exists area text;

alter table app_installs enable row level security;      -- no policies: only the server writes/reads
alter table app_daily_active enable row level security;
alter table app_events enable row level security;

-- ===================== store numbers (typed in from App Store Connect / Play Console) =====================
create table if not exists store_stats (
  day date not null,
  platform text not null check (platform in ('ios', 'android')),
  metric text not null check (metric in ('downloads', 'updates', 'uninstalls', 'rating_avg', 'ratings_count', 'store_page_views')),
  value numeric not null,
  primary key (day, platform, metric)
);
alter table store_stats enable row level security;
create policy "admin store stats" on store_stats for all using (is_admin()) with check (is_admin());

-- ===================== app settings (read by every phone) =====================
create table if not exists app_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);
insert into app_config (key, value, description) values
  ('ads_enabled', 'true', 'Show sponsor placements at all'),
  ('intro_enabled', 'true', 'Allow the 5-second sponsor intro at app open (still only when stopped)'),
  ('maintenance_message', 'null', 'Banner shown to everyone, e.g. "Satellite data delayed today". null = none'),
  ('min_app_version', '"0.0.0"', 'Older versions are asked to update'),
  ('analytics_enabled', 'true', 'Collect anonymous usage stats (people can still opt out individually)')
on conflict (key) do nothing;
alter table app_config enable row level security;
create policy "everyone reads config" on app_config for select using (true);
create policy "admin writes config" on app_config for all using (is_admin()) with check (is_admin());

-- ===================== push broadcasts =====================
create table if not exists broadcasts (
  id serial primary key,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 180),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  sent_at timestamptz,
  sent_count int
);
alter table broadcasts enable row level security;
create policy "admin broadcasts" on broadcasts for all using (is_admin()) with check (is_admin());
create or replace function limit_broadcasts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from broadcasts where status <> 'cancelled' and created_at > now() - interval '24 hours') then
    raise exception 'Only one broadcast per 24 hours, so people keep notifications on.';
  end if;
  return new;
end $$;
drop trigger if exists broadcasts_limit on broadcasts;
create trigger broadcasts_limit before insert on broadcasts for each row execute function limit_broadcasts();

-- ===================== daily rollup =====================
create table if not exists metrics_daily (
  day date primary key,
  data jsonb not null,
  computed_at timestamptz not null default now()
);
alter table metrics_daily enable row level security;
create policy "admin reads metrics" on metrics_daily for select using (is_admin());

create or replace function la_day(t timestamptz) returns date language sql immutable as $$ select (t at time zone 'America/Los_Angeles')::date $$;

create or replace function refresh_metrics(d date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  if not is_admin() and coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Admins only';
  end if;
  select jsonb_build_object(
    'dau', (select count(*) from app_daily_active where day = d),
    'dau_signed_in', (select count(*) from app_daily_active where day = d and signed_in),
    'wau', (select count(distinct install_id) from app_daily_active where day between d - 6 and d),
    'mau', (select count(distinct install_id) from app_daily_active where day between d - 29 and d),
    'new_installs', (select count(*) from app_installs where la_day(first_seen_at) = d),
    'total_installs', (select count(*) from app_installs where la_day(first_seen_at) <= d),
    'sessions', (select count(*) from app_events where day = d and name = 'app_open'),
    'avg_session_min', (select round(avg(least((props->>'duration_s')::numeric, 14400)) / 60, 1) from app_events
                        where day = d and name = 'session_end' and (props->>'duration_s') ~ '^[0-9.]+$'),
    'screen_views', (select count(*) from app_events where day = d and name = 'screen_view'),
    'signups', (select count(*) from auth.users where la_day(created_at) = d),
    'catches', (select count(*) from catch_reports where la_day(created_at) = d),
    'public_reports', (select count(*) from catch_reports where la_day(created_at) = d and location_mode <> 'private'),
    'fish', (select coalesce(sum(quantity), 0) from catch_reports where la_day(created_at) = d),
    'posts', (select count(*) from posts where la_day(created_at) = d),
    'comments', (select count(*) from comments where la_day(created_at) = d),
    'groups_created', (select count(*) from fishing_groups where la_day(created_at) = d),
    'alerts_created', (select count(*) from alert_subscriptions where la_day(created_at) = d),
    'ad_impressions', (select count(*) from ad_events where la_day(at) = d and event = 'impression'),
    'ad_clicks', (select count(*) from ad_events where la_day(at) = d and event = 'click'),
    'platforms', (select coalesce(jsonb_object_agg(coalesce(platform, 'unknown'), n), '{}') from
                   (select i.platform, count(*) n from app_daily_active a join app_installs i using (install_id) where a.day = d group by 1) x),
    'areas', (select coalesce(jsonb_object_agg(coalesce(area, 'Unknown'), n), '{}') from
               (select i.area, count(*) n from app_daily_active a join app_installs i using (install_id) where a.day = d group by 1) x)
  ) into j;
  insert into metrics_daily (day, data, computed_at) values (d, j, now())
  on conflict (day) do update set data = excluded.data, computed_at = now();
  return j;
end $$;

-- Recompute a range (admin "Recompute" button; also used by the nightly job)
create or replace function refresh_metrics_range(from_day date, to_day date) returns int
language plpgsql security definer set search_path = public as $$
declare d date := from_day; n int := 0;
begin
  if not is_admin() and coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then raise exception 'Admins only'; end if;
  while d <= to_day loop perform refresh_metrics(d); d := d + 1; n := n + 1; end loop;
  return n;
end $$;

-- ===================== live numbers & breakdowns for the console =====================
create or replace function admin_live() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := la_day(now());
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'today', today,
    'dau_today', (select count(*) from app_daily_active where day = today),
    'active_last_hour', (select count(distinct install_id) from app_events where at > now() - interval '1 hour'),
    'sessions_today', (select count(*) from app_events where day = today and name = 'app_open'),
    'new_installs_today', (select count(*) from app_installs where la_day(first_seen_at) = today),
    'total_installs', (select count(*) from app_installs),
    'total_accounts', (select count(*) from auth.users),
    'wau', (select count(distinct install_id) from app_daily_active where day > today - 7),
    'mau', (select count(distinct install_id) from app_daily_active where day > today - 30),
    'catches_today', (select count(*) from catch_reports where la_day(created_at) = today),
    'catches_total', (select count(*) from catch_reports),
    'public_reports_total', (select count(*) from public_catches),
    'verified_reporters', (select count(*) from profiles where verified_reporter),
    'groups', (select count(*) from fishing_groups),
    'sharing_now', (select count(distinct user_id) from group_members where sharing_until > now() and not hidden),
    'alert_subscribers', (select count(distinct user_id) from alert_subscriptions where active),
    'push_devices', (select count(*) from push_tokens),
    'forum_posts_total', (select count(*) from posts where moderation_status = 'visible'),
    'moderation_open', (select count(*) from moderation_reports where status = 'open') + (select count(*) from report_flags where status = 'open'),
    'store_downloads_total', (select coalesce(sum(value), 0) from store_stats where metric = 'downloads'),
    'ad_impressions_30d', (select count(*) from ad_events where at > now() - interval '30 days' and event = 'impression'),
    'ad_clicks_30d', (select count(*) from ad_events where at > now() - interval '30 days' and event = 'click')
  );
end $$;

create or replace function admin_breakdowns(days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since date := la_day(now()) - days;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'platforms', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(i.platform, 'unknown') k, count(distinct a.install_id) n
                    from app_daily_active a join app_installs i using (install_id) where a.day > since group by 1 order by 2 desc) x),
    'versions', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(i.app_version, '?') k, count(distinct a.install_id) n
                    from app_daily_active a join app_installs i using (install_id) where a.day > since group by 1 order by 2 desc limit 10) x),
    'areas', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(i.area, 'Unknown') k, count(distinct a.install_id) n
                    from app_daily_active a join app_installs i using (install_id) where a.day > since group by 1 order by 2 desc) x),
    'devices', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(i.device_class, 'unknown') k, count(distinct a.install_id) n
                    from app_daily_active a join app_installs i using (install_id) where a.day > since group by 1 order by 2 desc) x),
    'signed_in_share', (select round(100.0 * count(*) filter (where signed_in) / nullif(count(*), 0), 1) from app_daily_active where day > since),
    'hours', (select coalesce(jsonb_agg(x order by x.k), '[]') from (select extract(hour from at at time zone 'America/Los_Angeles')::int k, count(*) n
                    from app_events where day > since and name = 'app_open' group by 1) x),
    'weekdays', (select coalesce(jsonb_agg(x order by x.k), '[]') from (select extract(isodow from day)::int k, count(*) n
                    from app_daily_active where day > since group by 1) x),
    'screens', (select coalesce(jsonb_agg(x), '[]') from (select props->>'screen' k, count(*) n, count(distinct install_id) u
                    from app_events where day > since and name = 'screen_view' group by 1 order by 2 desc) x),
    'features', (select coalesce(jsonb_agg(x), '[]') from (select name k, count(*) n, count(distinct install_id) u
                    from app_events where day > since and name not in ('app_open', 'session_end', 'screen_view') group by 1 order by 3 desc limit 40) x),
    'layers', (select coalesce(jsonb_agg(x), '[]') from (select props->>'layer' k, count(*) n, count(distinct install_id) u
                    from app_events where day > since and name = 'layer_on' group by 1 order by 3 desc) x),
    'species_interest', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(props->>'species', '?') k, count(*) n
                    from app_events where day > since and name in ('catch_logged', 'catch_filter', 'alert_created') and props ? 'species' group by 1 order by 2 desc limit 12) x),
    'species_caught', (select coalesce(jsonb_agg(x), '[]') from (select s.code k, count(*) n, sum(c.quantity) fish
                    from catch_reports c join species s on s.id = c.species_id where la_day(c.created_at) > since group by 1 order by 3 desc limit 12) x)
  );
end $$;

-- Retention: of the installs that first opened in a given week, what % came back on day 1, 7 and 30.
create or replace function admin_retention(weeks int default 12) returns table (cohort_week date, installs bigint, d1 numeric, d7 numeric, d30 numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
  with c as (select install_id, la_day(first_seen_at) f, date_trunc('week', la_day(first_seen_at))::date w from app_installs
             where first_seen_at > now() - make_interval(weeks => weeks))
  select c.w, count(*),
    round(100.0 * count(*) filter (where exists (select 1 from app_daily_active a where a.install_id = c.install_id and a.day = c.f + 1)) / count(*), 1),
    round(100.0 * count(*) filter (where exists (select 1 from app_daily_active a where a.install_id = c.install_id and a.day between c.f + 7 and c.f + 13)) / count(*), 1),
    round(100.0 * count(*) filter (where exists (select 1 from app_daily_active a where a.install_id = c.install_id and a.day between c.f + 30 and c.f + 36)) / count(*), 1)
  from c group by c.w order by c.w desc;
end $$;

-- Sponsor numbers: per campaign per day, and per placement / area, plus inventory you can sell.
create or replace function admin_campaign_report(campaign int, days int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'campaign', (select to_jsonb(c) || jsonb_build_object('advertiser', a.name) from ad_campaigns c join advertisers a on a.id = c.advertiser_id where c.id = campaign),
    'daily', (select coalesce(jsonb_agg(x order by x.d), '[]') from (select la_day(at) d, count(*) filter (where event = 'impression') imp,
               count(*) filter (where event = 'click') clk, count(distinct device_day_hash) filter (where event = 'impression') reach
               from ad_events where campaign_id = campaign and at > now() - make_interval(days => days) group by 1) x),
    'areas', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(area, 'Unknown') k, count(*) n from ad_events
               where campaign_id = campaign and event = 'impression' group by 1 order by 2 desc) x),
    'contexts', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(nullif(context, ''), placement::text) k, count(*) n from ad_events
               where campaign_id = campaign and event = 'impression' group by 1 order by 2 desc) x),
    'totals', (select jsonb_build_object('impressions', count(*) filter (where event = 'impression'), 'clicks', count(*) filter (where event = 'click'),
               'daily_reach_sum', (select count(*) from (select distinct la_day(at), device_day_hash from ad_events where campaign_id = campaign and event = 'impression') r))
               from ad_events where campaign_id = campaign)
  );
end $$;

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
    'served', (select coalesce(jsonb_agg(x), '[]') from (select placement::text k, count(*) filter (where event = 'impression') imp,
               count(*) filter (where event = 'click') clk from ad_events where la_day(at) > since group by 1) x)
  );
end $$;

-- ===================== user admin =====================
create or replace function admin_users(q text default null, lim int default 100)
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, display_name text, is_admin boolean,
               verified_reporter boolean, suspended_until timestamptz, catches bigint, posts bigint, reports_flagged bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at, p.display_name, coalesce(p.is_admin, false), coalesce(p.verified_reporter, false), p.suspended_until,
    (select count(*) from catch_reports c where c.user_id = u.id), (select count(*) from posts x where x.author_id = u.id),
    (select count(*) from moderation_reports m where m.target_id = u.id or m.target_id in (select x.id from posts x where x.author_id = u.id))
  from auth.users u left join profiles p on p.id = u.id
  where q is null or u.email ilike '%' || q || '%' or p.display_name ilike '%' || q || '%'
  order by u.created_at desc limit least(lim, 500);
end $$;

create or replace function admin_set_user(target uuid, make_admin boolean default null, verified boolean default null, suspend_until timestamptz default null, unsuspend boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if target = auth.uid() and make_admin = false then raise exception 'You cannot remove your own admin access'; end if;
  insert into profiles (id) values (target) on conflict do nothing;
  update profiles set
    is_admin = coalesce(make_admin, is_admin),
    verified_reporter = coalesce(verified, verified_reporter),
    suspended_until = case when unsuspend then null else coalesce(suspend_until, suspended_until) end
  where id = target;
  insert into audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'user:update', 'user', target, jsonb_build_object('admin', make_admin, 'verified', verified, 'suspend_until', suspend_until, 'unsuspend', unsuspend));
end $$;

-- Delete raw events older than 400 days (daily metrics are kept).
create or replace function purge_old_events() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from app_events where at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- Nightly rollup with pg_cron (enable it first: Supabase → Database → Extensions → pg_cron).
-- select cron.schedule('metrics-nightly', '30 9 * * *', $$select refresh_metrics_range(la_day(now()) - 2, la_day(now()) - 1); select purge_old_events();$$);
