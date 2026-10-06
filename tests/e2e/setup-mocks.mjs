// Local stand-ins for the services `npm run setup` talks to, so the setup script can be tested end to end:
//   :4001  Supabase Management API (projects, api-keys, database/query, config/auth) backed by a real Postgres
//   :54321 Supabase project gateway (/rest/v1 → PostgREST on :3001, /auth/v1/admin/* and /auth/v1/invite)
//   :4002  Vercel REST API (projects, env)
// State the tests assert on is written to $MOCK_STATE.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ANON, SERVICE } from './jwt.mjs';

const DB = process.env.MOCK_DB ?? 'lostpod_setup';
const STATE = process.env.MOCK_STATE;
const PSQL = ['-h', 'localhost', '-p', process.env.PGPORT ?? '5433', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-At'];
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { auth: [], projects: {}, env: {}, sql: 0 });
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const psql = (sql, single = false) => execFileSync('psql', [...PSQL, ...(single ? ['--single-transaction'] : []), '-c', sql], { encoding: 'utf8' });
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const body = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString();
  return t ? JSON.parse(t) : null;
};
const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(data === undefined ? '' : JSON.stringify(data));
};

// ---------------- Supabase Management API
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer sbp_test_token') return send(res, 401, { message: 'Unauthorized' });
  const m = u.pathname.match(/^\/v1\/projects\/([a-z0-9]+)(\/.*)?$/);
  if (!m || m[1] !== 'abcdefghijklmnopqrst') return send(res, 404, { message: 'project not found' });
  const rest = m[2] ?? '';
  const s = load();
  if (req.method === 'GET' && rest === '') return send(res, 200, { name: 'lost-pod', region: 'ap-south-1', status: 'ACTIVE_HEALTHY' });
  if (req.method === 'GET' && rest === '/api-keys') return send(res, 200, [{ name: 'anon', api_key: ANON }, { name: 'service_role', api_key: SERVICE }]);
  if (req.method === 'PATCH' && rest === '/config/auth') {
    s.authConfig = { ...(s.authConfig ?? {}), ...(await body(req)) };
    s.authPatches = (s.authPatches ?? 0) + 1;
    save(s);
    return send(res, 200, s.authConfig);
  }
  if (req.method === 'POST' && rest === '/database/query') {
    const { query } = await body(req);
    s.sql++;
    save(s);
    try {
      const single = /^\s*select\b/i.test(query) && !query.trim().replace(/;\s*$/, '').includes(';');
      if (single) {
        const out = psql(`select coalesce(json_agg(t), '[]'::json) from (${query.trim().replace(/;\s*$/, '')}) t`);
        return send(res, 201, JSON.parse(out.trim()));
      }
      psql(query, true);
      psql(`notify pgrst, 'reload schema'`);
      return send(res, 201, []);
    } catch (e) {
      return send(res, 400, { message: String(e.stderr ?? e.message).slice(0, 800) });
    }
  }
  send(res, 404, { message: `no mock for ${req.method} ${u.pathname}` });
}).listen(4001);

// ---------------- Project gateway (REST + GoTrue admin)
const user = (row) => ({ id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, app_metadata: row.app, user_metadata: row.meta, created_at: new Date().toISOString() });
http.createServer((req, res) => gateway(req, res).catch((e) => send(res, 500, { message: String(e.stderr ?? e.message) })))
  .listen(54321);
async function gateway(req, res) {
  const u = new URL(req.url, 'http://x');
  const s = load();
  if (u.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
    const b = await body(req);
    const id = randomUUID();
    psql(`insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values (${lit(id)}, ${lit(b.email)}, ${lit(JSON.stringify(b.app_metadata ?? {}))}, ${lit(JSON.stringify(b.user_metadata ?? {}))})`);
    s.auth.push({ op: 'create', email: b.email, password: !!b.password });
    save(s);
    return send(res, 200, user({ id, email: b.email, app: b.app_metadata, meta: b.user_metadata }));
  }
  if (u.pathname === '/auth/v1/invite' && req.method === 'POST') {
    const b = await body(req);
    const id = randomUUID();
    psql(`insert into auth.users (id, email, raw_user_meta_data) values (${lit(id)}, ${lit(b.email)}, ${lit(JSON.stringify(b.data ?? {}))})`);
    s.auth.push({ op: 'invite', email: b.email, redirect: u.searchParams.get('redirect_to') });
    save(s);
    return send(res, 200, user({ id, email: b.email, app: {}, meta: b.data }));
  }
  const um = u.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (um && req.method === 'PUT') {
    const b = await body(req);
    if (b.app_metadata) psql(`update auth.users set raw_app_meta_data = ${lit(JSON.stringify(b.app_metadata))} where id = ${lit(um[1])}`);
    s.auth.push({ op: 'update', id: um[1], keys: Object.keys(b) });
    save(s);
    return send(res, 200, user({ id: um[1], email: '', app: b.app_metadata ?? {}, meta: {} }));
  }
  if (!u.pathname.startsWith('/rest/v1')) return send(res, 404, { message: `no mock for ${req.method} ${u.pathname}` });
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  const r = await fetch('http://127.0.0.1:3001' + u.pathname.slice('/rest/v1'.length) + u.search, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const out = Buffer.from(await r.arrayBuffer());
  const h = {};
  r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v; });
  res.writeHead(r.status, h);
  res.end(out);
}

// ---------------- Vercel REST API
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer vercel_test_token') return send(res, 403, { error: { message: 'forbidden' } });
  const s = load();
  let m = u.pathname.match(/^\/v9\/projects\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const p = Object.values(s.projects).find((x) => x.id === m[1] || x.name === decodeURIComponent(m[1]));
    if (!p) return send(res, 404, { error: { code: 'not_found' } });
    return send(res, 200, { ...p, targets: p.deployments ? { production: { alias: [`${p.name}-sfx.vercel.app`, `${p.name}-git-main-sfx.vercel.app`] } } : {} });
  }
  if (u.pathname === '/v10/projects' && req.method === 'POST') {
    const b = await body(req);
    const p = { id: `prj_${randomUUID().slice(0, 8)}`, accountId: 'team_fake', name: b.name, framework: b.framework, deployments: 0 };
    s.projects[p.id] = p;
    save(s);
    return send(res, 200, p);
  }
  m = u.pathname.match(/^\/v10\/projects\/([^/]+)\/env$/);
  if (m && req.method === 'POST' && u.searchParams.get('upsert') === 'true') {
    const list = await body(req);
    s.env[m[1]] = { ...(s.env[m[1]] ?? {}) };
    for (const e of list) s.env[m[1]][e.key] = { value: e.value, type: e.type, target: e.target };
    save(s);
    return send(res, 201, { created: list });
  }
  send(res, 404, { error: { message: `no mock for ${req.method} ${u.pathname}` } });
}).listen(4002, () => console.log('setup mocks listening on 4001, 54321, 4002'));
