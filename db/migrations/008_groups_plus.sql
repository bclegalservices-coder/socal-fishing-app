-- 008_groups_plus.sql — Fishing groups, part 2: the "crew" features.
--   * Invite buddies by EMAIL (they see it in the app when they sign in with that email; push if they have the app)
--   * LAST KNOWN position (stays on the map, gray, for 24 h after sharing stops — each member can turn this off)
--   * "COME TO ME" / send my GPS: one tap sends exact coordinates; buddies' push opens Go To straight to you
--   * Share a CATCH (exact spot) with your group only — never the public Catch Map
--   * Share a saved SPOT or ROUTE; short MESSAGES; one feed per group
--   * FLOAT PLAN: "heading out, back by 5 PM" → check-ins → automatic OVERDUE alert to the group
-- Push notifications are sent by the database itself (pg_net → Expo). No server needed, works while Render sleeps.
-- Run ONCE in Supabase SQL Editor after 007. Safe to run again.

create extension if not exists pg_net;

-- ===================== member settings =====================
alter table group_members add column if not exists show_last_known boolean not null default true;
alter table group_members add column if not exists notify boolean not null default true;

-- Sharing now, OR (stopped within the last 24 h AND that member allows "last known").
-- "Stop sharing" sets sharing_until = now(); "Stop and remove my position" sets it to null.
create or replace function can_see_position(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target = auth.uid() or exists (
    select 1
    from group_members theirs
    join group_members mine on mine.group_id = theirs.group_id and mine.user_id = auth.uid()
    where theirs.user_id = target
      and not theirs.hidden
      and theirs.sharing_until is not null
      and (theirs.sharing_until > now()
           or (theirs.show_last_known and theirs.sharing_until > now() - interval '24 hours'))
  );
$$;

-- Who to call someone in a group: boat name there, else their display name.
create or replace function member_label(g uuid, u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select boat_name from group_members where group_id = g and user_id = u and boat_name is not null),
                  (select display_name from profiles where id = u and display_name is not null),
                  'A buddy');
$$;

drop function if exists buddy_positions();
create or replace function buddy_positions()
returns table (user_id uuid, lat float8, lon float8, sog_kt real, cog_t real, recorded_at timestamptz,
               boat_name text, display_name text, groups text[], status text)
language sql stable security definer set search_path = public as $$
  select lp.user_id, st_y(lp.geom::geometry), st_x(lp.geom::geometry), lp.sog_kt, lp.cog_t, lp.recorded_at,
         (select gm.boat_name from group_members gm where gm.user_id = lp.user_id and gm.boat_name is not null limit 1),
         (select p.display_name from profiles p where p.id = lp.user_id),
         array(select g.name from group_members gm join fishing_groups g on g.id = gm.group_id
               where gm.user_id = lp.user_id and is_group_member(gm.group_id) and not gm.hidden
                 and gm.sharing_until is not null
                 and (gm.sharing_until > now() or (gm.show_last_known and gm.sharing_until > now() - interval '24 hours'))),
         case when exists (select 1 from group_members gm where gm.user_id = lp.user_id and is_group_member(gm.group_id)
                           and not gm.hidden and gm.sharing_until > now()) then 'live' else 'last_known' end
  from live_positions lp
  where lp.user_id <> auth.uid() and can_see_position(lp.user_id) and lp.recorded_at > now() - interval '24 hours';
$$;

create or replace function set_group_prefs(g uuid, notify_me boolean default null, last_known boolean default null, boat text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update group_members set notify = coalesce(notify_me, notify), show_last_known = coalesce(last_known, show_last_known),
                           boat_name = coalesce(nullif(trim(boat), ''), boat_name)
  where group_id = g and user_id = auth.uid();
  if not found then raise exception 'Not in this group'; end if;
end $$;

-- ===================== push (database → Expo) =====================
-- Never blocks or fails the action that triggered it.
create or replace function send_push(users uuid[], title text, body text, data jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare msgs jsonb; n int; i int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object('to', token, 'title', title, 'body', body, 'sound', 'default',
                                               'data', data, 'channelId', 'groups', 'priority', 'high')), '[]'::jsonb), count(*)
    into msgs, n
  from push_tokens where user_id = any(users);
  if n = 0 then return 0; end if;
  while i * 100 < n loop   -- Expo accepts up to 100 messages per request
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := (select jsonb_agg(m) from jsonb_array_elements(msgs) with ordinality t(m, ord) where ord > i * 100 and ord <= (i + 1) * 100),
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb);
    i := i + 1;
  end loop;
  return n;
