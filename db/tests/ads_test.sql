-- Scenario test for the Ad Studio (009). Runs as a normal role so row-level security is enforced.
\set OWNER '''00000000-0000-0000-0000-0000000000aa'''
\set SHOP  '''00000000-0000-0000-0000-0000000000bb'''
\set OTHER '''00000000-0000-0000-0000-0000000000cc'''
insert into auth.users values (:OWNER, 'me@example.com'), (:SHOP, 'shop@example.com'), (:OTHER, 'other@example.com');
insert into profiles (id, display_name, is_admin) values (:OWNER, 'Chris', true), (:SHOP, 'Bait Shop Bob', false), (:OTHER, 'Tackle Tim', false);
insert into push_tokens values ('tokOwner', :OWNER), ('tokShop', :SHOP);
-- some app activity so reach estimates work: 400 Weather views over 4 weeks, 3/4 in Orange County
insert into app_events (name, props, area, day)
select 'weather_view', '{}', case when g % 4 = 0 then 'San Diego' else 'Orange County' end, current_date - (g % 20)
from generate_series(1, 400) g;
create temp table ctx (k text primary key, v text);
grant all on ctx to app_user;
set role app_user;

-- 1. A shop signs up and adds a design
select set_config('test.uid', :SHOP, false);
insert into ctx select 'A', create_advertiser('Bob''s Bait & Tackle', 'shop@example.com', '(949) 555-0101', 'https://bobsbait.example')::text;
do $$ begin
  begin perform create_advertiser('Second Biz'); assert false, 'only one business per login'; exception when raise_exception then null; end;
end $$;
insert into ad_creatives (advertiser_id, kind, media_url, width, height, action_type, action_value, headline)
values ((select v::int from ctx where k = 'A'), 'image', 'https://cdn.example/a.png', 1200, 375, 'website', 'https://bobsbait.example', 'Live squid in stock');
insert into ctx select 'C', id::text from ad_creatives;
-- bad actions are refused by the database
do $$ begin
  begin
    insert into ad_creatives (advertiser_id, kind, media_url, action_type, action_value) values ((select v::int from ctx where k = 'A'), 'image', 'https://x/a.png', 'website', 'javascript:alert(1)');
    assert false, 'website must be http(s)';
  exception when check_violation then null; end;
  begin
    insert into ad_creatives (advertiser_id, kind, media_url, action_type, action_value) values ((select v::int from ctx where k = 'A'), 'image', 'http://x/a.png', 'none', null);
    assert false, 'media must be https';
  exception when check_violation then null; end;
  begin
    insert into ad_creatives (advertiser_id, kind, headline, action_type, action_value) values ((select v::int from ctx where k = 'A'), 'native', 'Hi', 'call', 'call me');
    assert false, 'phone must look like a phone';
  exception when check_violation then null; end;
end $$;

-- 2. Quotes: all SoCal vs one area, long-booking discount, reach estimate
do $$ declare q jsonb; begin
  q := ad_quote('banner_dashboard', '', null, current_date + 7, 4);
  assert (q->>'weekly_cents')::int = 2500 and (q->>'list_cents')::int = 10000 and (q->>'price_cents')::int = 9000 and (q->>'discount_pct')::numeric = 10, q::text;
  q := ad_quote('banner_dashboard', '', array['Orange County'], current_date + 7, 1);
  assert (q->>'price_cents')::int = 1000, q::text;
  q := ad_quote('banner_dashboard', '', array['Orange County', 'San Diego', 'Los Angeles'], current_date + 7, 1);
  assert (q->>'price_cents')::int = 2500, 'three areas never cost more than all of SoCal: ' || q::text;
  q := ad_quote('presented_by', 'Weather', array['Orange County'], current_date + 7, 1);
  assert (q->>'est_impressions')::int = 75, q::text;     -- 100 views/week × 75% in Orange County
  q := ad_quote('presented_by', 'Nowhere', null, current_date + 7, 1);
  assert not (q->>'ok')::boolean;
end $$;

-- 3. Book "Weather presented by" (one sponsor per week) and submit
do $$ declare o int; begin
  o := save_ad_order(null, (select v::int from ctx where k = 'A'), 'presented_by', 'Weather', null, current_date + 7, 2, (select v::uuid from ctx where k = 'C'), 'First time advertising!');
  insert into ctx values ('O', o::text);
  assert (select price_cents from ad_orders where id = o) = 8000;
  begin perform save_ad_order(null, (select v::int from ctx where k = 'A'), 'presented_by', 'Weather', null, current_date - 1, 1, null); assert false, 'past start';
  exception when raise_exception then null; end;
  perform submit_ad_order(o, 'Can you make the logo bigger?');
  assert (select status from ad_orders where id = o) = 'submitted';
  begin perform save_ad_order(o, (select v::int from ctx where k = 'A'), 'presented_by', 'Weather', null, current_date + 14, 2, null); assert false, 'locked after submit';
  exception when raise_exception then null; end;
