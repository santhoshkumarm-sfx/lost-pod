import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aging, Kpi, Panel, StatusBadge } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { REQUEST_STATUS } from '@/lib/cases/lost-filters';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Lost request' };

const ITEM: Record<string, { label: string; color: string }> = {
  pending: { label: 'Under review', color: 'amber' },
  approved: { label: 'Loss accepted', color: 'red' },
  rejected: { label: 'Not accepted', color: 'slate' },
  sent_back: { label: 'Being investigated', color: 'teal' },
};

export default async function PortalRequest({ params }: { params: Promise<{ id: string }> }) {
  await requirePoc();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [reqRes, itemsRes] = await Promise.all([
    supabase.from('v_lost_request_summary').select('*').eq('id', id).maybeSingle(),
    supabase.from('v_lost_requests').select('id, case_id, awb, escalation_date, current_aging_days, hub, location, status, decided_at, decision_note')
      .eq('request_id', id).order('status').order('awb').limit(5000),
  ]);
  const r = reqRes.data;
  if (!r) notFound();
  const items = (itemsRes.data ?? []) as {
    id: string; case_id: string; awb: string; escalation_date: string; current_aging_days: number; hub: string | null; location: string | null;
    status: string; decided_at: string | null; decision_note: string | null;
  }[];
  const history = new Map<string, { at: string; status: string; note: string | null; n: number }>();
  for (const i of items.filter((x) => x.decided_at)) {
    const key = `${i.decided_at!.slice(0, 16)}|${i.status}|${i.decision_note ?? ''}`;
    const h = history.get(key) ?? { at: i.decided_at!, status: i.status, note: i.decision_note, n: 0 };
    h.n++;
    history.set(key, h);
  }
  const st = REQUEST_STATUS[r.status] ?? { client: r.status, color: 'slate' };
  return (
    <>
      <div className="mb-2 text-xs"><Link href="/portal/requests">← Your Lost requests</Link></div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Lost request LR-{r.request_number}</h1>
          <p className="mt-1 text-ink-soft">
            Requested on {fmtDateTime(r.created_at)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}.{r.reason ? ` Reason: “${r.reason}”` : ''}
          </p>
        </div>
        <StatusBadge label={st.client} color={st.color} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="AWBs" value={r.awb_count} />
        <Kpi label="Under review" value={r.pending} />
        <Kpi label="Loss accepted" value={r.accepted} />
        <Kpi label="Not accepted / investigating" value={r.rejected + r.sent_back} />
      </div>
      <section className="panel mb-5 tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>AWB</th>
              <th>Escalated</th>
              <th>Aging</th>
              <th>Hub / location</th>
              <th>Outcome</th>
              <th>Decided on</th>
              <th>Shadowfax note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td><Link className="awb" href={`/portal/cases/${i.case_id}`}>{i.awb}</Link></td>
                <td className="whitespace-nowrap">{fmtDate(i.escalation_date)}</td>
                <td><Aging days={i.current_aging_days} final={i.status === 'approved'} /></td>
                <td>{i.hub ?? i.location ?? '—'}</td>
                <td><StatusBadge label={ITEM[i.status]?.label ?? i.status} color={ITEM[i.status]?.color ?? 'slate'} /></td>
                <td className="whitespace-nowrap">{i.decided_at ? fmtDateTime(i.decided_at) : '—'}</td>
                <td className="max-w-[300px] text-ink-soft">{i.decision_note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Panel title="History">
        <ul className="space-y-2">
          <li><span className="text-ink-soft">{fmtDateTime(r.created_at)}</span> — Loss requested for {r.awb_count} AWB(s)</li>
          {[...history.values()].sort((a, b) => a.at.localeCompare(b.at)).map((h) => (
            <li key={`${h.at}${h.status}${h.note}`}>
              <span className="text-ink-soft">{fmtDateTime(h.at)}</span> — {ITEM[h.status]?.label ?? h.status}: {h.n} AWB(s){h.note ? ` — “${h.note}”` : ''}
            </li>
          ))}
          {r.pending > 0 && <li className="text-ink-soft">{r.pending} AWB(s) still under review.</li>}
        </ul>
      </Panel>
    </>
  );
}
