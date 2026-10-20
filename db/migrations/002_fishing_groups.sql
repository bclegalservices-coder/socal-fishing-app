-- 002_fishing_groups.sql — invite-only fishing groups with live boat positions.
-- Run ONCE in Supabase SQL Editor, after 001_init.sql.
-- Privacy: you only ever see positions of people who are actively sharing with a group you belong to.

create table if not exists fishing_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references fishing_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  boat_name text,
  role text not null default 'member' check (role in ('owner','member')),
  sharing_until timestamptz,          -- null = not sharing with this group
  hidden boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on group_members (user_id);

-- Latest position only. No history is kept on the server.
create table if not exists live_positions (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  geom geography(point, 4326) not null,
  sog_kt real,
  cog_t real,
  accuracy_m real,
  recorded_at timestamptz not null default now()
);

-- ---------- helper functions (security definer avoids recursive RLS) ----------
create or replace function is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = auth.uid());
$$;

-- True when `target` is sharing right now with at least one group the caller belongs to.
create or replace function can_see_position(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target = auth.uid() or exists (
    select 1
    from group_members theirs
    join group_members mine on mine.group_id = theirs.group_id and mine.user_id = auth.uid()
    where theirs.user_id = target
      and theirs.hidden = false
      and theirs.sharing_until is not null
      and theirs.sharing_until > now()
  );
$$;

-- Join with an invite code (codes aren't readable by non-members, so joining goes through this).
create or replace function join_group(code text, boat text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into g from fishing_groups where invite_code = upper(trim(code));
  if g is null then raise exception 'No group with that code'; end if;
  insert into group_members (group_id, user_id, boat_name) values (g, auth.uid(), boat)
  on conflict (group_id, user_id) do nothing;
  return g;
end $$;

-- Create a group and become its owner in one step; returns the new group's id and invite code.
create or replace function create_group(group_name text, boat text default null)
returns table (id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare g fishing_groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into fishing_groups (name, owner_id) values (trim(group_name), auth.uid()) returning * into g;
  update group_members set boat_name = boat where group_id = g.id and user_id = auth.uid();
  return query select g.id, g.invite_code;
end $$;

-- Creator automatically becomes the owner/member (also covers direct inserts).
create or replace function add_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists fishing_groups_owner on fishing_groups;
create trigger fishing_groups_owner after insert on fishing_groups
  for each row execute function add_owner_membership();

-- ---------- row-level security ----------
alter table fishing_groups enable row level security;
alter table group_members enable row level security;
alter table live_positions enable row level security;

create policy "members read group" on fishing_groups for select using (is_group_member(id));
create policy "anyone signed in creates group" on fishing_groups for insert with check (owner_id = auth.uid());
create policy "owner renames or deletes group" on fishing_groups for update using (owner_id = auth.uid());
create policy "owner deletes group" on fishing_groups for delete using (owner_id = auth.uid());

create policy "members see roster" on group_members for select using (is_group_member(group_id));
create policy "edit own sharing" on group_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave group or owner removes" on group_members for delete using (
  user_id = auth.uid()
  or exists (select 1 from fishing_groups g where g.id = group_id and g.owner_id = auth.uid())
);

create policy "see shared positions" on live_positions for select using (can_see_position(user_id));
create policy "write own position" on live_positions for insert with check (user_id = auth.uid());
create policy "update own position" on live_positions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own position" on live_positions for delete using (user_id = auth.uid());

-- Live updates to the map (Supabase Realtime respects the RLS above).
alter publication supabase_realtime add table live_positions;
