-- 013 (Oct 27): spotter-plane alerts + the Pro switch for spotter planes.
-- Run once: Supabase → SQL Editor → New query → paste all of this → Run.

-- 1) A new alert type: "spotter" (a plane circling low over the water inside your area).
alter table alert_subscriptions drop constraint if exists alert_subscriptions_kind_check;
alter table alert_subscriptions add constraint alert_subscriptions_kind_check
  check (kind in ('species', 'activity', 'sst', 'weather', 'spotter'));

-- 2) The Pro switch (Admin → Settings → App switches). Off = spotter planes free for everyone (now).
--    On = circling / spotter highlights and spotter alerts only for Pro members.
insert into app_config (key, value, description) values
  ('spotter_premium', 'false', 'Spotter planes need Pro (circling highlights, loops, spotter alerts). Off = free for everyone')
on conflict (key) do nothing;

-- 3) Pro members live in the existing `subscriptions` table (tier 'pro', status 'active', not expired).
--    Let the admin grant / remove Pro by hand (friends, testers) until in-app purchases are switched on.
drop policy if exists "admin manages subscriptions" on subscriptions;
create policy "admin manages subscriptions" on subscriptions for all using (is_admin()) with check (is_admin());

create or replace function is_pro(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subscriptions s where s.user_id = uid and s.tier = 'pro' and s.status = 'active'
                 and (s.expires_at is null or s.expires_at > now()));
$$;
