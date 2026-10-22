-- 012: prices for the new ad spaces, plus in-app feedback and crash reports (seen in Admin → Feedback & crashes).

-- ===================== new ad spaces (edit prices in Admin → Sponsors / Ad Studio) =====================
insert into ad_rates (placement, section, price_cents_week, max_slots, description) values
  ('banner_weather', '', 3000, 4, 'Banner in the middle of the Weather tab, after the hourly forecast'),
  ('featured_listing', '', 2500, 4, 'Gold "Featured" pin on the map for a fuel dock, bait or marina (shows with that layer)'),
  ('presented_by', 'Wind', 3500, 1, '"Wind presented by" — when the wind map is on — one sponsor per week'),
  ('presented_by', 'Radar', 3500, 1, '"Radar presented by" — on the radar time label — one sponsor per week'),
  ('presented_by', 'Map Layers', 3000, 1, '"Map presented by" — top of the Map options sheet — one sponsor per week'),
  ('presented_by', 'Harbors', 4000, 1, '"Presented by" on every harbor, fuel and bait info card — one sponsor per week')
on conflict (placement, section) do nothing;

-- ===================== feedback from Me → Send feedback =====================
create table if not exists app_feedback (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('bug', 'idea', 'data', 'other')),
  message text not null check (length(message) between 1 and 4000),
  email text check (email is null or length(email) <= 200),
  app_version text, device text, area text,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  admin_note text
);
create index if not exists app_feedback_created_idx on app_feedback (created_at desc);

-- ===================== crash reports (no personal data) =====================
create table if not exists app_errors (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  happened_at timestamptz,
  message text not null,
  stack text,
  fatal boolean not null default false,
  context text, app_version text, os text, runtime text,
  fingerprint text not null,            -- same crash = same fingerprint, so the console can group them
  status text not null default 'new' check (status in ('new', 'fixed', 'ignored'))
);
create index if not exists app_errors_fp_idx on app_errors (fingerprint, created_at desc);
create index if not exists app_errors_created_idx on app_errors (created_at desc);

-- The API writes these with its own database login; in the app's Supabase access only admins can read or update.
alter table app_feedback enable row level security;
alter table app_errors enable row level security;
drop policy if exists app_feedback_admin on app_feedback;
create policy app_feedback_admin on app_feedback for all using (is_admin()) with check (is_admin());
drop policy if exists app_errors_admin on app_errors;
create policy app_errors_admin on app_errors for all using (is_admin()) with check (is_admin());

-- Grouped crash list for the console: newest first, with how many times and on how many app versions.
create or replace function admin_error_groups(days int default 14)
returns table (fingerprint text, message text, context text, n bigint, fatal boolean, versions text[], first_seen timestamptz, last_seen timestamptz, status text, sample_stack text, ids bigint[])
language sql stable security definer set search_path = public as $$
  select e.fingerprint, max(e.message), max(e.context), count(*), bool_or(e.fatal), array_agg(distinct e.app_version),
         min(e.created_at), max(e.created_at),
         case when bool_and(e.status = 'fixed') then 'fixed' when bool_and(e.status = 'ignored') then 'ignored' else 'new' end,
         (array_agg(e.stack order by e.created_at desc))[1], array_agg(e.id)
  from app_errors e
  where is_admin() and e.created_at > now() - make_interval(days => days)
  group by e.fingerprint order by max(e.created_at) desc limit 200;
$$;

-- Old crash reports clean themselves up after 90 days (called by the API now and then).
create or replace function prune_app_errors() returns void language sql security definer set search_path = public as $$
  delete from app_errors where created_at < now() - interval '90 days';
$$;

-- ===================== emergency off-switches (Admin → Settings) =====================
-- A list of features to switch off on every phone without an app update, e.g. ["wind","radar"] or ["chart_helper"].
insert into app_config (key, value, description) values
  ('features_off', '[]'::jsonb, 'Emergency off-switches: features turned off on every phone (use the checkboxes in Settings)')
on conflict (key) do nothing;
