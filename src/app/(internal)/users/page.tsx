import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireAdmin, ROLE_LABELS, type Role } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDate } from '@/lib/format';
import { getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { changeRole, createUser, resetPassword, setActive } from './actions';

export const metadata = { title: 'Users' };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [usersRes, clients, links] = await Promise.all([
    supabase.from('profiles').select('*').order('role').order('full_name'),
    getClients(supabase),
    supabase.from('client_pocs').select('user_id, clients(name)').not('user_id', 'is', null),
  ]);
  const roles = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => me.role === 'super_admin' || r !== 'super_admin');
  const clientOf = (uid: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (links.data ?? []).filter((l: any) => l.user_id === uid).map((l: any) => l.clients?.name).filter(Boolean).join(', ');
  return (
    <>
      <PageHeader title="Users" sub="Logins for the internal team and client POCs. Roles are enforced by the database, not just by this screen." />
      <Flash sp={sp} />
      <section className="panel tbl-wrap mb-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Client</th>
              <th>Access</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(usersRes.data ?? []).map((u) => {
              const locked = u.id === me.id || (u.role === 'super_admin' && me.role !== 'super_admin');
              return (
                <tr key={u.id} className={u.is_active ? '' : 'text-ink-faint'}>
                  <td>{u.full_name ?? '—'}{u.id === me.id && <span className="text-ink-faint"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    {locked ? ROLE_LABELS[u.role as Role] : (
                      <form action={changeRole} className="flex gap-1">
                        <input type="hidden" name="id" value={u.id} />
                        <select name="role" defaultValue={u.role} className="input input-sm w-36">
                          {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <SubmitButton className="btn btn-sm">Save</SubmitButton>
                      </form>
                    )}
                  </td>
                  <td>{u.role === 'client_poc' ? clientOf(u.id) || <span className="text-age-3">not linked</span> : ''}</td>
                  <td>{u.is_active ? 'Active' : 'Disabled'}</td>
                  <td className="whitespace-nowrap text-ink-soft">{fmtDate(u.created_at)}</td>
                  <td>
                    {!locked && (
                      <div className="flex gap-1">
                        <form action={setActive}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="active" value={u.is_active ? '0' : '1'} />
                          <SubmitButton className="btn btn-sm btn-ghost" confirm={u.is_active ? `Deactivate ${u.email}? They are signed out immediately.` : undefined}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </SubmitButton>
                        </form>
                        <form action={resetPassword}>
                          <input type="hidden" name="id" value={u.id} />
                          <SubmitButton className="btn btn-sm btn-ghost" pending="Sending…">Reset password</SubmitButton>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <Panel title="Add user">
        <form action={createUser} className="grid gap-3 md:grid-cols-3">
          <Field label="Full name"><input name="full_name" required className="input" /></Field>
          <Field label="Work email"><input name="email" type="email" required className="input" /></Field>
          <Field label="Role">
            <select name="role" className="input" defaultValue="internal_team">
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <Field label="Client (for Client POC only)">
            <select name="client_id" className="input" defaultValue="">
              <option value="">—</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Password (optional)" hint="Empty = Supabase emails an invitation to set a password.">
            <input name="password" type="password" minLength={10} className="input" autoComplete="new-password" />
          </Field>
          <div className="pt-5"><SubmitButton pending="Creating…">Add user</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
