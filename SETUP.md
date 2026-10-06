# Setup with one command

`npm run setup` does almost all of the deployment for you. You collect a few keys, put them in one file and run one command.

**What the command does:**

- Creates every database table, security rule and the reference data in Supabase.
- Recognises anything you already ran by hand, so it is never run twice.
- Turns off public sign-up.
- Writes the invite and reset-password email templates (the step that is hard to do by hand).
- Sets the sign-in redirect addresses.
- Creates your Super Admin account.
- Writes `.env.local` for running the app on your computer.
- Checks that Google Sheets and Gmail are connected, and tells you exactly what is missing.
- Imports the trackers for the first time.
- Creates the Vercel project, stores every secret there, deploys the app, and points Supabase at the live address.

You can run it again at any time, for example after adding the Google key. Nothing is duplicated.

**What it cannot do:** two Google steps (B and C below). Google has no way to automate them; they take about 10 minutes of clicking.

---

## Part A: Collect three things (5 minutes)

| What | Where to get it |
|---|---|
| **Supabase project ref** | Your project's address is `https://XXXXXXXX.supabase.co`. Copy the `XXXXXXXX` part. You can also paste the whole address. |
| **Supabase access token** | supabase.com → your avatar → **Account preferences → Access Tokens** (supabase.com/dashboard/account/tokens) → **Generate new token** → name it `lost-pod setup` → copy it. |
| **Vercel token** | vercel.com → your avatar → **Account Settings → Tokens** (vercel.com/account/tokens) → **Create Token** → scope: your account, expiration: 1 day is enough → copy it. |

If you don't have a Supabase project yet, create one first:
1. Go to supabase.com → **New project**.
2. Name: `lost-pod`. Region: **Mumbai**.
3. Wait about 2 minutes for it to finish.

Nothing else is needed in the Supabase dashboard.

---

## Part B: Google service account (5 minutes)

1. Go to console.cloud.google.com and create a project called `lost-pod`. Use the project picker at the top → **New project**.
2. Go to **APIs & Services → Library**.
   - Search **Google Sheets API** → **Enable**.
   - Search **Gmail API** → **Enable**.
3. Go to **IAM & Admin → Service Accounts → Create service account**. Name it `lost-pod-reader` → **Done**.
4. Click the new account → **Keys** tab → **Add key → Create new key → JSON**. A file downloads.
5. Rename the file to `google-key.json` and put it in the project folder, next to `package.json`.
   - It is a password; the project is set up so it is never uploaded to GitHub or Vercel.

---

## Part C: Allow the app to read the escalations mailbox (2 minutes, Google Workspace super admin)

1. Open `google-key.json` in a text editor and copy the number after `"client_id"`.
2. Go to admin.google.com → **Security → Access and data control → API controls → Manage Domain Wide Delegation → Add new**.
   - **Client ID:** the number from step 1.
   - **OAuth scopes:**
     ```
     https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send
     ```
   - Click **Authorize**.

Google can take up to an hour to apply this. If setup says Gmail isn't connected yet, run it again later.

---

## Part D: Run it

You need **Node.js 20 or newer** (nodejs.org).

```bash
cd lost-pod
npm install
cp setup.env.example setup.env        # Windows: copy setup.env.example setup.env
```

Open `setup.env` in a text editor and fill in:

```
SUPABASE_PROJECT_REF=<from part A>
SUPABASE_ACCESS_TOKEN=<from part A>
ADMIN_EMAIL=binay.sharma@shadowfax.in
ADMIN_NAME=Binay Sharma
ADMIN_PASSWORD=<choose one, 10+ characters>
GOOGLE_SERVICE_ACCOUNT_JSON=./google-key.json
GMAIL_IMPERSONATE_USER=<the escalations mailbox, e.g. tns-escalations@shadowfax.in>
VERCEL_TOKEN=<from part A>
```

Then run:

```bash
npm run setup
```

It takes about 5–10 minutes. Most of that is the first tracker import and the Vercel build. At the end it prints the live address and a short **Still to do** list, if anything is left.

**Usually the list says:** *"Share these workbooks with lost-pod-reader@….iam.gserviceaccount.com"*. To fix that:
1. Open each workbook listed.
2. Click **Share**, paste that email, choose **Viewer**, untick "Notify", and click **Share**.
3. Run `npm run setup` again.

### Options

| Command | Use it when |
|---|---|
| `npm run setup -- --skip-vercel` | You only want the database and local setup. |
| `npm run setup -- --skip-sync` | You don't want to wait for the tracker import now. |
| `npm run setup -- --sync` | You want to force the tracker import again. |

### Good to know

- **Vercel free (Hobby) plan:** scheduled jobs can run only once a day. Setup notices this, switches the tracker sync to once a day (07:30 IST), and tells you. The daily report at 09:00 IST is unaffected. On Vercel Pro the sync runs every 30 minutes.
- **Invite emails:** Supabase's built-in mailer sends only a few emails per hour. Before inviting the whole team, fill in the `SMTP_*` lines in `setup.env` and run setup again. Google Workspace SMTP relay or a Gmail app password both work. Until then, create users with a password under **Users** and share it with them securely.
- **Your own domain:** set `SITE_URL=https://pod.shadowfax.in` in `setup.env` once the domain points at Vercel, then run setup again.
- **GitHub:** setup deploys straight from your folder, so GitHub isn't required to go live. To have every push deploy automatically, connect the repository later in Vercel → Project → **Settings → Git**.
- **After setup**, you can delete the Supabase and Vercel tokens on their websites. The app doesn't use them. Keep `setup.env` private, or delete it too.

---

## If setup stops with an error

| Message | Fix |
|---|---|
| `rejected SUPABASE_ACCESS_TOKEN` | The token was copied incompletely or has expired. Generate a new one. |
| `no access to project` | The project ref is wrong, or the token belongs to a different Supabase account. |
| `Project … is INACTIVE / PAUSED` | Free Supabase projects pause after a week without use. Click **Restore** in the dashboard, then run setup again. |
| `Vercel rejected VERCEL_TOKEN` | Create a new token. If the project belongs to a Vercel team, set `VERCEL_TEAM` to the team slug. |
| `… .sql failed` | Nothing from that file was saved (each file runs all-or-nothing). Send me the message. |
| `Vercel deployment failed` | The last lines of the build output are printed above it. Send me those lines. |