end $$;
reset role;
do $$ begin assert (select count(*) from net.sent where body::text like '%tokOwner%' and body::text like '%New ad to review%') = 1, 'owner pinged'; end $$;
set role app_user;

-- 4. Another shop: can't see Bob's order, and those Weather weeks are sold out
select set_config('test.uid', :OTHER, false);
insert into ctx select 'B', create_advertiser('Tim''s Tackle')::text;
do $$ declare q jsonb; o int; begin
  assert (select count(*) from ad_orders) = 0, 'other advertiser sees nothing';
  assert (select count(*) from ad_creatives) = 0;
  assert (select count(*) from advertisers) = 1;
  q := ad_quote('presented_by', 'Weather', null, current_date + 14, 1);
  assert not (q->>'available')::boolean, q::text;
  begin
    insert into ad_creatives (advertiser_id, kind, media_url) values ((select v::int from ctx where k = 'A'), 'image', 'https://x/y.png');
    assert false, 'cannot add designs to another business';
  exception when insufficient_privilege then null; end;
  begin perform save_ad_order(null, (select v::int from ctx where k = 'A'), 'banner_dashboard', '', null, current_date + 7, 1, null); assert false;
  exception when raise_exception then null; end;
  insert into ad_creatives (advertiser_id, kind, headline, body, cta_label, action_type, action_value)
  values ((select v::int from ctx where k = 'B'), 'native', 'Tim''s Tackle', '10% off jigs this week', 'Get code', 'coupon', 'JIGS10');
  o := save_ad_order(null, (select v::int from ctx where k = 'B'), 'presented_by', 'Weather', null, current_date + 14, 1,
                     (select id from ad_creatives limit 1));
  begin perform submit_ad_order(o); assert false, 'sold-out weeks cannot be submitted'; exception when raise_exception then null; end;
  begin perform ad_order_report((select v::int from ctx where k = 'O')); assert false; exception when raise_exception then null; end;
  begin perform owner_ad_overview(); assert false; exception when raise_exception then null; end;
  begin perform owner_review_order((select v::int from ctx where k = 'O'), 'approve'); assert false; exception when raise_exception then null; end;
end $$;

-- 5. You approve → scheduled but not live until paid → mark paid (Zelle) → live
select set_config('test.uid', :OWNER, false);
do $$ declare o int := (select v::int from ctx where k = 'O'); c ad_campaigns; begin
  assert (owner_ad_overview()->>'to_review')::int = 1;
  perform owner_review_order(o, 'approve', 'Looks great — logo bumped up.', 7000);
  select * into c from ad_campaigns where order_id = o;
  assert c.id is not null and not c.active and c.presented_by_section = 'Weather' and c.creative->>'kind' = 'image', 'scheduled, waiting for payment';
  assert (select price_cents from ad_orders where id = o) = 7000, 'owner changed the price';
  perform owner_set_payment(o, 'paid', 'zelle', 'Zelle 10/18');
  select * into c from ad_campaigns where order_id = o;
  assert c.active and c.click_url = 'https://bobsbait.example', 'paid → live';
  perform owner_set_flags(o, null, true);
  assert not (select active from ad_campaigns where order_id = o), 'paused';
  perform owner_set_flags(o, null, false);
  assert (select active from ad_campaigns where order_id = o);
  assert (select count(*) from owner_ad_calendar(current_date, 4) where placement = 'presented_by' and section = 'Weather' and booked = 1) >= 2;
  assert (owner_ad_overview()->>'paid_total_cents')::int = 7000;
end $$;
-- the shop got a push and a message
reset role;
do $$ begin assert (select count(*) from net.sent where body::text like '%tokShop%' and body::text like '%approved%') = 1; end $$;
set role app_user;

-- 6. Stats flow back to the advertiser
reset role;
insert into ad_events (campaign_id, event, placement, device_day_hash, area)
select (select id from ad_campaigns limit 1), e, 'presented_by', 'dev' || (g % 7), 'Orange County'
from generate_series(1, 30) g, unnest(array['impression', 'impression', 'impression', 'click', 'coupon_save']) e;
do $$ begin
  begin insert into ad_events (campaign_id, event, placement) values ((select id from ad_campaigns limit 1), 'bogus', 'presented_by'); assert false;
  exception when check_violation then null; end;
