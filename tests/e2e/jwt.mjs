import { createHmac } from 'node:crypto';
export const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 * 6, iat: Math.floor(Date.now() / 1000), ...payload });
  const s = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
export const USERS = {
  super: { id: '00000000-0000-0000-0000-000000000001', email: 'super@sfx.test' },
  admin: { id: '00000000-0000-0000-0000-000000000002', email: 'admin@sfx.test' },
  agent: { id: '00000000-0000-0000-0000-000000000003', email: 'agent@sfx.test' },
  poc: { id: '00000000-0000-0000-0000-000000000004', email: 'poc@velocity.test' },
  poc2: { id: '00000000-0000-0000-0000-000000000005', email: 'poc@naaptol.test' },
};
export const tokenFor = (k) => sign({ sub: USERS[k].id, email: USERS[k].email, role: 'authenticated' });
export const SERVICE = sign({ role: 'service_role', aud: undefined });
export const ANON = sign({ role: 'anon', aud: undefined });
/** @supabase/ssr cookie: base64-<base64url(session json)> under sb-<ref>-auth-token. */
export function sessionCookie(k) {
  const access = tokenFor(k);
  const session = {
    access_token: access, token_type: 'bearer', expires_in: 21600, expires_at: Math.floor(Date.now() / 1000) + 21600,
    refresh_token: 'fake-refresh', user: { id: USERS[k].id, email: USERS[k].email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
  };
  return `sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}
