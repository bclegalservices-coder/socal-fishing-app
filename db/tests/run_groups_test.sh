#!/bin/bash
# Tests 002 + 008 (fishing groups) on a throwaway local Postgres:  bash db/tests/run_groups_test.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$HERE")
B=$(ls -d /usr/lib/postgresql/*/bin | tail -1); D=/var/lib/postgresql/grouptest
su postgres -c "rm -rf $D; mkdir -p $D && $B/initdb -D $D/data -A trust -U postgres >/dev/null && $B/pg_ctl -D $D/data -o '-k $D -p 5498 -c listen_addresses=' -l $D/log start >/dev/null"
trap "su postgres -c '$B/pg_ctl -D $D/data stop -m fast >/dev/null; rm -rf $D'" EXIT
sleep 2
prep() { sed -e 's/geography(point, 4326)/text/g' -e '/^create extension if not exists pg_net;/d' "$1"; }
{ cat "$HERE/stub_supabase.sql"; prep "$ROOT/migrations/002_fishing_groups.sql"; prep "$ROOT/migrations/008_groups_plus.sql"; prep "$ROOT/migrations/008_groups_plus.sql"; prep "$ROOT/migrations/010_account_deletion.sql";
  echo "grant all on all tables in schema public to app_user; grant all on all sequences in schema public to app_user;"
  cat "$HERE/groups_test.sql"; } | psql -h $D -p 5498 -U postgres -q -o /dev/null -v ON_ERROR_STOP=1 -X 2>&1 | grep -v "^NOTICE:  \(pg_cron\|relation\|extension\)" 