exception when others then
  raise notice 'push skipped: %', sqlerrm;
  return 0;
end $$;

-- ===================== invites by email =====================
create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references fishing_groups(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (group_id, email)
);
alter table group_invites enable row level security;
drop policy if exists "members see their group's invites" on group_invites;
create policy "members see their group's invites" on group_invites for select using (is_group_member(group_id));
-- All writes go through the functions below.

create or replace function my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

-- Returns one row per address. Never reveals whether an address already has an account.
create or replace function invite_to_group(g uuid, emails text[])
returns table (address text, result text)
language plpgsql security definer set search_path = public as $$
declare e text; gname text; who text; pending int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not is_group_member(g) then raise exception 'Not in this group'; end if;
  if coalesce(array_length(emails, 1), 0) > 25 then raise exception 'Up to 25 addresses at a time'; end if;
  select name into gname from fishing_groups where id = g;
  who := member_label(g, auth.uid());
  foreach e in array emails loop
    e := lower(trim(e));
    if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      address := e; result := 'invalid'; return next; continue;
    end if;
    if exists (select 1 from group_members m join auth.users u on u.id = m.user_id where m.group_id = g and lower(u.email) = e) then
      address := e; result := 'already_member'; return next; continue;
    end if;
    select count(*) into pending from group_invites i where i.group_id = g and i.status = 'pending';
    if pending >= 50 then raise exception 'This group has 50 invites waiting — revoke some first'; end if;
    insert into group_invites as gi (group_id, email, invited_by) values (g, e, auth.uid())
    on conflict (group_id, email) do update set status = 'pending', invited_by = auth.uid(), created_at = now(), responded_at = null
      where gi.status <> 'accepted';
    perform send_push(array(select id from auth.users where lower(auth.users.email) = e),
                      'Fishing group invite', who || ' invited you to "' || gname || '". Open the app to join.',
                      jsonb_build_object('type', 'group_invite', 'group_id', g));
    address := e; result := 'invited'; return next;
  end loop;
end $$;

create or replace function my_invites()
returns table (id uuid, group_id uuid, group_name text, invited_by text, created_at timestamptz, members int)
language sql stable security definer set search_path = public as $$
  select i.id, i.group_id, g.name, member_label(i.group_id, i.invited_by), i.created_at,
         (select count(*)::int from group_members m where m.group_id = i.group_id)
  from group_invites i join fishing_groups g on g.id = i.group_id
  where i.status = 'pending' and i.email = my_email()
    and not exists (select 1 from group_members m where m.group_id = i.group_id and m.user_id = auth.uid())
  order by i.created_at desc;
$$;

create or replace function respond_invite(invite uuid, accept boolean, boat text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv group_invites;
begin
  select * into inv from group_invites where id = invite and status = 'pending' and email = my_email();
  if inv.id is null then raise exception 'Invite not found (it may have been withdrawn)'; end if;
  update group_invites set status = case when accept then 'accepted' else 'declined' end, responded_at = now() where id = invite;
  if accept then
    insert into group_members (group_id, user_id, boat_name) values (inv.group_id, auth.uid(), nullif(trim(boat), ''))
    on conflict (group_id, user_id) do nothing;
    perform send_push(array[inv.invited_by], 'Invite accepted',
                      member_label(inv.group_id, auth.uid()) || ' joined ' || (select name from fishing_groups where id = inv.group_id),
                      jsonb_build_object('type', 'group_joined', 'group_id', inv.group_id));
  end if;
  return inv.group_id;
end $$;

create or replace function revoke_invite(invite uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update group_invites i set status = 'revoked', responded_at = now()
  where i.id = invite and i.status = 'pending'
    and (i.invited_by = auth.uid() or exists (select 1 from fishing_groups g where g.id = i.group_id and g.owner_id = auth.uid()));
  if not found then raise exception 'Only the person who sent it or the group owner can withdraw an invite'; end if;
end $$;

-- ===================== group feed: pings, positions, catches, spots, routes, messages, check-ins =====================
create table if not exists group_shares (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references fishing_groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('ping', 'position', 'catch', 'spot', 'route', 'message', 'checkin', 'overdue')),
  lat float8 check (lat between -90 and 90),
  lon float8 check (lon between -180 and 180),
  body text check (char_length(body) <= 500),
  payload jsonb not null default '{}'::jsonb,
  catch_id uuid references catch_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind in ('ping', 'position', 'catch', 'spot') and lat is not null and lon is not null)
         or kind not in ('ping', 'position', 'catch', 'spot'))
);
create index if not exists group_shares_group_idx on group_shares (group_id, created_at desc);
create index if not exists group_shares_user_idx on group_shares (user_id, created_at desc);
alter table group_shares enable row level security;
drop policy if exists "members read feed" on group_shares;
drop policy if exists "members post" on group_shares;
drop policy if exists "delete own or owner" on group_shares;
create policy "members read feed" on group_shares for select using (is_group_member(group_id));
create policy "members post" on group_shares for insert with check (
  user_id = auth.uid() and is_group_member(group_id) and kind in ('ping', 'position', 'spot', 'route', 'message'));
