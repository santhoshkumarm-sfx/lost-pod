import type { SupabaseClient } from '@supabase/supabase-js';

/** Create the Super Admin login, or promote an existing account. Safe to run again. */
export async function ensureSuperAdmin(
  sb: SupabaseClient,
  opts: { email: string; name: string; password?: string | null; siteUrl: string },
): Promise<'created' | 'invited' | 'existing'> {
  const email = opts.email.trim().toLowerCase();
  const existing = await sb.from('profiles').select('id').eq('email', email).maybeSingle();
  let id = existing.data?.id as string | undefined;
  let result: 'created' | 'invited' | 'existing' = 'existing';
  if (!id) {
    if (opts.password) {
      const { data, error } = await sb.auth.admin.createUser({
        email, password: opts.password, email_confirm: true, app_metadata: { role: 'super_admin' }, user_metadata: { full_name: opts.name },
      });
      if (error) throw new Error(`Could not create ${email}: ${error.message}`);
      id = data.user.id;
      result = 'created';
    } else {
      const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
        data: { full_name: opts.name }, redirectTo: `${opts.siteUrl}/auth/callback?next=/update-password`,
      });
      if (error) throw new Error(`Could not invite ${email}: ${error.message}`);
      id = data.user.id;
      result = 'invited';
    }
  } else if (opts.password) {
    await sb.auth.admin.updateUserById(id, { password: opts.password });
  }
  const upd = await sb.auth.admin.updateUserById(id!, { app_metadata: { role: 'super_admin' }, ban_duration: 'none' });
  if (upd.error) throw new Error(upd.error.message);
  const { error } = await sb.from('profiles').upsert({ id, email, full_name: opts.name, role: 'super_admin', is_active: true });
  if (error) throw new Error(error.message);
  return result;
}
