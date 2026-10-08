import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SelectAll, SubmitButton } from '@/components/buttons';
import { Aging, Empty, Flash, Kpi, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { REQUEST_STATUS, VIA_LABELS } from '@/lib/cases/lost-filters';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, fmtInr } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { decideLost } from '../../../cases/actions';

export const metadata = { title: 'Lost request' };

const ITEM: Record<string, { label: string; color: string }> = {
  pending: { label: 'Waiting', color: 'amber' },
  approved: { label: 'Loss accepted', color: 'red' },
  rejected: { label: 'Rejected', color: 'slate' },
  sent_back: { label: 'Sent back', color: 'teal' },
};

export default async function LostRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await createClient();
  const [reqRes, itemsRes] = await Promise.all([
    supabase.from('v_lost_request_summary').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('v_lost_requests')
      .select('id, case_id, awb, escalation_date, current_aging_days, hub, location, product_value, status, decided_at, decided_by_name, decision_note, request_reason, can_decide')
      .eq('request_id', id)
      .order('status')
      .order('current_aging_days', { ascending: false })
      .limit(5000),
  ]);
  const r = reqRes.data;
  if (!r) notFound();
  const items = (itemsRes.data ?? []) as {
    id: string; case_id: string; awb: string; escalation_date: string; current_aging_days: number; hub: string | null; location: string | null;
    product_value: number | null; status: string; decided_at: string | null; decided_by_name: string | null; decision_note: string | null;
    request_reason: string | null; can_decide: boolean;
  }[];
  const decidable = items.filter((i) => i.status === 'pending' && i.can_decide);
  // Decision history: one line per decision batch (same person, outcome, note and minute).
  const history = new Map<string, { at: string; by: string; status: string; note: string | null; n: number }>();
  for (const i of items.filter((x) => x.decided_at)) {
    const key = `${i.decided_at!.slice(0, 16)}|${i.decided_by_name}|${i.status}|${i.decision_note ?? ''}`;
    const h = history.get(key) ?? { at: i.decided_at!, by: i.decided_by_name ?? '—', status: i.status, note: i.decision_note, n: 0 };
    h.n++;
    history.set(key, h);
  }
  const back = `/lost-approval/requests/${id}`;
  const st = REQUEST_STATUS[r.status] ?? { label: r.status, color: 'slate' };

  return (
    <>
      <div className="mb-2 text-xs"><Link href="/lost-approval">← Lost approval</Link></div>
      <PageHeader
        title={`Lost request LR-${r.request_number} · ${r.client_name}`}
        sub={
          <>
            Requested by <strong>{r.requested_via === 'google_sheet' ? 'Google Sheet' : r.requested_by_name ?? 'Unknown'}</strong> via {VIA_LABELS[r.requested_via] ?? r.requested_via} on {fmtDateTime(r.created_at)}.
            {r.reason && <> Reason: “{r.reason}”</>}
          </>
        }
        actions={<StatusBadge label={st.label} color={st.color} />}
      />
      <Flash sp={sp} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="AWBs" value={r.awb_count} />
        <Kpi label="Waiting" value={r.pending} tone={r.pending ? 'warn' : undefined} />
        <Kpi label="Loss accepted" value={r.accepted} />
        <Kpi label="Rejected / sent back" value={r.rejected + r.sent_back} />
        <Kpi label="Oldest aging (days)" value={r.max_aging} tone={r.max_aging > 30 ? 'alert' : undefined} />
        <Kpi label={r.pending ? 'Waiting for (days)' : 'Average aging'} value={r.pending ? r.waiting_days : `${r.avg_aging} d`} />
      </div>

      <form action={decideLost} className="panel mb-5">
        <input type="hidden" name="back" value={back} />
        {decidable.length > 0 ? (
          <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-line bg-panel px-4 py-3">
            <label className="flex items-center gap-2 pb-2 font-medium"><SelectAll name="approval_id" /> Select all</label>
            <fieldset className="flex flex-col gap-1 text-xs">
              <label className="flex items-center gap-1.5"><input type="radio" name="request_id" value="" defaultChecked /> Ticked AWBs only</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="request_id" value={id} /> All {decidable.length} waiting in this request</label>
            </fieldset>
            <label className="min-w-[240px] flex-1">
              <span className="label">Note (shared with the requester; required to reject or send back)</span>
              <input name="note" className="input" />
            </label>
            <SubmitButton name="decision" value="approved" className="btn btn-danger" pending="Accepting…" confirm="Accept the loss for the chosen AWBs? The client is told.">Accept loss</SubmitButton>
            <SubmitButton name="decision" value="rejected" className="btn" pending="Rejecting…">Reject</SubmitButton>
            <SubmitButton name="decision" value="sent_back" className="btn" pending="Sending back…">Send back</SubmitButton>
          </div>
        ) : r.pending > 0 ? (
          <p className="border-b border-line px-4 py-2 text-xs text-ink-soft">You can view this request but not decide it. A Super Admin grants approval rights under Users.</p>
        ) : null}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8" />
                <th>AWB</th>
                <th>Escalated</th>
                <th>Aging</th>
                <th>Hub / location</th>
                <th className="text-right">Value</th>
                <th>Outcome</th>
                <th>Decided</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.status === 'pending' && i.can_decide && <input type="checkbox" name="approval_id" value={i.id} aria-label={`Select ${i.awb}`} />}</td>
                  <td><Link className="awb" href={`/cases/${i.case_id}`}>{i.awb}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(i.escalation_date)}</td>
                  <td><Aging days={i.current_aging_days} final={i.status === 'approved'} /></td>
                  <td>{i.hub ?? i.location ?? '—'}</td>
                  <td className="whitespace-nowrap text-right">{fmtInr(i.product_value)}</td>
                  <td><StatusBadge label={ITEM[i.status]?.label ?? i.status} color={ITEM[i.status]?.color ?? 'slate'} /></td>
                  <td className="whitespace-nowrap text-ink-soft">{i.decided_at ? fmtDateTime(i.decided_at) : '—'}</td>
                  <td>{i.decided_by_name ?? '—'}</td>
                  <td className="max-w-[260px] text-ink-soft">{i.decision_note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <Empty title="No AWBs in this request" />}
        </div>
      </form>

      <Panel title="History">
        <ul className="space-y-2">
          <li><span className="text-ink-soft">{fmtDateTime(r.created_at)}</span> — Requested: {r.awb_count} AWB(s) by {r.requested_via === 'google_sheet' ? 'Google Sheet' : r.requested_by_name ?? 'Unknown'}</li>
          {[...history.values()].sort((a, b) => a.at.localeCompare(b.at)).map((h) => (
            <li key={`${h.at}${h.status}${h.note}`}>
              <span className="text-ink-soft">{fmtDateTime(h.at)}</span> — {ITEM[h.status]?.label ?? h.status}: {h.n} AWB(s) by {h.by}{h.note ? ` — “${h.note}”` : ''}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
