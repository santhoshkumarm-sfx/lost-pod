import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/buttons';
import { AgingRibbon, Field, Flash, Kpi, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';
import { createPocLogin, saveClient, savePoc, setPocActive } from '../actions';

export const metadata = { title: 'Client' };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
  if (!c) notFound();
  const [statsRes, pocsRes] = await Promise.all([
    supabase.rpc('case_stats', { p_client_id: id }),
    supabase.from('client_pocs').select('*, profiles(is_active, email)').eq('client_id', id).order('name'),
  ]);
  const s = statsRes.data as { open: number; total: number; sla_breached: number; by_status: { code: string; count: number }[]; by_aging: { label: string; count: number }[] };
  const n = (code: string) => s.by_status.find((x) => x.code === code)?.count ?? 0;
  const back = `/clients/${id}`;
  return (
    <>
      <div className="mb-1 text-xs text-ink-faint"><Link href="/clients">Clients</Link> / {c.name}</div>
      <div className="mb-5 flex items-end justify-between">
        <h1>{c.name}</h1>
        <Link href={`/cases?client=${id}`} className="btn">View cases</Link>
      </div>
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Open" value={s.open} href={`/cases?client=${id}`} />
        <Kpi label="TAT breached" value={s.sla_breached} tone={s.sla_breached ? 'alert' : undefined} href={`/cases?client=${id}&sla=1`} />
        <Kpi label="Awaiting Lost approval" value={n('lost_pending_approval')} href="/lost-approval" />
        <Kpi label="Lost" value={n('lost')} href={`/lost?client=${id}`} />
        <Kpi label="All cases" value={s.total} href={`/cases?client=${id}&category=all`} />
      </div>
      <Panel title="Open cases by aging" className="mb-5">
        <AgingRibbon buckets={s.by_aging} hrefFor={(l) => `/cases?client=${id}&aging=${encodeURIComponent(l)}`} />
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[2fr_3fr]">
        <Panel title="Client details">
          <form action={saveClient} className="space-y-3">
            <input type="hidden" name="id" value={c.id} />
            <fieldset disabled={!admin} className="space-y-3">
              <Field label="Name"><input name="name" defaultValue={c.name} required className="input" /></Field>
              <Field label="Short code"><input name="code" defaultValue={c.code ?? ''} className="input" /></Field>
              <Field label="Also written as" hint="Comma separated. Used to match the Client column in trackers and names in emails.">
                <input name="aliases" defaultValue={c.aliases.join(', ')} className="input" />
              </Field>
              <Field label="Email domains" hint="Mail from these domains is assigned to this client.">
                <input name="email_domains" defaultValue={c.email_domains.join(', ')} className="input" />
              </Field>
              <Field label="TAT in days" hint="Empty = default from Settings"><input name="sla_days" type="number" min={1} defaultValue={c.sla_days ?? ''} className="input" /></Field>
              <label className="flex items-center gap-2"><input type="checkbox" name="is_active" value="1" defaultChecked={c.is_active} /> Active</label>
              {admin && <SubmitButton>Save client</SubmitButton>}
            </fieldset>
          </form>
        </Panel>
        <Panel title="Client POCs" bodyClass="">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Portal login</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(pocsRes.data ?? []).map((p: any) => (
                  <tr key={p.id} className={p.is_active ? '' : 'text-ink-faint'}>
                    <td>{p.name}{!p.is_active && ' (inactive)'}</td>
                    <td>{p.email ?? '—'}</td>
                    <td>{p.phone ?? '—'}</td>
                    <td>{p.user_id ? (p.profiles?.is_active ? 'Active' : 'Disabled') : 'No login'}</td>
                    {admin && (
                      <td className="flex gap-1">
                        {!p.user_id && p.email && p.is_active && (
                          <form action={createPocLogin}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="back" value={back} />
                            <SubmitButton className="btn btn-sm" pending="Inviting…">Invite to portal</SubmitButton>
                          </form>
                        )}
                        <form action={setPocActive}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="active" value={p.is_active ? '0' : '1'} />
                          <SubmitButton className="btn btn-sm btn-ghost" confirm={p.is_active ? `Deactivate ${p.name}? Their portal access ends now.` : undefined}>
                            {p.is_active ? 'Deactivate' : 'Activate'}
                          </SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {admin && (
            <form action={savePoc} className="grid gap-3 border-t border-line p-4 md:grid-cols-2">
              <input type="hidden" name="client_id" value={c.id} />
              <input type="hidden" name="back" value={back} />
              <Field label="Name"><input name="name" required className="input" /></Field>
              <Field label="Email"><input name="email" type="email" className="input" /></Field>
              <Field label="Phone"><input name="phone" className="input" /></Field>
              <Field label="Password (optional)" hint="Leave empty to send an invitation email instead."><input name="password" type="password" minLength={10} className="input" autoComplete="new-password" /></Field>
              <label className="flex items-center gap-2"><input type="checkbox" name="create_login" value="1" /> Create a portal login (sees only {c.name} cases)</label>
              <div><SubmitButton>Add POC</SubmitButton></div>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}
