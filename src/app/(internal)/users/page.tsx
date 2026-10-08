import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireAdmin, ROLE_LABELS, type Role } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDate } from '@/lib/format';
import { getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { changeRole, createUser, resetPassword, setActive, setApprover } from './actions';

export const metadata = { title: 'Users' };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [usersRes, clients, links, approversRes] = await Promise.all([
    supabase.from('profiles').select('*').order('role').order('full_name'),
    getClients(supabase),
    supabase.from('client_pocs').select('user_id, clients(name)').not('user_id', 'is', null),
    supabase.from('lost_approvers').select('user_id, client_id'),
  ]);
  const isSuper = me.role === 'super_admin';
  const approvers = (approversRes.data ?? []) as { user_id: string; client_id: string | null }[];
  const rightsOf = (uid: string) => approvers.filter((a) => a.user_id === uid);
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? 'Unknown client';
  const rightsText = (u: { id: string; role: string }) => {
    if (u.role === 'super_admin') return 'Always';
    if (u.role === 'client_poc') return '—';
    const r = rightsOf(u.id);
    if (!r.length) return 'No';
    if (r.some((x) => x.client_id === null)) return 'All clients';
    return r.map((x) => clientName(x.client_id)).join(', ');
  };
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
              <th title="Who may approve (accept) Lost requests">Can approve Lost</th>
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
                  <td className="max-w-[260px]">
                    {isSuper && (u.role === 'admin' || u.role === 'internal_team') ? (
                      <details>
                        <summary className="cursor-pointer">{rightsText(u)}</summary>
                        <form action={setApprover} className="mt-2 space-y-2 rounded border border-line p-2">
                          <input type="hidden" name="id" value={u.id} />
                          <select name="lost_mode" className="input input-sm" defaultValue={!rightsOf(u.id).length ? 'none' : rightsOf(u.id).some((x) => x.client_id === null) ? 'all' : 'clients'}>
                            <option value="none">Cannot approve Lost</option>
                            <option value="all">Can approve — all clients</option>
                            <option value="clients">Can approve — only the ticked clients</option>
                          </select>
                          <div className="max-h-40 overflow-y-auto">
                            {clients.map((c) => (
                              <label key={c.id} className="flex items-center gap-1.5 text-xs">
                                <input type="checkbox" name="lost_clients" value={c.id} defaultChecked={rightsOf(u.id).some((x) => x.client_id === c.id)} /> {c.name}
                              </label>
                            ))}
                          </div>
                          <SubmitButton className="btn btn-sm">Save rights</SubmitButton>
                        </form>
                      </details>
                    ) : rightsText(u)}
                  </td>
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
          <Field
            label="Can this person approve (accept) Lost?"
            hint={isSuper ? 'Only for Admin / Internal team. Super Admins can always approve; Client POCs never can.' : 'Only a Super Admin can give Lost approval rights.'}
          >
            <select name="lost_mode" className="input" defaultValue="none" disabled={!isSuper}>
              <option value="none">No — can only request Lost</option>
              <option value="all">Yes — for all clients</option>
              <option value="clients">Yes — only for the clients ticked below</option>
            </select>
          </Field>
          {isSuper && (
            <Field label="Clients they can approve Lost for" hint="Used only with “only for the clients ticked”." className="md:col-span-2">
              <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded border border-line p-2">
                {clients.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" name="lost_clients" value={c.id} /> {c.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="Password (optional)" hint="Empty = Supabase emails an invitation to set a password.">
            <input name="password" type="password" minLength={10} className="input" autoComplete="new-password" />
          </Field>
          <div className="pt-5"><SubmitButton pending="Creating…">Add user</SubmitButton></div>
        </form>
      </Panel>
    </>
  );
}
