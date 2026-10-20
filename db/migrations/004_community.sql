-- 004_community.sql — Catch Map finishing touches, auto-verification, forum, moderation,
-- rate limits, photo storage and fishing-group helpers. Run ONCE after 001–003.

-- ===================== accounts =====================
alter table profiles add column if not exists is_admin boolean not null default false;
alter table profiles add column if not exists suspended_until timestamptz;

-- Every new account gets a profile row automatically.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
insert into profiles (id) select id from auth.users on conflict do nothing;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Display names only (never prefs or anything private) for showing authors and buddies.
create or replace function public_profiles(ids uuid[]) returns table (id uuid, display_name text, verified_reporter boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.verified_reporter from profiles p where p.id = any(ids);
$$;

create or replace function assert_can_post() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from profiles where id = auth.uid() and suspended_until > now()) then
    raise exception 'This account is suspended from posting';
  end if;
end $$;

-- Rate limiter used by triggers: max `n` rows by this user in `tbl` during the last `win`.
create or replace function enforce_rate(tbl regclass, author_col text, n int, win interval) returns void
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  execute format('select count(*) from %s where %I = $1 and created_at > now() - $2', tbl, author_col)
    into c using auth.uid(), win;
  if c >= n then raise exception 'Slow down — too many posts in a short time. Try again later.'; end if;
end $$;

-- ===================== Catch Map =====================
alter table catch_reports add column if not exists client_id text unique;      -- makes offline re-sends safe
alter table catch_reports add column if not exists live_photo boolean not null default false;  -- photo taken in-app at the time
alter table catch_reports add column if not exists public_photo_paths text[] not null default '{}';
alter table public_catches add column if not exists species_code text;
alter table public_catches add column if not exists author_name text;
alter table public_catches add column if not exists photo_paths text[] not null default '{}';
alter table public_catches add column if not exists spot_id uuid;
create index if not exists public_catches_species_idx on public_catches (species_code, caught_at desc);

-- Trusted server-side changes (auto-verify, auto-hide) may change verification_status.
create or replace function lock_verification() returns trigger
language plpgsql as $$
begin
  if new.verification_status is distinct from old.verification_status
     and coalesce(auth.role(), '') <> 'service_role'
     and coalesce(current_setting('app.trusted', true), '') <> 'on'
     and not is_admin() then
    new.verification_status := old.verification_status;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Public copy: exact point, fuzzed point, or the named spot's point for "area only"; never the true point otherwise.
create or replace function sync_public_catch() returns trigger
language plpgsql security definer set search_path = public as $$
declare s env_snapshots; g geography; nm text; sp_code text;
begin
  if tg_op = 'DELETE' then delete from public_catches where id = old.id; return old; end if;
  if new.location_mode = 'private' or new.verification_status in ('removed', 'flagged') then
    delete from public_catches where id = new.id; return new;
  end if;
  select * into s from env_snapshots where id = new.snapshot_id;
  select code into sp_code from species where id = new.species_id;
  if not new.anonymous then select display_name into nm from profiles where id = new.user_id; end if;
  g := case new.location_mode
         when 'exact' then new.true_geom
         when 'approximate' then fuzz_point(new.user_id, new.true_geom)
         else (select st_pointonsurface(f.geom::geometry)::geography from fishing_spots f where f.id = new.spot_id)
       end;
  insert into public_catches (id, species_id, species_code, caught_at, public_geom, area_name, fuzz_radius_nm, quantity, weight_lb,
                              technique, bait, author_id, author_name, verified, sst_f, chl_mg_m3, tide_stage, wind_kt, photo_paths, spot_id)
  values (new.id, new.species_id, sp_code, new.caught_at, g, new.area_name,
          case when new.location_mode = 'approximate' then 1.5 end,
          new.quantity, new.weight_lb, new.technique, new.bait,
          case when new.anonymous then null else new.user_id end, case when new.anonymous then null else nm end,
          new.verification_status = 'verified', s.sst_f, s.chl_mg_m3, s.tide_stage, s.wind_kt, new.public_photo_paths, new.spot_id)
  on conflict (id) do update set
    species_id = excluded.species_id, species_code = excluded.species_code, caught_at = excluded.caught_at,
    public_geom = excluded.public_geom, area_name = excluded.area_name, fuzz_radius_nm = excluded.fuzz_radius_nm,
    quantity = excluded.quantity, weight_lb = excluded.weight_lb, technique = excluded.technique, bait = excluded.bait,
    author_id = excluded.author_id, author_name = excluded.author_name, verified = excluded.verified,
    sst_f = excluded.sst_f, chl_mg_m3 = excluded.chl_mg_m3, tide_stage = excluded.tide_stage, wind_kt = excluded.wind_kt,
    photo_paths = excluded.photo_paths, spot_id = excluded.spot_id;
  return new;
