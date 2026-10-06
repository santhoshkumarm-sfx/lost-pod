# End-to-end tests (local, no cloud)

These tests run the built app against a real Postgres plus PostgREST, the same REST layer Supabase uses. A tiny gateway (`proxy.mjs`) serves `/rest/v1` and answers `GET /auth/v1/user` from the JWT.

Sessions are signed locally (`jwt.mjs`) for a Super Admin, an Admin, an internal agent and two client POCs.

**Requirements**
- Postgres 15+ reachable as a superuser.
- A PostgREST v12 binary (https://github.com/PostgREST/postgrest/releases).

**`.env.local` for the build**

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<node -e "import('./tests/e2e/jwt.mjs').then(m=>console.log(m.ANON))">
SUPABASE_SERVICE_ROLE_KEY=<node -e "import('./tests/e2e/jwt.mjs').then(m=>console.log(m.SERVICE))">
NEXT_PUBLIC_SITE_URL=http://localhost:3000
CRON_SECRET=test-cron-secret
```

**Run**

```bash
npm run build
PGHOST=/tmp PGPORT=5433 PGUSER=postgres POSTGREST=/path/to/postgrest bash tests/e2e/run.sh
```

User invitations (`auth.admin.*`) need real Supabase Auth and are not covered here.
