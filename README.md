# Lost & POD desk

Lost shipment and POD escalation management for Shadowfax Trust & Safety.

Escalations arrive from client Google Sheet trackers, from client emails and by hand. This app pulls them into **one case database** (Supabase Postgres). It computes aging from the escalation date and runs the Lost approval workflow. It gives client POCs a portal limited to their own shipments and emails admins a daily report.

Google Sheets and Gmail are **inputs only**. The database is the master record. Every case keeps its lineage: which workbook/tab/row or which Gmail thread it came from.

```
Google Sheets ──(every 30 min / on demand)──┐
Gmail thread  ──(subject search → review)───┼──► Supabase Postgres ──► Dashboard · POC portal · Daily email + Excel
Manual entry  ──────────────────────────────┘     (RLS on every table)
```

Stack: Next.js 15 (App Router, TypeScript), Supabase (Postgres, Auth, Row Level Security), Google Sheets API, Gmail API, Recharts, ExcelJS, Tailwind. It is hosted on Vercel, with code on GitHub.

---

## 1. What is where

| Path | What it does |
|---|---|
| `supabase/migrations/` | Schema, triggers, workflow functions, Row Level Security, email → case function |
| `supabase/seed.sql` | Statuses, aging buckets, settings, status wording, ~130 header aliases, the 7 clients and the 23 tracker tabs shared in Sept 2026 |
| `src/lib/normalize/` | Header detection and mapping, date parsing, AWB clean-up, hub/location, status resolution |
| `src/lib/email/` | Gmail MIME decoding and escalation extraction (HTML tables, text tables, AWBs in sentences) |
| `src/lib/importer/` | Sheet sync engine (reads tabs, normalises, upserts in batches of 500) |
| `src/lib/reports/` | Daily report data, email HTML, Excel workbook, CSV |
| `src/app/(internal)/` | Internal screens: dashboard, cases, email escalations, imports, Lost approval, Lost shipments, clients, POCs, users, reports, settings, audit, data quality |
| `src/app/portal/` | Client POC portal |
| `src/app/api/cron/` | `sync-sheets` and `daily-report`, protected by `CRON_SECRET` |
| `scripts/` | `setup` (one-command deployment), `create-admin`, `sync:sheets`, `report:send` command-line tools |
| `tests/` | Unit tests (Vitest), database rule tests (SQL), end-to-end tests (`tests/e2e`) |

---

## 2. Set up Supabase

> **Fastest way:** follow [SETUP.md](SETUP.md). `npm run setup` does sections 2–5 below in one command (database, sign-in settings, email templates, first admin, Google checks, first import, Vercel deploy). The manual steps below are kept for reference.

1. Create a Supabase project. Region: Mumbai (`ap-south-1`).
2. **Run the migrations, in order.** Use the SQL editor or `supabase link && supabase db push`:
   - `20260901000000_schema.sql`
   - `20260901000100_functions.sql`
   - `20260901000200_rls.sql`
   - `20260901000300_email_cases.sql`
3. **Run `supabase/seed.sql`.** It is safe to re-run.
4. **Authentication → Providers → Email:** turn **off** "Allow new users to sign up". Admins create every account.
5. **Authentication → URL configuration:**
   - Site URL: your Vercel URL.
   - Redirect URLs: add `https://<your-domain>/auth/confirm`.
6. **Authentication → Email templates.** Change the link in *Invite user* and *Reset password* so the server can verify it:
   - Invite: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
7. Copy the URL, anon key and service-role key from **Project settings → API**.
8. **Create the first Super Admin.** Run this locally once `.env.local` is filled in:
   ```bash
   npm install
   npm run create-admin -- binay.sharma@shadowfax.in "Binay Sharma"
   ```
   Add a third argument to set a password directly instead of sending an invite.

Roles are stored in `app_metadata`, which users cannot edit. Anyone who signs up without an admin lands as an **inactive** client POC and sees nothing.

---

## 3. Connect Google

> **No Google Cloud access?** Use the Apps Script bridge (`apps-script/Bridge.gs`, SETUP.md part B): it runs as a Shadowfax user and needs only `GOOGLE_BRIDGE_URL` and `GOOGLE_BRIDGE_SECRET`. When set, it is used for Sheets, Gmail search and sending the daily report.

### Option A: service account (recommended)

1. In Google Cloud, create a project and enable the **Google Sheets API** and the **Gmail API**.
2. Create a service account and a JSON key.
   - Put `client_email` in `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
   - Put `private_key` in `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, keeping the `\n` sequences.
3. **Sheets:** share every tracker workbook with the service-account email as *Viewer*.
4. **Gmail:** in Google Workspace Admin go to **Security → API controls → Domain-wide delegation**. Add the service account's client ID with these scopes:
   `https://www.googleapis.com/auth/gmail.readonly, https://www.googleapis.com/auth/gmail.send`
