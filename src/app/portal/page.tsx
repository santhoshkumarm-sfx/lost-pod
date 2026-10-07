import Link from 'next/link';
import { CaseFilterForm } from '@/components/CaseFilterForm';
import { Aging, AgingRibbon, Empty, Flash, Kpi, Pagination, SortHeader, StatusBadge } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { applyCaseFilters, filtersToQuery, parseCaseFilters } from '@/lib/cases/filters';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { getBuckets, getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Your escalations' };

// Columns a client may see. Internal notes live in a separate table the portal cannot read.
const PORTAL_COLUMNS =
  'id, awb, escalation_date, aging_days, aging_bucket, status_label, status_color, status_category, hub, location, team_remark, client_remark, pod_status, pod_link, email_subject, updated_at';

export default async function PortalHome({ searchParams }: { searchParams: SearchParams }) {
  await requirePoc();
  const sp = await searchParams;
  const f = parseCaseFilters(sp);
  const supabase = await createClient();
  const [statsRes, statuses, buckets, notes] = await Promise.all([
    supabase.rpc('case_stats', {}),
    getStatuses(supabase),
    getBuckets(supabase),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(5),
  ]);
  let q = applyCaseFilters(supabase.from('v_cases').select(PORTAL_COLUMNS, { count: 'exact' }), f);
  q = q.order(f.sort, { ascending: f.dir === 'asc', nullsFirst: false }).range((f.page - 1) * f.size, f.page * f.size - 1);
  const { data, count, error } = await q;
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const s = statsRes.data as { open: number; total: number; by_status: { code: string; count: number }[]; by_aging: { label: string; count: number }[] };
  const n = (code: string) => s.by_status.find((x) => x.code === code)?.count ?? 0;
  const href = (o: Record<string, string | number | null>) => `/portal${filtersToQuery(f, o)}`;
  const exportQs = filtersToQuery({ ...f, page: 1 });

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Your escalations</h1>
          <p className="mt-1 text-ink-soft">Aging is counted in days from the date you escalated the shipment.</p>
        </div>
        <a className="btn" href={`/api/export/cases${exportQs ? `${exportQs}&` : '?'}format=csv`}>Download CSV</a>
      </div>
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Open" value={s.open} href="/portal?category=active" />
        <Kpi label="POD shared" value={n('pod_shared')} href="/portal?status=pod_shared&category=all" />
        <Kpi label="Lost — under review" value={n('lost_pending_approval')} href="/portal?category=lost_pending" />
        <Kpi label="Lost" value={n('lost')} href="/portal?category=lost" />
        <Kpi label="All escalations" value={s.total} href="/portal?category=all" />
      </div>
      <section className="panel panel-body mb-5">
        <h2 className="mb-3">Open escalations by aging</h2>
        <AgingRibbon buckets={s.by_aging} hrefFor={(l) => `/portal?aging=${encodeURIComponent(l)}`} />
      </section>
      {!!notes.data?.length && (
        <section className="panel mb-5 divide-y divide-line">
          {notes.data.map((m) => (
            <div key={m.id} className="flex justify-between gap-3 px-4 py-2">
              <span>
                {m.case_id ? <Link href={`/portal/cases/${m.case_id}`}>{m.title}</Link> : m.title}
                {m.body && <span className="text-ink-soft"> — {m.body}</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-ink-faint">{fmtDateTime(m.created_at)}</span>
            </div>
          ))}
        </section>
      )}
      <CaseFilterForm f={f} action="/portal" clearHref="/portal" fields={['q', 'category', 'status', 'aging', 'hub', 'dates']} statuses={statuses} buckets={buckets} />
      <section className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <SortHeader label="AWB" col="awb" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Escalated" col="escalation_date" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Aging" col="aging_days" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <SortHeader label="Status" col="status_label" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
                <th>Hub / location</th>
                <th>Shadowfax update</th>
                <th>POD</th>
                <SortHeader label="Updated" col="updated_at" sort={f.sort} dir={f.dir} hrefFor={(c, d) => href({ sort: c, dir: d, page: 1 })} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/portal/cases/${c.id}`} className="awb">{c.awb}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(c.escalation_date)}</td>
                  <td><Aging days={c.aging_days} final={c.status_category === 'closed' || c.status_category === 'lost'} /></td>
                  <td><StatusBadge label={c.status_label} color={c.status_color} /></td>
                  <td>{c.hub ?? c.location ?? '—'}</td>
                  <td className="max-w-[300px] truncate text-ink-soft" title={c.team_remark ?? ''}>{c.team_remark ?? ''}</td>
                  <td>{c.pod_link ? <a href={c.pod_link} target="_blank" rel="noreferrer">View POD</a> : c.pod_status === 'shared' ? 'Shared' : '—'}</td>
                  <td className="whitespace-nowrap text-ink-soft">{fmtDate(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title="No escalations match these filters" />}
        </div>
        <Pagination page={f.page} size={f.size} total={count ?? 0} hrefFor={(p) => href({ page: p })} />
      </section>
    </>
  );
}
