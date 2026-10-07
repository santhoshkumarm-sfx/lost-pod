import Link from 'next/link';
import { Empty, PageHeader, Pagination } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { setDeleted } from '../cases/actions';
import { SubmitButton } from '@/components/buttons';

export const metadata = { title: 'Audit log' };

const TABLES = ['clients', 'profiles', 'client_pocs', 'lost_approvals', 'case_private', 'sheet_sources', 'app_settings', 'status_master', 'status_mappings', 'column_aliases', 'aging_buckets'];

function diff(oldD: Record<string, unknown> | null, newD: Record<string, unknown> | null): string {
  if (!oldD) return 'created';
  if (!newD) return 'deleted';
  const keys = Object.keys(newD).filter((k) => !['updated_at', 'created_at'].includes(k) && JSON.stringify(oldD[k]) !== JSON.stringify(newD[k]));
  return keys.map((k) => `${k}: ${JSON.stringify(oldD[k])} → ${JSON.stringify(newD[k])}`).join('; ').slice(0, 400) || 'no visible change';
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = param(sp, 'view') === 'cases' ? 'cases' : param(sp, 'view') === 'removed' ? 'removed' : 'config';
  const table = param(sp, 'table');
  const page = Math.max(1, Number(param(sp, 'page')) || 1);
  const size = 50;
  const supabase = await createClient();
  const tabs = [
    { key: 'config', label: 'Settings, users and approvals' },
    { key: 'cases', label: 'Case changes' },
    { key: 'removed', label: 'Removed cases' },
  ];

  let body: React.ReactNode;
  let total = 0;
  if (view === 'config') {
    let q = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (table) q = q.eq('table_name', table);
    const { data, count } = await q.range((page - 1) * size, page * size - 1);
    total = count ?? 0;
    const ids = [...new Set((data ?? []).map((r) => r.user_id).filter(Boolean))];
    const people = ids.length ? (await supabase.from('profiles').select('id, full_name, email').in('id', ids)).data ?? [] : [];
    body = (
      <table className="tbl">
        <thead><tr><th>When</th><th>Who</th><th>Table</th><th>Action</th><th>Change</th></tr></thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
              <td>{people.find((p) => p.id === r.user_id)?.full_name ?? (r.user_id ? 'User' : 'System / import')}</td>
              <td>{r.table_name}</td>
              <td>{r.action}</td>
              <td className="max-w-[640px] break-words font-mono text-xs text-ink-soft">{diff(r.old_data, r.new_data)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (view === 'cases') {
    const { data, count } = await supabase
      .from('case_updates')
      .select('*, cases(awb)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * size, page * size - 1);
    total = count ?? 0;
    const ids = [...new Set((data ?? []).map((r) => r.user_id).filter(Boolean))];
    const people = ids.length ? (await supabase.from('profiles').select('id, full_name').in('id', ids)).data ?? [] : [];
    body = (
      <table className="tbl">
        <thead><tr><th>When</th><th>Case</th><th>Who</th><th>What</th><th>Via</th></tr></thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
              <td><Link href={`/cases/${r.case_id}`} className="awb">{r.cases?.awb ?? 'case'}</Link></td>
              <td>{people.find((p) => p.id === r.user_id)?.full_name ?? 'System'}</td>
              <td className="max-w-[560px] text-ink-soft">{r.field ? `${r.field}: ${r.old_value ?? '—'} → ${r.new_value ?? '—'}` : `${r.action}${r.note ? ` — ${r.note}` : ''}`}</td>
              <td>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    const { data, count } = await supabase
      .from('cases')
      .select('id, awb, escalation_date, updated_at, client_name', { count: 'exact' })
      .eq('is_deleted', true)
      .order('updated_at', { ascending: false })
      .range((page - 1) * size, page * size - 1);
    total = count ?? 0;
    body = data?.length ? (
      <table className="tbl">
        <thead><tr><th>AWB</th><th>Escalated</th><th>Removed</th><th /></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}>
              <td className="awb">{r.awb}</td>
              <td>{r.escalation_date}</td>
              <td>{fmtDateTime(r.updated_at)}</td>
              <td>
                <form action={setDeleted}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="deleted" value="0" />
                  <SubmitButton className="btn btn-sm">Restore</SubmitButton>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : <Empty title="No removed cases" />;
  }

  const href = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ view, ...(table ? { table } : {}), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    return `/audit?${p.toString()}`;
  };
  return (
    <>
      <PageHeader title="Audit log" sub="Every change to cases, approvals, users and configuration, with who made it and from where." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={`/audit?view=${t.key}`} className={`btn btn-sm ${view === t.key ? 'border-ink bg-ink text-white hover:bg-ink' : ''}`}>{t.label}</Link>
        ))}
        {view === 'config' && (
          <form className="ml-auto flex gap-2">
            <input type="hidden" name="view" value="config" />
            <select name="table" defaultValue={table} className="input input-sm w-44">
              <option value="">All tables</option>
              {TABLES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="btn btn-sm">Filter</button>
          </form>
        )}
      </div>
      <section className="panel">
        <div className="tbl-wrap">{body}</div>
        <Pagination page={page} size={size} total={total} hrefFor={(p) => href({ page: p })} />
      </section>
    </>
  );
}
