import Link from 'next/link';
import { Empty, Flash, Kpi, Pagination, StatusBadge } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { applyRequestFilters, lostQuery, parseLostFilters, REQUEST_STATUS } from '@/lib/cases/lost-filters';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { requestIdsForAwbSearch } from '@/lib/lost';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Your Lost requests' };

export default async function PortalRequests({ searchParams }: { searchParams: SearchParams }) {
  await requirePoc();
  const sp = await searchParams;
  const f = { ...parseLostFilters(sp), client: '', via: '', mine: '', size: 50 };
  f.state = f.state || 'all';
  const supabase = await createClient();
  const awbIds = await requestIdsForAwbSearch(supabase, f.q);
  const [listRes, totalsRes] = await Promise.all([
    applyRequestFilters(
      supabase.from('v_lost_request_summary').select('id, request_number, requested_by_name, requested_via, reason, created_at, awb_count, pending, accepted, rejected, sent_back, max_aging, last_accepted_at, last_decided_at, status', { count: 'exact' }),
      f, awbIds,
    )
      .order('created_at', { ascending: false })
      .range((f.page - 1) * f.size, f.page * f.size - 1),
    supabase.from('v_lost_request_summary').select('pending, accepted, rejected, sent_back').limit(5000),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);
  const rows = (listRes.data ?? []) as {
    id: string; request_number: number; requested_by_name: string | null; requested_via: string; reason: string | null; created_at: string;
    awb_count: number; pending: number; accepted: number; rejected: number; sent_back: number; max_aging: number;
    last_accepted_at: string | null; last_decided_at: string | null; status: string;
  }[];
  const all = (totalsRes.data ?? []) as { pending: number; accepted: number; rejected: number; sent_back: number }[];
  const t = all.reduce((a, r) => ({ open: a.open + (r.pending ? 1 : 0), pending: a.pending + r.pending, accepted: a.accepted + r.accepted, other: a.other + r.rejected + r.sent_back }), { open: 0, pending: 0, accepted: 0, other: 0 });
  const href = (o: Record<string, string | number | null>) => `/portal/requests${lostQuery(f, o)}`;

  return (
    <>
      <div className="mb-5">
        <h1>Your Lost requests</h1>
        <p className="mt-1 text-ink-soft">Every request to accept the loss of shipments, when it was made, and what Shadowfax decided for each AWB.</p>
      </div>
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Requests under review" value={t.open} href={href({ state: 'open', page: 1 })} />
        <Kpi label="AWBs under review" value={t.pending} />
        <Kpi label="AWBs loss accepted" value={t.accepted} href="/portal?category=lost" />
        <Kpi label="AWBs not accepted / investigating" value={t.other} />
      </div>
      <form action="/portal/requests" className="panel mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="min-w-[260px] flex-1">
          <span className="label">Request no. or AWB(s)</span>
          <input name="q" defaultValue={f.q} className="input" placeholder="LR-12 or paste AWBs" />
        </label>
        <label>
          <span className="label">Show</span>
          <select name="state" defaultValue={f.state} className="input w-48">
            <option value="all">All requests</option>
            <option value="open">Under review</option>
            <option value="decided">Fully decided</option>
          </select>
        </label>
        <label>
          <span className="label">Requested from</span>
          <input type="date" name="from" defaultValue={f.from} className="input" />
        </label>
        <label>
          <span className="label">to</span>
          <input type="date" name="to" defaultValue={f.to} className="input" />
        </label>
        <button className="btn btn-primary">Apply</button>
        <Link href="/portal/requests" className="btn btn-ghost">Clear</Link>
      </form>
      <section className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th>Requested on</th>
                <th>Requested by</th>
                <th className="text-right">AWBs</th>
                <th className="text-right">Under review</th>
                <th className="text-right">Loss accepted</th>
                <th className="text-right">Not accepted / investigating</th>
                <th>Loss accepted on</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="font-semibold" href={`/portal/requests/${r.id}`}>LR-{r.request_number}</Link></td>
                  <td><StatusBadge label={REQUEST_STATUS[r.status]?.client ?? r.status} color={REQUEST_STATUS[r.status]?.color ?? 'slate'} /></td>
                  <td className="whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td>{r.requested_via === 'google_sheet' ? 'Your tracker (Google Sheet)' : r.requested_via === 'poc_portal' ? r.requested_by_name ?? 'Your team' : 'Shadowfax team'}</td>
                  <td className="text-right font-semibold">{fmtNum(r.awb_count)}</td>
                  <td className="text-right">{r.pending ? fmtNum(r.pending) : '—'}</td>
                  <td className="text-right">{r.accepted ? fmtNum(r.accepted) : '—'}</td>
                  <td className="text-right">{r.rejected + r.sent_back ? fmtNum(r.rejected + r.sent_back) : '—'}</td>
                  <td className="whitespace-nowrap">{r.last_accepted_at ? fmtDateTime(r.last_accepted_at) : '—'}</td>
                  <td className="max-w-[260px] truncate" title={r.reason ?? ''}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title="No Lost requests yet">Tick shipments on the Cases page and use “Request Lost for selected”.</Empty>}
        </div>
        <Pagination page={f.page} size={f.size} total={listRes.count ?? 0} hrefFor={(p) => href({ page: p })} />
      </section>
    </>
  );
}
