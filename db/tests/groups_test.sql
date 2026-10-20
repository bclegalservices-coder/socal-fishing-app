-- Scenario test for fishing groups (002 + 008). Runs as a normal role so row-level security is enforced.
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''
\set D '''dddddddd-0000-0000-0000-000000000004'''
insert into auth.users values (:A, 'captain@example.com'), (:B, 'buddy@example.com'), (:C, 'new.guy@example.com'), (:D, 'stranger@example.com');
insert into profiles values (:A, 'Chris'), (:B, 'Mike'), (:C, 'Sam'), (:D, 'Dave');
insert into push_tokens values ('tokA', :A), ('tokB', :B), ('tokC', :C), ('tokD', :D);
create temp table ctx (k text primary key, v text);
grant all on ctx to app_user;
set role app_user;

-- 1. A creates a group, B joins with the code
select set_config('test.uid', :A, false);
insert into ctx select 'g', id::text from create_group('Reel Crew', 'Reel Therapy');
insert into ctx select 'code', invite_code from fishing_groups;
select set_config('test.uid', :B, false);
select join_group((select v from ctx where k = 'code'), 'Salty Dog');

-- 2. A invites by email: one new, one bad, one already in
select set_config('test.uid', :A, false);
do $$ declare r record; n int := 0; begin
  for r in select * from invite_to_group((select v::uuid from ctx where k = 'g'), array['New.Guy@Example.com ', 'not-an-email', 'buddy@example.com']) loop
    n := n + 1;
    if r.address = 'new.guy@example.com' then assert r.result = 'invited', r.result; end if;
    if r.address = 'not-an-email' then assert r.result = 'invalid'; end if;
    if r.address = 'buddy@example.com' then assert r.result = 'already_member', r.result; end if;
  end loop;
  assert n = 3;
end $$;
reset role;
do $$ begin assert (select count(*) from net.sent where body::text like '%tokC%' and body::text like '%Reel Crew%') = 1, 'invite push to C'; end $$;
set role app_user;

-- 3. C sees the invite after signing in, accepts; D sees nothing
select set_config('test.uid', :D, false);
do $$ begin assert (select count(*) from my_invites()) = 0; end $$;
select set_config('test.uid', :C, false);
do $$ declare inv record; begin
  select * into inv from my_invites();
  assert inv.group_name = 'Reel Crew' and inv.invited_by = 'Reel Therapy', inv::text;
  perform respond_invite(inv.id, true, 'Sam''s Skiff');
  assert (select count(*) from my_invites()) = 0;
end $$;

-- 4. Positions: live, then last known, then gone when the member turns "last known" off
select set_config('test.uid', :A, false);
update group_members set sharing_until = now() + interval '4 hours' where user_id = auth.uid();
insert into live_positions (user_id, geom, sog_kt) values (auth.uid(), 'SRID=4326;POINT(-118.3 33.4)', 7.5);
select set_config('test.uid', :B, false);
do $$ declare r record; begin
  select * into r from buddy_positions();
  assert r.status = 'live' and r.lat = 33.4 and r.boat_name = 'Reel Therapy', r::text;
end $$;
select set_config('test.uid', :A, false);
update group_members set sharing_until = now() where user_id = auth.uid();       -- "Stop sharing"
select set_config('test.uid', :B, false);
do $$ begin assert (select status from buddy_positions()) = 'last_known'; end $$;
select set_config('test.uid', :A, false);
select set_group_prefs((select v::uuid from ctx where k = 'g'), null, false);    -- don't show my last known
select set_config('test.uid', :B, false);
do $$ begin assert (select count(*) from buddy_positions()) = 0; end $$;
select set_config('test.uid', :D, false);
do $$ begin assert (select count(*) from live_positions) = 0, 'stranger sees no positions'; end $$;

-- 5. "Come to me": push to B and C; a second ping within a minute is refused
select set_config('test.uid', :A, false);
reset role; truncate net.sent; set role app_user;
insert into group_shares (group_id, kind, lat, lon, body) values ((select v::uuid from ctx where k = 'g'), 'ping', 33.41, -118.31, 'Wide open on yellows');
reset role;
do $$ declare b text; begin
  select body::text into b from net.sent;
  assert b like '%tokB%' and b like '%tokC%' and b not like '%tokA%', b;
  assert b like '%Come to me%' and b like '%33.41%', b;
end $$;
set role app_user;
do $$ begin
  begin
    insert into group_shares (group_id, kind, lat, lon) values ((select v::uuid from ctx where k = 'g'), 'ping', 33.41, -118.31);
    assert false, 'second ping should be refused';
  exception when raise_exception then null; end;
end $$;
-- a ping without coordinates is refused by the table
do $$ begin
  begin
    insert into group_shares (group_id, kind, payload) values ((select v::uuid from ctx where k = 'g'), 'spot', '{"name": "x"}');
    assert false, 'a spot needs lat/lon';
  exception when check_violation then null; end;
end $$;

-- 6. Muted member gets no push; a stranger can't read or post
select set_config('test.uid', :B, false);
select set_group_prefs((select v::uuid from ctx where k = 'g'), false);
reset role; truncate net.sent; set role app_user;
select set_config('test.uid', :C, false);
insert into group_shares (group_id, kind, body) values ((select v::uuid from ctx where k = 'g'), 'message', 'Bait receiver at the pier has sardines');
reset role;
do $$ declare b text; begin select body::text into b from net.sent; assert b like '%tokA%' and b not like '%tokB%', b; end $$;
set role app_user;
select set_config('test.uid', :D, false);
do $$ begin
  assert (select count(*) from group_shares) = 0, 'stranger reads nothing';
  begin
    insert into group_shares (group_id, kind, body) values ((select v::uuid from ctx where k = 'g'), 'message', 'spam');
    assert false, 'stranger cannot post';
  exception when insufficient_privilege then null; end;
  begin
    perform group_feed((select v::uuid from ctx where k = 'g'));
  end;
  assert (select count(*) from group_feed((select v::uuid from ctx where k = 'g'))) = 0;
  assert (select count(*) from group_pins()) = 0;