end $$;

-- Rate limit + suspension check for public catch reports.
create or replace function before_catch_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform assert_can_post();
  if new.location_mode <> 'private' then
    perform enforce_rate('catch_reports', 'user_id', 30, interval '1 hour');
  end if;
  return new;
end $$;
drop trigger if exists catch_reports_rate on catch_reports;
create trigger catch_reports_rate before insert on catch_reports for each row execute function before_catch_insert();

-- Auto-verification (MVP rule, documented in the plan):
-- a PUBLIC report with a photo taken in-app at the time counts as verified when the angler has
-- 3+ earlier reports in good standing, or already holds the Verified Reporter badge.
-- 10+ verified reports and none removed earns the badge.
create or replace function auto_verify_catch() returns trigger
language plpgsql security definer set search_path = public as $$
declare prior int; badge boolean;
begin
  insert into user_reputation (user_id, reports_total) values (new.user_id, 1)
  on conflict (user_id) do update set reports_total = user_reputation.reports_total + 1, updated_at = now();
  if new.location_mode <> 'private' and new.live_photo then
    select count(*) into prior from catch_reports
     where user_id = new.user_id and id <> new.id and verification_status <> 'removed' and created_at < new.created_at;
    select coalesce(verified_reporter, false) into badge from profiles where id = new.user_id;
    if prior >= 3 or coalesce(badge, false) then
      perform set_config('app.trusted', 'on', true);
      update catch_reports set verification_status = 'verified' where id = new.id;
      perform set_config('app.trusted', 'off', true);
      update user_reputation set reports_verified = reports_verified + 1, updated_at = now() where user_id = new.user_id;
      update profiles p set verified_reporter = true
       where p.id = new.user_id and not p.verified_reporter
         and (select reports_verified from user_reputation r where r.user_id = new.user_id) >= 10
         and (select reports_removed from user_reputation r where r.user_id = new.user_id) = 0;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists catch_reports_verify on catch_reports;
create trigger catch_reports_verify after insert on catch_reports for each row execute function auto_verify_catch();

-- 3+ different people flag a report -> hidden until a moderator looks.
create or replace function on_catch_flag() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(distinct reporter_id) into n from report_flags where catch_id = new.catch_id and status = 'open';
  if n >= 3 then
    perform set_config('app.trusted', 'on', true);
    update catch_reports set verification_status = 'flagged' where id = new.catch_id and verification_status <> 'removed';
    perform set_config('app.trusted', 'off', true);
  end if;
  return new;
end $$;
drop trigger if exists report_flags_hide on report_flags;
create trigger report_flags_hide after insert on report_flags for each row execute function on_catch_flag();

-- Catch Map clusters for the visible area: one row per species per grid cell (cell shrinks as you zoom in).
create or replace function catch_map(min_lon float8, min_lat float8, max_lon float8, max_lat float8, zoom int,
                                     since timestamptz, species_codes text[] default null)
returns table (lon float8, lat float8, species_code text, n bigint, fish bigint, latest timestamptz, verified_n bigint, fuzzy boolean, cell float8)
language sql stable set search_path = public as $$
  with c as (select greatest(0.002, 360.0 / power(2, zoom) / 6) as d)
  select avg(st_x(pc.public_geom::geometry)), avg(st_y(pc.public_geom::geometry)), pc.species_code,
         count(*), sum(pc.quantity), max(pc.caught_at), count(*) filter (where pc.verified),
         bool_or(pc.fuzz_radius_nm is not null), max(c.d)
  from public_catches pc, c
  where pc.public_geom is not null and pc.caught_at >= since
    and pc.public_geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)::geography
    and (species_codes is null or pc.species_code = any(species_codes))
  group by pc.species_code, floor(st_x(pc.public_geom::geometry) / c.d), floor(st_y(pc.public_geom::geometry) / c.d)
  order by count(*) desc
  limit 250;
