-- Nov 2: catch details on the map, "Found on", and whale sightings.
-- Safe to run more than once.

-- ===================== catches =====================
-- "Found on": how the fish were found (kelp paddy, meter marks, open-water school, birds, porpoise, other).
alter table catch_reports add column if not exists found_on text;
alter table catch_reports drop constraint if exists catch_reports_found_on_chk;
alter table catch_reports add constraint catch_reports_found_on_chk
  check (found_on is null or found_on in ('paddy', 'meter_marks', 'school', 'birds', 'porpoise', 'other'));

-- Everything the angler chose to share now shows when a catch is tapped on the map.
alter table public_catches add column if not exists found_on text;
alter table public_catches add column if not exists length_in real;
alter table public_catches add column if not exists kept boolean;
alter table public_catches add column if not exists fishing_depth_ft real;
alter table public_catches add column if not exists water_depth_ft real;
alter table public_catches add column if not exists meter_marks text;
alter table public_catches add column if not exists notes text;

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
                              technique, bait, author_id, author_name, verified, sst_f, chl_mg_m3, tide_stage, wind_kt, photo_paths, spot_id,
                              found_on, length_in, kept, fishing_depth_ft, water_depth_ft, meter_marks, notes)
  values (new.id, new.species_id, sp_code, new.caught_at, g, new.area_name,
          case when new.location_mode = 'approximate' then 1.5 end,
          new.quantity, new.weight_lb, new.technique, new.bait,
          case when new.anonymous then null else new.user_id end, case when new.anonymous then null else nm end,
          new.verification_status = 'verified', s.sst_f, s.chl_mg_m3, s.tide_stage, s.wind_kt, new.public_photo_paths, new.spot_id,
          new.found_on, new.length_in, new.kept, new.fishing_depth_ft, new.water_depth_ft, new.meter_marks, new.notes)
  on conflict (id) do update set
    species_id = excluded.species_id, species_code = excluded.species_code, caught_at = excluded.caught_at,
    public_geom = excluded.public_geom, area_name = excluded.area_name, fuzz_radius_nm = excluded.fuzz_radius_nm,
    quantity = excluded.quantity, weight_lb = excluded.weight_lb, technique = excluded.technique, bait = excluded.bait,
    author_id = excluded.author_id, author_name = excluded.author_name, verified = excluded.verified,
    sst_f = excluded.sst_f, chl_mg_m3 = excluded.chl_mg_m3, tide_stage = excluded.tide_stage, wind_kt = excluded.wind_kt,
    photo_paths = excluded.photo_paths, spot_id = excluded.spot_id,
    found_on = excluded.found_on, length_in = excluded.length_in, kept = excluded.kept, fishing_depth_ft = excluded.fishing_depth_ft,
    water_depth_ft = excluded.water_depth_ft, meter_marks = excluded.meter_marks, notes = excluded.notes;
  return new;
end $$;

-- fill the new columns for catches already on the map
update catch_reports set updated_at = updated_at where location_mode <> 'private';

drop function if exists catch_reports_in(float8, float8, float8, float8, timestamptz, text[], int);
create or replace function catch_reports_in(min_lon float8, min_lat float8, max_lon float8, max_lat float8,
                                            since timestamptz, species_codes text[] default null, lim int default 50)
returns table (id uuid, species_code text, caught_at timestamptz, lon float8, lat float8, area_name text, fuzz_radius_nm real,
               quantity int, weight_lb real, technique text, bait text, author_name text, verified boolean,
               sst_f real, chl_mg_m3 real, tide_stage text, wind_kt real, photo_paths text[],
               found_on text, length_in real, kept boolean, fishing_depth_ft real, water_depth_ft real, meter_marks text, notes text)
language sql stable set search_path = public as $$
  select pc.id, pc.species_code, pc.caught_at, st_x(pc.public_geom::geometry), st_y(pc.public_geom::geometry), pc.area_name,
         pc.fuzz_radius_nm, pc.quantity, pc.weight_lb, pc.technique, pc.bait, pc.author_name, pc.verified,
         pc.sst_f, pc.chl_mg_m3, pc.tide_stage, pc.wind_kt, pc.photo_paths,
         pc.found_on, pc.length_in, pc.kept, pc.fishing_depth_ft, pc.water_depth_ft, pc.meter_marks, pc.notes
  from public_catches pc
  where pc.public_geom is not null and pc.caught_at >= since
    and pc.public_geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)::geography
    and (species_codes is null or pc.species_code = any(species_codes))
  order by pc.caught_at desc
  limit least(lim, 200);
$$;

-- ===================== whale sightings =====================
create table if not exists whale_sightings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  species text not null check (species in ('orca', 'blue', 'gray', 'humpback', 'fin', 'minke', 'sperm', 'other')),
  other_name text,
  how_many int not null default 1 check (how_many between 1 and 500),
  behavior text check (behavior is null or behavior in ('traveling', 'feeding', 'breaching', 'resting', 'with_calf', 'other')),
  seen_at timestamptz not null default now(),
  geom geography(point, 4326) not null,
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists whale_sightings_geom_idx on whale_sightings using gist (geom);
create index if not exists whale_sightings_time_idx on whale_sightings (seen_at desc);
alter table whale_sightings enable row level security;
drop policy if exists "read whale sightings" on whale_sightings;
create policy "read whale sightings" on whale_sightings for select using (true);
drop policy if exists "log own whale sighting" on whale_sightings;
create policy "log own whale sighting" on whale_sightings for insert with check (user_id = auth.uid());
drop policy if exists "delete own whale sighting" on whale_sightings;
create policy "delete own whale sighting" on whale_sightings for delete using (user_id = auth.uid() or is_admin());

create or replace function whales_in(min_lon float8, min_lat float8, max_lon float8, max_lat float8, since timestamptz)
returns table (id uuid, species text, other_name text, how_many int, behavior text, seen_at timestamptz, lon float8, lat float8,
               notes text, author_name text, mine boolean)
language sql stable set search_path = public as $$
  select w.id, w.species, w.other_name, w.how_many, w.behavior, w.seen_at, st_x(w.geom::geometry), st_y(w.geom::geometry), w.notes,
         (select pp.display_name from public_profiles(array[w.user_id]) pp), w.user_id = auth.uid()
  from whale_sightings w
  where w.seen_at >= since and w.geom && st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326)::geography
  order by w.seen_at desc
  limit 300;
$$;
