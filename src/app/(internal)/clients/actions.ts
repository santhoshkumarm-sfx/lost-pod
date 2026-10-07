'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { errorText, must, str, strOrNull, withFlash } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLogin, setLoginActive } from '@/lib/users';

async function done(back: string, fn: () => Promise<string>): Promise<never> {
  let dest: string;
  try {
    dest = withFlash(back, 'ok', await fn());
  } catch (e) {
    dest = withFlash(back, 'error', errorText(e));
  }
  revalidatePath(back.split('?')[0]);
  redirect(dest);
}

const list = (v: string) => [...new Set(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];

export async function saveClient(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'id');
  await done(id ? `/clients/${id}` : '/clients', async () => {
    const sb = await createClient();
    const sla = Number(str(fd, 'sla_days'));
    const row = {
      name: str(fd, 'name'), code: strOrNull(fd, 'code')?.toUpperCase() ?? null, aliases: list(str(fd, 'aliases')),
      email_domains: list(str(fd, 'email_domains')).map((d) => d.toLowerCase().replace(/^@/, '')),
      sla_days: sla > 0 ? sla : null, is_active: id ? str(fd, 'is_active') === '1' : true,
    };
    if (!row.name) throw new Error('Client name is required.');
    if (id) must(await sb.from('clients').update(row).eq('id', id).select('id'));
    else must(await sb.from('clients').insert(row).select('id'));
    return id ? 'Client saved.' : `Client “${row.name}” added.`;
  });
}

/** Adds a client POC; optionally creates a portal login that only sees this client's cases. */
export async function savePoc(fd: FormData) {
  await requireAdmin();
  const back = str(fd, 'back') || '/pocs';
  await done(back, async () => {
    const sb = await createClient();
    const clientId = str(fd, 'client_id');
    const name = str(fd, 'name');
    const email = strOrNull(fd, 'email')?.toLowerCase() ?? null;
    if (!clientId || !name) throw new Error('Client and name are required.');
    let userId: string | null = null;
    if (str(fd, 'create_login') === '1') {
      if (!email) throw new Error('An email is needed to create a login.');
      userId = await createLogin({ email, fullName: name, role: 'client_poc', password: strOrNull(fd, 'password') });
    }
    const id = str(fd, 'id');
    const row = { client_id: clientId, name, email, phone: strOrNull(fd, 'phone'), ...(userId ? { user_id: userId } : {}) };
    if (id) must(await sb.from('client_pocs').update(row).eq('id', id).select('id'));
    else must(await sb.from('client_pocs').insert(row).select('id'));
    return userId ? `${name} added with a portal login. ${strOrNull(fd, 'password') ? 'Share the password securely.' : 'An invitation email was sent.'}` : `${name} saved.`;
  });
}

export async function createPocLogin(fd: FormData) {
  await requireAdmin();
  const back = str(fd, 'back') || '/pocs';
  await done(back, async () => {
    const sb = await createClient();
    const poc = must(await sb.from('client_pocs').select('id, name, email, user_id').eq('id', str(fd, 'id')).single()) as {
      id: string; name: string; email: string | null; user_id: string | null;
    };
    if (poc.user_id) throw new Error('This POC already has a login.');
    if (!poc.email) throw new Error('Add an email to the POC first.');
    const userId = await createLogin({ email: poc.email, fullName: poc.name, role: 'client_poc', password: null });
    must(await sb.from('client_pocs').update({ user_id: userId }).eq('id', poc.id).select('id'));
    return `Invitation sent to ${poc.email}.`;
  });
}

export async function setPocActive(fd: FormData) {
  await requireAdmin();
  const back = str(fd, 'back') || '/pocs';
  await done(back, async () => {
    const sb = await createClient();
    const active = str(fd, 'active') === '1';
    const poc = must(await sb.from('client_pocs').update({ is_active: active }).eq('id', str(fd, 'id')).select('user_id, name').single()) as { user_id: string | null; name: string };
    if (poc.user_id) {
      // A POC login with no active client link sees nothing; switching the login off also ends its sessions.
      const others = await createAdminClient().from('client_pocs').select('id').eq('user_id', poc.user_id).eq('is_active', true);
      if (!active && !others.data?.length) await setLoginActive(poc.user_id, false);
      if (active) await setLoginActive(poc.user_id, true);
    }
    return active ? `${poc.name} re-activated.` : `${poc.name} deactivated. Their portal access is removed.`;
  });
}