end $$;
-- members can't fake system rows
select set_config('test.uid', :B, false);
do $$ begin
  begin
    insert into group_shares (group_id, kind, body) values ((select v::uuid from ctx where k = 'g'), 'overdue', 'fake');
    assert false, 'members cannot post overdue';
  exception when insufficient_privilege then null; end;
end $$;

-- 7. Share a catch (exact spot) with the group
select set_config('test.uid', :A, false);
insert into catch_reports (species_id, true_geom, quantity, weight_lb, bait) values (1, 'SRID=4326;POINT(-118.32 33.42)', 3, 22, 'sardine');
do $$ declare n int; begin
  n := share_catch((select id from catch_reports limit 1), array[(select v::uuid from ctx where k = 'g')]);
  assert n = 1;
  n := share_catch((select id from catch_reports limit 1), array[(select v::uuid from ctx where k = 'g')]);
  assert n = 0, 'no duplicate share';
end $$;
select set_config('test.uid', :B, false);
do $$ declare r record; begin
  select * into r from group_feed((select v::uuid from ctx where k = 'g')) where kind = 'catch';
  assert r.lat = 33.42 and r.payload->>'species' = 'Yellowtail' and r.who = 'Reel Therapy' and not r.mine, r::text;
  assert (select count(*) from group_pins() where kind in ('ping', 'catch')) = 2;
  -- B can't share A's catch
  begin perform share_catch((select id from catch_reports limit 1), array[(select v::uuid from ctx where k = 'g')]); assert false;
  exception when raise_exception then null; end;
end $$;

-- 8. Float plan: out → overdue alert once → back
select set_config('test.uid', :C, false);
select start_float_plan(array[(select v::uuid from ctx where k = 'g')], now() + interval '2 hours', 'Catalina, back to Long Beach');
do $$ begin assert (my_float_plan()->>'note') = 'Catalina, back to Long Beach'; end $$;
insert into live_positions (user_id, geom) values (auth.uid(), 'SRID=4326;POINT(-118.4 33.35)');
select set_config('test.uid', :A, false);
do $$ declare r record; begin
  select * into r from group_float_plans((select v::uuid from ctx where k = 'g'));
  assert r.who = 'Sam''s Skiff' and not r.overdue, r::text;
  assert (select count(*) from buddy_positions() where status = 'live') = 1, 'float plan turns sharing on';
end $$;
reset role;
update float_plans set back_by = now() - interval '45 minutes';
truncate net.sent;
do $$ begin
  assert check_overdue() = 1;
  assert check_overdue() = 0, 'only once';
  assert (select count(*) from group_shares where kind = 'overdue') = 1;
  assert (select body::text from net.sent where body::text like '%is overdue%') like '%33.35%', 'overdue push has last position';
  assert (select count(*) from net.sent where body::text like '%Are you OK%' and body::text like '%tokC%') = 1;
end $$;
set role app_user;
select set_config('test.uid', :C, false);
select float_checkin('back');
do $$ begin assert my_float_plan() is null; end $$;

-- 9. Group screen data: statuses, masked invite emails, owner flag
select set_config('test.uid', :A, false);
select invite_to_group((select v::uuid from ctx where k = 'g'), array['joe.smith@gmail.com']);
select set_config('test.uid', :B, false);
do $$ declare d jsonb; begin
  d := group_detail((select v::uuid from ctx where k = 'g'));
  assert jsonb_array_length(d->'members') = 3, d::text;
  assert not (d->>'is_owner')::boolean;
  assert d->'invites'->0->>'email' = 'j•••@gmail.com', d->'invites'::text;
  assert (select count(*) from jsonb_array_elements(d->'members') m where m->>'label' = 'Sam''s Skiff' and m->>'status' = 'last_known') = 1, d::text;
  assert (select count(*) from jsonb_array_elements(d->'members') m where m->>'notify' is not null) = 1, 'only my own settings are visible';
end $$;
-- non-member can't see the group
select set_config('test.uid', :D, false);
do $$ begin
  begin perform group_detail((select v::uuid from ctx where k = 'g')); assert false; exception when raise_exception then null; end;
end $$;
-- B (not the inviter or owner) can't withdraw A's invite; A can
select set_config('test.uid', :B, false);
do $$ begin
  begin perform revoke_invite((select id from group_invites where email = 'joe.smith@gmail.com')); assert false;
  exception when raise_exception then null; end;
end $$;
select set_config('test.uid', :A, false);
select revoke_invite((select id from group_invites where email = 'joe.smith@gmail.com'));

-- 10. Delete my account (App Store requirement): everything tied to the user goes, others are untouched
select set_config('test.uid', :C, false);
select delete_my_account();
reset role;
do $$ begin
  assert (select count(*) from auth.users where id = 'cccccccc-0000-0000-0000-000000000003') = 0;
  assert (select count(*) from group_members where user_id = 'cccccccc-0000-0000-0000-000000000003') = 0;
  assert (select count(*) from live_positions where user_id = 'cccccccc-0000-0000-0000-000000000003') = 0;
  assert (select count(*) from float_plans where user_id = 'cccccccc-0000-0000-0000-000000000003') = 0;
  assert (select count(*) from group_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1, 'other users untouched';
end $$;
set role app_user;
select set_config('test.uid', '', false);
do $$ begin begin perform delete_my_account(); assert false; exception when raise_exception then null; end; end $$;

\echo ALL GROUP TESTS PASSED
