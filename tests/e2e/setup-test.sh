#!/usr/bin/env bash
# Tests `npm run setup` against local mocks (tests/e2e/setup-mocks.mjs): fresh project, re-run,
# migrations already run by hand, Vercel Hobby cron fallback, bad credentials.
# Needs Postgres (superuser postgres on localhost:$PGPORT) and a PostgREST binary at $POSTGREST.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
: "${PGPORT:=5433}" "${POSTGREST:?set POSTGREST to the postgrest binary}"
WORK="${WORK:-$(mktemp -d)}"
export PGHOST=localhost PGPORT PGUSER=postgres MOCK_STATE="$WORK/state.json"
PASS=0; FAILS=0
check() { if eval "$2"; then echo "ok   $1"; PASS=$((PASS+1)); else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { psql -d lostpod_setup -At -c "$1"; }

fresh_db() {
  psql -d postgres -q -c "drop database if exists lostpod_setup with (force)" -c "create database lostpod_setup" 2>/dev/null
  psql -d postgres -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'authpass' noinherit; end if; end \$\$;"
  psql -d lostpod_setup -q -v ON_ERROR_STOP=1 -f "$REPO/supabase/tests/local_supabase_stub.sql" >/dev/null
  psql -d lostpod_setup -q -c "grant anon, authenticated, service_role to authenticator" 2>/dev/null
  rm -f "$MOCK_STATE"
}

start_services() {
  pkill -f "^node tests/e2e/setup-mocks.mjs" 2>/dev/null; pkill -f "^$POSTGREST " 2>/dev/null; sleep 1
  cat > "$WORK/pgrst.conf" <<CONF
db-uri = "postgres://authenticator:authpass@localhost:$PGPORT/lostpod_setup"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
server-port = 3001
CONF
  (setsid nohup "$POSTGREST" "$WORK/pgrst.conf" > "$WORK/pgrst.log" 2>&1 &)
  (cd "$REPO" && setsid nohup node tests/e2e/setup-mocks.mjs > "$WORK/mocks.log" 2>&1 &)
  sleep 3
}

# A throwaway copy of the project so the real repo's .env.local / setup.env are never touched.
APP="$WORK/app"
rm -rf "$APP"; mkdir -p "$APP"
(cd "$REPO" && tar --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=setup.env -cf - .) | (cd "$APP" && tar -xf -)
ln -s "$REPO/node_modules" "$APP/node_modules"

write_env() {
  cat > "$APP/setup.env" <<ENV
SUPABASE_PROJECT_REF=https://abcdefghijklmnopqrst.supabase.co
SUPABASE_ACCESS_TOKEN=${TOKEN:-sbp_test_token}
ADMIN_EMAIL=binay.sharma@shadowfax.in
ADMIN_NAME=Binay Sharma
ADMIN_PASSWORD=${ADMIN_PASSWORD-ChangeMe-12345}
GOOGLE_SERVICE_ACCOUNT_JSON=${SA_JSON:-./google-key.json}
GOOGLE_BRIDGE_URL=${BRIDGE_URL:-}
GOOGLE_BRIDGE_SECRET=${BRIDGE_SECRET:-}
GMAIL_IMPERSONATE_USER=tns-escalations@shadowfax.in
VERCEL_TOKEN=${VERCEL_TOKEN-vercel_test_token}
VERCEL_PROJECT_NAME=lost-pod-dashboard
SMTP_HOST=${SMTP_HOST:-}
SMTP_USER=${SMTP_HOST:+relay@shadowfax.in}
SMTP_PASS=${SMTP_HOST:+app-password}
SMTP_SENDER_EMAIL=${SMTP_HOST:+noreply@shadowfax.in}
ENV
}

run_setup() {
  (cd "$APP" && SUPABASE_API_URL=http://localhost:4001 VERCEL_API_URL=http://localhost:4002 \
     SUPABASE_URL_OVERRIDE=http://localhost:54321 SETUP_ALLOW_ANY_BRIDGE_URL=1 VERCEL_CLI="node $REPO/tests/e2e/fake-vercel.mjs" \
     npx tsx --conditions=react-server scripts/setup.ts "$@") > "$WORK/out.txt" 2>&1
  echo $?
}
js() { node -e "const s=require('$MOCK_STATE'); process.exit(($1) ? 0 : 1)"; }

echo "== 1. fresh project, no Google key yet, Vercel Hobby plan"
fresh_db; start_services; write_env
code=$(FAKE_HOBBY=1 run_setup)
check "setup exits 0" "[ $code = 0 ] || { tail -30 $WORK/out.txt; false; }"
check "4 migrations recorded" "[ \"\$(q 'select count(*) from app_migrations')\" = 4 ]"
check "seed loaded (7 clients, 23 tabs)" "[ \"\$(q 'select count(*) from clients')\" = 7 ] && [ \"\$(q 'select count(*) from sheet_sources')\" = 23 ]"
check "public sign-up disabled" "js 's.authConfig.disable_signup === true'"
check "free plan: templates skipped, setup continues" "js '!s.authConfig.mailer_templates_invite_content' && grep -q 'standard invite/reset emails kept' $WORK/out.txt"
check "no Google-key warning when using the bridge route" "! grep -q 'Google key file not found' $WORK/out.txt"
check "Super Admin created with password" "[ \"\$(q \"select role||','||is_active from profiles where email='binay.sharma@shadowfax.in'\")\" = 'super_admin,true' ]"
check ".env.local written with keys and cron secret" "grep -q '^SUPABASE_SERVICE_ROLE_KEY=ey' $APP/.env.local && grep -Eq '^CRON_SECRET=[0-9a-f]{48}$' $APP/.env.local"
check "Vercel project created" "js 'Object.values(s.projects).length === 1'"
check "Vercel env has secrets" "js 'Object.keys(Object.values(s.env)[0]).includes(\"SUPABASE_SERVICE_ROLE_KEY\") && Object.keys(Object.values(s.env)[0]).includes(\"CRON_SECRET\")'"
check "Hobby fallback deployed with a daily sync" "js 's.deploys[0].crons.every(c => !c.includes(\"*/\"))'"
check "redeployed with the real production address" "js 's.deploys.length === 2 && s.deploys[1].site === \"https://lost-pod-dashboard-sfx.vercel.app\"'"
check "Supabase site URL = production address" "js 's.authConfig.site_url === \"https://lost-pod-dashboard-sfx.vercel.app\" && s.authConfig.uri_allow_list.includes(\"https://lost-pod-dashboard-sfx.vercel.app/auth/confirm\")'"
check "summary lists the Google to-do" "grep -q 'Still to do' $WORK/out.txt && grep -q 'Install the Google bridge' $WORK/out.txt"
check "vercel.json kept daily for Hobby + noted" "grep -q '0 2 \* \* \*' $APP/vercel.json && grep -q 'commit it' $WORK/out.txt"
cp "$WORK/out.txt" "$WORK/run1.txt"
SECRET1=$(grep '^CRON_SECRET=' "$APP/.env.local")

echo "== 2. run again: nothing duplicated"
cp "$REPO/vercel.json" "$APP/vercel.json"
code=$(run_setup)
check "second run exits 0" "[ $code = 0 ] || { tail -30 $WORK/out.txt; false; }"
check "migrations reported as already applied" "[ \"\$(grep -c 'already applied' $WORK/out.txt)\" = 4 ]"
check "still one admin, one project" "[ \"\$(q 'select count(*) from profiles')\" = 1 ] && js 'Object.values(s.projects).length === 1'"
check "cron secret kept" "grep -qx \"$SECRET1\" $APP/.env.local"
check "existing admin reported" "grep -q 'already exists' $WORK/out.txt"
check "vercel.json untouched on Pro plan" "cmp -s $REPO/vercel.json $APP/vercel.json"

echo "== 3. migrations already run by hand in the SQL editor + a Google key"
fresh_db
for f in "$REPO"/supabase/migrations/*.sql "$REPO/supabase/seed.sql"; do psql -d lostpod_setup -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
start_services
openssl genrsa 2048 2>/dev/null > "$WORK/k.pem"
node -e "require('fs').writeFileSync('$APP/google-key.json', JSON.stringify({type:'service_account', client_email:'lost-pod-reader@lost-pod.iam.gserviceaccount.com', client_id:'1234567890', private_key: require('fs').readFileSync('$WORK/k.pem','utf8')}))"
rm -f "$APP/.env.local"
ADMIN_PASSWORD= VERCEL_TOKEN= write_env
code=$(timeout 300 bash -c "$(declare -f run_setup); WORK=$WORK APP=$APP REPO=$REPO run_setup --skip-sync")
check "setup exits 0" "[ $code = 0 ] || { tail -30 $WORK/out.txt; false; }"
check "hand-run migrations recognised, not re-run" "[ \"\$(grep -c 'run earlier by hand' $WORK/out.txt)\" = 4 ]"
check "admin invited when no password" "js 's.auth.some(a => a.op === \"invite\" && a.redirect.endsWith(\"/auth/callback?next=/update-password\"))'"
check "Google key written to .env.local" "grep -q '^GOOGLE_SERVICE_ACCOUNT_EMAIL=lost-pod-reader@' $APP/.env.local && grep -q 'BEGIN PRIVATE KEY' $APP/.env.local"
check "unreadable workbooks reported with sharing instructions" "grep -q 'Share these workbooks with lost-pod-reader@' $WORK/out.txt || grep -q 'Sheets API' $WORK/out.txt"
check "Vercel skipped and listed as to-do" "grep -q 'VERCEL_TOKEN is empty' $WORK/out.txt"

echo "== 3b. with SMTP: branded templates saved"
SMTP_HOST=smtp-relay.gmail.com ADMIN_PASSWORD= VERCEL_TOKEN= write_env
code=$(run_setup --skip-sync)
check "templates saved once SMTP is configured" "js 's.authConfig.smtp_host === \"smtp-relay.gmail.com\" && s.authConfig.mailer_templates_invite_content.includes(\"/auth/confirm?token_hash={{ .TokenHash }}&type=invite\")' && grep -q 'Branded invite' $WORK/out.txt"

echo "== 4. wrong Supabase token"
TOKEN=sbp_wrong write_env
code=$(run_setup)
check "fails with a clear message" "[ $code = 1 ] && grep -q 'rejected SUPABASE_ACCESS_TOKEN' $WORK/out.txt"

echo "== 5. no Google Cloud access: secret generated, then Apps Script bridge"
fresh_db; start_services; rm -f "$APP/google-key.json" "$APP/.env.local"
SA_JSON=./none.json VERCEL_TOKEN= write_env
code=$(run_setup --skip-sync)
GEN=$(grep '^GOOGLE_BRIDGE_SECRET=' "$APP/setup.env" | cut -d= -f2)
check "secret generated and saved in setup.env" "[ \${#GEN} = 48 ]"
check "to-do tells you to install the bridge with that secret" "grep -q 'Install the Google bridge' $WORK/out.txt && grep -q \"$GEN\" $WORK/out.txt"
check "same secret kept on re-run" "run_setup --skip-sync >/dev/null; grep -q \"^GOOGLE_BRIDGE_SECRET=$GEN\" $APP/setup.env"
BRIDGE_URL=http://localhost:4003/macros/s/TESTDEPLOY/exec BRIDGE_SECRET=test-bridge-secret-0123456789 SA_JSON=./none.json VERCEL_TOKEN= write_env
code=$(run_setup)
check "setup with bridge exits 0" "[ $code = 0 ] || { tail -30 $WORK/out.txt; false; }"
check "bridge ping reports the Google account" "grep -q 'running as santhoshkumar.m@shadowfax.in' $WORK/out.txt"
check "readable tracker found via bridge" "grep -q 'Sheets: can read' $WORK/out.txt"
check "unreadable trackers listed for sharing" "grep -q 'can open these workbooks' $WORK/out.txt"
check "Gmail checked through the bridge" "grep -q \"Gmail: can search santhoshkumar.m@shadowfax.in\" $WORK/out.txt"
check "first import ran through the bridge" "[ \"\$(q \"select count(*) from cases where source_type='google_sheet'\")\" = 3 ]"
check "tracker LOST became a pending approval only" "[ \"\$(q \"select team_status from cases where awb='R2178493750VEO'\")\" = lost_pending_approval ]"
check ".env.local has bridge settings, no service account" "grep -q '^GOOGLE_BRIDGE_URL=http://localhost:4003' $APP/.env.local && ! grep -q GOOGLE_SERVICE_ACCOUNT $APP/.env.local"
(cd "$APP" && SETUP_ALLOW_ANY_BRIDGE_URL=1 npx tsx --conditions=react-server scripts/send-daily-report.ts santhoshkumar.m@shadowfax.in) > "$WORK/report.txt" 2>&1
check "daily report sent through the bridge with the Excel file" "js 's.mail && s.mail.to[0] === \"santhoshkumar.m@shadowfax.in\" && s.mail.htmlHasTop10 && s.mail.attachments[0].name.endsWith(\".xlsx\") && s.mail.attachments[0].bytes > 5000' || cat $WORK/report.txt"
BRIDGE_URL=http://localhost:4003/macros/s/TESTDEPLOY/exec BRIDGE_SECRET=wrong-secret-0000000000000 SA_JSON=./none.json VERCEL_TOKEN= write_env
code=$(run_setup --skip-sync)
check "wrong bridge secret explained" "grep -q 'rejected the secret' $WORK/out.txt"

pkill -f "^node tests/e2e/setup-mocks.mjs"; pkill -f "^$POSTGREST "
echo; echo "$PASS passed, $FAILS failed  (logs in $WORK)"
[ $FAILS = 0 ]
