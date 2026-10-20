-- 003_catch_map_and_ads.sql — Catch Map, private log, environmental snapshots,
-- report verification, ad server and Pro-ready subscriptions.
-- Run ONCE in Supabase SQL Editor, after 001 and 002.
--
-- PRIVACY DESIGN: true catch coordinates live ONLY in catch_reports (owner-only).
-- The public map reads public_catches, which a trigger fills with the fuzzed point,
-- the area name, or nothing. There is no join path from public data to true coordinates.

-- ---------- species ----------
create table if not exists species (
  id serial primary key,
  code text unique not null,          -- short map label
  name text not null,
  grp text                            -- 'tuna', 'bass', 'bottom', ...
);
insert into species (code, name, grp) values
  ('BFT','Bluefin tuna','tuna'), ('YFT','Yellowfin tuna','tuna'), ('ALB','Albacore','tuna'),
  ('SKJ','Skipjack','tuna'), ('YT','Yellowtail','jacks'), ('DOR','Dorado','pelagic'),
  ('WSB','White seabass','croaker'), ('CAL','Calico bass','bass'), ('SAN','Sand bass','bass'),
  ('BAR','Barracuda','pelagic'), ('BON','Bonito','pelagic'), ('HAL','California halibut','flatfish'),
  ('RCK','Rockfish','bottom'), ('LNG','Lingcod','bottom'), ('SHP','Sheephead','bottom'),
  ('WAH','Wahoo','pelagic'), ('SWD','Swordfish','billfish'), ('MAR','Striped marlin','billfish'),
  ('THR','Thresher shark','shark'), ('MAK','Mako shark','shark'), ('LOB','Spiny lobster','other'),
  ('OTH','Other','other')
on conflict (code) do nothing;

-- ---------- environmental snapshot at the moment of a catch ----------
create table if not exists env_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  captured_at timestamptz not null default now(),
  sst_f real, sst_observed_at timestamptz, sst_source text, sst_interpolated boolean,
  sst_gradient_f_per_nm real,
  chl_mg_m3 real, chl_observed_at timestamptz, chl_source text, chl_interpolated boolean,
  tide_stage text, tide_height_ft real, tide_station text, tide_station_nm real,
  wind_kt real, wind_dir_deg real, gust_kt real, wind_source text, wind_is_forecast boolean,
  swell_ft real, swell_period_s real, swell_dir_deg real, swell_source text,
  weather text, air_temp_f real,
  moon_phase real,                    -- 0 = new, 0.5 = full
  depth_ft real, depth_source text,
  raw jsonb not null default '{}'::jsonb   -- full provider payloads with provenance
);

-- ---------- private catch reports (owner only) ----------
create type location_mode as enum ('exact','approximate','area','private');

create table if not exists catch_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  species_id int not null references species(id),
  caught_at timestamptz not null default now(),
  true_geom geography(point, 4326) not null,
  location_mode location_mode not null default 'private',
  anonymous boolean not null default false,
  area_name text,                     -- e.g. 'Catalina East End' (used by 'area' mode)
  spot_id uuid references fishing_spots(id),
  quantity int not null default 1 check (quantity between 1 and 500),
  weight_lb real, length_in real, kept boolean,
  technique text, bait text,
  fishing_depth_ft real, water_depth_ft real, meter_marks text,
  notes text,
  photo_paths text[] not null default '{}',
  snapshot_id uuid references env_snapshots(id),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','flagged','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists catch_reports_user_idx on catch_reports (user_id, caught_at desc);

-- ---------- public copy for the Catch Map (read-only to users) ----------
create table if not exists public_catches (
  id uuid primary key references catch_reports(id) on delete cascade,
  species_id int not null references species(id),
  caught_at timestamptz not null,
  public_geom geography(point, 4326),  -- exact or fuzzed; null for area-only
  area_name text,
  fuzz_radius_nm real,                 -- shown as a circle, never the true point
  quantity int, weight_lb real, technique text, bait text,
  author_id uuid,                      -- null when anonymous
  verified boolean not null default false,
  sst_f real, chl_mg_m3 real, tide_stage text, wind_kt real
);
create index if not exists public_catches_geom_idx on public_catches using gist (public_geom);
create index if not exists public_catches_time_idx on public_catches (caught_at desc);

-- Deterministic fuzz: same angler near the same place always gets the same offset,
-- so averaging many reports can't triangulate the true spot. Offset 0.5–1.5 NM.
create or replace function fuzz_point(uid uuid, g geography) returns geography
language plpgsql immutable as $$
declare
  h text := md5(uid::text || round(st_y(g::geometry)::numeric, 2)::text || round(st_x(g::geometry)::numeric, 2)::text);
  ang double precision := (('x' || substr(h, 1, 8))::bit(32)::bigint % 3600) / 10.0;
  dist_nm double precision := 0.5 + (('x' || substr(h, 9, 8))::bit(32)::bigint % 1000) / 1000.0;
begin
  return st_project(g, dist_nm * 1852, radians(ang));
end $$;

