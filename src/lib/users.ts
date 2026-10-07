import 'server-only';
import { publicEnv } from './env';
import type { Role, SessionUser } from './auth';
import { createAdminClient } from './supabase/admin';

export const ROLES: Role[] = ['super_admin', 'admin', 'internal_team', 'client_poc'];

/** Admins manage everyone except Super Admins; only a Super Admin grants or changes Super Admin; nobody edits themselves. */
export function assertCanManage(actor: SessionUser, targetId: string | null, currentRole: Role | null, newRole: Role | null) {
  if (targetId && targetId === actor.id) throw new Error('You cannot change your own role or access.');
  const touchesSuper = currentRole === 'super_admin' || newRole === 'super_admin';
  if (touchesSuper && actor.role !== 'super_admin') throw new Error('Only a Super Admin can manage Super Admin accounts.');
  if (actor.role !== 'super_admin' && actor.role !== 'admin') throw new Error('Admin access needed.');
}

/**
 * Creates the login. With a password the account is ready at once; without one Supabase emails an
 * invitation and the person sets their own password. The role lives in app_metadata (not user-editable).
 */
export async function createLogin(input: { email: string; fullName: string; role: Role; password?: string | null }): Promise<string> {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  let id: string;
  if (input.password) {
    if (input.password.length < 10) throw new Error('Passwords need at least 10 characters.');
    const { data, error } = await admin.auth.admin.createUser({
      email, password: input.password, email_confirm: true, app_metadata: { role: input.role }, user_metadata: { full_name: input.fullName },
    });
    if (error) throw new Error(error.message);
    id = data.user.id;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: input.fullName }, redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/update-password`,
    });
    if (error) throw new Error(error.message);
    id = data.user.id;
    await admin.auth.admin.updateUserById(id, { app_metadata: { role: input.role } });
  }
  const { error } = await admin.from('profiles').upsert({ id, email, full_name: input.fullName, role: input.role, is_active: true });
  if (error) throw new Error(error.message);
  return id;
}

export async function setLoginActive(userId: string, active: boolean) {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
  if (error) throw new Error(error.message);
  const res = await admin.from('profiles').update({ is_active: active }).eq('id', userId);
  if (res.error) throw new Error(res.error.message);
}

export async function setLoginRole(userId: string, role: Role) {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { role } });
  if (error) throw new Error(error.message);
  const res = await admin.from('profiles').update({ role }).eq('id', userId);
  if (res.error) throw new Error(res.error.message);
}

export async function sendPasswordReset(email: string) {
  const admin = createAdminClient();
  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/update-password` });
  if (error) throw new Error(error.message);
}
