// Renders every page as each role and reports HTTP status, redirects and error markers.
import { sessionCookie } from './jwt.mjs';

const BASE = 'http://localhost:3000';
async function caseIds(cookie) {
  const html = await (await fetch(`${BASE}/cases?category=all`, { headers: { cookie } })).text();
  return [...new Set([...html.matchAll(/href="\/cases\/([0-9a-f-]{36})"/g)].map((m) => m[1]))];
}

async function check(role, paths) {
  const cookie = sessionCookie(role);
  const out = [];
  for (const p of paths) {
    const r = await fetch(BASE + p, { headers: { cookie }, redirect: 'manual' });
    const body = r.status === 200 ? await r.text() : '';
    const err = /Something went wrong|Application error|Internal Server Error/.test(body);
    out.push(`${role.padEnd(6)} ${String(r.status).padEnd(4)} ${err ? 'ERROR ' : ''}${p}${r.headers.get('location') ? ' -> ' + r.headers.get('location') : ''}`);
  }
  return out;
}

const admin = sessionCookie('super');
const ids = await caseIds(admin);
const emailHtml = await (await fetch(`${BASE}/email-escalations?status=processed`, { headers: { cookie: admin } })).text();
const emailId = emailHtml.match(/href="\/email-escalations\/([0-9a-f-]{36})"/)?.[1];
const importsHtml = await (await fetch(`${BASE}/imports`, { headers: { cookie: admin } })).text();
const srcId = importsHtml.match(/href="\/imports\/([0-9a-f-]{36})"/)?.[1];
const clientsHtml = await (await fetch(`${BASE}/clients`, { headers: { cookie: admin } })).text();
const clientId = clientsHtml.match(/href="\/clients\/([0-9a-f-]{36})"/)?.[1];

const internal = ['/', '/dashboard', '/dashboard?source=email', '/cases', '/cases?category=all&q=R2466544662BDM%20R2460991811BDM', '/cases?q=Velocity&sort=awb&dir=asc',
  '/cases?aging=0%E2%80%932&sla=1', '/cases/new', ...ids.slice(0, 4).map((i) => `/cases/${i}`), '/email-escalations', '/email-escalations?status=processed',
  `/email-escalations/${emailId}`, '/email-escalations/new', '/email-escalations/new?mode=paste', '/email-escalations/new?subject=Regarding%20POD',
  '/imports', `/imports/${srcId}`, '/imports/mappings', '/lost-approval', '/lost', '/lost?from=2026-01-01&to=2026-12-31', '/clients', `/clients/${clientId}`,
  '/pocs', '/users', '/reports', '/reports/preview', '/settings', '/audit', '/audit?view=cases', '/audit?view=removed', '/data-quality', '/notifications',
  '/api/export/cases?format=csv&category=all', '/api/export/cases?format=xlsx', '/reports/download'];
const lines = [
  ...(await check('super', internal)),
  ...(await check('agent', ['/dashboard', '/cases', `/cases/${ids[0]}`, '/lost-approval', '/users', '/settings', '/portal', '/reports/preview'])),
  ...(await check('poc', ['/', '/portal', '/portal?category=all', '/dashboard', '/cases', ...ids.slice(0, 11).map((i) => `/portal/cases/${i}`), '/api/export/cases?format=csv&category=all'])),
];
console.log(lines.join('\n'));
