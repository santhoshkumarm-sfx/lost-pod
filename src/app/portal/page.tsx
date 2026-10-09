import Link from 'next/link';
import { CaseFilterForm } from '@/components/CaseFilterForm';
import { Aging, Empty, Flash, Pagination, SortHeader, StatusBadge } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { applyCaseFilters, filtersToQuery, getCriticalDays, parseCaseFilters, type PodStats } from '@/lib/cases/filters';
import { PodTiles } from '@/components/pod';
import { PivotTable } from '@/components/pivot';
import type { SearchParams } from '@/lib/flash';
import { clientStatusLabel, fmtDate, fmtDateTime } from '@/lib/format';
import { SelectAll, SubmitButton } from '@/components/buttons';
import { pocRequestLostBulk } from './actions';
import { getBuckets, getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Your escalations' };

// Columns a client may see. Internal notes live in a separate table the portal cannot read.
const PORTAL_COLUMNS =
  'id, awb, team_status, escalation_date, aging_days, aging_bucket, status_label, status_color, status_category, hub, location, team_remark, client_remark, pod_status, pod_link, email_subject, updated_at';

export default async function PortalHome({ searchParams }: { searchParams: SearchParams }) {
  await requirePoc();
  const sp = await searchParams;
  const f = parseCaseFilters(sp, { category: 'pending_pod' });
  const supabase = await createClient();
  const criticalDays = await getCriticalDays(supabase);
  const [statsRes, statuses, buckets, notes] = await Promise.all([
    supabase.rpc('pod_stats', { p: { q: f.q, hub: f.hub, from: f.from, to: f.to } }),
    getStatuses(supabase),
    getBuckets(supabase),
    supabase.from('notifications').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(3),
  ]);
  let q = applyCaseFilters(supabase.from('v_cases').select(PORTAL_COLUMNS, { count: 'exact' }), f, { criticalDays });
  q = q.order(f.sort, { ascending: f.dir === 'asc', nullsFirst: false }).range((f.page - 1) * f.size, f.page * f.size - 1);
  const { data, count, error } = await q;
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  if (statsRes.error) throw new Error(statsRes.error.message);
  const s = statsRes.data as PodStats;
  const filtered = !!(f.q || f.hub || f.from || f.to);
  const back = `/portal${filtersToQuery(f)}`;
  const href = (o: Record<string, string | number | null>) => `/portal${filtersToQuery(f, o)}`;
  const exportQs = filtersToQuery({ ...f, page: 1 });

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Your escalations</h1>
          <p className="mt-1 text-ink-soft">Aging is counted in days from the date you escalated the shipment.</p>
        </div>
        <div className="flex gap-2">
          <a className="btn" href={`/api/export/cases${exportQs ? `${exportQs}&` : '?'}format=csv`}>Download CSV</a>
          <a className="btn btn-primary" href="/portal/new">Add pending shipments</a>
        </div>
      </div>
      <Flash sp={sp} />
      <PodTiles
        s={s}
        clientView
        href={(k) => k === 'lost_pending' ? '/portal/requests?state=open'
          : href({ category: k === 'pending' ? 'pending_pod' : k === 'shared' ? 'pod_done' : k, status: null, agemin: null, agemax: null, aging: null, page: 1 })}
      />
      <PivotTable
        title="Pending POD by days since you escalated"
        note={`${filtered ? 'Counts follow your search. ' : ''}Shaded columns (over ${s.critical_days} days) are being chased first.`}
        rowHeader="Client"
        columns={s.pending_age.map((b) => ({ label: `${b.label} days`, alert: b.min > s.critical_days }))}
        rows={s.by_client.filter((c) => c.pending > 0).map((c) => ({
          label: c.client,
          cells: c.age.map((v, i) => ({ value: v, href: href({ category: 'pending_pod', agemin: String(s.pending_age[i].min), agemax: s.pending_age[i].max === null ? null : String(s.pending_age[i].max), aging: null, status: null, page: 1 }) })),
        }))}
        totalHref={href({ category: 'pending_pod', agemin: null, agemax: null, aging: null, status: null, page: 1 })}
      />
      {!!notes.data?.length && (
        <section className="panel mb-5 divide-y divide-line">
          {notes.data.map((m) => (
            <div key={m.id} className="flex justify-between gap-3 px-4 py-2">
              <span>
                {m.link ? <Link href={m.link}>{m.title}</Link> : m.case_id ? <Link href={`/portal/cases/${m.case_id}`}>{m.title}</Link> : m.title}
                {m.body && <span className="text-ink-soft"> — {m.body}</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-ink-faint">{fmtDateTime(m.created_at)}</span>
            </div>
          ))}
        </section>
      )}
      <CaseFilterForm f={f} action="/portal" clearHref="/portal" fields={['q', 'category']} more={['status', 'aging', 'hub', 'dates']} statuses={statuses} buckets={buckets} clientView criticalDays={criticalDays} />
      <form action={pocRequestLostBulk} className="panel">
        <input type="hidden" name="back" value={back} />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
          <label className="flex items-center gap-1.5 font-medium"><SelectAll name="ids" /> Select all on this page</label>
          <input name="reason" className="input input-sm min-w-[260px] flex-1" placeholder="Why should the ticked shipments be declared Lost?" />
          <SubmitButton className="btn btn-sm" pending="Sending…" confirm="Send a Lost request for the ticked shipments? Shadowfax reviews every request.">Request Lost for selected</SubmitButton>
          <span className="text-ink-faint">Only shipments still waiting for a POD can be ticked.</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8" />
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
                  <td>{c.status_category === 'open' && c.team_status !== 'pod_shared' && c.pod_status !== 'shared' && <input type="checkbox" name="ids" value={c.id} aria-label={`Select ${c.awb}`} />}</td>
                  <td><Link href={`/portal/cases/${c.id}`} className="awb">{c.awb}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(c.escalation_date)}</td>
                  <td><Aging days={c.aging_days} final={c.status_category === 'closed' || c.status_category === 'lost'} /></td>
                  <td><StatusBadge label={clientStatusLabel(c.status_category, c.status_label)} color={c.status_color} /></td>
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
      </form>
    </>
  );
}