$$;

-- The reports inside a cluster (or any box), newest first.
create or replace function catch_reports_in(min_lon float8, min_lat float8, max_lon float8, max_lat float8,
                                            since timestamptz, species_codes text[] default null, lim int default 50)
returns table (id uuid, species_code text, caught_at timestamptz, lon float8, lat float8, area_name text, fuzz_radius_nm real,
               quantity int, weight_lb real, technique text, bait text, author_name text, verified boolean,
               sst_f real, chl_mg_m3 real, tide_stage text, wind_kt real, photo_paths text[])
language sql stable set search_path = public as $$
  select pc.id, pc.species_code, pc.caught_at, st_x(pc.public_geom::geometry), st_y(pc.public_geom::geometry), pc.area_name,
         pc.fuzz_radius_nm, pc.quantity, pc.weight_lb, pc.technique, pc.bait, pc.author_name, pc.verified,
         pc.sst_f, pc.chl_mg_m3, pc.tide_stage, pc.wind_kt, pc.photo_paths
  from public_catches pc
  where pc.public_geom is not null and pc.caught_at >= since
    and pc.public_geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)::geography
    and (species_codes is null or pc.species_code = any(species_codes))
  order by pc.caught_at desc
  limit least(lim, 200);
$$;

-- ===================== fishing groups: buddy boats for the map =====================
create or replace function buddy_positions()
returns table (user_id uuid, lat float8, lon float8, sog_kt real, cog_t real, recorded_at timestamptz, boat_name text, display_name text, groups text[])
language sql stable set search_path = public as $$
  select lp.user_id, st_y(lp.geom::geometry), st_x(lp.geom::geometry), lp.sog_kt, lp.cog_t, lp.recorded_at,
         (select gm.boat_name from group_members gm where gm.user_id = lp.user_id and gm.boat_name is not null limit 1),
         (select pp.display_name from public_profiles(array[lp.user_id]) pp),
         array(select g.name from group_members gm join fishing_groups g on g.id = gm.group_id
               where gm.user_id = lp.user_id and is_group_member(gm.group_id)
                 and gm.sharing_until > now() and not gm.hidden)
  from live_positions lp   -- row-level security limits this to people sharing with your groups
  where lp.user_id <> auth.uid() and lp.recorded_at > now() - interval '12 hours';
$$;

-- ===================== forum =====================
create table if not exists forum_categories (
  id serial primary key,
  slug text unique not null,
  name text not null,
  description text,
  sort int not null default 100,
  active boolean not null default true
);
insert into forum_categories (slug, name, description, sort) values
  ('reports', 'Fishing Reports', 'Trip reports and what''s biting', 10),
  ('offshore', 'Offshore', 'Tuna, yellowtail, dorado and the banks', 20),
  ('catalina', 'Catalina', 'Catalina Island', 30),
  ('sci', 'San Clemente Island', 'SCI fishing', 40),
  ('banks', 'Local Banks', '14 Mile, 9 Mile, Avalon Bank and friends', 50),
  ('inshore', 'Inshore', 'Bays, harbors, kelp and beaches', 60),
  ('tuna', 'Tuna', 'Bluefin and yellowfin', 70),
  ('yellowtail', 'Yellowtail', null, 80),
  ('bass', 'Bass', 'Calico, sand and spotted bay bass', 90),
  ('halibut', 'Halibut', null, 100),
  ('rockfish', 'Rockfish', 'Rockfish and bottom fishing', 110),
  ('lobster', 'Lobster', 'Hoop netting and diving', 120),
  ('boats', 'Boats', null, 130),
  ('electronics', 'Marine Electronics', null, 140),
  ('gear', 'Fishing Gear & Tackle', null, 150),
  ('conditions', 'Weather & Conditions', null, 160),
  ('general', 'General Discussion', null, 170)
on conflict (slug) do nothing;

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id int not null references forum_categories(id),
  title text not null check (char_length(title) between 3 and 140),
  body text not null default '' check (char_length(body) <= 10000),
  species_code text,
  spot_id uuid references fishing_spots(id),
  catch_id uuid references catch_reports(id) on delete set null,   -- a post may share one of your public catch reports
  photo_paths text[] not null default '{}',
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden', 'removed')),
  comment_count int not null default 0,
  like_count int not null default 0,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  last_activity_at timestamptz not null default now()
);
create index if not exists posts_cat_idx on posts (category_id, last_activity_at desc);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_post_idx on comments (post_id, created_at);

