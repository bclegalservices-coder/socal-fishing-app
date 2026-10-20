-- 005_alerts_admin.sql — push alerts, announcements, and admin-console permissions. Run ONCE after 001–004.

-- ===================== push alerts =====================
create table if not exists push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);

create table if not exists alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('species', 'activity', 'sst', 'weather')),
  -- params: {species:[codes], center:[lon,lat], radius_nm, label, verified_only, min_f, max_f}
  params jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,       -- server bookkeeping (e.g. warnings already sent)
  active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists alert_subscriptions_user_idx on alert_subscriptions (user_id);

create table if not exists notification_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references alert_subscriptions(id) on delete set null,
  body text not null,
  sent_at timestamptz not null default now()
);
create index if not exists notification_log_user_idx on notification_log (user_id, sent_at desc);

-- Keep alerts sane: at most 10 subscriptions per person.
create or replace function limit_subscriptions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from alert_subscriptions where user_id = auth.uid()) >= 10 then
    raise exception 'You can have up to 10 alerts.';
  end if;
  new.state := '{}'::jsonb;
  new.last_sent_at := null;
  return new;
end $$;
drop trigger if exists alert_subscriptions_limit on alert_subscriptions;
create trigger alert_subscriptions_limit before insert on alert_subscriptions for each row execute function limit_subscriptions();

alter table push_tokens enable row level security;
alter table alert_subscriptions enable row level security;
alter table notification_log enable row level security;
create policy "own tokens" on push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own alerts" on alert_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications" on notification_log for select using (user_id = auth.uid());

-- ===================== announcements (shown on Today) =====================
create table if not exists announcements (
  id serial primary key,
  title text not null,
  body text,
  link text,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
alter table announcements enable row level security;
create policy "read live announcements" on announcements for select using (active and now() between starts_at and coalesce(ends_at, 'infinity') or is_admin());
create policy "admin announcements" on announcements for all using (is_admin()) with check (is_admin());

-- ===================== admin console permissions =====================
-- Fishing spots: admins add, correct, rename, disable (spec §58). Every change is audited.
create policy "admin reads all spots" on fishing_spots for select using (is_admin());
create policy "admin writes spots" on fishing_spots for all using (is_admin()) with check (is_admin());
create or replace function audit_spots() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'spot:' || lower(tg_op), 'spot', coalesce(new.id, old.id),
          jsonb_build_object('name', coalesce(new.canonical_name, old.canonical_name), 'status', coalesce(new.status, old.status)));
  return coalesce(new, old);
end $$;
drop trigger if exists fishing_spots_audit on fishing_spots;
create trigger fishing_spots_audit after insert or update or delete on fishing_spots for each row execute function audit_spots();

-- Data-source registry: admins edit, verify, enable/disable.
create policy "admin reads sources" on data_sources for select using (is_admin());
create policy "admin writes sources" on data_sources for all using (is_admin()) with check (is_admin());

-- Ads: admins manage advertisers and campaigns and read results.
create policy "admin advertisers" on advertisers for all using (is_admin()) with check (is_admin());
create policy "admin campaigns" on ad_campaigns for all using (is_admin()) with check (is_admin());
create policy "admin reads ad events" on ad_events for select using (is_admin());

-- Moderation queue in one place for the console.
create or replace view moderation_queue with (security_invoker = true) as
  select 'report' as source, r.id, r.target_type, r.target_id, r.reason, r.details, r.created_at,
         (select count(*) from moderation_reports r2 where r2.target_id = r.target_id and r2.status = 'open') as open_reports
  from moderation_reports r where r.status = 'open'
  union all
  select 'flag', f.id, 'catch', f.catch_id, f.reason, f.details, f.created_at,
         (select count(*) from report_flags f2 where f2.catch_id = f.catch_id and f2.status = 'open')
  from report_flags f where f.status = 'open';

-- Fishing spots: insert/update helper that takes plain lat/lon from the console.
create or replace function admin_upsert_spot(spot_id uuid, name text, alt_names text[], lat float8, lon float8, spot spot_type,
                                             depth int, descr text, src_name text, src_url text, src_license text, confidence text, st text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if spot_id is null then
    insert into fishing_spots (canonical_name, alternate_names, geom, spot_type, depth_ft, description, source_name, source_url,
                               source_license, coordinate_confidence, status, source_last_verified)
    values (name, coalesce(alt_names, '{}'), st_makepoint(lon, lat)::geography, spot, depth, descr, src_name, src_url, src_license,
            confidence, coalesce(st, 'active'), current_date)
    returning id into rid;
  else
    update fishing_spots set canonical_name = name, alternate_names = coalesce(alt_names, '{}'),
      geom = st_makepoint(lon, lat)::geography, spot_type = spot, depth_ft = depth, description = descr, source_name = src_name,
      source_url = src_url, source_license = src_license, coordinate_confidence = confidence, status = coalesce(st, status),
      source_last_verified = current_date, updated_at = now()
    where id = spot_id returning id into rid;
  end if;
  return rid;
end $$;

create or replace function admin_spots(q text default null)
returns table (id uuid, canonical_name text, alternate_names text[], lat float8, lon float8, spot_type text, depth_ft int,
               description text, source_name text, source_url text, source_license text, coordinate_confidence text, status text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, f.canonical_name, f.alternate_names, st_y(st_pointonsurface(f.geom::geometry)), st_x(st_pointonsurface(f.geom::geometry)),
         f.spot_type::text, f.depth_ft, f.description, f.source_name, f.source_url, f.source_license, f.coordinate_confidence, f.status, f.updated_at
  from fishing_spots f
  where is_admin() and (q is null or f.canonical_name ilike '%' || q || '%' or exists (select 1 from unnest(f.alternate_names) a where a ilike '%' || q || '%'))
  order by f.canonical_name limit 500;
$$;
