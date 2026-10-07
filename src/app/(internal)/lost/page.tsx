import Link from 'next/link';
import { HBarChart } from '@/components/charts';
import { CaseFilterForm } from '@/components/CaseFilterForm';
import { Aging, Empty, Kpi, PageHeader, Pagination, Panel, SortHeader } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { applyCaseFilters, filtersToQuery, parseCaseFilters } from '@/lib/cases/filters';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, fmtInr, fmtNum } from '@/lib/format';
import { getAgents, getBuckets, getClients, getPocs } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { fetchAllCases } from '@/lib/reports/daily';

export const metadata = { title: 'Lost shipments' };

export default async function LostPage({ searchParams }: { searchParams: SearchParams }) {
  await requireInternal();
  const sp = await searchParams;
  const f = { ...parseCaseFilters(sp, { sort: 'lost_approved_at', dir: 'desc' }), category: 'lost' };
  const supabase = await createClient();
  const [clients, buckets, agents, pocs] = await Promise.all([getClients(supabase), getBuckets(supabase), getAgents(supabase), getPocs(supabase)]);

  const cols = 'id, awb, client_display_name, escalation_date, lost_approved_at, aging_days, final_aging_days, hub, location, reason, team_remark, poc_name, agent_display_name, product_value, aging_bucket';
  let list = applyCaseFilters(supabase.from('v_cases').select(cols, { count: 'exact' }), f, { dateField: 'lost_approved_at' });
  list = list.order(f.sort, { ascending: f.dir === 'asc', nullsFirst: false }).range((f.page - 1) * f.size, f.page * f.size - 1);
  // Aggregates over the full filtered set (not just this page).
  const [{ data, count, error }, aggRows] = await Promise.all([
    list,
    fetchAllCases(supabase, 'client_display_name, aging_days, product_value, hub, location', (q) => applyCaseFilters(q, f, { dateField: 'lost_approved_at' })),
  ]);
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as Record<string, any>[];
  const agg = aggRows as unknown as { client_display_name: string | null; aging_days: number; product_value: number | null; hub: string | null; location: string | null }[];
  const avg = agg.length ? Math.round((agg.reduce((n, r) => n + r.aging_days, 0) / agg.length) * 10) / 10 : 0;
  const value = agg.reduce((n, r) => n + Number(r.product_value ?? 0), 0);
  const tally = (key: (r: (typeof agg)[number]) => string) => {
    const m = new Map<string, number>();
    agg.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, value]) => ({ name, value }));
  };
  const href = (o: Record<string, string | number | null>) => `/lost${filtersToQuery({ ...f, category: '' }, o)}`;
  const exportQs = filtersToQuery({ ...f, page: 1 });

  return (
    <>
      <PageHeader
        title="Lost shipments"
        sub="Cases approved as Lost by an Admin. Lost aging = approval date − original escalation date."
        actions={
          <>
            <a className="btn" href={`/api/export/cases${exportQs}&format=csv&datefield=lost_approved_at`}>Export CSV</a>
            <a className="btn" href={`/api/export/cases${exportQs}&format=xlsx&datefield=lost_approved_at`}>Export Excel</a>
          </>
        }
      />
      <CaseFilterForm
        f={f}
        action="/lost"
        clearHref="/lost"
        dateLabel="Approved"
        fields={['q', 'client', 'aging', 'hub', 'poc', 'reason', 'agent', 'dates']}
        clients={clients}
        buckets={buckets}
        agents={agents}
        pocs={pocs}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Lost shipments" value={count ?? 0} tone="alert" />
        <Kpi label="Average Lost aging" value={`${avg} d`} />
        <Kpi label="Product value lost" value={fmtInr(value)} />
        <Kpi label="Clients affected" value={new Set(agg.map((r) => r.client_display_name)).size} />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Panel title="By client">{agg.length ? <HBarChart data={tally((r) => r.client_display_name ?? 'No client')} color="#A9402B" /> : <p className="text-ink-soft">No Lost cases.</p>}</Panel>
        <Panel title="By hub / location">{agg.length ? <HBarChart data={tally((r) => r.hub ?? r.location ?? 'Unknown')} color="#7E2A26" /> : <p className="text-ink-soft">No Lost cases.</p>}</Panel>
      </div>
      <section className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortHeader label="AWB" col="awb" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Client" col="client_display_name" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Escalated" col="escalation_date" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Approved" col="lost_approved_at" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Lost aging" col="aging_days" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <th>Hub / location</th>
                <th>Reason</th>
                <th>Final remark</th>
                <th>POC</th>
                <th>Agent</th>
                <SortHeader label="Value" col="product_value" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="awb" href={`/cases/${r.id}`}>{r.awb}</Link></td>
                  <td>{r.client_display_name ?? '—'}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.escalation_date)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(r.lost_approved_at)}</td>
                  <td><Aging days={r.final_aging_days ?? r.aging_days} /></td>
                  <td>{r.hub ?? r.location ?? '—'}</td>
                  <td className="max-w-[200px] truncate" title={r.reason ?? ''}>{r.reason ?? '—'}</td>
                  <td className="max-w-[220px] truncate text-ink-soft" title={r.team_remark ?? ''}>{r.team_remark ?? ''}</td>
                  <td>{r.poc_name ?? '—'}</td>
                  <td>{r.agent_display_name ?? '—'}</td>
                  <td className="whitespace-nowrap text-right">{fmtInr(r.product_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title="No Lost shipments for these filters" />}
        </div>
        <Pagination page={f.page} size={f.size} total={count ?? 0} hrefFor={(p) => href({ page: p })} />
      </section>
      <p className="mt-3 text-xs text-ink-faint">{fmtNum(agg.length)} cases in the charts above.</p>
    </>
  );
}