5. Set `GMAIL_IMPERSONATE_USER` to the mailbox that receives client escalations.
6. Set `GMAIL_SENDER` to the address the daily report is sent from: that mailbox or one of its aliases.

### Option B: one mailbox with an OAuth refresh token

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`. The token needs the scopes `gmail.readonly`, `gmail.send` and `spreadsheets.readonly`. This option is used when no service account is configured.

The **Settings** screen shows whether Sheets and Gmail are connected. Until Gmail is connected, the team can still use **Email escalations → Paste an email**.

---

## 4. Run locally

```bash
cp .env.example .env.local     # fill in Supabase + Google values
npm install
npm run dev                    # http://localhost:3000
```

**First full import.** The trackers have about 6,000 rows, so run the first import from your machine rather than inside a serverless function:

```bash
npm run sync:sheets
```

After that, the 30-minute cron keeps the trackers in sync. Only changed rows are processed; unchanged rows are skipped by hash.

---

## 5. Deploy to Vercel

1. Push the repository to GitHub. `.env*`, keys and service-account JSON are git-ignored.
2. Import the repo in Vercel; it detects Next.js. `vercel.json` already sets:
   - region `bom1`
   - `maxDuration` for crons and exports
   - two crons:
     - `/api/cron/sync-sheets`: every 30 minutes
     - `/api/cron/daily-report`: 03:30 UTC = **09:00 IST**
3. Add every variable from `.env.example` under **Settings → Environment Variables**:
   - Set `NEXT_PUBLIC_SITE_URL` to the production URL.
   - Set `CRON_SECRET` to a long random string. Vercel sends it to the crons automatically.
4. Deploy. Then sign in as the Super Admin.
5. Under **Users**, add the team. Under **Clients**, add the client POCs.

> Vercel Hobby plans only run crons once a day. On Hobby, either change the sync schedule to daily or call `/api/cron/sync-sheets` from another scheduler with the header `Authorization: Bearer <CRON_SECRET>`.

---

## 6. How it works

### Aging

- **Aging** is `today (IST) − escalation date`. It is calculated in the database view `v_cases` every time it is read.
- The trackers' `AGEING` / `AEGING` columns are ignored. They are often `#REF!`.
- Closed and Lost cases keep a **final aging** that is frozen at closure.
- **Lost aging** = `approval date − original escalation date`. Example: escalated 01 Aug and approved 20 Aug gives 19 days.
- Buckets default to 0–2, 3–7, 8–15, 16–30, 31–60, 61–90 and 90+. Change them under Settings.
- **TAT breached** means an open case is older than the client's TAT (set per client), or older than `default_sla_days` (7) when the client has none.

### Statuses and Lost approval

- The default statuses are: Pending, Working on it, Shipment at DC, Shipment at Hub, POD Shared, Lost — Pending Admin Approval, Lost and Closed. Admins can add more open or closed statuses.
- **Nobody can set Lost directly.** A database trigger blocks any write that enters or leaves a Lost state, unless it comes from the workflow functions.
- How a case gets to Lost:
  1. A POC, the team, or a tracker row saying "Lost" or "Need LOST ASAP" creates a request. The case moves to **Lost — Pending Admin Approval** and admins are notified in the app (and by email, if enabled).
  2. An Admin then decides:
     - **Approve**: the case becomes Lost.
     - **Reject**: it returns to its previous status.
     - **Send back**: it goes to Working on it.
  3. A note is required to reject or send back.
- Bulk approval is supported. Every request and decision is kept.
- An Admin can take a case out of Lost (for example, if the shipment is found). A reason is required, and this is audited.

### Google Sheet sync

