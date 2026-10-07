import Link from 'next/link';
import { SelectAll, SubmitButton } from '@/components/buttons';
import { Aging, Empty, Flash, PageHeader, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, fmtInr } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { decideLost } from '../cases/actions';

export const metadata = { title: 'Lost approval' };

interface Approval {
  id: string; case_id: string; requested_by: string | null; requested_via: string; requested_at: string; request_reason: string | null;
  previous_status: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string | null;
}

export default async function LostApprovalPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const supabase = await createClient();
  const [pendingRes, decidedRes] = await Promise.all([
    supabase.from('lost_approvals').select('*').eq('status', 'pending').order('requested_at'),
    supabase.from('lost_approvals').select('*').neq('status', 'pending').order('decided_at', { ascending: false }).limit(50),
  ]);
  const pending = (pendingRes.data ?? []) as Approval[];
  const decided = (decidedRes.data ?? []) as Approval[];
  const caseIds = [...new Set([...pending, ...decided].map((a) => a.case_id))];
  const userIds = [...new Set([...pending, ...decided].flatMap((a) => [a.requested_by, a.decided_by]).filter((x): x is string => !!x))];
  const [casesRes, peopleRes] = await Promise.all([
    caseIds.length
      ? supabase.from('v_cases').select('id, awb, client_display_name, escalation_date, current_aging_days, hub, location, product_value, team_remark, poc_name').in('id', caseIds)
      : Promise.resolve({ data: [] as never[] }),
    userIds.length ? supabase.from('profiles').select('id, full_name, email, role').in('id', userIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  type C = { id: string; awb: string; client_display_name: string | null; escalation_date: string; current_aging_days: number; hub: string | null; location: string | null; product_value: number | null; team_remark: string | null; poc_name: string | null };
  const cases = new Map(((casesRes.data ?? []) as C[]).map((c) => [c.id, c]));
  const people = (peopleRes.data ?? []) as { id: string; full_name: string | null; email: string; role: string }[];
  const who = (a: Approval) => {
    if (a.requested_via === 'google_sheet') return 'Google Sheet';
    const p = people.find((x) => x.id === a.requested_by);
    return p ? `${p.full_name ?? p.email}${p.role === 'client_poc' ? ' (client POC)' : ''}` : 'Unknown';
  };
  const decider = (id: string | null) => people.find((x) => x.id === id)?.full_name ?? '—';

  return (
    <>
      <PageHeader
        title="Lost approval"
        sub="Requests from client POCs, the team and Google Sheets. Nothing is Lost until an Admin approves it; Lost aging runs from the original escalation date to the approval date."
      />
      <Flash sp={sp} />
      <form action={decideLost} className="panel mb-6">
        <input type="hidden" name="back" value="/lost-approval" />
        <div className="panel-head">
          <h2>Waiting for a decision ({pending.length})</h2>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {admin && <th className="w-8"><SelectAll name="approval_id" /></th>}
                <th>AWB</th>
                <th>Client</th>
                <th>Escalated</th>
                <th>Lost aging if approved today</th>
                <th>Hub / location</th>
                <th>Value</th>
                <th>Requested by</th>
                <th>Reason</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((a) => {
                const c = cases.get(a.case_id);
                return (
                  <tr key={a.id}>
                    {admin && <td><input type="checkbox" name="approval_id" value={a.id} aria-label={`Select ${c?.awb}`} /></td>}
                    <td><Link className="awb" href={`/cases/${a.case_id}`}>{c?.awb ?? 'Case'}</Link></td>
                    <td>{c?.client_display_name ?? '—'}</td>
                    <td className="whitespace-nowrap">{fmtDate(c?.escalation_date)}</td>
                    <td>{c ? <Aging days={c.current_aging_days} /> : '—'}</td>
                    <td>{c?.hub ?? c?.location ?? '—'}</td>
                    <td className="whitespace-nowrap">{fmtInr(c?.product_value)}</td>
                    <td>{who(a)}</td>
                    <td className="max-w-[280px]">{a.request_reason}</td>
                    <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(a.requested_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pending.length && <Empty title="No Lost requests waiting">New requests appear here and on the dashboard.</Empty>}
        </div>
        {admin && pending.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3">
            <label className="min-w-[300px] flex-1">
              <span className="label">Note for the selected requests (shared with the client; required to reject or send back)</span>
              <input name="note" className="input" />
            </label>
            <SubmitButton name="decision" value="approved" className="btn btn-danger" confirm="Approve Lost for all selected cases?">Approve selected</SubmitButton>
            <SubmitButton name="decision" value="rejected" className="btn">Reject selected</SubmitButton>
            <SubmitButton name="decision" value="sent_back" className="btn">Send back selected</SubmitButton>
          </div>
        )}
        {!admin && pending.length > 0 && <p className="border-t border-line px-4 py-3 text-ink-soft">Only an Admin can decide these requests.</p>}
      </form>

      <Panel title="Recent decisions" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>AWB</th>
              <th>Client</th>
              <th>Decision</th>
              <th>Note</th>
              <th>Decided by</th>
              <th>Decided</th>
              <th>Requested by</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((a) => {
              const c = cases.get(a.case_id);
              return (
                <tr key={a.id}>
                  <td><Link className="awb" href={`/cases/${a.case_id}`}>{c?.awb ?? 'Case'}</Link></td>
                  <td>{c?.client_display_name ?? '—'}</td>
                  <td className={a.status === 'approved' ? 'font-medium text-age-5' : ''}>
                    {a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : 'Sent back'}
                  </td>
                  <td className="max-w-[300px] text-ink-soft">{a.decision_note ?? ''}</td>
                  <td>{decider(a.decided_by)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(a.decided_at)}</td>
                  <td>{who(a)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!decided.length && <Empty title="No decisions yet" />}
      </Panel>
    </>
  );
}
