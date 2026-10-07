'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin, type Role } from '@/lib/auth';
import { errorText, must, str, strOrNull, withFlash } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';
import { assertCanManage, createLogin, ROLES, sendPasswordReset, setLoginActive, setLoginRole } from '@/lib/users';

async function done(fn: () => Promise<string>): Promise<never> {
  let dest: string;
  try {
    dest = withFlash('/users', 'ok', await fn());
  } catch (e) {
    dest = withFlash('/users', 'error', errorText(e));
  }
  revalidatePath('/users');
  redirect(dest);
}

async function target(id: string) {
  const sb = await createClient();
  return must(await sb.from('profiles').select('id, email, full_name, role, is_active').eq('id', id).single()) as {
    id: string; email: string; full_name: string | null; role: Role; is_active: boolean;
  };
}

export async function createUser(fd: FormData) {
  const actor = await requireAdmin();
  await done(async () => {
    const role = str(fd, 'role') as Role;
    if (!ROLES.includes(role)) throw new Error('Choose a role.');
    assertCanManage(actor, null, null, role);
    const email = str(fd, 'email').toLowerCase();
    const name = str(fd, 'full_name');
    if (!email.includes('@') || !name) throw new Error('Name and email are required.');
    const clientId = strOrNull(fd, 'client_id');
    if (role === 'client_poc' && !clientId) throw new Error('Choose the client this POC belongs to.');
    const id = await createLogin({ email, fullName: name, role, password: strOrNull(fd, 'password') });
    if (role === 'client_poc' && clientId) {
      const sb = await createClient();
      const existing = await sb.from('client_pocs').select('id').eq('client_id', clientId).ilike('name', name).maybeSingle();
      if (existing.data) must(await sb.from('client_pocs').update({ user_id: id, email }).eq('id', existing.data.id).select('id'));
      else must(await sb.from('client_pocs').insert({ client_id: clientId, name, email, user_id: id }).select('id'));
    }
    return `${name} added. ${strOrNull(fd, 'password') ? 'Share the password securely.' : 'An invitation email was sent.'}`;
  });
}

export async function changeRole(fd: FormData) {
  const actor = await requireAdmin();
  await done(async () => {
    const t = await target(str(fd, 'id'));
    const role = str(fd, 'role') as Role;
    if (!ROLES.includes(role)) throw new Error('Unknown role.');
    assertCanManage(actor, t.id, t.role, role);
    await setLoginRole(t.id, role);
    return `${t.full_name ?? t.email} is now ${role.replace('_', ' ')}.`;
  });
}

export async function setActive(fd: FormData) {
  const actor = await requireAdmin();
  await done(async () => {
    const t = await target(str(fd, 'id'));
    assertCanManage(actor, t.id, t.role, null);
    const active = str(fd, 'active') === '1';
    await setLoginActive(t.id, active);
    return active ? `${t.email} can sign in again.` : `${t.email} is deactivated and signed out everywhere.`;
  });
}

export async function resetPassword(fd: FormData) {
  const actor = await requireAdmin();
  await done(async () => {
    const t = await target(str(fd, 'id'));
    assertCanManage(actor, t.id === actor.id ? null : t.id, t.role, null);
    await sendPasswordReset(t.email);
    return `Password reset email sent to ${t.email}.`;
  });
}
