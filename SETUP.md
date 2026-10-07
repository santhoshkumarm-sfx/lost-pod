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

**What it cannot do:** install the Google connection (Part B). Google needs you to paste a script and click "Allow" once; it takes about 10 minutes and needs no Google Cloud access.

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

## Part B: Connect Google through Apps Script (10 minutes, no Google Cloud access needed)

The app reads the trackers and the escalation emails through a small script that runs **as your own Google account**. It can open every tracker you can open and search your mailbox. The daily report is sent from your mailbox.

Do this **after the first `npm run setup`**. That run prints a secret under "Still to do". If you ran it already, the secret is also saved in `setup.env` as `GOOGLE_BRIDGE_SECRET`.

1. Open any Google Sheet you own. A new blank sheet named `Lost POD bridge` is best.
2. Go to **Extensions → Apps Script**. Delete the sample code.
3. Open `apps-script/Bridge.gs` from the project folder in Notepad, copy all of it, and paste it into the editor. Click **Save** (the disk icon).
4. Click the **gear (Project Settings)** on the left. Scroll down to **Script properties** and click **Add script property**:
   - Property: `BRIDGE_SECRET`
   - Value: the secret from `setup.env`
   - Click **Save script properties**.
5. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Click **Deploy**.
6. Click **Authorize access** and choose your shadowfax.in account.
   - If you see "Google hasn't verified this app", click **Advanced → Go to … (unsafe)**. It is your own script.
   - Click **Allow**. This lets it read Sheets and Gmail and send email as you.
7. Copy the **Web app URL**. It ends in `/exec`.
8. In `setup.env`, set `GOOGLE_BRIDGE_URL=<that URL>`, then run `npm run setup` again.

Notes:
- "Anyone" only means the URL can be called. Every request must carry the secret, or the script refuses it. Never share the URL together with the secret.
- **If "Anyone" isn't offered**, your Workspace admin restricts web apps. Ask IT to allow Apps Script web apps for your account. Until then, use **Email escalations → Paste an email**. Tracker sync and the daily report will need the bridge.
- **If a tracker isn't readable**, setup lists it. Ask its owner to share it with your account; you need at least view access.
- **If you change `Bridge.gs` later**, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.
- Use a team mailbox account rather than a personal one, if you can. The bridge runs as whoever deployed it, so it stops working if that person leaves.
- Gmail sending limits: about 1,500 recipients a day on Workspace. The daily report uses 3.

---

## Part C (only if you DO have Google Cloud access): service account instead of the bridge

<details><summary>Show the service-account steps</summary>

1. Go to console.cloud.google.com and create a project.
2. Enable the **Google Sheets API** and the **Gmail API**.
3. Create a service account. Under **Keys → Add key → JSON**, download the key, save it as `google-key.json` in the project folder, and set `GOOGLE_SERVICE_ACCOUNT_JSON=./google-key.json`.
4. In admin.google.com, go to **Security → API controls → Domain Wide Delegation** and add the key's `client_id` with these scopes:
   `https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send`
5. Set `GMAIL_IMPERSONATE_USER` to the escalations mailbox.
6. Share each tracker with the service account's email as Viewer.

If `GOOGLE_BRIDGE_URL` is set, the bridge is used and these settings are ignored.
</details>

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
VERCEL_TOKEN=<from part A>
GOOGLE_BRIDGE_URL=                 # leave empty on the first run (Part B)
```

Then run:

```bash
npm run setup
```

It takes about 5–10 minutes. Most of that is the first tracker import and the Vercel build. At the end it prints the live address and a short **Still to do** list, if anything is left.

**On the first run the list says** *"Install the Google bridge … BRIDGE_SECRET …"*. Do Part B, then run `npm run setup` again. The second run imports the trackers and deploys with Google connected.

**If it then lists trackers you can't open**, ask each owner to share them with your account, then run setup again.

### Options

| Command | Use it when |
|---|---|
| `npm run setup -- --skip-vercel` | You only want the database and local setup. |
| `npm run setup -- --skip-sync` | You don't want to wait for the tracker import now. |
| `npm run setup -- --sync` | You want to force the tracker import again. |

### Good to know

- **Vercel free (Hobby) plan:** scheduled jobs can run only once a day. Setup notices this, switches the tracker sync to once a day (07:30 IST), and tells you. The daily report at 09:00 IST is unaffected. On Vercel Pro the sync runs every 30 minutes.
- **Supabase free plan:** setup keeps Supabase's standard invite and reset emails, because changing their wording needs your own email server. Their links work as they are. Add `SMTP_*` later and run setup again to get the branded emails.
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
