#!/usr/bin/env bash
# Usage: PGURL=postgres://postgres@localhost:5432/postgres supabase/tests/run.sh
# Creates a scratch database, applies migrations + seed with a Supabase auth stub, runs the rule checks.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGURL="${PGURL:-postgres://postgres@localhost:5432/postgres}"
DB=lostpod_rls_test
psql "$PGURL" -q -c "drop database if exists $DB" -c "create database $DB"
TEST_URL="${PGURL%/*}/$DB"
for f in supabase/tests/local_supabase_stub.sql supabase/migrations/*.sql supabase/seed.sql supabase/tests/rls_test.sql; do
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
done
echo "All database rule checks passed."
