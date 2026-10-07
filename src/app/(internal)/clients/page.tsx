import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtNum } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { saveClient } from './actions';

export const metadata = { title: 'Clients' };

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const supabase = await createClient();
  const [clientsRes, statsRes, pocsRes] = await Promise.all([
    supabase.from('clients').select('*').order('name'),
    supabase.rpc('case_stats', {}),
    supabase.from('client_pocs').select('client_id, is_active, user_id'),
  ]);
  const byClient = new Map(((statsRes.data?.by_client ?? []) as { client_id: string | null; open: number; total: number; lost: number; sla_breached: number }[]).map((c) => [c.client_id, c]));
  const pocs = pocsRes.data ?? [];
  return (
    <>
      <PageHeader title="Clients" sub="Names and aliases used in trackers and emails, sender domains for identifying email escalations, and each client’s TAT." />
      <Flash sp={sp} />
      <section className="panel tbl-wrap mb-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>Client</th>
              <th>Also written as</th>
              <th>Email domains</th>
              <th className="text-right">TAT (days)</th>
              <th className="text-right">POCs</th>
              <th className="text-right">Open</th>
              <th className="text-right">TAT breached</th>
              <th className="text-right">Lost</th>
              <th className="text-right">All cases</th>
            </tr>
          </thead>
          <tbody>
            {(clientsRes.data ?? []).map((c) => {
              const s = byClient.get(c.id);
              const p = pocs.filter((x) => x.client_id === c.id && x.is_active);
              return (
                <tr key={c.id} className={c.is_active ? '' : 'text-ink-faint'}>
                  <td><Link href={`/clients/${c.id}`}>{c.name}</Link>{!c.is_active && ' (inactive)'}</td>
                  <td className="max-w-[220px] text-ink-soft">{c.aliases.join(', ') || '—'}</td>
                  <td className="text-ink-soft">{c.email_domains.join(', ') || <span className="text-age-3">none</span>}</td>
                  <td className="text-right">{c.sla_days ?? 'default'}</td>
                  <td className="text-right">{p.length} <span className="text-ink-faint">({p.filter((x) => x.user_id).length} with login)</span></td>
                  <td className="text-right font-semibold">{fmtNum(s?.open ?? 0)}</td>
                  <td className="text-right">{fmtNum(s?.sla_breached ?? 0)}</td>
                  <td className="text-right">{fmtNum(s?.lost ?? 0)}</td>
                  <td className="text-right text-ink-soft">{fmtNum(s?.total ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {admin && (
        <Panel title="Add client">
          <form action={saveClient} className="grid gap-3 md:grid-cols-3">
            <Field label="Name"><input name="name" required className="input" /></Field>
            <Field label="Short code"><input name="code" className="input" maxLength={8} /></Field>
            <Field label="TAT in days" hint="Empty = default from Settings"><input name="sla_days" type="number" min={1} className="input" /></Field>
            <Field label="Also written as" hint="Comma separated, e.g. Swift Premium, Swift Prime"><input name="aliases" className="input" /></Field>
            <Field label="Email domains" hint="e.g. goswift.in" className="md:col-span-2"><input name="email_domains" className="input" /></Field>
            <div><SubmitButton>Add client</SubmitButton></div>
          </form>
        </Panel>
      )}
    </>
  );
}
