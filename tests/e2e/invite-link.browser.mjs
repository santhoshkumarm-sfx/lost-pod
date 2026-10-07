// Browser check of /auth/callback with Supabase-style invite links. Run after tests/e2e/run.sh:
//   node tests/e2e/invite-link.browser.mjs <path-to-chromium>   (needs playwright-core)
import { chromium } from 'playwright-core';
import { createHmac } from 'node:crypto';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (p) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const q = b64(p); return `${h}.${q}.${createHmac('sha256', 'super-secret-jwt-token-with-at-least-32-characters-long').update(`${h}.${q}`).digest('base64url')}`; };
const now = Math.floor(Date.now() / 1000);
const at = sign({ sub: '00000000-0000-0000-0000-000000000003', email: 'agent@sfx.test', role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 });
const browser = await chromium.launch({ executablePath: process.argv[2] });
const page = await browser.newPage();
const results = [];
// 1. Standard Supabase invite link lands with the session in the URL fragment
await page.goto(`http://localhost:3000/auth/callback?next=/update-password#access_token=${at}&refresh_token=rt&expires_in=3600&token_type=bearer&type=invite`);
await page.waitForURL('**/update-password', { timeout: 15000 }).catch(() => {});
results.push(['invite link → set-password page', page.url().endsWith('/update-password') && (await page.content()).includes('agent@sfx.test')]);
// 2. signed in afterwards: the dashboard opens
await page.goto('http://localhost:3000/dashboard');
results.push(['session kept → dashboard opens', page.url().endsWith('/dashboard')]);
// 3. expired link
const p2 = await browser.newPage();
await p2.goto('http://localhost:3000/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
await p2.waitForURL('**/login**', { timeout: 15000 }).catch(() => {});
results.push(['expired link → login with message', p2.url().includes('/login?error=') && (await p2.content()).includes('expired')]);
for (const [n, ok] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`);
await browser.close();