create policy "delete own or owner" on group_shares for delete using (
  user_id = auth.uid() or exists (select 1 from fishing_groups g where g.id = group_id and g.owner_id = auth.uid()));

-- Anti-spam (system rows — overdue alerts — are exempt).
create or replace function group_shares_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.kind = 'overdue' then return new; end if;
  if new.kind in ('ping', 'position') then
    select count(*) into n from group_shares
    where user_id = new.user_id and group_id = new.group_id and kind in ('ping', 'position') and created_at > now() - interval '60 seconds';
    if n > 0 then raise exception 'You just sent your position — wait a minute before sending again'; end if;
  end if;
  select count(*) into n from group_shares where user_id = new.user_id and created_at > now() - interval '1 hour';
  if n >= 60 then raise exception 'Too many posts in the last hour — try again later'; end if;
  return new;
end $$;
drop trigger if exists group_shares_limits on group_shares;
create trigger group_shares_limits before insert on group_shares for each row execute function group_shares_limits();

-- Push to the rest of the group.
create or replace function group_shares_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; gname text; title text; msg text; recips uuid[]; st text;
begin
  who := member_label(new.group_id, new.user_id);
  select name into gname from fishing_groups where id = new.group_id;
  st := new.payload->>'status';
  if new.kind = 'ping' then
    title := '🎣 ' || who || ': Come to me!';
    msg := coalesce(nullif(new.body, ''), 'On fish — tap to navigate to them.');
  elsif new.kind = 'position' then
    title := '📍 ' || who || ' sent their position';
    msg := coalesce(nullif(new.body, ''), 'Tap to see it on the map.');
  elsif new.kind = 'catch' then
    title := '🐟 ' || who || ' caught ' || coalesce(new.payload->>'quantity', '1') || ' ' || coalesce(new.payload->>'species', 'fish');
    msg := concat_ws(' · ', nullif(new.payload->>'weight_lb', '') || ' lb', new.payload->>'bait', 'Tap to see where.');
  elsif new.kind = 'spot' then
    title := '📌 ' || who || ' shared a spot';
    msg := coalesce(new.payload->>'name', 'Spot') || coalesce(' — ' || nullif(new.body, ''), '');
  elsif new.kind = 'route' then
    title := '🧭 ' || who || ' shared a route';
    msg := coalesce(new.payload->>'name', 'Route') || ' (' || coalesce(jsonb_array_length(new.payload->'points'), 0) || ' points)';
  elsif new.kind = 'message' then
    title := who || ' · ' || gname;
    msg := new.body;
  elsif new.kind = 'checkin' then
    title := case st when 'out' then '🚤 ' || who || ' is heading out'
                     when 'ok' then '👍 ' || who || ' checked in: all good'
                     when 'heading_in' then '⚓ ' || who || ' is heading in'
                     when 'back' then '🏠 ' || who || ' is back at the dock'
                     when 'extended' then '⏱ ' || who || ' will be out longer'
                     else who || ' checked in' end;
    msg := concat_ws(' · ',
             case when new.payload ? 'back_by' then 'Back by ' || to_char((new.payload->>'back_by')::timestamptz at time zone 'America/Los_Angeles', 'FMHH12:MI AM') end,
             nullif(new.body, ''));
  elsif new.kind = 'overdue' then
    title := '⚠ ' || who || ' is overdue';
    msg := new.body;
  end if;
  select array_agg(user_id) into recips from group_members
  where group_id = new.group_id and user_id <> new.user_id and notify;
  if recips is not null then
    perform send_push(recips, title, coalesce(msg, ''), jsonb_build_object(
      'type', 'group_share', 'kind', new.kind, 'share_id', new.id, 'group_id', new.group_id,
      'lat', new.lat, 'lon', new.lon, 'label', who));
  end if;
  return null;