create table if not exists reactions (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'like' check (kind in ('like')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists user_blocks (
  blocker uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create table if not exists user_mutes (
  muter uuid not null default auth.uid() references auth.users(id) on delete cascade,
  muted uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter, muted)
);

create table if not exists moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'catch', 'user')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'offensive', 'fake', 'wrong_location', 'harassment', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz,
  unique (reporter_id, target_type, target_id)
);

create table if not exists audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create or replace function hidden_from_me(author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_blocks where blocker = auth.uid() and blocked = author)
      or exists (select 1 from user_mutes where muter = auth.uid() and muted = author);
$$;

-- counters, activity time, rate limits, moderation lock
create or replace function forum_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform assert_can_post();
  if tg_table_name = 'posts' then
    perform enforce_rate('posts', 'author_id', 10, interval '1 hour');
  elsif tg_table_name = 'comments' then
    perform enforce_rate('comments', 'author_id', 60, interval '1 hour');
  end if;
  new.moderation_status := 'visible';
  return new;
end $$;
drop trigger if exists posts_before_insert on posts;
create trigger posts_before_insert before insert on posts for each row execute function forum_before_insert();
drop trigger if exists comments_before_insert on comments;
create trigger comments_before_insert before insert on comments for each row execute function forum_before_insert();

create or replace function forum_lock_moderation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.moderation_status is distinct from old.moderation_status
     and not is_admin() and coalesce(current_setting('app.trusted', true), '') <> 'on' then
    new.moderation_status := old.moderation_status;
  end if;
  if tg_table_name = 'posts' and (new.title is distinct from old.title or new.body is distinct from old.body) then
    new.edited_at := now();
  elsif tg_table_name = 'comments' and new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists posts_lock on posts;
create trigger posts_lock before update on posts for each row execute function forum_lock_moderation();
drop trigger if exists comments_lock on comments;
create trigger comments_lock before update on comments for each row execute function forum_lock_moderation();

create or replace function comment_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.trusted', 'on', true);
  if tg_op = 'INSERT' then
    update posts set comment_count = comment_count + 1, last_activity_at = now() where id = new.post_id;
  else
    update posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
  end if;
  perform set_config('app.trusted', 'off', true);
  return null;
end $$;
drop trigger if exists comments_count on comments;
create trigger comments_count after insert or delete on comments for each row execute function comment_counts();

create or replace function reaction_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.trusted', 'on', true);
  if tg_op = 'INSERT' then update posts set like_count = like_count + 1 where id = new.post_id;
  else update posts set like_count = greatest(0, like_count - 1) where id = old.post_id; end if;
  perform set_config('app.trusted', 'off', true);
  return null;
end $$;
drop trigger if exists reactions_count on reactions;
create trigger reactions_count after insert or delete on reactions for each row execute function reaction_counts();

-- 3+ different people report a post/comment -> hidden until a moderator looks.
create or replace function on_moderation_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform enforce_rate('moderation_reports', 'reporter_id', 20, interval '1 hour');
  select count(distinct reporter_id) into n from moderation_reports
   where target_type = new.target_type and target_id = new.target_id and status = 'open';
  perform set_config('app.trusted', 'on', true);
  if n >= 3 and new.target_type = 'post' then
    update posts set moderation_status = 'hidden' where id = new.target_id and moderation_status = 'visible';
  elsif n >= 3 and new.target_type = 'comment' then
    update comments set moderation_status = 'hidden' where id = new.target_id and moderation_status = 'visible';
  end if;
  perform set_config('app.trusted', 'off', true);
  return new;
end $$;
drop trigger if exists moderation_reports_hide on moderation_reports;
create trigger moderation_reports_hide after insert on moderation_reports for each row execute function on_moderation_report();

