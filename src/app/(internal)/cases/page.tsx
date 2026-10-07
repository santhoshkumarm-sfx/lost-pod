import Link from 'next/link';
import { SelectAll, SubmitButton } from '@/components/buttons';
import { CaseFilterForm } from '@/components/CaseFilterForm';
import { Aging, Empty, Flash, PageHeader, Pagination, SortHeader, SourceTag, StatusBadge } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import { applyCaseFilters, filtersToQuery, parseCaseFilters } from '@/lib/cases/filters';
import type { SearchParams } from '@/lib/flash';
import { fmtDate } from '@/lib/format';
import { getAgents, getBuckets, getClients, getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { CASE_LIST_COLUMNS, type CaseRow } from '@/lib/types';
import { bulkUpdate } from './actions';

export const metadata = { title: 'Cases' };

export default async function CasesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const sp = await searchParams;
  const f = parseCaseFilters(sp);
  const supabase = await createClient();
  const [clients, statuses, buckets, agents] = await Promise.all([getClients(supabase), getStatuses(supabase), getBuckets(supabase), getAgents(supabase)]);

  let q = supabase.from('v_cases').select(CASE_LIST_COLUMNS, { count: 'exact' });
  q = applyCaseFilters(q, f);
  q = q.order(f.sort, { ascending: f.dir === 'asc', nullsFirst: false }).order('case_number', { ascending: false });
  const { data, count, error } = await q.range((f.page - 1) * f.size, f.page * f.size - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as CaseRow[];
  const query = filtersToQuery(f);
  const href = (o: Record<string, string | number | null>) => `/cases${filtersToQuery(f, o)}`;
  const exportQs = filtersToQuery({ ...f, page: 1 });
  const manualStatuses = statuses.filter((s) => s.allow_manual && s.is_active && (s.category === 'open' || s.category === 'closed'));

  return (
    <>
      <PageHeader
        title="Cases"
        sub="One row per escalated AWB, from Google Sheets, email and manual entry."
        actions={
          <>
            <a className="btn" href={`/api/export/cases${exportQs ? exportQs + '&' : '?'}format=csv`}>Export CSV</a>
            <a className="btn" href={`/api/export/cases${exportQs ? exportQs + '&' : '?'}format=xlsx`}>Export Excel</a>
            <Link className="btn btn-primary" href="/cases/new">Add case</Link>
          </>
        }
      />
      <Flash sp={sp} />
      <CaseFilterForm
        f={f}
        action="/cases"
        clearHref="/cases"
        fields={['q', 'client', 'category', 'status', 'aging', 'hub', 'agent', 'source', 'dates', 'sla']}
        clients={clients}
        statuses={statuses}
        buckets={buckets}
        agents={agents}
      />
      <form action={bulkUpdate} className="panel">
        <input type="hidden" name="back" value={`/cases${query}`} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
          <span className="text-ink-soft">With selected:</span>
          <select name="bulk_action" className="input input-sm w-36" defaultValue="">
            <option value="">Choose action</option>
            <option value="assign">Assign agent</option>
            <option value="status">Change status</option>
          </select>
          <select name="bulk_agent" className="input input-sm w-40" defaultValue={isAdminRole(user.role) ? '' : user.id}>
            <option value="">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
          </select>
          <select name="bulk_status" className="input input-sm w-40" defaultValue="">
            <option value="">Status…</option>
            {manualStatuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <SubmitButton className="btn btn-sm" pending="Updating…">Apply to selected</SubmitButton>
          <span className="ml-auto text-ink-faint">Lost is only set through a Lost request and Admin approval.</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8"><SelectAll name="ids" /></th>
                <SortHeader label="AWB" col="awb" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Client" col="client_display_name" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Escalated" col="escalation_date" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Aging" col="aging_days" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Status" col="status_label" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Hub / location" col="hub" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <th>Agent</th>
                <th>Source</th>
                <th>Shadowfax remark</th>
                <SortHeader label="Updated" col="updated_at" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" name="ids" value={c.id} aria-label={`Select ${c.awb}`} /></td>
                  <td>
                    <Link href={`/cases/${c.id}`} className="awb">{c.awb}</Link>
                    {c.sla_breached && <span className="ml-1.5 text-2xs font-semibold text-age-5" title="TAT breached">TAT</span>}
                  </td>
                  <td>{c.client_display_name ?? <span className="muted">—</span>}</td>
                  <td className="whitespace-nowrap">
                    {fmtDate(c.escalation_date)}
                    {c.escalation_date_estimated && <span className="ml-1 text-2xs text-age-3" title="No escalation date in the source; estimated">est.</span>}
                  </td>
                  <td><Aging days={c.aging_days} final={c.status_category === 'closed' || c.status_category === 'lost'} /></td>
                  <td><StatusBadge label={c.status_label} color={c.status_color} /></td>
                  <td className="max-w-[180px] truncate" title={c.hub ?? c.location ?? ''}>{c.hub ?? c.location ?? <span className="muted">—</span>}</td>
                  <td className="whitespace-nowrap">{c.agent_display_name ?? <span className="muted">Unassigned</span>}</td>
                  <td><SourceTag source={c.source_type} /></td>
                  <td className="max-w-[240px] truncate text-ink-soft" title={c.team_remark ?? ''}>{c.team_remark ?? ''}</td>
                  <td className="whitespace-nowrap text-ink-soft">{fmtDate(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty title="No cases match these filters">
              Try “Everything” under Show, or clear the filters. New cases arrive from Google Sheet syncs and email escalations.
            </Empty>
          )}
        </div>
        <Pagination page={f.page} size={f.size} total={count ?? 0} hrefFor={(p) => href({ page: p })} />
      </form>
    </>
  );
}