end $$;
drop trigger if exists group_shares_push on group_shares;
create trigger group_shares_push after insert on group_shares for each row execute function group_shares_push();

-- Share one of MY catches (exact spot) with one or more of my groups.
create or replace function share_catch(c uuid, groups uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare r record; g uuid; n int := 0;
begin
  select cr.*, s.name species_name, s.code species_code, st_y(cr.true_geom::geometry) la, st_x(cr.true_geom::geometry) lo
    into r from catch_reports cr join species s on s.id = cr.species_id
  where cr.id = c and cr.user_id = auth.uid();
  if r.id is null then raise exception 'Catch not found'; end if;
  foreach g in array groups loop
    if not is_group_member(g) then continue; end if;
    if exists (select 1 from group_shares where catch_id = c and group_id = g) then continue; end if;
    insert into group_shares (group_id, user_id, kind, lat, lon, catch_id, payload) values (g, auth.uid(), 'catch', r.la, r.lo, c,
      jsonb_strip_nulls(jsonb_build_object('species', r.species_name, 'species_code', r.species_code, 'quantity', r.quantity,
        'weight_lb', r.weight_lb, 'length_in', r.length_in, 'kept', r.kept, 'bait', r.bait, 'technique', r.technique,
        'fishing_depth_ft', r.fishing_depth_ft, 'water_depth_ft', r.water_depth_ft, 'caught_at', r.caught_at)));
    n := n + 1;
  end loop;
  return n;
end $$;

-- The feed for one group, newest first, with names.
create or replace function group_feed(g uuid, lim int default 100, before timestamptz default null)
returns table (id uuid, kind text, lat float8, lon float8, body text, payload jsonb, created_at timestamptz, user_id uuid, who text, mine boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.lat, s.lon, s.body, s.payload, s.created_at, s.user_id, member_label(g, s.user_id), s.user_id = auth.uid()
  from group_shares s
  where s.group_id = g and is_group_member(g) and (before is null or s.created_at < before)
  order by s.created_at desc
  limit least(greatest(lim, 1), 200);
$$;

-- Map pins from all my groups: pings, positions, catches, spots and overdue alerts from the last `hours`.
create or replace function group_pins(hours int default 24)
returns table (id uuid, kind text, lat float8, lon float8, body text, payload jsonb, created_at timestamptz, who text, group_name text, mine boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.lat, s.lon, s.body, s.payload, s.created_at, member_label(s.group_id, s.user_id), g.name, s.user_id = auth.uid()
  from group_shares s join fishing_groups g on g.id = s.group_id
  where is_group_member(s.group_id) and s.lat is not null
    and s.kind in ('ping', 'position', 'catch', 'spot', 'overdue')
    and s.created_at > now() - make_interval(hours => least(greatest(hours, 1), 168))
  order by s.created_at desc
  limit 300;
$$;

-- ===================== float plan + overdue =====================
create table if not exists float_plans (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  group_ids uuid[] not null,
  departed_at timestamptz not null default now(),
  back_by timestamptz not null,
  note text check (char_length(note) <= 300),
  closed_at timestamptz,
  overdue_sent_at timestamptz
);
alter table float_plans enable row level security;
drop policy if exists "own float plan" on float_plans;
create policy "own float plan" on float_plans for select using (user_id = auth.uid());

create or replace function start_float_plan(groups uuid[], back timestamptz, plan_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid; ok uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if back < now() + interval '10 minutes' or back > now() + interval '72 hours' then
    raise exception 'Back-by time must be between 10 minutes and 3 days from now';
  end if;
  foreach g in array groups loop
    if is_group_member(g) then ok := ok || g; end if;
  end loop;
  if cardinality(ok) = 0 then raise exception 'Pick at least one of your groups'; end if;
  insert into float_plans (user_id, group_ids, departed_at, back_by, note, closed_at, overdue_sent_at)
  values (auth.uid(), ok, now(), back, nullif(trim(plan_note), ''), null, null)
  on conflict (user_id) do update set group_ids = excluded.group_ids, departed_at = now(), back_by = excluded.back_by,
    note = excluded.note, closed_at = null, overdue_sent_at = null;
  -- While a float plan is open my boat is shared with those groups (so "last known" is useful if I'm late).
  update group_members set sharing_until = back + interval '6 hours', hidden = false where user_id = auth.uid() and group_id = any(ok);
  foreach g in array ok loop
    insert into group_shares (group_id, user_id, kind, body, payload)
    values (g, auth.uid(), 'checkin', nullif(trim(plan_note), ''), jsonb_build_object('status', 'out', 'back_by', back));
  end loop;
end $$;

-- status: 'ok' | 'heading_in' | 'back' ; new_back: extend the plan.
create or replace function float_checkin(status text, new_back timestamptz default null, msg text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p float_plans; g uuid; st text := status;
begin
  select * into p from float_plans where user_id = auth.uid() and closed_at is null;
  if p.user_id is null then raise exception 'No open float plan'; end if;
  if st not in ('ok', 'heading_in', 'back') then raise exception 'Unknown check-in'; end if;
  if new_back is not null then
    if new_back < now() or new_back > now() + interval '72 hours' then raise exception 'New back-by time must be within 3 days'; end if;
    update float_plans set back_by = new_back, overdue_sent_at = null where user_id = auth.uid();
    update group_members set sharing_until = new_back + interval '6 hours' where user_id = auth.uid() and group_id = any(p.group_ids);
    st := 'extended';
  end if;
  if status = 'back' then
    update float_plans set closed_at = now() where user_id = auth.uid();
    update group_members set sharing_until = now() where user_id = auth.uid() and group_id = any(p.group_ids) and sharing_until > now();
  end if;
  foreach g in array p.group_ids loop
    if is_group_member(g) then
      insert into group_shares (group_id, user_id, kind, body, payload)
      values (g, auth.uid(), 'checkin', nullif(trim(msg), ''),
              jsonb_strip_nulls(jsonb_build_object('status', st, 'back_by', coalesce(new_back, case when status = 'back' then null else p.back_by end))));
    end if;
  end loop;
end $$;

create or replace function my_float_plan() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'user_id' from float_plans p where p.user_id = auth.uid() and p.closed_at is null;
$$;

-- Open float plans of members of a group (for the group screen).
create or replace function group_float_plans(g uuid)
returns table (user_id uuid, who text, departed_at timestamptz, back_by timestamptz, note text, overdue boolean)
language sql stable security definer set search_path = public as $$
  select p.user_id, member_label(g, p.user_id), p.departed_at, p.back_by, p.note, now() > p.back_by + interval '30 minutes'
  from float_plans p
  where is_group_member(g) and g = any(p.group_ids) and p.closed_at is null
    and exists (select 1 from group_members m where m.group_id = g and m.user_id = p.user_id);
$$;

-- Run every 5 minutes (pg_cron below). 30 min past back-by → alert the group once, and nudge the boater.
create or replace function check_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare p record; g uuid; la float8; lo float8; seen timestamptz; n int := 0; msg text;
begin
  for p in select * from float_plans where closed_at is null and overdue_sent_at is null and back_by + interval '30 minutes' < now() loop
    select st_y(geom::geometry), st_x(geom::geometry), recorded_at into la, lo, seen from live_positions where user_id = p.user_id;
    msg := 'Was due back by ' || to_char(p.back_by at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '. '
        || case when seen is not null
                then 'Last known position ' || round(la::numeric, 4) || ', ' || round(lo::numeric, 4) || ' at '
                     || to_char(seen at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '. '
                else 'No position shared. ' end
        || 'Try calling them or VHF 16. If you believe they are in distress, call the Coast Guard.';
    foreach g in array p.group_ids loop
      if exists (select 1 from group_members where group_id = g and user_id = p.user_id) then
        insert into group_shares (group_id, user_id, kind, lat, lon, body, payload)
        values (g, p.user_id, 'overdue', la, lo, msg,
                jsonb_strip_nulls(jsonb_build_object('back_by', p.back_by, 'last_seen', seen, 'no_position', seen is null)));
      end if;
    end loop;
    perform send_push(array[p.user_id], 'Are you OK?', 'Your float plan said back by '
      || to_char(p.back_by at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '. Your group has been told. Tap to check in.',
      jsonb_build_object('type', 'float_overdue'));
    update float_plans set overdue_sent_at = now() where user_id = p.user_id;
    n := n + 1;
  end loop;
  -- Tidy up: plans left open 3 days past their time close themselves.
  update float_plans set closed_at = now() where closed_at is null and back_by < now() - interval '3 days';
  return n;
end $$;

-- ===================== one call for the group screen =====================
create or replace function group_detail(g uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result_json jsonb;
begin
  if not is_group_member(g) then raise exception 'Not in this group'; end if;
  select jsonb_build_object(
    'id', f.id, 'name', f.name, 'invite_code', f.invite_code, 'owner_id', f.owner_id, 'is_owner', f.owner_id = auth.uid(),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'label', member_label(g, m.user_id), 'boat_name', m.boat_name, 'role', m.role, 'me', m.user_id = auth.uid(),
        'status', case when m.hidden or m.sharing_until is null then 'off'
                       when m.sharing_until > now() then 'live'
                       when m.show_last_known and m.sharing_until > now() - interval '24 hours' then 'last_known'
                       else 'off' end,
        'sharing_until', case when m.user_id = auth.uid() then m.sharing_until end,
        'hidden', case when m.user_id = auth.uid() then m.hidden end,
        'notify', case when m.user_id = auth.uid() then m.notify end,
        'show_last_known', case when m.user_id = auth.uid() then m.show_last_known end,
        'position', (select jsonb_build_object('lat', st_y(lp.geom::geometry), 'lon', st_x(lp.geom::geometry), 'recorded_at', lp.recorded_at,
                                               'sog_kt', lp.sog_kt)
                     from live_positions lp where lp.user_id = m.user_id and m.user_id <> auth.uid() and can_see_position(m.user_id)
                       and lp.recorded_at > now() - interval '24 hours')
      ) order by m.role desc, m.joined_at), '[]'::jsonb) from group_members m where m.group_id = g),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id,
        'email', regexp_replace(i.email, '^(.).*(@.*)$', '\1•••\2'), 'mine', i.invited_by = auth.uid(), 'created_at', i.created_at)
      order by i.created_at desc), '[]'::jsonb) from group_invites i where i.group_id = g and i.status = 'pending'),
    'float_plans', (select coalesce(jsonb_agg(to_jsonb(fp)), '[]'::jsonb) from group_float_plans(g) fp)
  ) into result_json from fishing_groups f where f.id = g;
  return result_json;
end $$;

-- ===================== lock down the internal helpers =====================
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function send_push(uuid[], text, text, jsonb) from %I', r);
      execute format('revoke all on function check_overdue() from %I', r);
      execute format('revoke all on function member_label(uuid, uuid) from %I', r);
    end if;
  end loop;
  revoke all on function send_push(uuid[], text, text, jsonb) from public;
  revoke all on function check_overdue() from public;
  revoke all on function member_label(uuid, uuid) from public;
end $$;

-- ===================== schedule the overdue check (needs pg_cron: Database → Extensions) =====================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'float-plan-overdue';
    perform cron.schedule('float-plan-overdue', '*/5 * * * *', 'select check_overdue()');
  else
    raise notice 'pg_cron is not enabled — enable it (Database → Extensions) and run this file again, or overdue alerts will not go out.';
  end if;
end $$;

-- Live feed updates in the app (Realtime respects the row-level security above).
do $$
begin
  alter publication supabase_realtime add table group_shares;
exception when duplicate_object or undefined_object then null;
end $$;
