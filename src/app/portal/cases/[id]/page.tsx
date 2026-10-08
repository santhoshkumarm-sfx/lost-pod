import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/buttons';
import { Aging, Field, Flash, Panel, StatusBadge } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, clientStatusLabel } from '@/lib/format';
import { getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { pocComment, pocRequestLost } from '../../actions';

export const metadata = { title: 'Escalation' };

const FIELD_NAMES: Record<string, string> = {
  team_status: 'Status', pod_status: 'POD status', pod_link: 'POD link', team_remark: 'Shadowfax update', client_remark: 'Your remark', closure_date: 'Closed on',
};
const ACTIONS: Record<string, string> = {
  created: 'Escalation registered', lost_requested: 'Lost requested', lost_approved: 'Loss accepted', lost_rejected: 'Lost request rejected',
  lost_sent_back: 'Lost request sent back for investigation', lost_reopened: 'Shipment taken out of Lost',
};

export default async function PortalCase({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requirePoc();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // RLS returns nothing for another client's case, so a guessed id is simply "not found".
  const { data: c } = await supabase
    .from('v_cases')
    .select('id, awb, client_display_name, escalation_date, aging_days, current_aging_days, final_aging_days, status_label, status_color, status_category, hub, location, delivery_date, team_remark, client_remark, pod_status, pod_link, email_subject, closure_date, lost_approved_at, reason, complaint_type')
    .eq('id', id)
    .maybeSingle();
  if (!c) notFound();
  const [updates, comments, approvals, statuses] = await Promise.all([
    supabase.from('case_updates').select('id, action, field, old_value, new_value, note, created_at').eq('case_id', id).order('created_at', { ascending: false }),
    supabase.from('case_comments').select('id, body, created_at, user_id').eq('case_id', id).order('created_at'),
    supabase.from('lost_approvals').select('id, status, requested_at, request_reason, decided_at, decision_note').eq('case_id', id).order('requested_at', { ascending: false }),
    getStatuses(supabase),
  ]);
  const label = (field: string | null, v: string | null) => (!v ? '—' : field === 'team_status' ? statuses.find((s) => s.code === v)?.label ?? v : v);
  const canRequest = c.status_category === 'open';

  return (
    <>
      <div className="mb-1 text-xs text-ink-faint"><Link href="/portal">Your escalations</Link></div>
      <div className="mb-5">
        <h1 className="awb text-2xl font-medium">{c.awb}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <StatusBadge label={clientStatusLabel(c.status_category, c.status_label)} color={c.status_color} />
          <Aging days={c.aging_days} final={c.status_category === 'closed' || c.status_category === 'lost'} />
          <span className="text-ink-soft">Escalated {fmtDate(c.escalation_date)}</span>
        </div>
      </div>
      <Flash sp={sp} />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5">
          <Panel title="Details">
            <dl className="kv">
              <dt>Shadowfax update</dt><dd className="whitespace-pre-wrap">{c.team_remark ?? '—'}</dd>
              <dt>POD</dt><dd>{c.pod_link ? <a href={c.pod_link} target="_blank" rel="noreferrer">View POD</a> : c.pod_status === 'shared' ? 'Shared' : 'Not yet shared'}</dd>
              <dt>Hub / location</dt><dd>{[c.hub, c.location].filter(Boolean).join(' — ') || '—'}</dd>
              <dt>Delivery date</dt><dd>{fmtDate(c.delivery_date)}</dd>
              <dt>Escalation</dt><dd>{[c.complaint_type, c.reason].filter(Boolean).join(': ') || '—'}</dd>
              {c.email_subject && (<><dt>Your mail</dt><dd>{c.email_subject}</dd></>)}
              <dt>Your remark</dt><dd>{c.client_remark ?? '—'}</dd>
              {c.closure_date && (<><dt>Closed</dt><dd>{fmtDate(c.closure_date)} after {c.final_aging_days} days</dd></>)}
            </dl>
          </Panel>
          <Panel title="Messages">
            <ul className="mb-4 space-y-3">
              {(comments.data ?? []).map((m) => (
                <li key={m.id} className={`rounded border px-3 py-2 ${m.user_id === user.id ? 'border-line' : 'border-signal/30 bg-signal-soft/40'}`}>
                  <div className="mb-1 text-xs text-ink-soft">{m.user_id === user.id ? 'You' : 'Shadowfax team'} — {fmtDateTime(m.created_at)}</div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                </li>
              ))}
              {!comments.data?.length && <li className="text-ink-soft">No messages yet.</li>}
            </ul>
            <form action={pocComment} className="space-y-2">
              <input type="hidden" name="id" value={c.id} />
              <textarea name="body" required className="input" placeholder="Write to the Shadowfax team" />
              <SubmitButton className="btn">Send message</SubmitButton>
            </form>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Lost">
            {canRequest ? (
              <form action={pocRequestLost} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <p className="text-ink-soft">If the shipment cannot be traced, ask Shadowfax to declare it Lost. A Shadowfax admin reviews every request.</p>
                <Field label="Reason"><textarea name="reason" required minLength={5} className="input" /></Field>
                <SubmitButton className="btn" confirm="Send a Lost request for this shipment?">Request Lost</SubmitButton>
              </form>
            ) : c.status_category === 'lost_pending' ? (
              <p>Your Lost request is being reviewed by Shadowfax.</p>
            ) : c.status_category === 'lost' ? (
              <p>Loss accepted on {fmtDateTime(c.lost_approved_at)}, {c.final_aging_days ?? c.aging_days} days after escalation.</p>
            ) : (
              <p className="text-ink-soft">This escalation is closed.</p>
            )}
            {!!approvals.data?.length && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
                {approvals.data.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{a.status === 'pending' ? 'Under review' : a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Not approved' : 'Sent back for investigation'}</span>
                    <span className="text-ink-soft"> — requested {fmtDateTime(a.requested_at)}</span>
                    {a.decision_note && <div className="text-ink-soft">Shadowfax: {a.decision_note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="History">
            <ol className="space-y-2.5">
              {(updates.data ?? []).map((u) => (
                <li key={u.id} className="border-l-2 border-line pl-3 text-sm">
                  <div>
                    {u.field ? (
                      <><span className="font-medium">{FIELD_NAMES[u.field] ?? u.field}</span>: {label(u.field, u.new_value)}</>
                    ) : (
                      <span className="font-medium">{ACTIONS[u.action] ?? u.action}</span>
                    )}
                    {u.note && u.action !== 'created' && <span className="text-ink-soft"> — {u.note}</span>}
                  </div>
                  <div className="text-xs text-ink-faint">{fmtDateTime(u.created_at)}</div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
