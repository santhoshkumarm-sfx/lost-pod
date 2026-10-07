import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/buttons';
import { Aging, Field, Flash, Panel, SourceTag, StatusBadge } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, fmtInr, SOURCE_LABELS } from '@/lib/format';
import { getAgents, getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import type { CaseRow } from '@/lib/types';
import { addComment, assignToMe, decideLost, reopenLost, requestLost, saveInternalNote, setDeleted, updateCase } from '../actions';

export const metadata = { title: 'Case' };

const FIELD_NAMES: Record<string, string> = {
  team_status: 'Status', pod_status: 'POD status', pod_link: 'POD link', team_remark: 'Shadowfax remark', client_remark: 'Client remark',
  assigned_agent: 'Agent', assigned_agent_name: 'Agent (tracker)', hub: 'Hub', location: 'Location', priority: 'Priority', reason: 'Reason',
  complaint_type: 'Complaint type', escalation_date: 'Escalation date', delivery_date: 'Delivery date', client_id: 'Client',
  client_poc_id: 'Client POC', closure_date: 'Closure date', product_name: 'Product', product_value: 'Product value',
  seller_name: 'Seller', shipment_status: 'Shipment status', awb: 'AWB', is_deleted: 'Removed',
};
const ACTION_NAMES: Record<string, string> = {
  created: 'Case created', lost_requested: 'Lost requested', lost_approved: 'Lost approved', lost_rejected: 'Lost request rejected',
  lost_sent_back: 'Lost request sent back', lost_reopened: 'Taken out of Lost', email_linked: 'Email linked',
};
const SOURCE_NAMES: Record<string, string> = { app: 'dashboard', sheet: 'Google Sheet', email: 'email', poc: 'client portal' };

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from('v_cases').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const c = data as CaseRow;

  const [priv, updates, comments, approvals, sources, statuses, agents, others] = await Promise.all([
    supabase.from('case_private').select('internal_remark, updated_at').eq('case_id', id).maybeSingle(),
    supabase.from('case_updates').select('*').eq('case_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('case_comments').select('*').eq('case_id', id).order('created_at'),
    supabase.from('lost_approvals').select('*').eq('case_id', id).order('requested_at', { ascending: false }),
    supabase.from('source_records').select('id, source_type, workbook_id, sheet_name, row_number, raw, last_seen_at, email_id').eq('case_id', id),
    getStatuses(supabase),
    getAgents(supabase),
    supabase.from('v_cases').select('id, case_number, escalation_date, status_label, status_color, client_display_name').eq('awb', c.awb).neq('id', id),
  ]);
  const userIds = new Set<string>();
  (updates.data ?? []).forEach((u) => u.user_id && userIds.add(u.user_id));
  (comments.data ?? []).forEach((u) => u.user_id && userIds.add(u.user_id));
  (approvals.data ?? []).forEach((a) => {
    if (a.requested_by) userIds.add(a.requested_by);
    if (a.decided_by) userIds.add(a.decided_by);
  });
  const people = userIds.size
    ? ((await supabase.from('profiles').select('id, full_name, email').in('id', [...userIds])).data ?? [])
    : [];
  const who = (uid: string | null) => {
    if (!uid) return 'System';
    const p = people.find((x) => x.id === uid);
    return p?.full_name ?? p?.email ?? 'Unknown user';
  };
  const agentName = (uid: string | null) => agents.find((a) => a.id === uid)?.full_name ?? null;
  const statusLabel = (code: string | null) => statuses.find((s) => s.code === code)?.label ?? code;
  const showValue = (field: string | null, v: string | null) =>
    !v ? '—' : field === 'team_status' ? statusLabel(v) : field === 'assigned_agent' ? agentName(v) ?? 'a user' : field === 'client_id' || field === 'client_poc_id' ? 'changed' : v;

  const inLostFlow = c.status_category === 'lost' || c.status_category === 'lost_pending';
  const pending = (approvals.data ?? []).find((a) => a.status === 'pending');
  const canEdit = admin || !c.assigned_agent || c.assigned_agent === user.id;
  const manualStatuses = statuses.filter((s) => s.is_active && s.allow_manual && (s.category === 'open' || s.category === 'closed'));
  const sheetUrl = c.source_type === 'google_sheet' && sources.data?.[0]?.workbook_id ? `https://docs.google.com/spreadsheets/d/${sources.data[0].workbook_id}` : null;

  return (
    <>
      <div className="mb-1 text-xs text-ink-faint">
        <Link href="/cases">Cases</Link> / #{c.case_number}
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="awb text-2xl font-medium">{c.awb}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusBadge label={c.status_label} color={c.status_color} />
            <Aging days={c.aging_days} final={c.status_category === 'closed' || c.status_category === 'lost'} />
            <span className="text-ink-soft">{c.client_display_name ?? 'No client'}</span>
            <SourceTag source={c.source_type} />
            {c.sla_breached && <span className="chip bg-[#F8E4E0] text-age-6">TAT breached</span>}
            {c.status_source === 'import' && <span className="text-xs text-ink-faint">Status follows the tracker until changed here</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!c.assigned_agent && (
            <form action={assignToMe}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton className="btn">Assign to me</SubmitButton>
            </form>
          )}
          {admin && (
            <form action={setDeleted}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="deleted" value="1" />
              <SubmitButton className="btn btn-ghost" confirm="Remove this case? It disappears from lists and reports but stays in the audit log.">Remove case</SubmitButton>
            </form>
          )}
        </div>
      </div>
      <Flash sp={sp} />
      {!!others.data?.length && (
        <div className="mb-4 rounded border border-age-2/50 bg-[#FBF7E6] px-3 py-2 text-sm">
          Other escalations of this AWB:{' '}
          {others.data.map((o, i) => (
            <span key={o.id}>
              {i ? ', ' : ''}
              <Link href={`/cases/${o.id}`}>#{o.case_number}</Link> ({fmtDate(o.escalation_date)}, {o.status_label})
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="space-y-5">
          <Panel title="Work on this case">
            {!canEdit && <p className="mb-3 text-ink-soft">Assigned to {c.agent_display_name}. Only they or an admin can edit it.</p>}
            <form action={updateCase}>
              <input type="hidden" name="id" value={c.id} />
              <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-3">
                <Field label="Status" hint={inLostFlow ? 'Lost states change only through the approval actions below.' : undefined}>
                  {inLostFlow ? (
                    <input className="input" value={c.status_label} disabled />
                  ) : (
                    <select name="team_status" defaultValue={c.team_status} className="input">
                      {manualStatuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Agent">
                  {admin ? (
                    <select name="assigned_agent" defaultValue={c.assigned_agent ?? ''} className="input">
                      <option value="">Unassigned</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
                    </select>
                  ) : (
                    <input className="input" value={c.agent_display_name ?? 'Unassigned'} disabled />
                  )}
                </Field>
                <Field label="POD status">
                  <select name="pod_status" defaultValue={c.pod_status} className="input">
                    <option value="pending">Pending</option>
                    <option value="shared">Shared</option>
                    <option value="not_available">Not available</option>
                    <option value="disputed">Disputed</option>
                  </select>
                </Field>
                <Field label="POD link" className="md:col-span-2"><input name="pod_link" type="url" defaultValue={c.pod_link ?? ''} className="input" /></Field>
                <Field label="Priority">
                  <select name="priority" defaultValue={c.priority ?? ''} className="input">
                    <option value="">—</option>
                    <option>Normal</option>
                    <option>High</option>
                  </select>
                </Field>
                <Field label="Hub"><input name="hub" defaultValue={c.hub ?? ''} className="input" /></Field>
                <Field label="Location"><input name="location" defaultValue={c.location ?? ''} className="input" /></Field>
                <Field label="Complaint type"><input name="complaint_type" defaultValue={c.complaint_type ?? ''} className="input" /></Field>
                <Field label="Reason" className="md:col-span-3"><input name="reason" defaultValue={c.reason ?? ''} className="input" /></Field>
                <Field label="Product"><input name="product_name" defaultValue={c.product_name ?? ''} className="input" /></Field>
                <Field label="Product value (₹)"><input name="product_value" defaultValue={c.product_value ?? ''} inputMode="decimal" className="input" /></Field>
                <div />
                <Field label="Shadowfax remark — visible to the client" className="md:col-span-3">
                  <textarea name="team_remark" defaultValue={c.team_remark ?? ''} className="input" />
                </Field>
                <Field label="Client remark" className="md:col-span-3">
                  <textarea name="client_remark" defaultValue={c.client_remark ?? ''} className="input" />
                </Field>
                <div className="md:col-span-3"><SubmitButton>Save changes</SubmitButton></div>
              </fieldset>
            </form>
          </Panel>

          <Panel title="Lost">
            {c.status_category === 'open' || c.status_category === 'closed' ? (
              <form action={requestLost} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                <p className="text-ink-soft">Raising a request moves the case to “Lost — Pending Admin Approval”. It becomes Lost only when an Admin approves it.</p>
                <Field label="Why should this shipment be declared Lost?">
                  <textarea name="reason" required className="input" />
                </Field>
                <SubmitButton className="btn">Request Lost approval</SubmitButton>
              </form>
            ) : c.status_category === 'lost_pending' && pending ? (
              <div className="space-y-3">
                <p>
                  Requested by <strong>{pending.requested_via === 'google_sheet' ? 'Google Sheet' : who(pending.requested_by)}</strong> on{' '}
                  {fmtDateTime(pending.requested_at)}: “{pending.request_reason}”
                </p>
                {admin ? (
                  <form action={decideLost} className="space-y-3">
                    <input type="hidden" name="approval_id" value={pending.id} />
                    <input type="hidden" name="back" value={`/cases/${c.id}`} />
                    <Field label="Note (shared with the client; required to reject or send back)">
                      <textarea name="note" className="input" />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton name="decision" value="approved" className="btn btn-danger" confirm={`Approve Lost for ${c.awb}? Lost aging will be ${c.current_aging_days} days from the original escalation date.`}>Approve Lost</SubmitButton>
                      <SubmitButton name="decision" value="rejected" className="btn">Reject</SubmitButton>
                      <SubmitButton name="decision" value="sent_back" className="btn">Send back for investigation</SubmitButton>
                    </div>
                  </form>
                ) : (
                  <p className="text-ink-soft">Waiting for an Admin decision.</p>
                )}
              </div>
            ) : c.status_category === 'lost' ? (
              <div className="space-y-3">
                <p>
                  Approved Lost on {fmtDateTime(c.lost_approved_at)}. Lost aging: <strong>{c.final_aging_days ?? c.aging_days} days</strong> from the escalation on {fmtDate(c.escalation_date)}.
                </p>
                {admin && (
                  <details>
                    <summary className="cursor-pointer text-signal">Take this case out of Lost (shipment found)</summary>
                    <form action={reopenLost} className="mt-3 grid gap-3 md:grid-cols-[200px_1fr_auto] md:items-end">
                      <input type="hidden" name="id" value={c.id} />
                      <Field label="New status">
                        <select name="status" className="input">
                          {manualStatuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Reason"><input name="note" required className="input" /></Field>
                      <SubmitButton className="btn" confirm="Take this case out of Lost?">Reopen</SubmitButton>
                    </form>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-ink-soft">No Lost request.</p>
            )}
            {!!approvals.data?.length && (
              <div className="mt-4 border-t border-line pt-3">
                <h3 className="mb-2">Approval history</h3>
                <ul className="space-y-2">
                  {approvals.data.map((a) => (
                    <li key={a.id} className="text-sm">
                      <span className="font-medium">{a.status === 'pending' ? 'Pending' : a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : 'Sent back'}</span>
                      <span className="text-ink-soft"> — requested {fmtDateTime(a.requested_at)} by {a.requested_via === 'google_sheet' ? 'Google Sheet' : who(a.requested_by)}: {a.request_reason}</span>
                      {a.decided_at && (
                        <div className="text-ink-soft">
                          Decided {fmtDateTime(a.decided_at)} by {who(a.decided_by)}{a.decision_note ? `: ${a.decision_note}` : ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title="Comments">
            <ul className="mb-4 space-y-3">
              {(comments.data ?? []).map((m) => (
                <li key={m.id} className={`rounded border px-3 py-2 ${m.visibility === 'client' ? 'border-signal/30 bg-signal-soft/40' : 'border-line'}`}>
                  <div className="mb-1 text-xs text-ink-soft">
                    {who(m.user_id)} · {fmtDateTime(m.created_at)} · {m.visibility === 'client' ? 'Shared with client' : 'Internal'}
                  </div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                </li>
              ))}
              {!comments.data?.length && <li className="text-ink-soft">No comments yet.</li>}
            </ul>
            <form action={addComment} className="space-y-2">
              <input type="hidden" name="id" value={c.id} />
              <textarea name="body" required className="input" placeholder="Write a comment" />
              <div className="flex items-center gap-3">
                <select name="visibility" className="input w-48" defaultValue="internal">
                  <option value="internal">Internal only</option>
                  <option value="client">Share with client POC</option>
                </select>
                <SubmitButton className="btn">Add comment</SubmitButton>
              </div>
            </form>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Details">
            <dl className="kv">
              <dt>Case</dt><dd>#{c.case_number}</dd>
              <dt>Client</dt><dd>{c.client_display_name ?? '—'}{c.client_name && c.client_name !== c.client_display_name ? <span className="muted"> (tracker: {c.client_name})</span> : null}</dd>
              <dt>Client POC</dt><dd>{c.poc_name ?? '—'}</dd>
              <dt>Escalation date</dt>
              <dd>{fmtDate(c.escalation_date)}{c.escalation_date_estimated && <span className="ml-1 text-age-3">estimated — not in source</span>}</dd>
              <dt>Current aging</dt><dd>{c.current_aging_days} days</dd>
              {c.final_aging_days !== null && (<><dt>Final aging</dt><dd>{c.final_aging_days} days (closed {fmtDate(c.closure_date)})</dd></>)}
              <dt>Delivery date</dt><dd>{fmtDate(c.delivery_date)}</dd>
              <dt>Hub</dt><dd>{c.hub ?? '—'}</dd>
              <dt>Location</dt><dd>{c.location ?? '—'}</dd>
              <dt>Seller</dt><dd>{c.seller_name ?? '—'}</dd>
              <dt>Shipment status</dt><dd>{c.shipment_status ?? '—'}</dd>
              <dt>Product</dt><dd>{c.product_name ?? '—'} {c.product_value !== null && <span className="text-ink-soft">({fmtInr(c.product_value)})</span>}</dd>
              <dt>Order ID</dt><dd>{c.order_id ?? '—'}</dd>
              <dt>Rider</dt><dd>{[c.rider_name, c.rider_id].filter(Boolean).join(' / ') || '—'}</dd>
              <dt>POD link</dt><dd>{c.pod_link ? <a href={c.pod_link} target="_blank" rel="noreferrer">Open POD</a> : '—'}</dd>
              <dt>Agent</dt><dd>{c.agent_display_name ?? 'Unassigned'}</dd>
              <dt>Created</dt><dd>{fmtDateTime(c.created_at)}</dd>
            </dl>
          </Panel>

          <Panel title="Internal note" actions={<span className="text-xs text-ink-faint">Never shown to clients</span>}>
            <form action={saveInternalNote} className="space-y-2">
              <input type="hidden" name="id" value={c.id} />
              <textarea name="internal_remark" defaultValue={priv.data?.internal_remark ?? ''} className="input" rows={3} />
              <SubmitButton className="btn btn-sm">Save note</SubmitButton>
            </form>
          </Panel>

          <Panel title="Source">
            <dl className="kv">
              <dt>Created from</dt><dd>{SOURCE_LABELS[c.source_type]}</dd>
              {c.source_sheet && (<><dt>Sheet</dt><dd>{sheetUrl ? <a href={sheetUrl} target="_blank" rel="noreferrer">{c.source_workbook} › {c.source_sheet}</a> : `${c.source_workbook} › ${c.source_sheet}`}{c.source_row ? `, row ${c.source_row}` : ''}</dd></>)}
              {c.email_subject && (<><dt>Mail subject</dt><dd>{c.email_id ? <Link href={`/email-escalations/${c.email_id}`}>{c.email_subject}</Link> : c.email_subject}</dd></>)}
              {c.email_sender && (<><dt>Sender</dt><dd>{c.email_sender}</dd></>)}
              {c.email_thread_id && (<><dt>Gmail thread</dt><dd className="font-mono text-xs">{c.email_thread_id}</dd></>)}
            </dl>
            {!!sources.data?.length && (
              <details className="mt-3">
                <summary className="cursor-pointer text-signal">Raw source records ({sources.data.length})</summary>
                {sources.data.map((s) => (
                  <div key={s.id} className="mt-2 rounded border border-line bg-canvas/50 p-2 text-xs">
                    <div className="mb-1 text-ink-soft">
                      {s.source_type === 'google_sheet' ? `${s.sheet_name}, row ${s.row_number}` : 'Email'} · last seen {fmtDateTime(s.last_seen_at)}
                    </div>
                    <dl className="grid grid-cols-[130px_1fr] gap-x-2">
                      {Object.entries((s.raw ?? {}) as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="truncate text-ink-faint">{k}</dt>
                          <dd className="break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </details>
            )}
          </Panel>

          <Panel title="Timeline">
            <ol className="space-y-2.5">
              {(updates.data ?? []).map((u) => (
                <li key={u.id} className="border-l-2 border-line pl-3 text-sm">
                  <div>
                    {u.action === 'status_changed' || u.action === 'field_updated' ? (
                      <>
                        <span className="font-medium">{FIELD_NAMES[u.field] ?? u.field}</span>: {showValue(u.field, u.old_value)} → {showValue(u.field, u.new_value)}
                      </>
                    ) : (
                      <span className="font-medium">{ACTION_NAMES[u.action] ?? u.action}</span>
                    )}
                    {u.note && <span className="text-ink-soft"> — {u.note}</span>}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {fmtDateTime(u.created_at)} · {who(u.user_id)} via {SOURCE_NAMES[u.source] ?? u.source}
                    {!u.client_visible && ' · internal'}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
