-- 009_ad_platform.sql — Ad Studio: advertisers upload and preview their own ads, see prices and availability,
-- and submit; YOU review (approve / ask for changes / reject), set the final price, and take payment
-- (Stripe card, or cash/check/Venmo/Zelle marked by hand). Approved + paid orders go live automatically.
-- Run ONCE in Supabase SQL Editor after 008. Safe to run again.

-- ===================== advertisers & who can act for them =====================
alter table advertisers add column if not exists phone text;
alter table advertisers add column if not exists logo_url text;
alter table advertisers add column if not exists address text;
alter table advertisers add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table advertisers add column if not exists status text not null default 'active';
do $$ begin
  alter table advertisers add constraint advertisers_status_check check (status in ('active', 'blocked'));
exception when duplicate_object then null; end $$;

create table if not exists advertiser_users (
  advertiser_id int not null references advertisers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (advertiser_id, user_id)
);
create index if not exists advertiser_users_user_idx on advertiser_users (user_id);

-- Your private notes about an advertiser live in their own table, so advertisers can never read them.
create table if not exists advertiser_notes (
  advertiser_id int primary key references advertisers(id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now()
);

-- Advertisers may edit their own contact details, never their status (blocked/active) or who created them.
create or replace function advertisers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    new.status := old.status;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
drop trigger if exists advertisers_guard on advertisers;
create trigger advertisers_guard before update on advertisers for each row execute function advertisers_guard();

create or replace function is_advertiser_member(a int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from advertiser_users where advertiser_id = a and user_id = auth.uid());
$$;

-- Coarse targeting areas — the same ones the app's anonymous analytics use.
create or replace function ad_areas() returns text[] language sql immutable as $$
  select array['Los Angeles', 'Orange County', 'San Diego', 'Santa Barbara / Ventura', 'Catalina', 'San Clemente Island',
               'Channel Islands', 'Offshore SoCal', 'North Baja'];
$$;

-- ===================== price list (you edit these in the Studio) =====================
create table if not exists ad_rates (
  placement ad_placement not null,
  section text not null default '',                 -- for "Presented by": Today, Weather, Catch Map, SST Map
  price_cents_week int not null check (price_cents_week >= 0),
  max_slots int not null default 4 check (max_slots between 1 and 50),   -- advertisers sharing it in the same week & area
  active boolean not null default true,
  description text,
  updated_at timestamptz not null default now(),
  primary key (placement, section)
);
insert into ad_rates (placement, section, price_cents_week, max_slots, description) values
  ('banner_dashboard', '', 2500, 4, 'Banner on the daily "SoCal Fishing Today" screen'),
  ('banner_reports', '', 2000, 4, 'Banner in the catch reports feed'),
  ('banner_community', '', 1500, 4, 'Banner at the top of the forum'),
  ('sponsor_intro', '', 7500, 2, '5-second full-screen sponsor at app open (only when the boat is stopped)'),
  ('presented_by', 'Today', 5000, 1, '"Presented by" on the daily fishing report — one sponsor per week'),
  ('presented_by', 'Weather', 4000, 1, '"Marine forecast presented by" on the Weather page — one sponsor per week'),
  ('presented_by', 'Catch Map', 4000, 1, '"Catch Map presented by" — one sponsor per week'),
  ('presented_by', 'SST Map', 3500, 1, '"Water temperature map presented by" — one sponsor per week')
on conflict (placement, section) do nothing;

create table if not exists ad_discounts (
  min_weeks int primary key check (min_weeks between 2 and 52),
  pct numeric not null check (pct between 0 and 90)
);
insert into ad_discounts values (4, 10), (12, 20) on conflict do nothing;

insert into app_config (key, value, description) values
  ('ad_area_price_factor', '0.4', 'Price of ONE targeted area as a share of the all-SoCal price (several areas never cost more than all of SoCal)'),
  ('ad_business_name', '"Your App Name"', 'Shown on invoices and in the Ad Studio'),
  ('ad_payment_instructions', '"Pay by card online, or Zelle/Venmo/check — ask us for details."', 'Shown to advertisers next to "Pay"')
on conflict (key) do nothing;

-- ===================== creatives (every format) =====================
create table if not exists ad_creatives (
  id uuid primary key default gen_random_uuid(),
  advertiser_id int not null references advertisers(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null check (kind in ('image', 'gif', 'video', 'html5', 'native', 'pdf')),
  media_url text,                -- image / gif / video / rendered first page of a PDF
  poster_url text,               -- still frame for video
  html_url text,                 -- html5: ONE self-contained file (the Studio bundles the zip)
  pdf_url text,                  -- full PDF (flyer / coupon), opened from the ad
  width int, height int, duration_s real, bytes int,
  headline text check (char_length(headline) <= 60),
  body text check (char_length(body) <= 140),
  cta_label text check (char_length(cta_label) <= 20),
  logo_url text,
  action_type text not null default 'website' check (action_type in ('website', 'call', 'directions', 'coupon', 'none')),
  action_value text check (char_length(action_value) <= 500),  -- https://… | phone | "lat,lon" | promo code
  created_at timestamptz not null default now(),
  check (kind = 'native' or media_url is not null or html_url is not null),
  check (kind <> 'html5' or html_url is not null),
  check (kind <> 'native' or headline is not null),
  check (coalesce(media_url, 'https://') ~ '^https://' and coalesce(poster_url, 'https://') ~ '^https://'
         and coalesce(html_url, 'https://') ~ '^https://' and coalesce(pdf_url, 'https://') ~ '^https://' and coalesce(logo_url, 'https://') ~ '^https://'),
  check (action_type <> 'website' or action_value ~* '^https?://'),
  check (action_type <> 'call' or action_value ~ '^[+0-9(). -]{7,20}$'),
  check (action_type <> 'directions' or action_value ~ '^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$')
);
create index if not exists ad_creatives_adv_idx on ad_creatives (advertiser_id, created_at desc);

-- ===================== orders (a booking + its review & payment) =====================
create table if not exists ad_orders (
  id serial primary key,
  advertiser_id int not null references advertisers(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  placement ad_placement not null,
  section text not null default '',
  areas text[],                                   -- null = all of SoCal
  tags text[] not null default '{}',              -- optional context, e.g. {tuna, offshore}
  start_date date not null,
  weeks int not null check (weeks between 1 and 52),
  end_date date generated always as (start_date + weeks * 7) stored,   -- the day after the last day
  creative_id uuid references ad_creatives(id) on delete set null,
  list_cents int not null default 0,              -- before discount
  discount_pct numeric not null default 0,
  price_cents int not null default 0,             -- what they owe (you can change it)
  status text not null default 'draft' check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'comped', 'refunded')),
  payment_method text,                            -- stripe | zelle | venmo | check | cash | other
  payment_note text,
  paid_at timestamptz,
  run_unpaid boolean not null default false,      -- you trust them: go live before payment
  paused boolean not null default false,
  stripe_session_id text,
  campaign_id int references ad_campaigns(id) on delete set null,
  advertiser_note text check (char_length(advertiser_note) <= 1000),
  review_note text check (char_length(review_note) <= 1000),
  submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (areas is null or areas <@ ad_areas())
);
create index if not exists ad_orders_adv_idx on ad_orders (advertiser_id, created_at desc);
create index if not exists ad_orders_dates_idx on ad_orders (placement, start_date, end_date);

create table if not exists ad_messages (
  id bigserial primary key,
  order_id int not null references ad_orders(id) on delete cascade,
  author uuid default auth.uid() references auth.users(id) on delete set null,
  from_owner boolean not null default false,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists ad_messages_order_idx on ad_messages (order_id, created_at);

-- Campaigns are what the app's ad server reads; approved orders create/refresh one automatically.
alter table ad_campaigns add column if not exists order_id int references ad_orders(id) on delete set null;
alter table ad_campaigns add column if not exists creative jsonb;
alter table ad_campaigns add column if not exists areas text[];
alter table ad_campaigns alter column creative_url drop not null;
create unique index if not exists ad_campaigns_order_uidx on ad_campaigns (order_id) where order_id is not null;

-- More things a sponsor wants counted than views and clicks.
alter table ad_events drop constraint if exists ad_events_event_check;
alter table ad_events add constraint ad_events_event_check check (event in
  ('impression', 'click', 'call', 'directions', 'coupon_open', 'coupon_save', 'video_start', 'video_complete'));

-- ===================== pricing, availability and reach estimate =====================
-- Weekly "opportunities" for a placement over the last 28 days (screen views where it can show).
create or replace function ad_weekly_opportunities(p ad_placement, sec text) returns numeric
language sql stable security definer set search_path = public as $$
  select (count(*)::numeric / 4) from app_events e
  where e.day > (now() at time zone 'America/Los_Angeles')::date - 28
    and case
      when p = 'sponsor_intro' then e.name = 'app_open' and coalesce((e.props->>'stopped')::boolean, false)
      when p = 'banner_dashboard' or (p = 'presented_by' and sec = 'Today') then e.name = 'screen_view' and e.props->>'screen' = 'today'
      when p = 'presented_by' and sec = 'Weather' then e.name = 'weather_view'
      when p = 'presented_by' and sec = 'Catch Map' then e.name = 'catch_map_view' or (e.name = 'layer_on' and e.props->>'layer' = 'catches')
      when p = 'presented_by' and sec = 'SST Map' then e.name = 'layer_on' and e.props->>'layer' = 'sst'
      when p = 'banner_reports' then e.name = 'screen_view' and e.props->>'screen' = 'community_reports'
      when p = 'banner_community' then e.name = 'screen_view' and e.props->>'screen' = 'community_forum'
      else false end;
$$;

-- Share of activity in the chosen areas (1 = all of SoCal).
create or replace function ad_area_share(p_areas text[]) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_areas is null or cardinality(p_areas) = 0 then 1
    else coalesce((select count(*) filter (where area = any(p_areas))::numeric / nullif(count(*), 0)
                   from app_events where day > (now() at time zone 'America/Los_Angeles')::date - 28 and area is not null), 0) end;
$$;

-- Weeks in [start, start+weeks) that are already full for this placement in an overlapping area.
create or replace function ad_full_weeks(p ad_placement, p_sec text, p_areas text[], p_start date, p_weeks int, ignore_order int default null)
returns date[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(w order by w), '{}') from (
    select gs::date w
    from generate_series(p_start, p_start + (p_weeks - 1) * 7, interval '7 days') gs
    where (select count(*) from ad_orders o
           where o.placement = p and o.section = coalesce(p_sec, '') and o.status in ('submitted', 'approved') and not o.paused
             and o.id is distinct from ignore_order
             and o.start_date < gs::date + 7 and o.end_date > gs::date
             and (o.areas is null or p_areas is null or o.areas && p_areas))
          >= coalesce((select max_slots from ad_rates r where r.placement = p and r.section = coalesce(p_sec, '')), 1)
  ) x;
$$;

create or replace function ad_quote(p ad_placement, p_sec text, p_areas text[], p_start date, p_weeks int, ignore_order int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tgt text[] := p_areas; r ad_rates; factor numeric; weekly numeric; disc numeric; list int; opp numeric; share numeric; sharing int; full_w date[];
begin
  select * into r from ad_rates where placement = p and section = coalesce(p_sec, '') and active;
  if r.placement is null then return jsonb_build_object('ok', false, 'error', 'This spot isn''t for sale right now'); end if;
  if p_weeks < 1 or p_weeks > 52 then return jsonb_build_object('ok', false, 'error', 'Pick 1 to 52 weeks'); end if;
  if tgt is not null and cardinality(tgt) = 0 then tgt := null; end if;
  if tgt is not null and not (tgt <@ ad_areas()) then return jsonb_build_object('ok', false, 'error', 'Unknown area'); end if;
  factor := coalesce((select (value #>> '{}')::numeric from app_config where key = 'ad_area_price_factor'), 0.4);
  weekly := case when tgt is null then r.price_cents_week else least(r.price_cents_week, round(r.price_cents_week * factor * cardinality(tgt))) end;
  disc := coalesce((select pct from ad_discounts where min_weeks <= p_weeks order by min_weeks desc limit 1), 0);
  list := (weekly * p_weeks)::int;
  opp := ad_weekly_opportunities(p, coalesce(p_sec, ''));
  share := ad_area_share(tgt);
  select count(*) into sharing from ad_orders o
  where o.placement = p and o.section = coalesce(p_sec, '') and o.status in ('submitted', 'approved') and o.id is distinct from ignore_order
    and o.start_date < p_start + p_weeks * 7 and o.end_date > p_start and (o.areas is null or tgt is null or o.areas && tgt);
  full_w := ad_full_weeks(p, p_sec, tgt, p_start, p_weeks, ignore_order);
  return jsonb_build_object(
    'ok', true, 'weekly_cents', weekly, 'list_cents', list, 'discount_pct', disc,
    'price_cents', round(list * (100 - disc) / 100)::int,
    'max_slots', r.max_slots, 'sharing_with', sharing,
    'est_impressions', case when opp > 0 then round(opp * share * p_weeks / greatest(1, least(sharing + 1, r.max_slots)))::int end,
    'full_weeks', to_jsonb(full_w), 'available', cardinality(full_w) = 0,
    'description', r.description);
end $$;

-- ===================== advertiser actions =====================
create or replace function create_advertiser(biz_name text, email text default null, phone_no text default null,
                                             site text default null, link_me boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare a int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(trim(biz_name)) < 2 then raise exception 'Business name is required'; end if;
  if not is_admin() and exists (select 1 from advertiser_users where user_id = auth.uid()) then
    raise exception 'You already have a business set up';
  end if;
  insert into advertisers (name, contact_email, phone, website, created_by)
  values (trim(biz_name), nullif(trim(email), ''), nullif(trim(phone_no), ''), nullif(trim(site), ''), auth.uid()) returning id into a;
  if link_me or not is_admin() then
    insert into advertiser_users (advertiser_id, user_id) values (a, auth.uid()) on conflict do nothing;
  end if;
  return a;
end $$;

-- First sign-in: if you already set up a business with this person's email (and nobody else manages it), link them to it.
create or replace function claim_my_advertiser() returns int
language plpgsql security definer set search_path = public as $$
declare a int; e text := my_email();
begin
  if auth.uid() is null or e is null then return null; end if;
  select advertiser_id into a from advertiser_users where user_id = auth.uid() limit 1;
  if a is not null then return a; end if;
  select id into a from advertisers adv
  where lower(adv.contact_email) = e and adv.status = 'active'
    and not exists (select 1 from advertiser_users u where u.advertiser_id = adv.id)
  order by created_at limit 1;
  if a is not null then insert into advertiser_users (advertiser_id, user_id) values (a, auth.uid()); end if;
  return a;
end $$;

-- Give someone who has signed in to the Studio access to a business (owner only).
create or replace function owner_link_advertiser_login(adv int, login_email text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  select id into u from auth.users where lower(email) = lower(trim(login_email));
  if u is null then raise exception 'No account with that email yet — ask them to sign in to the Ad Studio once, then try again'; end if;
  insert into advertiser_users (advertiser_id, user_id, role) values (adv, u, 'member') on conflict do nothing;
end $$;

create or replace function owner_advertiser_logins(adv int) returns table (email text, role text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select u.email::text, au.role, au.created_at from advertiser_users au join auth.users u on u.id = au.user_id
  where au.advertiser_id = adv and is_admin() order by au.created_at;
$$;

create or replace function owner_unlink_advertiser_login(adv int, login_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  delete from advertiser_users au using auth.users u where au.user_id = u.id and au.advertiser_id = adv and lower(u.email) = lower(trim(login_email));
end $$;

-- Save (create or edit) a draft. Prices are always recomputed here — never trusted from the browser.
create or replace function save_ad_order(ord int, adv int, p ad_placement, sec text, target_areas text[], start date, wks int,
                                         creative uuid, note text default null, ctx_tags text[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare o ad_orders; q jsonb; id_out int;
begin
  if not (is_advertiser_member(adv) or is_admin()) then raise exception 'Not your business'; end if;
  if (select status from advertisers where id = adv) = 'blocked' then raise exception 'This account can''t book ads — contact us'; end if;
  if start < (now() at time zone 'America/Los_Angeles')::date then raise exception 'Start date can''t be in the past'; end if;
  if creative is not null and not exists (select 1 from ad_creatives c where c.id = creative and c.advertiser_id = adv) then
    raise exception 'That ad design belongs to another business';
  end if;
  q := ad_quote(p, sec, target_areas, start, wks, ord);
  if not (q->>'ok')::boolean then raise exception '%', q->>'error'; end if;
  if ord is null then
    insert into ad_orders (advertiser_id, placement, section, areas, tags, start_date, weeks, creative_id, list_cents, discount_pct, price_cents, advertiser_note)
    values (adv, p, coalesce(sec, ''), nullif(target_areas, '{}'), coalesce(ctx_tags, '{}'), start, wks, creative,
            (q->>'list_cents')::int, (q->>'discount_pct')::numeric, (q->>'price_cents')::int, nullif(trim(note), ''))
    returning id into id_out;
  else
    select * into o from ad_orders where id = ord and advertiser_id = adv;
    if o.id is null then raise exception 'Order not found'; end if;
    if o.status not in ('draft', 'changes_requested') and not is_admin() then raise exception 'This ad is already submitted — message us to change it'; end if;
    update ad_orders set placement = p, section = coalesce(sec, ''), areas = nullif(target_areas, '{}'), tags = coalesce(ctx_tags, '{}'),
      start_date = start, weeks = wks, creative_id = creative, list_cents = (q->>'list_cents')::int, discount_pct = (q->>'discount_pct')::numeric,
      price_cents = (q->>'price_cents')::int, advertiser_note = coalesce(nullif(trim(note), ''), advertiser_note), updated_at = now()
    where id = ord returning id into id_out;
  end if;
  return id_out;
end $$;

create or replace function submit_ad_order(ord int, note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o ad_orders; q jsonb; adv_name text;
begin
  select * into o from ad_orders where id = ord;
  if o.id is null or not (is_advertiser_member(o.advertiser_id) or is_admin()) then raise exception 'Order not found'; end if;
  if o.status not in ('draft', 'changes_requested') then raise exception 'Already submitted'; end if;
  if o.creative_id is null then raise exception 'Add your ad design first'; end if;
  q := ad_quote(o.placement, o.section, o.areas, o.start_date, o.weeks, o.id);
  if not (q->>'available')::boolean then raise exception 'Some of those weeks just sold out — pick other dates'; end if;
  update ad_orders set status = 'submitted', submitted_at = now(), updated_at = now(),
    advertiser_note = coalesce(nullif(trim(note), ''), advertiser_note) where id = ord;
  if nullif(trim(note), '') is not null then
    insert into ad_messages (order_id, body, from_owner) values (ord, trim(note), false);
  end if;
  select name into adv_name from advertisers where id = o.advertiser_id;
  perform send_push(array(select id from profiles where is_admin), 'New ad to review',
                    adv_name || ' submitted an ad (' || replace(o.placement::text, '_', ' ') || ', ' || o.weeks || ' wk). Open the Ad Studio.',
                    jsonb_build_object('type', 'ad_review', 'order_id', ord));
end $$;

create or replace function cancel_ad_order(ord int) returns void
language plpgsql security definer set search_path = public as $$
declare o ad_orders;
begin
  select * into o from ad_orders where id = ord;
  if o.id is null or not (is_advertiser_member(o.advertiser_id) or is_admin()) then raise exception 'Order not found'; end if;
  if o.status = 'approved' and o.payment_status = 'paid' and not is_admin() then
    raise exception 'This ad is paid — message us to cancel or change it';
  end if;
  update ad_orders set status = 'cancelled', updated_at = now() where id = ord;
  perform sync_ad_campaign(ord);
end $$;

-- ===================== going live =====================
-- Creates or refreshes the campaign the app reads. Live = approved AND (paid / comped / "run before payment") AND not paused.
create or replace function sync_ad_campaign(ord int) returns void
language plpgsql security definer set search_path = public as $$
declare o ad_orders; c ad_creatives; adv advertisers; live boolean; cid int;
begin
  select * into o from ad_orders where id = ord;
  if o.id is null then return; end if;
  select * into c from ad_creatives where id = o.creative_id;
  select * into adv from advertisers where id = o.advertiser_id;
  live := o.status = 'approved' and not o.paused and adv.status = 'active'
          and (o.payment_status in ('paid', 'comped') or o.run_unpaid) and c.id is not null;
  if o.status <> 'approved' and o.campaign_id is null then return; end if;
  insert into ad_campaigns (advertiser_id, name, placement, presented_by_section, creative_url, click_url, headline,
                            context_tags, region, areas, starts_at, ends_at, active, order_id, creative)
  values (o.advertiser_id, adv.name || ' · #' || o.id, o.placement, nullif(o.section, ''),
          coalesce(c.media_url, c.poster_url, c.logo_url, adv.logo_url),
          case when c.action_type = 'website' then c.action_value end, coalesce(c.headline, adv.name),
          o.tags, 'socal', o.areas,
          (o.start_date::timestamp at time zone 'America/Los_Angeles'), (o.end_date::timestamp at time zone 'America/Los_Angeles'),
          live, o.id, to_jsonb(c) - 'created_by' - 'advertiser_id' || jsonb_build_object('advertiser_logo', adv.logo_url))
  on conflict (order_id) where order_id is not null do update set
    name = excluded.name, placement = excluded.placement, presented_by_section = excluded.presented_by_section,
    creative_url = excluded.creative_url, click_url = excluded.click_url, headline = excluded.headline,
    context_tags = excluded.context_tags, areas = excluded.areas, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    active = excluded.active, creative = excluded.creative
  returning id into cid;
  update ad_orders set campaign_id = cid where id = ord and campaign_id is distinct from cid;
end $$;

-- ===================== your decisions =====================
-- decision: 'approve' | 'changes' | 'reject'. Optional: change the price, dates or weeks while approving.
create or replace function owner_review_order(ord int, decision text, note text default null,
                                              new_price_cents int default null, new_start date default null, new_weeks int default null)
returns void language plpgsql security definer set search_path = public as $$
declare o ad_orders; msg text; push_title text;
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  select * into o from ad_orders where id = ord;
  if o.id is null then raise exception 'Order not found'; end if;
  if decision not in ('approve', 'changes', 'reject') then raise exception 'Unknown decision'; end if;
  update ad_orders set
    status = case decision when 'approve' then 'approved' when 'changes' then 'changes_requested' else 'rejected' end,
    review_note = nullif(trim(note), ''), reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now(),
    price_cents = coalesce(new_price_cents, price_cents),
    start_date = coalesce(new_start, start_date), weeks = coalesce(new_weeks, weeks)
  where id = ord;
  msg := case decision when 'approve' then 'Approved! ' when 'changes' then 'Please make a few changes: ' else 'Not approved: ' end
         || coalesce(nullif(trim(note), ''), case decision when 'approve' then 'Your ad is scheduled.' else '' end);
  insert into ad_messages (order_id, body, from_owner) values (ord, msg, true);
  perform sync_ad_campaign(ord);
  -- Advertisers who also use the app get a push.
  perform send_push(array(select user_id from advertiser_users where advertiser_id = o.advertiser_id),
                    case decision when 'approve' then 'Your ad was approved' when 'changes' then 'Changes requested on your ad' else 'Your ad was not approved' end,
                    left(msg, 140), jsonb_build_object('type', 'ad_status', 'order_id', ord));
end $$;

-- status: 'paid' | 'comped' | 'refunded' | 'unpaid'
create or replace function owner_set_payment(ord int, pay_status text, method text default null, note text default null,
                                             amount_cents int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  if pay_status not in ('paid', 'comped', 'refunded', 'unpaid') then raise exception 'Unknown payment status'; end if;
  update ad_orders set payment_status = pay_status, payment_method = coalesce(nullif(trim(method), ''), payment_method),
    payment_note = coalesce(nullif(trim(note), ''), payment_note), price_cents = coalesce(amount_cents, price_cents),
    paid_at = case when pay_status = 'paid' then coalesce(paid_at, now()) when pay_status = 'unpaid' then null else paid_at end,
    updated_at = now()
  where id = ord;
  if not found then raise exception 'Order not found'; end if;
  perform sync_ad_campaign(ord);
end $$;

create or replace function owner_set_flags(ord int, run_before_payment boolean default null, pause boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  update ad_orders set run_unpaid = coalesce(run_before_payment, run_unpaid), paused = coalesce(pause, paused), updated_at = now()
  where id = ord;
  if not found then raise exception 'Order not found'; end if;
  perform sync_ad_campaign(ord);
end $$;

-- Called by the API after Stripe confirms a payment (server connection, so no auth.uid()).
create or replace function stripe_mark_paid(ord int, session_id text, amount_cents int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update ad_orders set payment_status = 'paid', payment_method = 'stripe', paid_at = coalesce(paid_at, now()),
    payment_note = 'Stripe ' || session_id || ' · $' || to_char(amount_cents / 100.0, 'FM999999990.00'), updated_at = now()
  where id = ord and stripe_session_id = session_id and payment_status <> 'paid';
  if not found then return false; end if;
  perform sync_ad_campaign(ord);
  perform send_push(array(select id from profiles where is_admin), 'Ad payment received',
                    'Order #' || ord || ' paid $' || to_char(amount_cents / 100.0, 'FM999999990.00') || ' by card.',
                    jsonb_build_object('type', 'ad_paid', 'order_id', ord));
  return true;
end $$;

-- ===================== reports =====================
create or replace function ad_order_report(ord int, days int default 365) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o ad_orders; cid int;
begin
  select * into o from ad_orders where id = ord;
  if o.id is null or not (is_advertiser_member(o.advertiser_id) or is_admin()) then raise exception 'Order not found'; end if;
  cid := o.campaign_id;
  return jsonb_build_object(
    'order_id', o.id, 'campaign_id', cid,
    'totals', (select jsonb_build_object(
        'impressions', count(*) filter (where event = 'impression'),
        'clicks', count(*) filter (where event = 'click'),
        'calls', count(*) filter (where event = 'call'),
        'directions', count(*) filter (where event = 'directions'),
        'coupon_opens', count(*) filter (where event = 'coupon_open'),
        'coupon_saves', count(*) filter (where event = 'coupon_save'),
        'video_starts', count(*) filter (where event = 'video_start'),
        'video_completes', count(*) filter (where event = 'video_complete'),
        'reach', (select count(*) from (select distinct (at at time zone 'America/Los_Angeles')::date, device_day_hash
                                         from ad_events where campaign_id = cid and event = 'impression') r))
      from ad_events where campaign_id = cid),
    'daily', (select coalesce(jsonb_agg(x order by x.d), '[]'::jsonb) from (
        select (at at time zone 'America/Los_Angeles')::date d,
               count(*) filter (where event = 'impression') imp,
               count(*) filter (where event <> 'impression' and event not like 'video_%') act,
               count(distinct device_day_hash) filter (where event = 'impression') reach
        from ad_events where campaign_id = cid and at > now() - make_interval(days => days) group by 1) x),
    'areas', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(area, 'Unknown') k, count(*) n from ad_events where campaign_id = cid and event = 'impression' group by 1) x),
    'screens', (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select coalesce(nullif(context, ''), placement::text) k, count(*) n from ad_events where campaign_id = cid and event = 'impression' group by 1) x)
  );
end $$;

-- Your dashboard numbers.
create or replace function owner_ad_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if not is_admin() then raise exception 'Owner only'; end if;
  return jsonb_build_object(
    'to_review', (select count(*) from ad_orders where status = 'submitted'),
    'live_now', (select count(*) from ad_campaigns where active and now() between starts_at and ends_at),
    'starting_7d', (select count(*) from ad_orders where status = 'approved' and start_date between today and today + 7),
    'unpaid_cents', (select coalesce(sum(price_cents), 0) from ad_orders where status = 'approved' and payment_status = 'unpaid'),
    'paid_month_cents', (select coalesce(sum(price_cents), 0) from ad_orders where payment_status = 'paid' and paid_at >= date_trunc('month', now())),
    'paid_total_cents', (select coalesce(sum(price_cents), 0) from ad_orders where payment_status = 'paid'),
    'booked_future_cents', (select coalesce(sum(price_cents), 0) from ad_orders where status = 'approved' and end_date > today),
    'monthly', (select coalesce(jsonb_agg(x order by x.m), '[]'::jsonb) from (
        select to_char(date_trunc('month', paid_at at time zone 'America/Los_Angeles'), 'YYYY-MM') m, sum(price_cents) cents
        from ad_orders where payment_status = 'paid' and paid_at > now() - interval '12 months' group by 1) x),
    'impressions_30d', (select count(*) from ad_events where event = 'impression' and at > now() - interval '30 days'),
    'actions_30d', (select count(*) from ad_events where event <> 'impression' and at > now() - interval '30 days'),
    'advertisers', (select count(*) from advertisers)
  );
end $$;

-- Booking calendar: for each placement and week, how many slots are taken.
create or replace function owner_ad_calendar(p_from date, p_weeks int default 12)
returns table (placement text, section text, week_start date, booked int, max_slots int, orders jsonb)
language sql stable security definer set search_path = public as $$
  select r.placement::text, r.section, w::date, count(o.id)::int, r.max_slots,
         coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'advertiser', a.name, 'status', o.status, 'paid', o.payment_status, 'areas', o.areas))
                  filter (where o.id is not null), '[]'::jsonb)
  from ad_rates r
  cross join generate_series(p_from, p_from + (least(greatest(p_weeks, 1), 52) - 1) * 7, interval '7 days') w
  left join ad_orders o on o.placement = r.placement and o.section = r.section and o.status in ('submitted', 'approved')
       and o.start_date < w::date + 7 and o.end_date > w::date
  left join advertisers a on a.id = o.advertiser_id
  where is_admin()
  group by r.placement, r.section, w, r.max_slots
  order by r.placement, r.section, w;
$$;

-- ===================== row-level security =====================
alter table advertiser_users enable row level security;
alter table advertiser_notes enable row level security;
alter table ad_rates enable row level security;
alter table ad_discounts enable row level security;
alter table ad_creatives enable row level security;
alter table ad_orders enable row level security;
alter table ad_messages enable row level security;

do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('advertiser_notes', 'advertiser_users', 'ad_rates', 'ad_discounts', 'ad_creatives', 'ad_orders', 'ad_messages', 'advertisers')
    and policyname like 'studio:%' loop
    execute format('drop policy %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "studio: owner notes" on advertiser_notes for all using (is_admin()) with check (is_admin());
create policy "studio: see my business" on advertisers for select using (is_advertiser_member(id));
create policy "studio: edit my business" on advertisers for update using (is_advertiser_member(id)) with check (is_advertiser_member(id) and status = 'active');
create policy "studio: my memberships" on advertiser_users for select using (user_id = auth.uid() or is_admin());
create policy "studio: owner manages memberships" on advertiser_users for all using (is_admin()) with check (is_admin());
create policy "studio: prices are public to signed-in users" on ad_rates for select using (auth.uid() is not null);
create policy "studio: owner edits prices" on ad_rates for all using (is_admin()) with check (is_admin());
create policy "studio: discounts are public" on ad_discounts for select using (auth.uid() is not null);
create policy "studio: owner edits discounts" on ad_discounts for all using (is_admin()) with check (is_admin());
create policy "studio: see my designs" on ad_creatives for select using (is_advertiser_member(advertiser_id) or is_admin());
create policy "studio: add designs" on ad_creatives for insert with check (is_advertiser_member(advertiser_id) or is_admin());
create policy "studio: delete unused designs" on ad_creatives for delete using (
  (is_advertiser_member(advertiser_id) or is_admin())
  and not exists (select 1 from ad_orders o where o.creative_id = ad_creatives.id and o.status in ('submitted', 'approved')));
create policy "studio: see my orders" on ad_orders for select using (is_advertiser_member(advertiser_id) or is_admin());
create policy "studio: delete my drafts" on ad_orders for delete using (status = 'draft' and (is_advertiser_member(advertiser_id) or is_admin()));
-- (all other order changes go through the functions above)
create policy "studio: read messages" on ad_messages for select using (
  is_admin() or exists (select 1 from ad_orders o where o.id = order_id and is_advertiser_member(o.advertiser_id)));
create policy "studio: write messages" on ad_messages for insert with check (
  author = auth.uid() and from_owner = is_admin()
  and (is_admin() or exists (select 1 from ad_orders o where o.id = order_id and is_advertiser_member(o.advertiser_id))));

-- Tell you when an advertiser writes.
create or replace function ad_messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.from_owner then
    perform send_push(array(select id from profiles where is_admin), 'Advertiser message',
      (select a.name from ad_orders o join advertisers a on a.id = o.advertiser_id where o.id = new.order_id) || ': ' || left(new.body, 120),
      jsonb_build_object('type', 'ad_message', 'order_id', new.order_id));
  end if;
  return null;
end $$;
drop trigger if exists ad_messages_push on ad_messages;
create trigger ad_messages_push after insert on ad_messages for each row execute function ad_messages_push();

-- ===================== file storage for ad media (public, so the app can show it) =====================
do $$ begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('ad-media', 'ad-media', true, 52428800) on conflict (id) do nothing;   -- 50 MB per file
exception when undefined_table or undefined_column then raise notice 'storage schema not available here — create the "ad-media" public bucket in the dashboard';
end $$;
do $$ begin
  drop policy if exists "studio: upload ad media" on storage.objects;
  drop policy if exists "studio: replace ad media" on storage.objects;
  drop policy if exists "studio: delete ad media" on storage.objects;
  create policy "studio: upload ad media" on storage.objects for insert
    with check (bucket_id = 'ad-media' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
  create policy "studio: replace ad media" on storage.objects for update
    using (bucket_id = 'ad-media' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
  create policy "studio: delete ad media" on storage.objects for delete
    using (bucket_id = 'ad-media' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
exception when undefined_table or invalid_schema_name or undefined_function then raise notice 'storage policies skipped (no storage schema here)';
end $$;

-- Internal helpers aren't for direct calls from the app.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'public'] loop
    if r = 'public' or exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function sync_ad_campaign(int) from %s', r);
      execute format('revoke all on function stripe_mark_paid(int, text, int) from %s', r);
    end if;
  end loop;
end $$;
