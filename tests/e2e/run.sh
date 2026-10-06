#!/usr/bin/env bash
# End-to-end check against a local Postgres + PostgREST (no Supabase cloud, no Google):
#   1. fresh database with migrations + seed, 2. data loaded through the real import/email/approval code,
#   3. every page rendered per role, 4. server actions exercised per role.
# Needs: Postgres on $PGHOST/$PGPORT (superuser $PGUSER), a PostgREST binary at $POSTGREST, and `npm run build` done
# with .env.local pointing at http://localhost:54321 (see tests/e2e/README.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:=/tmp}" "${PGPORT:=5433}" "${PGUSER:=postgres}" "${POSTGREST:=/tmp/pgrst/postgrest}"
export PGHOST PGPORT PGUSER
DB=lostpod_api
pkill -f "postgrest" || true; pkill -f "tests/e2e/proxy.mjs" || true; pkill -f "next start" || true
psql -d postgres -q -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
psql -d postgres -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'authpass' noinherit; end if; end \$\$;"
for f in supabase/tests/local_supabase_stub.sql supabase/migrations/*.sql supabase/seed.sql; do psql -d $DB -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null; done
psql -d $DB -q -f tests/e2e/users.sql
cat > /tmp/pgrst.conf <<CONF
db-uri = "postgres://authenticator:authpass@localhost:$PGPORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
server-port = 3001
db-max-rows = 1000
CONF
(setsid nohup "$POSTGREST" /tmp/pgrst.conf > /tmp/pgrst.log 2>&1 &)
(setsid nohup node tests/e2e/proxy.mjs > /tmp/proxy.log 2>&1 &)
sleep 3
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=x npx tsx --conditions=react-server tests/e2e/seed.ts
(setsid nohup npx next start -p 3000 > /tmp/next.log 2>&1 &)
sleep 6
node tests/e2e/pages.mjs | tee /tmp/pages.txt
if grep -q "ERROR\| 500 " /tmp/pages.txt; then echo "PAGE ERRORS"; exit 1; fi
node tests/e2e/actions.mjs