create or replace function sync_public_catch() returns trigger
language plpgsql security definer set search_path = public as $$
declare s env_snapshots;
begin
  if tg_op = 'DELETE' then
    delete from public_catches where id = old.id; return old;
  end if;
  if new.location_mode = 'private' or new.verification_status = 'removed' then
    delete from public_catches where id = new.id; return new;
  end if;
  select * into s from env_snapshots where id = new.snapshot_id;
  insert into public_catches (id, species_id, caught_at, public_geom, area_name, fuzz_radius_nm,
                              quantity, weight_lb, technique, bait, author_id, verified,
                              sst_f, chl_mg_m3, tide_stage, wind_kt)
  values (
    new.id, new.species_id, new.caught_at,
    case new.location_mode when 'exact' then new.true_geom
                           when 'approximate' then fuzz_point(new.user_id, new.true_geom)
                           else null end,
    new.area_name,
    case when new.location_mode = 'approximate' then 1.5 else null end,
    new.quantity, new.weight_lb, new.technique, new.bait,
    case when new.anonymous then null else new.user_id end,
    new.verification_status = 'verified',
    s.sst_f, s.chl_mg_m3, s.tide_stage, s.wind_kt
  )
  on conflict (id) do update set
    species_id = excluded.species_id, caught_at = excluded.caught_at, public_geom = excluded.public_geom,
    area_name = excluded.area_name, fuzz_radius_nm = excluded.fuzz_radius_nm, quantity = excluded.quantity,
    weight_lb = excluded.weight_lb, technique = excluded.technique, bait = excluded.bait,
    author_id = excluded.author_id, verified = excluded.verified, sst_f = excluded.sst_f,
    chl_mg_m3 = excluded.chl_mg_m3, tide_stage = excluded.tide_stage, wind_kt = excluded.wind_kt;
  return new;
end $$;
drop trigger if exists catch_reports_public on catch_reports;
create trigger catch_reports_public after insert or update or delete on catch_reports
  for each row execute function sync_public_catch();

-- ---------- verification and reputation ----------
alter table profiles add column if not exists verified_reporter boolean not null default false;

create table if not exists report_flags (
  id uuid primary key default gen_random_uuid(),
  catch_id uuid not null references catch_reports(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (reason in ('fake','wrong_location','offensive','spam','other')),
  details text,
  status text not null default 'open' check (status in ('open','upheld','dismissed')),
  created_at timestamptz not null default now(),
  unique (catch_id, reporter_id)
);

-- Scoring inputs are private: only the server (service role) reads or writes this table.
create table if not exists user_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  score real not null default 0,
  reports_total int not null default 0,
  reports_verified int not null default 0,
  reports_removed int not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------- ads and sponsorships ----------
create table if not exists advertisers (
  id serial primary key,
  name text not null,
  contact_email text,
  website text,
  created_at timestamptz not null default now()
);

create type ad_placement as enum ('banner_dashboard','banner_reports','banner_community','sponsor_intro','presented_by','catch_map_open');

create table if not exists ad_campaigns (
  id serial primary key,
  advertiser_id int not null references advertisers(id) on delete cascade,
  name text not null,
  placement ad_placement not null,
  presented_by_section text,          -- e.g. 'SST Map', 'Catalina Report'
  creative_url text not null,
  click_url text,
  headline text,
  context_tags text[] not null default '{}',   -- e.g. {tuna, offshore, catalina} — contextual only
  region text,                        -- e.g. 'socal'
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_per_user_per_day int not null default 3,
  active boolean not null default true
);

-- Events carry no user identity: a daily-rotating device hash is enough for frequency caps.
create table if not exists ad_events (
  id bigserial primary key,
  campaign_id int not null references ad_campaigns(id) on delete cascade,
  event text not null check (event in ('impression','click')),
  placement ad_placement not null,
  context text,
  device_day_hash text,
  at timestamptz not null default now()
);
create index if not exists ad_events_campaign_idx on ad_events (campaign_id, at);

-- security_invoker: stats follow table permissions, so only the server can read them.
create or replace view ad_campaign_stats with (security_invoker = true) as
  select c.id, c.name, a.name as advertiser, c.placement,
         count(*) filter (where e.event = 'impression') as impressions,
         count(*) filter (where e.event = 'click') as clicks,
         round(100.0 * count(*) filter (where e.event = 'click') /
               nullif(count(*) filter (where e.event = 'impression'), 0), 2) as ctr_pct
  from ad_campaigns c join advertisers a on a.id = c.advertiser_id
  left join ad_events e on e.campaign_id = c.id
  group by c.id, a.name;

-- ---------- Pro-ready subscriptions (not switched on yet) ----------
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','pro')),
  status text not null default 'inactive',
  provider text,                      -- 'apple', 'google'
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- row-level security ----------
alter table species enable row level security;
alter table env_snapshots enable row level security;
alter table catch_reports enable row level security;
alter table public_catches enable row level security;
alter table report_flags enable row level security;
alter table user_reputation enable row level security;   -- no policies = server only
alter table advertisers enable row level security;       -- no policies = server only
alter table ad_campaigns enable row level security;
alter table ad_events enable row level security;
alter table subscriptions enable row level security;

create policy "public read species" on species for select using (true);

create policy "own snapshots" on env_snapshots for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private log: owner only, for every operation.
create policy "own catches select" on catch_reports for select using (user_id = auth.uid());
create policy "own catches insert" on catch_reports for insert with check (user_id = auth.uid() and verification_status = 'unverified');
create policy "own catches update" on catch_reports for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own catches delete" on catch_reports for delete using (user_id = auth.uid());

-- Public map: anyone can read; nobody can write directly (only the trigger above).
create policy "public read catch map" on public_catches for select using (true);

create policy "flag a report" on report_flags for insert with check (reporter_id = auth.uid());
create policy "see own flags" on report_flags for select using (reporter_id = auth.uid());

create policy "read live campaigns" on ad_campaigns for select using (active and now() between starts_at and ends_at);
create policy "log ad events" on ad_events for insert with check (true);

create policy "own subscription" on subscriptions for select using (user_id = auth.uid());

-- Owners can't promote their own reports: block verification_status changes from the app.
create or replace function lock_verification() returns trigger
language plpgsql as $$
begin
  if new.verification_status is distinct from old.verification_status
     and coalesce(auth.role(), '') <> 'service_role' then
    new.verification_status := old.verification_status;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists catch_reports_lock on catch_reports;
create trigger catch_reports_lock before update on catch_reports
  for each row execute function lock_verification();
