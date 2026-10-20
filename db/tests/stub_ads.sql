-- Pieces of 001/003/004/006 the ad platform needs (simplified for plain Postgres).
alter table profiles add column if not exists is_admin boolean not null default false;
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false); $$;
create table advertisers (id serial primary key, name text not null, contact_email text, website text, created_at timestamptz not null default now());
create type ad_placement as enum ('banner_dashboard','banner_reports','banner_community','sponsor_intro','presented_by','catch_map_open');
create table ad_campaigns (id serial primary key, advertiser_id int not null references advertisers(id) on delete cascade, name text not null,
  placement ad_placement not null, presented_by_section text, creative_url text not null, click_url text, headline text,
  context_tags text[] not null default '{}', region text, starts_at timestamptz not null, ends_at timestamptz not null,
  max_per_user_per_day int not null default 3, active boolean not null default true);
create table ad_events (id bigserial primary key, campaign_id int not null references ad_campaigns(id) on delete cascade,
  event text not null check (event in ('impression','click')), placement ad_placement not null, context text, device_day_hash text,
  at timestamptz not null default now(), area text);
create table app_events (id bigserial primary key, install_id uuid, name text not null, props jsonb not null default '{}', area text, at timestamptz, day date);
create table app_config (key text primary key, value jsonb not null, description text, updated_at timestamptz not null default now());
alter table advertisers enable row level security; alter table ad_campaigns enable row level security; alter table ad_events enable row level security;
create policy "admin advertisers" on advertisers for all using (is_admin()) with check (is_admin());
create policy "admin campaigns" on ad_campaigns for all using (is_admin()) with check (is_admin());
create policy "admin reads ad events" on ad_events for select using (is_admin());