- **Header row** is detected automatically (Velocity's header is on row 2). It can be pinned per tab.
- **Columns** are matched in this order:
  1. per-tab admin choice;
  2. header alias, tolerating typos like "Client reamrks";
  3. column content (AWB codes, hub codes like `DEL_KirtiNagar_RTS`, URLs).
- Change any column on the tab's mapping screen. The screen previews the rows as they will be imported.
- **Dates:**
  - Formats like `17 Jul`, `02-Jan-26`, `29-July-2026`, `1 June 26`, `dd-mm-yyyy hh:mm`, `2026-03-31` and `7/13/2026` are all read.
  - The day/month order is decided per column, so Kartrocket's M/D/Y escalation dates can sit next to D/M/Y delivery dates.
  - Impossible delivery dates are swapped. For example, Swift's `2026-01-07` is read as 1 July.
  - A missing escalation date falls back to a date in the mail subject. If there is none, the date of import is used and the case is flagged *estimated*.
- **Status** wording is spread over Status, SFX remark, Remarks, POD status and Client remark columns.
  - Mapped wording is configurable without a deploy.
  - Any Lost wording only creates a Lost request.
  - Unknown wording shows up under Data quality.
  - The tracker sets the status only until someone changes it in the dashboard. After that, the dashboard owns it.
- **Duplicates:**
  - The same AWB and escalation date in one tab is one case.
  - The same AWB for the same client within `dedupe_window_days` (30) in another tab, or in an email, is linked to the existing case. Missing fields are filled in; the case is not duplicated.
- **Lookup tabs** ("Rough sheet", Sheet5/7/8) are set to *fill gaps only*. They add price, POD links and hubs to cases that already exist; they never create cases.

### Email escalations

1. **Find the email:** Email escalations → **Find email in Gmail** → type the subject. `Re:` and `Fwd:` are ignored.
2. **Pick the thread** from the results.
3. **Extraction.** The app reads the real message bodies, never Gmail's summary. It takes AWBs from the client's message, not from our replies, and reads:
   - AWBs, location and hub, delivery date and seller, from HTML tables, `AWB | WH` text tables, tab-separated lists, or AWBs written in sentences;
   - the client, from the sender's POC email or domain, or the client named in the mail;
   - the escalation date, which is the date the mail was sent (IST);
   - the reason, complaint type and priority.
4. **Review form.** Everything shows in a review form.
   - Fields that were missing or guessed are highlighted.
   - AWBs that already have a case can be linked instead of duplicated.
5. **Create cases.** **Create cases** makes one case per AWB in a single transaction. Every case is linked to the Gmail thread id, message id, subject and sender.

### Client POC portal

- A POC sees only their own client's cases. This is enforced by Row Level Security, so a guessed case id or API call returns nothing.
- The portal shows status, aging, hub, POD link, the Shadowfax remark, messages and the client-visible history.
- A POC can request Lost.
- Internal notes live in a separate table that POCs cannot read. Internal comments are hidden. POC exports leave out internal columns.

### Daily report (09:00 IST)

The report goes to the addresses in **Settings → Daily report recipients**. By default these are santhoshkumar.m@, naveed.iqbal@ and binay.sharma@shadowfax.in. Everything is computed from the database at send time.

**Email body, in order:**

1. Daily summary.
2. **Top 10 aging.** The 10 clients with the most open cases, with columns for aging day 1 … 10 and 10+. The column direction is a setting.
3. **Top 10 highest product value.** Open shipments only.
4. **Top 10 highest AWB count.**
5. Client-wise table: Client | Total | Open | Pending | Lost pending | Lost | POD Shared | 0–7 | 8–15 | 16–30 | 30+.
6. Aging-wise table.
7. Approved Lost cases from the last 30 days.
8. Pending Lost approvals.
9. A note about the attachment.

**Attachment:** a consolidated Excel workbook. It contains every table above, all approved Lost cases, pending approvals and every case.

"New escalations" means escalated since yesterday.

Preview or send the report under **Reports**, or run `npm run report:send -- --preview`.

---

## 7. Security summary

- Every table has Row Level Security. The UI hides things for convenience only; the database decides.
- POC isolation, internal notes, and the rule that an internal agent can edit only their own or unassigned cases are all enforced by policies.
- The admin-only Lost decision is enforced by a function check plus a trigger.
- The service-role key is used only on the server: crons, imports and user management, each after an explicit role check.
- Only a Super Admin can grant or change Super Admin. Nobody can change their own role or deactivate themselves.
- Deactivating a user bans their login and removes all data access immediately.
- Every change to cases, approvals, users and configuration is written to `case_updates` or `audit_logs`. Admins can read these under **Audit log**.

---

## 8. Tests

```bash
npm test             # 38 unit tests: dates, headers, statuses, sheets (real tracker rows), email extraction, report, exports, MIME
npm run typecheck
PGURL=postgres://postgres@localhost:5432/postgres npm run test:db   # database rules: RLS, Lost workflow, imports, email → cases
bash tests/e2e/run.sh   # full stack on local Postgres + PostgREST (see tests/e2e/README.md)
POSTGREST=/path/to/postgrest bash tests/e2e/setup-test.sh   # `npm run setup` against mock Supabase/Vercel APIs
```

The end-to-end run:

- loads data through the real import, email and approval code;
- renders every page as Super Admin, internal agent and POC;
- runs 35 server-action checks, including that a POC can never see another client's case or an internal note.

---

## 9. Assumptions to confirm

- **Top 10 aging layout.** "From right to left" was read as one row per client and columns 1 … 10, 10+. Change the direction in Settings, or tell us if the rows should be something else.
- **Kartrocket vs Shiprocket.** The whole "Kartrocket & Shiprocket" workbook is imported as Kartrocket. Point Shiprocket tabs at the Shiprocket client under Imports → tab settings.
- **Lenskart.** No Lenskart tab was found in the Naaptol workbook. Add it with Imports → Add a workbook once shared.
- **Gmail samples.** The two example threads ("Re: POD needed - Shadowfax - 11-09-26", "Re: Regarding POD") could not be opened while building. Extraction is tested on the format in the brief and similar mails.
- **Client email domains** are empty for every client. Add them under Clients so email escalations are assigned to the right client automatically.
