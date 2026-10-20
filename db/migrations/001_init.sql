-- 001_init.sql — core schema, Phase 1.
-- Run ONCE in Supabase: Dashboard > SQL Editor > New query > paste this whole file > Run.

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ---------- reference data (public read) ----------
create table if not exists regions (
  id serial primary key,
  slug text unique not null,
  name text not null,
  geom geography(multipolygon, 4326),
  timezone text not null default 'America/Los_Angeles'
);

create table if not exists data_sources (
  id serial primary key,
  name text unique not null,
  provider text not null,
  product text,
  dataset_id text,
  endpoint text,
  docs_url text,
  license_url text,
  attribution text,
  spatial_res text,
  temporal_res text,
  update_freq text,
  requires_key boolean not null default false,
  commercial_notes text,
  enabled boolean not null default true,
  last_verified_at timestamptz
);

create type spot_type as enum ('bank','knoll','reef','canyon','fathom_spot','island_feature','kelp','wreck','ridge','offshore_structure','other');

create table if not exists fishing_spots (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  alternate_names text[] not null default '{}',
  geom geography(geometry, 4326) not null,        -- point, line or polygon
  high_spots geography(multipoint, 4326),
  region text,
  subregion text,
  spot_type spot_type not null default 'other',
  depth_ft int,
  description text,
  source_id int references data_sources(id),
  source_name text not null,
  source_url text,
  source_license text not null,                   -- no license, no row
  source_last_verified date,
  coordinate_confidence text check (coordinate_confidence in ('high','medium','low')),
  status text not null default 'active' check (status in ('active','disabled','dev')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fishing_spots_geom_idx on fishing_spots using gist (geom);
create index if not exists fishing_spots_name_trgm on fishing_spots using gin (canonical_name gin_trgm_ops);

-- ---------- user data (private) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  home_region text,
  prefs jsonb not null default '{}'::jsonb,       -- units, coordinate format, theme
  created_at timestamptz not null default now()
);

create type waypoint_category as enum ('fishing_spot','catch','structure','lobster','bait','dive','wreck','anchorage','custom');

create table if not exists waypoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  geom geography(point, 4326) not null,
  category waypoint_category not null default 'fishing_spot',
  species text[] not null default '{}',
  notes text,
  last_visited_at timestamptz,
  deleted_at timestamptz,                          -- tombstone; recoverable 30 days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists waypoints_user_idx on waypoints (user_id);
create index if not exists waypoints_geom_idx on waypoints using gist (geom);

-- ---------- row-level security ----------
alter table regions enable row level security;
alter table data_sources enable row level security;
alter table fishing_spots enable row level security;
alter table profiles enable row level security;
alter table waypoints enable row level security;

create policy "public read regions" on regions for select using (true);
create policy "public read sources" on data_sources for select using (enabled);
create policy "public read spots" on fishing_spots for select using (status = 'active');

create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- "Your numbers are yours": only the owner can see or change a waypoint. No exceptions.
create policy "own waypoints select" on waypoints for select using (user_id = auth.uid());
create policy "own waypoints insert" on waypoints for insert with check (user_id = auth.uid());
create policy "own waypoints update" on waypoints for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own waypoints delete" on waypoints for delete using (user_id = auth.uid());