end $$;
set role app_user;
select set_config('test.uid', :SHOP, false);
do $$ declare r jsonb; begin
  r := ad_order_report((select v::int from ctx where k = 'O'));
  assert (r->'totals'->>'impressions')::int = 90 and (r->'totals'->>'clicks')::int = 30 and (r->'totals'->>'coupon_saves')::int = 30, r::text;
  assert (r->'totals'->>'reach')::int = 7, r::text;
  assert r->'areas'->0->>'k' = 'Orange County';
  -- messages: shop sees the thread and can reply; the other shop can't read it
  assert (select count(*) from ad_messages) = 2, 'note + approval message';
  insert into ad_messages (order_id, body) values ((select v::int from ctx where k = 'O'), 'Thanks! Paid by Zelle.');
  begin insert into ad_messages (order_id, body, from_owner) values ((select v::int from ctx where k = 'O'), 'fake owner', true); assert false;
  exception when insufficient_privilege then null; end;
  -- paid & approved can't be cancelled by the shop
  begin perform cancel_ad_order((select v::int from ctx where k = 'O')); assert false; exception when raise_exception then null; end;
end $$;
select set_config('test.uid', :OTHER, false);
do $$ begin assert (select count(*) from ad_messages) = 0; end $$;

-- 7. Stripe: only the matching checkout session marks it paid (server-side call)
reset role;
do $$ declare o int; begin
  insert into ad_orders (advertiser_id, placement, start_date, weeks, status, stripe_session_id, creative_id)
  values ((select v::int from ctx where k = 'A'), 'banner_dashboard', current_date + 7, 1, 'approved', 'cs_test_123', (select v::uuid from ctx where k = 'C'))
  returning id into o;
  assert not stripe_mark_paid(o, 'cs_wrong', 2500);
  assert stripe_mark_paid(o, 'cs_test_123', 2500);
  assert not stripe_mark_paid(o, 'cs_test_123', 2500), 'only once';
  assert (select active from ad_campaigns where order_id = o);
  assert (select payment_method from ad_orders where id = o) = 'stripe';
end $$;
-- the app can't call the internal helpers directly
set role app_user;
do $$ begin
  begin perform stripe_mark_paid(1, 'x', 1); assert false; exception when insufficient_privilege then null; end;
  begin perform sync_ad_campaign(1); assert false; exception when insufficient_privilege then null; end;
end $$;

-- 7b. An active advertiser edits their details; a sneaky status change is ignored
select set_config('test.uid', :SHOP, false);
update advertisers set name = 'Bob''s Bait', status = 'blocked' where id = (select v::int from ctx where k = 'A');
do $$ begin assert (select name || '/' || status from advertisers where id = (select v::int from ctx where k = 'A')) = 'Bob''s Bait/active'; end $$;

-- 8. Advertisers can't un-block themselves or read your notes; email claiming and owner-granted logins work
reset role;
insert into auth.users values ('00000000-0000-0000-0000-0000000000dd', 'Marina@Example.com');
insert into profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000dd', 'Marina Mike');
set role app_user;
select set_config('test.uid', :OWNER, false);
do $$ declare a int; begin
  a := create_advertiser('Marina Boat Rentals', 'marina@example.com', null, null, false);
  insert into advertiser_notes values (a, 'Pays late — ask for card');
  update advertisers set status = 'blocked' where id = (select v::int from ctx where k = 'B');
  assert (select count(*) from owner_advertiser_logins((select v::int from ctx where k = 'A'))) = 1;
end $$;
select set_config('test.uid', :OTHER, false);
do $$ begin
  begin
    update advertisers set status = 'active' where id = (select v::int from ctx where k = 'B');
    assert false, 'a blocked business cannot change anything';
  exception when insufficient_privilege then null; end;
  assert (select status from advertisers where id = (select v::int from ctx where k = 'B')) = 'blocked', 'cannot unblock yourself';
  assert (select count(*) from advertiser_notes) = 0, 'notes are owner-only';
  begin perform save_ad_order(null, (select v::int from ctx where k = 'B'), 'banner_dashboard', '', null, current_date + 7, 1, null); assert false, 'blocked';
  exception when raise_exception then null; end;
end $$;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000dd', false);
do $$ declare a int; begin
  a := claim_my_advertiser();
  assert a is not null and (select name from advertisers where id = a) = 'Marina Boat Rentals', 'claimed by email';
  assert claim_my_advertiser() = a, 'idempotent';
end $$;
select set_config('test.uid', :SHOP, false);
do $$ begin assert claim_my_advertiser() = (select v::int from ctx where k = 'A'), 'already linked returns own business'; end $$;

\echo ALL AD STUDIO TESTS PASSED
