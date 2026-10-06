/**
 * Creates (or promotes) the first Super Admin.
 *   npm run create-admin -- you@shadowfax.in "Your Name" [password]
 * Without a password an invitation email is sent.
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
import { ensureSuperAdmin } from './_admin';

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npm run create-admin -- email@shadowfax.in "Full Name" [password]');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const r = await ensureSuperAdmin(sb, { email, name, password, siteUrl: site });
  console.log(`Super Admin ready: ${email}${r === 'invited' ? ' (invitation email sent)' : ''}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
