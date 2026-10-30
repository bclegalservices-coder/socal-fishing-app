-- 014 (Oct 28): San Clemente Island closure alerts + the status the admin sets.
-- Run once: Supabase → SQL Editor → New query → paste all of this → Run.

-- 1) A new alert type: "sci" (the Navy closes / reopens San Clemente Island sections).
alter table alert_subscriptions drop constraint if exists alert_subscriptions_kind_check;
alter table alert_subscriptions add constraint alert_subscriptions_kind_check
  check (kind in ('species', 'activity', 'sst', 'weather', 'spotter', 'sci'));

-- 2) What's closed right now (Admin → San Clemente). Everyone can read it (the app shows it on the map);
--    only the admin can change it (existing app_config policies).
insert into app_config (key, value, description) values
  ('sci_closures', '{"sections": {}, "note": null, "updated_at": null}', 'San Clemente Island sections closed by the Navy — set in Admin → San Clemente')
on conflict (key) do nothing;
