import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { createPocLogin, savePoc, setPocActive } from '../clients/actions';

export const metadata = { title: 'POCs' };

export default async function PocsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const clientFilter = param(sp, 'client');
  const supabase = await createClient();
  let q = supabase.from('client_pocs').select('*, clients(name), profiles(is_active)').order('name');
  if (clientFilter) q = q.eq('client_id', clientFilter);
  const [pocsRes, clients, counts] = await Promise.all([
    q,
    getClients(supabase),
    supabase.from('v_cases').select('client_poc_id').in('status_category', ['open', 'lost_pending']).not('client_poc_id', 'is', null).limit(5000),
  ]);
  const open = new Map<string, number>();
  (counts.data ?? []).forEach((r) => open.set(r.client_poc_id, (open.get(r.client_poc_id) ?? 0) + 1));
  return (
    <>
      <PageHeader
        title="Client POCs"
        sub="Contacts on the client side. A POC with a portal login sees only their own client’s cases and can request Lost for Admin approval."
      />
      <Flash sp={sp} />
      <form className="mb-3 flex items-end gap-2">
        <label>
          <span className="label">Client</span>
          <select name="client" defaultValue={clientFilter} className="input w-48">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button className="btn">Filter</button>
      </form>
      <section className="panel tbl-wrap mb-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Client</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Portal login</th>
              <th className="text-right">Open cases</th>
              {admin && <th />}
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(pocsRes.data ?? []).map((p: any) => (
              <tr key={p.id} className={p.is_active ? '' : 'text-ink-faint'}>
                <td>{p.name}{!p.is_active && ' (inactive)'}</td>
                <td><Link href={`/clients/${p.client_id}`}>{p.clients?.name}</Link></td>
                <td>{p.email ?? '—'}</td>
                <td>{p.phone ?? '—'}</td>
                <td>{p.user_id ? (p.profiles?.is_active ? 'Active' : 'Disabled') : 'No login'}</td>
                <td className="text-right"><Link href={`/cases?poc=${p.id}`}>{open.get(p.id) ?? 0}</Link></td>
                {admin && (
                  <td className="flex gap-1">
                    {!p.user_id && p.email && p.is_active && (
                      <form action={createPocLogin}>
                        <input type="hidden" name="id" value={p.id} />
                        <SubmitButton className="btn btn-sm" pending="Inviting…">Invite to portal</SubmitButton>
                      </form>
                    )}
                    <form action={setPocActive}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="active" value={p.is_active ? '0' : '1'} />
                      <SubmitButton className="btn btn-sm btn-ghost" confirm={p.is_active ? `Deactivate ${p.name}?` : undefined}>{p.is_active ? 'Deactivate' : 'Activate'}</SubmitButton>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {admin && (
        <Panel title="Add POC">
          <form action={savePoc} className="grid gap-3 md:grid-cols-3">
            <Field label="Client">
              <select name="client_id" required className="input" defaultValue={clientFilter}>
                <option value="">Select client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Name"><input name="name" required className="input" /></Field>
            <Field label="Email"><input name="email" type="email" className="input" /></Field>
            <Field label="Phone"><input name="phone" className="input" /></Field>
            <Field label="Password (optional)" hint="Empty = invitation email"><input name="password" type="password" minLength={10} className="input" autoComplete="new-password" /></Field>
            <label className="flex items-center gap-2 pt-5"><input type="checkbox" name="create_login" value="1" /> Create a portal login</label>
            <div><SubmitButton>Add POC</SubmitButton></div>
          </form>
        </Panel>
      )}
    </>
  );
}
