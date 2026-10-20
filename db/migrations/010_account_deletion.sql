-- 010_account_deletion.sql — "Delete my account" inside the app (required by Apple, App Store guideline 5.1.1(v)).
-- Deletes the signed-in user. Everything tied to the account goes with it (profiles, catches and their public copies,
-- spots, groups they own, memberships, positions, invites, alerts, push tokens, ad logins…) through ON DELETE CASCADE.
-- Photos are removed by the app through the storage API just before this runs.
-- Run ONCE in Supabase SQL Editor after 009. Safe to run again.

create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  -- Businesses this person was the only login for stay (with their paid history) for your records, unlinked.
  delete from auth.users where id = me;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function delete_my_account() from anon';
  end if;
end $$;
