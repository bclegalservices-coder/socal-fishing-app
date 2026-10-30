-- 015 (Oct 29): spotter-plane history — the real recorded flight paths of planes that circled low over the water.
-- Run once: Supabase → SQL Editor → New query → paste all of this → Run.
-- Only the server writes here (it connects directly); phones read the history from the server (GET /air/history).
create table if not exists spotter_sessions (
  id text primary key,                         -- plane hex + start time
  hex text not null,
  data jsonb not null,                         -- plane details + points [[lon, lat, unix time, altitude ft], …]
  last_t timestamptz not null,
  center_lon double precision,
  center_lat double precision,
  updated_at timestamptz not null default now()
);
create index if not exists spotter_sessions_last_t on spotter_sessions (last_t desc);
alter table spotter_sessions enable row level security;    -- no public access (the server bypasses this)
drop policy if exists "admin reads spotter sessions" on spotter_sessions;
create policy "admin reads spotter sessions" on spotter_sessions for select using (is_admin());
