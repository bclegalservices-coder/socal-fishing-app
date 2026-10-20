-- Minimal stand-ins for Supabase pieces so migrations can be tested on plain Postgres (no PostGIS / pg_net / auth).
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create domain geometry as text;
create function st_y(geometry) returns float8 language sql immutable as $$ select rtrim(split_part(split_part($1, '(', 2), ' ', 2), ')')::float8 $$;
create function st_x(geometry) returns float8 language sql immutable as $$ select split_part(split_part($1, '(', 2), ' ', 1)::float8 $$;
create schema net;
create table net.sent (id bigserial, url text, body jsonb, at timestamptz default now());
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.sent (url, body) values (url, body) returning id $$;
create publication supabase_realtime;
create role app_user nologin;
grant usage on schema public, auth, net to app_user;
-- simplified tables from 001/003/005
create table profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text);
create table species (id serial primary key, code text unique, name text);
insert into species (code, name) values ('YT', 'Yellowtail');
create table catch_reports (id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), species_id int references species(id),
  caught_at timestamptz default now(), true_geom text, quantity int default 1, weight_lb real, length_in real, kept boolean, bait text, technique text,
  fishing_depth_ft real, water_depth_ft real);
create table push_tokens (token text primary key, user_id uuid not null);
