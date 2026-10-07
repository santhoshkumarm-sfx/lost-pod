/**
 * One-command setup: Supabase database + auth settings + email templates, Super Admin,
 * local .env.local, Google checks, first tracker import, and (optionally) Vercel deployment.
 *
 *   cp setup.env.example setup.env   # fill it in
 *   npm run setup                    # flags: --skip-sync  --skip-vercel  --only-supabase
 *
 * Every step is safe to repeat: migrations are tracked, settings are overwritten with the same
 * values, the admin is created once, and Vercel variables are upserted.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ensureSuperAdmin } from './_admin';

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const SUPABASE_API = (process.env.SUPABASE_API_URL ?? 'https://api.supabase.com').replace(/\/$/, '');
const VERCEL_API = (process.env.VERCEL_API_URL ?? 'https://api.vercel.com').replace(/\/$/, '');
const VERCEL_CLI = process.env.VERCEL_CLI ?? 'npx --yes vercel@latest';

// ---------------------------------------------------------------- output helpers
const isTTY = process.stdout.isTTY;
const c = (code: number) => (s: string) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c(32), yellow = c(33), red = c(31), bold = c(1), dim = c(2);
let stepNo = 0;
const step = (t: string) => console.log(`\n${bold(`${++stepNo}. ${t}`)}`);
const ok = (t: string) => console.log(`   ${green('✓')} ${t}`);
const warn = (t: string) => console.log(`   ${yellow('!')} ${t}`);
const info = (t: string) => console.log(`   ${dim(t)}`);
const todo: string[] = [];

class SetupError extends Error {}
const fail = (msg: string): never => {
  throw new SetupError(msg);
};

// ---------------------------------------------------------------- inputs
function loadInputs() {
  const file = path.join(ROOT, 'setup.env');
  if (!existsSync(file)) fail('setup.env not found. Copy setup.env.example to setup.env and fill it in.');
  const v = parse(readFileSync(file));
  const get = (k: string) => (v[k] ?? '').trim();
  let ref = get('SUPABASE_PROJECT_REF');
  const m = ref.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i) ?? ref.match(/project\/([a-z0-9]+)/i);
  if (m) ref = m[1];
  if (!/^[a-z0-9]{10,40}$/.test(ref)) fail('SUPABASE_PROJECT_REF is missing or not a project ref (e.g. abcdefghijklmnop).');
  if (!get('SUPABASE_ACCESS_TOKEN')) fail('SUPABASE_ACCESS_TOKEN is missing (supabase.com/dashboard/account/tokens).');
  if (!get('ADMIN_EMAIL').includes('@') || !get('ADMIN_NAME')) fail('ADMIN_EMAIL and ADMIN_NAME are required.');
  if (get('ADMIN_PASSWORD') && get('ADMIN_PASSWORD').length < 10) fail('ADMIN_PASSWORD needs at least 10 characters (or leave it empty for an invite).');

  let sa: { email: string; key: string; clientId: string } | null = null;
  const saPath = get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (saPath) {
    const p = path.resolve(ROOT, saPath);
    if (!existsSync(p)) {
      if (path.basename(saPath) !== 'google-key.json') warn(`Google key file not found at ${saPath} — service-account steps skipped.`);
    } else {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        if (!j.client_email || !j.private_key) throw new Error('missing client_email / private_key');
        sa = { email: j.client_email, key: j.private_key, clientId: String(j.client_id ?? '') };
      } catch (e) {
        fail(`${saPath} is not a service-account JSON key (${(e as Error).message}).`);
      }
    }
  }
  const bridgeUrl = get('GOOGLE_BRIDGE_URL');
  if (bridgeUrl && !process.env.SETUP_ALLOW_ANY_BRIDGE_URL && !/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]+\/exec\/?$/.test(bridgeUrl)) {
    fail('GOOGLE_BRIDGE_URL must be the Apps Script web app URL ending in /exec (Deploy → Manage deployments → Web app URL).');
  }
  const siteUrl = get('SITE_URL').replace(/\/$/, '');
  if (siteUrl && !/^https:\/\//.test(siteUrl)) fail('SITE_URL must start with https://');
  return {
    ref,
    token: get('SUPABASE_ACCESS_TOKEN'),
    admin: { email: get('ADMIN_EMAIL'), name: get('ADMIN_NAME'), password: get('ADMIN_PASSWORD') || null },
    sa,
    bridge: { url: bridgeUrl, secret: get('GOOGLE_BRIDGE_SECRET') },
    gmailUser: get('GMAIL_IMPERSONATE_USER'),
    gmailSender: get('GMAIL_SENDER') || get('GMAIL_IMPERSONATE_USER'),
    vercel: {
      token: get('VERCEL_TOKEN'),
      project: get('VERCEL_PROJECT_NAME') || 'lost-pod-dashboard',
      team: get('VERCEL_TEAM'),
    },
    siteUrl,
    smtp: {
      host: get('SMTP_HOST'), port: get('SMTP_PORT') || '587', user: get('SMTP_USER'), pass: get('SMTP_PASS'),
      sender: get('SMTP_SENDER_EMAIL'), name: get('SMTP_SENDER_NAME') || 'Lost & POD desk',
    },
    supabaseUrlOverride: process.env.SUPABASE_URL_OVERRIDE ?? '',
  };
}
type Inputs = ReturnType<typeof loadInputs>;

/** Write KEY=value into setup.env (replacing an existing line), so a generated secret survives re-runs. */
function saveSetupValue(key: string, value: string) {
  const file = path.join(ROOT, 'setup.env');
  const text = readFileSync(file, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(file, re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`);
}

// ---------------------------------------------------------------- Supabase Management API
function supabaseApi(inp: Inputs) {
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${SUPABASE_API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${inp.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (r.status === 401) fail('Supabase rejected SUPABASE_ACCESS_TOKEN (401). Generate a new token and paste it again.');
    if (r.status === 403 || r.status === 404) fail(`Supabase: no access to project "${inp.ref}" (${r.status}). Check SUPABASE_PROJECT_REF and that the token belongs to an owner/admin of that project.`);
    if (!r.ok) fail(`Supabase ${method} ${p} failed (${r.status}): ${text.slice(0, 600)}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    call,
    sql: (query: string) => call('POST', `/v1/projects/${inp.ref}/database/query`, { query }) as Promise<Record<string, unknown>[]>,
  };
}

// Recognises migrations that were run by hand in the SQL editor before this script existed.
const ALREADY_APPLIED: Record<string, string> = {
  '20260901000000_schema.sql': `select to_regclass('public.cases') is not null as ok`,
  '20260901000100_functions.sql': `select exists (select 1 from pg_proc where proname = 'import_sheet_rows') as ok`,
  '20260901000200_rls.sql': `select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cases' and policyname = 'cases_read') as ok`,
  '20260901000300_email_cases.sql': `select exists (select 1 from pg_proc where proname = 'create_email_cases') as ok`,
};

async function runMigrations(api: ReturnType<typeof supabaseApi>) {
  await api.sql(`create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;
revoke all on public.app_migrations from anon, authenticated;`);
  const done = new Set(((await api.sql('select name from public.app_migrations')) ?? []).map((r) => String(r.name)));
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) {
      info(`${f} — already applied`);
      continue;
    }
    if (ALREADY_APPLIED[f]) {
      const [row] = await api.sql(ALREADY_APPLIED[f]);
      if (row?.ok === true) {
        await api.sql(`insert into public.app_migrations (name) values ('${f}') on conflict do nothing`);
        info(`${f} — found (run earlier by hand), recorded`);
        continue;
      }
    }
    const body = readFileSync(path.join(dir, f), 'utf8');
    // One request = one implicit transaction: a failing file leaves nothing half-applied.
    await api.sql(`${body}\n;\ninsert into public.app_migrations (name) values ('${f}');`);
    ok(`${f} applied`);
  }
  await api.sql(readFileSync(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  ok('Reference data loaded (statuses, aging buckets, settings, wording, clients, tracker tabs)');
  const [counts] = await api.sql(`select (select count(*) from public.clients)::int as clients, (select count(*) from public.sheet_sources)::int as tabs, (select count(*) from public.status_master)::int as statuses`);
  info(`${counts.clients} clients, ${counts.tabs} tracker tabs, ${counts.statuses} statuses in the database`);
}

const INVITE_HTML = `<h2>You're invited to the Lost &amp; POD desk</h2>
<p>An admin has created an account for you. Click the button below to set your password and sign in.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite" style="display:inline-block;padding:10px 16px;background:#1F5FBF;color:#ffffff;text-decoration:none;border-radius:4px">Set my password</a></p>
<p style="color:#4A5566;font-size:13px">If you were not expecting this, you can ignore this email.</p>`;

const RECOVERY_HTML = `<h2>Reset your password</h2>
<p>Click the button below to choose a new password for the Lost &amp; POD desk.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery" style="display:inline-block;padding:10px 16px;background:#1F5FBF;color:#ffffff;text-decoration:none;border-radius:4px">Choose a new password</a></p>
<p style="color:#4A5566;font-size:13px">If you did not ask for this, you can ignore this email; your password stays the same.</p>`;

/** Returns true when the custom email templates were saved (needs a custom SMTP server on the free plan). */
async function configureAuth(api: ReturnType<typeof supabaseApi>, inp: Inputs, siteUrl: string, extraUrls: string[] = []): Promise<boolean> {
  const allow = [...new Set([`${siteUrl}/auth/confirm`, `${siteUrl}/**`, 'http://localhost:3000/auth/confirm', 'http://localhost:3000/**', ...extraUrls])];
  const body: Record<string, unknown> = {
    site_url: siteUrl,
    uri_allow_list: allow.join(','),
    disable_signup: true,
    external_email_enabled: true,
    password_min_length: 10,
  };
  const s = inp.smtp;
  const hasSmtp = !!(s.host && s.user && s.pass && s.sender);
  if (hasSmtp) {
    Object.assign(body, {
      smtp_host: s.host, smtp_port: s.port, smtp_user: s.user, smtp_pass: s.pass, smtp_admin_email: s.sender, smtp_sender_name: s.name,
    });
  }
  await api.call('PATCH', `/v1/projects/${inp.ref}/config/auth`, body);
  // Supabase's free plan only allows template changes with a custom SMTP server. Without them the
  // standard emails are used; the app handles their links at /auth/callback, so both work.
  try {
    await api.call('PATCH', `/v1/projects/${inp.ref}/config/auth`, {
      mailer_subjects_invite: "You're invited to the Lost & POD desk",
      mailer_templates_invite_content: INVITE_HTML,
      mailer_subjects_recovery: 'Reset your Lost & POD desk password',
      mailer_templates_recovery_content: RECOVERY_HTML,
    });
    return true;
  } catch (e) {
    if (/template|free tier|smtp/i.test((e as Error).message)) return false;
    throw e;
  }
}

interface ApiKey {
  name?: string;
  api_key?: string | null;
  type?: string | null;
}

async function projectKeys(api: ReturnType<typeof supabaseApi>, inp: Inputs) {
  const keys = ((await api.call('GET', `/v1/projects/${inp.ref}/api-keys?reveal=true`)) ?? []) as ApiKey[];
  const pick = (names: string[], type: string) =>
    keys.find((k) => k.name && names.includes(k.name) && k.api_key)?.api_key ??
    keys.find((k) => k.type === type && k.api_key)?.api_key ??
    null;
  const anon = pick(['anon'], 'publishable');
  const service = pick(['service_role'], 'secret');
  if (!anon || !service) fail('Could not read the project API keys. Check that the access token belongs to an owner/admin of the project.');
  return { anon: anon!, service: service! };
}

// ---------------------------------------------------------------- .env.local
function readEnvLocal(): Record<string, string> {
  const p = path.join(ROOT, '.env.local');
  return existsSync(p) ? parse(readFileSync(p)) : {};
}

function writeEnvLocal(values: Record<string, string>) {
  const p = path.join(ROOT, '.env.local');
  if (existsSync(p)) copyFileSync(p, `${p}.bak`);
  const q = (v: string) => (/[\s"#'\\\n]/.test(v) ? JSON.stringify(v) : v);
  const lines = [
    '# Written by `npm run setup`. Re-running setup rewrites this file (the previous one is kept as .env.local.bak).',
    ...Object.entries(values).map(([k, v]) => `${k}=${q(v)}`),
    '',
  ];
  writeFileSync(p, lines.join('\n'), { mode: 0o600 });
}

// ---------------------------------------------------------------- Vercel
function vercelApi(inp: Inputs) {
  const teamQs = (p: string) => (inp.vercel.team ? `${p}${p.includes('?') ? '&' : '?'}${/^team_/.test(inp.vercel.team) ? 'teamId' : 'slug'}=${encodeURIComponent(inp.vercel.team)}` : p);
  return async (method: string, p: string, body?: unknown, allow404 = false) => {
    const r = await fetch(`${VERCEL_API}${teamQs(p)}`, {
      method,
      headers: { Authorization: `Bearer ${inp.vercel.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (allow404 && r.status === 404) return null;
    if (r.status === 401 || r.status === 403) fail(`Vercel rejected VERCEL_TOKEN (${r.status}). Create a new token${inp.vercel.team ? ' with access to the team' : ''}.`);
    if (!r.ok) fail(`Vercel ${method} ${p} failed (${r.status}): ${text.slice(0, 600)}`);
    return text ? JSON.parse(text) : null;
  };
}

function runVercelDeploy(inp: Inputs, ids: { orgId: string; projectId: string }): { ok: boolean; output: string; url: string | null } {
  const parts = VERCEL_CLI.split(' ');
  const cliArgs = [...parts.slice(1), 'deploy', '--prod', '--yes', '--token', inp.vercel.token];
  const r = spawnSync(parts[0], cliArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, VERCEL_ORG_ID: ids.orgId, VERCEL_PROJECT_ID: ids.projectId },
    maxBuffer: 50 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const urls = output.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? [];
  return { ok: r.status === 0, output, url: urls.length ? urls[urls.length - 1] : null };
}

async function deployToVercel(inp: Inputs, env: Record<string, string>): Promise<string> {
  const v = vercelApi(inp);
  let project = await v('GET', `/v9/projects/${encodeURIComponent(inp.vercel.project)}`, undefined, true);
  if (!project) {
    project = await v('POST', '/v10/projects', { name: inp.vercel.project, framework: 'nextjs' });
    ok(`Vercel project "${inp.vercel.project}" created`);
  } else ok(`Vercel project "${inp.vercel.project}" found`);
  const ids = { orgId: project.accountId as string, projectId: project.id as string };

  const upsertEnv = async (vars: Record<string, string>) => {
    const payload = Object.entries(vars).map(([key, value]) => ({ key, value, type: 'encrypted', target: ['production', 'preview'] }));
    await v('POST', `/v10/projects/${ids.projectId}/env?upsert=true`, payload);
  };

  let siteUrl = inp.siteUrl || `https://${inp.vercel.project}.vercel.app`;
  await upsertEnv({ ...env, NEXT_PUBLIC_SITE_URL: siteUrl });
  ok(`${Object.keys(env).length + 1} environment variables saved in Vercel`);

  const vercelJson = path.join(ROOT, 'vercel.json');
  const original = readFileSync(vercelJson, 'utf8');
  let hobbyCron = false;
  try {
    info('Building and deploying (2–4 minutes)…');
    let d = runVercelDeploy(inp, ids);
    if (!d.ok && /cron/i.test(d.output) && /hobby|daily|once per day|plan/i.test(d.output)) {
      // Vercel Hobby only allows daily crons: run the tracker sync once a day instead of every 30 minutes.
      hobbyCron = true;
      const cfg = JSON.parse(original);
      cfg.crons = cfg.crons.map((x: { path: string; schedule: string }) => (x.path.includes('sync-sheets') ? { ...x, schedule: '0 2 * * *' } : x));
      writeFileSync(vercelJson, JSON.stringify(cfg, null, 2) + '\n');
      warn('Your Vercel plan only allows daily scheduled jobs: tracker sync set to once a day (07:30 IST). Upgrade to Pro for every 30 minutes.');
      d = runVercelDeploy(inp, ids);
    }
    if (!d.ok) {
      console.log(dim(d.output.split('\n').slice(-30).join('\n')));
      fail('Vercel deployment failed (output above).');
    }

    // The production address Vercel actually gave the project.
    const fresh = await v('GET', `/v9/projects/${ids.projectId}`);
    const aliases: string[] = fresh?.targets?.production?.alias ?? fresh?.alias?.map((a: { domain: string }) => a.domain) ?? [];
    const vercelApp = aliases.filter((a) => a.endsWith('.vercel.app')).sort((a, b) => a.length - b.length)[0];
    const finalUrl = inp.siteUrl || (vercelApp ? `https://${vercelApp}` : d.url ?? siteUrl);
    if (finalUrl !== siteUrl) {
      siteUrl = finalUrl;
      await upsertEnv({ NEXT_PUBLIC_SITE_URL: siteUrl });
      info(`Production address is ${siteUrl}; redeploying once so links in emails use it…`);
      const again = runVercelDeploy(inp, ids);
      if (!again.ok) {
        console.log(dim(again.output.split('\n').slice(-30).join('\n')));
        fail('Second Vercel deployment failed (output above).');
      }
    }
    ok(`Deployed: ${siteUrl}`);
  } finally {
    if (hobbyCron) {
      // Keep the daily schedule in the repo too, so a later GitHub deploy does not fail the same way.
      todo.push('vercel.json was changed to a daily tracker sync for the Hobby plan — commit it if you deploy from GitHub.');
    } else writeFileSync(vercelJson, original);
  }
  return siteUrl;
}

// ---------------------------------------------------------------- Google checks
async function checkGoogle(inp: Inputs, serviceKey: string, supabaseUrl: string): Promise<{ sheets: boolean; gmail: boolean }> {
  const res = { sheets: false, gmail: false };
  const useBridge = !!inp.bridge.url;
  let readerEmail = inp.sa?.email ?? '';
  if (useBridge) {
    const { callBridge } = await import('../src/lib/google/bridge');
    try {
      const p = await callBridge<{ email: string }>('ping', {}, 60_000);
      readerEmail = p.email;
      ok(`Google bridge is running as ${p.email}`);
    } catch (e) {
      warn(`Google bridge: ${(e as Error).message}`);
      todo.push(`Fix the Google bridge (SETUP.md, part B): check the Web app URL and that the BRIDGE_SECRET script property is exactly:\n      ${inp.bridge.secret}`);
      return res;
    }
  } else if (!inp.sa) {
    warn('No Google connection yet — skipping Sheets and Gmail.');
    todo.push(`Install the Google bridge in Apps Script (SETUP.md, part B). Use this value for the BRIDGE_SECRET script property:\n      ${inp.bridge.secret}\n   then put the Web app URL in setup.env as GOOGLE_BRIDGE_URL and run \`npm run setup\` again.`);
    return res;
  }
  const { getWorkbook } = await import('../src/lib/google/sheets');
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data } = await sb.from('sheet_sources').select('workbook_id, workbook_name').eq('is_active', true);
  const books = [...new Map((data ?? []).map((r) => [r.workbook_id as string, r.workbook_name as string])).entries()];
  const unshared: string[] = [];
  for (const [id, name] of books) {
    try {
      await getWorkbook(id);
      ok(`Sheets: can read "${name}"`);
      res.sheets = true;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/disabled|has not been used|not enabled/i.test(msg)) {
        warn('Google Sheets API is not enabled in the Google Cloud project.');
        todo.push('Enable the Google Sheets API in Google Cloud (APIs & Services → Library), then run setup again.');
        break;
      }
      unshared.push(`${name}  https://docs.google.com/spreadsheets/d/${id}`);
      warn(`Sheets: cannot read "${name}" (${msg.split('\n')[0].slice(0, 120)})`);
    }
  }
  if (unshared.length) {
    todo.push(`${useBridge ? `Make sure ${readerEmail} can open these workbooks (ask the owner to share them)` : `Share these workbooks with ${readerEmail} as Viewer`}, then run setup again:\n      - ${unshared.join('\n      - ')}`);
  }

  if (useBridge) {
    try {
      const { callBridge } = await import('../src/lib/google/bridge');
      await callBridge('searchThreads', { query: 'newer_than:2d', max: 1 }, 60_000);
      ok(`Gmail: can search ${readerEmail}'s mailbox; the daily report will be sent from it`);
      res.gmail = true;
    } catch (e) {
      warn(`Gmail via bridge: ${(e as Error).message}`);
      todo.push('Open the Apps Script project, run any function once (or redeploy) and accept the Gmail permission, then run setup again.');
    }
    return res;
  }
  if (!inp.gmailUser) {
    warn('GMAIL_IMPERSONATE_USER is empty — skipping Gmail.');
    todo.push('Set GMAIL_IMPERSONATE_USER in setup.env (the escalations mailbox) and run setup again.');
    return res;
  }
  try {
    const { gmail } = await import('@googleapis/gmail');
    const { googleAuth, SCOPES } = await import('../src/lib/google/auth');
    const g = gmail({ version: 'v1', auth: googleAuth(SCOPES.gmailRead, 'gmail') });
    const p = await g.users.getProfile({ userId: 'me' });
    ok(`Gmail: connected to ${p.data.emailAddress} (${p.data.messagesTotal ?? '?'} messages)`);
    res.gmail = true;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    warn(`Gmail: not connected yet (${msg.split('\n')[0].slice(0, 140)})`);
    if (/unauthorized_client|delegation|not authorized/i.test(msg)) {
      todo.push(`Turn on domain-wide delegation for client ID ${inp.sa?.clientId || '(client_id in the key file)'} (SETUP.md, part C). It can take up to an hour to apply; then run setup again.`);
    } else if (/disabled|not been used|not enabled/i.test(msg)) {
      todo.push('Enable the Gmail API in Google Cloud (APIs & Services → Library), then run setup again.');
    } else {
      todo.push('Gmail could not be reached; check GMAIL_IMPERSONATE_USER and domain-wide delegation (SETUP.md, part C).');
    }
  }
  return res;
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(bold('Lost & POD desk — setup'));
  const inp = loadInputs();
  const api = supabaseApi(inp);
  const supabaseUrl = inp.supabaseUrlOverride || `https://${inp.ref}.supabase.co`;
  const previous = readEnvLocal();

  step('Supabase project');
  const proj = await api.call('GET', `/v1/projects/${inp.ref}`);
  if (proj?.status && !/ACTIVE_HEALTHY/i.test(String(proj.status))) {
    fail(`Project "${proj.name ?? inp.ref}" is ${proj.status}. Restore/unpause it in the Supabase dashboard, then run setup again.`);
  }
  ok(`Connected to "${proj?.name ?? inp.ref}" (${proj?.region ?? 'region unknown'})`);
  const keys = await projectKeys(api, inp);
  ok('API keys read');

  step('Database tables, security rules and reference data');
  await runMigrations(api);

  const provisionalSite = inp.siteUrl || previous.NEXT_PUBLIC_SITE_URL?.replace(/^http:\/\/localhost:3000$/, '') || (inp.vercel.token ? `https://${inp.vercel.project}.vercel.app` : 'http://localhost:3000');
  step('Sign-in settings and email templates');
  const templates = await configureAuth(api, inp, provisionalSite);
  ok('Public sign-up turned off (only admins create accounts)');
  if (templates) ok('Branded invite and reset-password emails saved');
  else info("Supabase's standard invite/reset emails kept (custom wording needs SMTP on the free plan) — their links work as they are");
  ok(`Site URL ${provisionalSite} and redirect URLs set`);
  if (inp.smtp.host) ok(`Emails sent through ${inp.smtp.host}`);
  else {
    warn("Using Supabase's built-in mailer (only a few emails per hour). Add SMTP_* to setup.env before inviting the whole team.");
  }

  if (!inp.bridge.secret) {
    inp.bridge.secret = previous.GOOGLE_BRIDGE_SECRET || randomBytes(24).toString('hex');
    saveSetupValue('GOOGLE_BRIDGE_SECRET', inp.bridge.secret);
  }
  const env: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
    SUPABASE_SERVICE_ROLE_KEY: keys.service,
    CRON_SECRET: previous.CRON_SECRET || randomBytes(24).toString('hex'),
    ...(inp.bridge.url ? { GOOGLE_BRIDGE_URL: inp.bridge.url, GOOGLE_BRIDGE_SECRET: inp.bridge.secret } : {}),
    ...(inp.sa && !inp.bridge.url ? { GOOGLE_SERVICE_ACCOUNT_EMAIL: inp.sa.email, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: inp.sa.key } : {}),
    ...(inp.gmailUser ? { GMAIL_IMPERSONATE_USER: inp.gmailUser } : {}),
    ...(inp.gmailSender ? { GMAIL_SENDER: inp.gmailSender } : {}),
  };
  Object.assign(process.env, env, { NEXT_PUBLIC_SITE_URL: provisionalSite });

  step('Local settings file');
  writeEnvLocal({ ...env, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' });
  ok('.env.local written (for `npm run dev` and the command-line tools)');

  step('First Super Admin');
  const sb = createClient(supabaseUrl, keys.service, { auth: { persistSession: false } });
  const r = await ensureSuperAdmin(sb, { ...inp.admin, siteUrl: provisionalSite });
  if (r === 'created') ok(`${inp.admin.email} created — sign in with the password from setup.env`);
  else if (r === 'invited') ok(`Invitation sent to ${inp.admin.email}`);
  else ok(`${inp.admin.email} already exists — kept as Super Admin${inp.admin.password ? ' (password updated)' : ''}`);

  step('Google Sheets and Gmail');
  const g = await checkGoogle(inp, keys.service, supabaseUrl);

  step('First import of the trackers');
  if (args.has('--skip-sync') || args.has('--only-supabase')) info('Skipped (--skip-sync).');
  else if (!g.sheets) info('Skipped: no tracker workbook is readable yet.');
  else {
    const [{ n }] = (await api.sql('select count(*)::int as n from public.sync_runs')) as { n: number }[];
    if (n > 0 && !args.has('--sync')) info('Trackers were imported before; the scheduled sync keeps them up to date (use --sync to force).');
    else {
      info('Reading every active tab (a few minutes for ~6,000 rows)…');
      const { syncSources } = await import('../src/lib/importer/sheets-sync');
      const { results } = await syncSources(sb, { actor: null, trigger: 'cli', timeBudgetMs: 60 * 60 * 1000 });
      for (const x of results) (x.status === 'failed' ? warn : ok)(`${x.label}: ${x.message}`);
    }
  }

  let liveUrl: string | null = null;
  step('Vercel deployment');
  if (args.has('--skip-vercel') || args.has('--only-supabase')) info('Skipped (--skip-vercel).');
  else if (!inp.vercel.token) {
    info('Skipped: VERCEL_TOKEN is empty. Add it to setup.env and run setup again to deploy.');
    todo.push('Add VERCEL_TOKEN to setup.env and run `npm run setup` again to put the app online.');
  } else {
    liveUrl = await deployToVercel(inp, env);
    if (liveUrl !== provisionalSite) {
      await configureAuth(api, inp, liveUrl);
      ok(`Supabase sign-in links now point to ${liveUrl}`);
    }
  }

  console.log(`\n${bold(green('Setup finished.'))}`);
  if (liveUrl) console.log(`   App:    ${bold(liveUrl)}`);
  console.log(`   Local:  npm run dev  →  http://localhost:3000`);
  console.log(`   Admin:  ${inp.admin.email}`);
  if (todo.length) {
    console.log(`\n${bold(yellow('Still to do:'))}`);
    todo.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }
}

main().catch((e) => {
  if (e instanceof SetupError) console.error(`\n${red('✗')} ${e.message}`);
  else console.error(`\n${red('✗ Unexpected error:')}`, e);
  process.exit(1);
});
