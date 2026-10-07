import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Role = 'super_admin' | 'admin' | 'internal_team' | 'client_poc';

export interface SessionUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  internal_team: 'Internal team',
  client_poc: 'Client POC',
};

export const isInternalRole = (r: Role) => r === 'super_admin' || r === 'admin' || r === 'internal_team';
export const isAdminRole = (r: Role) => r === 'super_admin' || r === 'admin';

/** The signed-in user's profile, once per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const uid = auth?.claims?.sub;
  if (!uid) return null;
  const { data } = await supabase.from('profiles').select('id, email, full_name, role, is_active').eq('id', uid).maybeSingle();
  return (data as SessionUser | null) ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  if (!u.is_active) redirect('/login?error=Your%20account%20is%20not%20active.%20Ask%20an%20admin%20to%20enable%20it.');
  return u;
}

export async function requireInternal(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isInternalRole(u.role)) redirect('/portal');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isAdminRole(u.role)) redirect(isInternalRole(u.role) ? '/dashboard?error=Admin%20access%20needed' : '/portal');
  return u;
}

export async function requirePoc(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'client_poc') redirect('/dashboard');
  return u;
}
