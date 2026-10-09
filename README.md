# Lost & POD desk

Shadowfax Trust & Safety: every shipment that needs a POD, until the POD is shared or the loss is accepted.

Cases come from client Google Sheet trackers, from client emails, and from people adding them (by hand or with the Excel template). Everything lands in one Supabase database. Aging is counted from the escalation date. Pending POD older than 7 days is **critical**.

| Who | Can do |
|---|---|
| Super Admin | Everything, incl. who approves Lost, report schedules and email settings |
| Admin | Users (except Super Admins), settings, approve Lost if given the right |
| Internal team | Work cases, request Lost, approve Lost if given the right |
| Client POC | Own client only: see status, add pending shipments, request Lost |

**Emails are off by default.** A Super Admin turns them on in Settings ("Send emails automatically", and each scheduled report).

---

## Folders

| Folder | What |
|---|---|
| `src/app/(internal)` | Screens for the Shadowfax team |
| `src/app/portal` | Client portal |
| `src/lib` | Import, normalising, Lost workflow, emails, reports |
| `supabase/migrations` | `0001_base.sql` (tables) and `0002_app.sql` (everything since; safe to run again) |
| `supabase/seed.sql` | Statuses, settings, clients and tracker tabs |
| `apps-script/Bridge.gs` | The Google bridge (Sheets, Gmail, Drive) |
| `scripts` | `setup` (install / update) and `sync-sheets` (full tracker import) |

---

## Install or update (GitHub Codespace)

1. Copy `setup.env.example` to `setup.env` once and fill in the Supabase ref and token, the first admin, and the Vercel token.
2. Run:
   ```
   npm install
   npm run setup -- --skip-sync
   ```
   It updates the database, deploys to Vercel and prints anything left to do. Running it again is always safe.
3. Full import of every tracker (no time limit): `npm run sync:sheets`

## Google bridge

The app reads trackers, Gmail and Drive through a small Apps Script that runs as your Google account. No Google Cloud access is needed.

1. Open a Google Sheet you own → **Extensions → Apps Script**. Paste `apps-script/Bridge.gs` and click **Save**.
2. **Project Settings → Script properties**: add `BRIDGE_SECRET` with the value of `GOOGLE_BRIDGE_SECRET` from `setup.env` (setup creates it).
3. **Deploy → New deployment → Web app**, Execute as: **Me**, Who has access: **Anyone**. Authorize, then copy the `/exec` URL into `setup.env` as `GOOGLE_BRIDGE_URL` and run setup again.
4. After changing `Bridge.gs`: **Deploy → Manage deployments → ✏️ → New version → Deploy**.

A tab name with `?` or `*` reads every matching tab, e.g. `??-??-????` for a workbook with one tab per day (Meesho).

Trackers must be shared with the account that runs the bridge. Emails are sent from that mailbox. Uploaded Excel files are kept in its Drive under "Lost POD uploads".

## Schedules (Vercel)

- Tracker sync: every 30 minutes (once a day at 07:30 IST on the free plan).
- Reports check: every hour (once a day at 09:00 IST on the free plan). Nothing is sent unless switched on in Settings.

## Tests (for developers)

`npm test` runs the unit tests. `supabase/tests/rls_test.sql` checks the database rules on a local Postgres (load `supabase/tests/local_supabase_stub.sql`, both migrations and `seed.sql` first).