-- Admin tools (call from the Supabase SQL editor or the admin console). Every action is audited.
create or replace function moderate(target_type text, target_id uuid, action text, note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'Admins only'; end if;
  perform set_config('app.trusted', 'on', true);
  if target_type = 'post' then
    update posts set moderation_status = action where id = target_id;          -- 'visible' | 'hidden' | 'removed'
  elsif target_type = 'comment' then
    update comments set moderation_status = action where id = target_id;
  elsif target_type = 'catch' then
    update catch_reports set verification_status = case action when 'visible' then 'unverified' else 'removed' end where id = target_id;
    if action = 'removed' then
      update user_reputation set reports_removed = reports_removed + 1
       where user_id = (select user_id from catch_reports where id = target_id);
    end if;
  end if;
  update moderation_reports set status = 'actioned', handled_by = auth.uid(), handled_at = now()
   where moderation_reports.target_id = moderate.target_id and status = 'open';
  update report_flags set status = case when action = 'visible' then 'dismissed' else 'upheld' end
   where catch_id = target_id and status = 'open';
  perform set_config('app.trusted', 'off', true);
  insert into audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'moderate:' || action, target_type, target_id, jsonb_build_object('note', note));
end $$;

create or replace function suspend_user(target uuid, until_ts timestamptz, note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'Admins only'; end if;
  update profiles set suspended_until = until_ts where id = target;
  insert into audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'suspend', 'user', target, jsonb_build_object('until', until_ts, 'note', note));
end $$;

-- ===================== row-level security =====================
alter table forum_categories enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table user_blocks enable row level security;
alter table user_mutes enable row level security;
alter table moderation_reports enable row level security;
alter table audit_log enable row level security;

create policy "read categories" on forum_categories for select using (active or is_admin());
create policy "admin categories" on forum_categories for all using (is_admin()) with check (is_admin());

create policy "read posts" on posts for select using (
  (moderation_status = 'visible' and not hidden_from_me(author_id)) or author_id = auth.uid() or is_admin());
create policy "write own posts" on posts for insert with check (author_id = auth.uid());
create policy "edit own posts" on posts for update using (author_id = auth.uid() or is_admin()) with check (author_id = auth.uid() or is_admin());
create policy "delete own posts" on posts for delete using (author_id = auth.uid() or is_admin());

create policy "read comments" on comments for select using (
  (moderation_status = 'visible' and not hidden_from_me(author_id)) or author_id = auth.uid() or is_admin());
create policy "write own comments" on comments for insert with check (author_id = auth.uid());
create policy "edit own comments" on comments for update using (author_id = auth.uid() or is_admin()) with check (author_id = auth.uid() or is_admin());
create policy "delete own comments" on comments for delete using (author_id = auth.uid() or is_admin());

create policy "read reactions" on reactions for select using (true);
create policy "own reactions" on reactions for insert with check (user_id = auth.uid());
create policy "remove own reactions" on reactions for delete using (user_id = auth.uid());

create policy "own blocks" on user_blocks for all using (blocker = auth.uid()) with check (blocker = auth.uid());
create policy "own mutes" on user_mutes for all using (muter = auth.uid()) with check (muter = auth.uid());

create policy "file a report" on moderation_reports for insert with check (reporter_id = auth.uid());
create policy "see own or admin" on moderation_reports for select using (reporter_id = auth.uid() or is_admin());
create policy "admin handles reports" on moderation_reports for update using (is_admin()) with check (is_admin());

create policy "admin reads audit log" on audit_log for select using (is_admin());

-- Moderators see everything in catch reports too (for review), but still never through the public API.
create policy "admin reads catches" on catch_reports for select using (is_admin());
create policy "admin reads flags" on report_flags for select using (is_admin());

-- ===================== photo storage =====================
-- Private bucket: every catch photo (only the owner can read). Public bucket: copies the owner chose to show on public reports.
-- The app re-encodes photos before upload, which strips GPS/EXIF data.
insert into storage.buckets (id, name, public) values ('catch-photos', 'catch-photos', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('public-photos', 'public-photos', true) on conflict (id) do nothing;

create policy "own private photos" on storage.objects for all
  using (bucket_id = 'catch-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'catch-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "upload own public photos" on storage.objects for insert
  with check (bucket_id = 'public-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own public photos" on storage.objects for delete
  using (bucket_id = 'public-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Your own catch's true position (for "Show on map" in your private log). Owner only.
create or replace function my_catch_point(catch_id uuid) returns table (lat float8, lon float8)
language sql stable set search_path = public as $$
  select st_y(c.true_geom::geometry), st_x(c.true_geom::geometry)
  from catch_reports c where c.id = catch_id and c.user_id = auth.uid();
$$;
