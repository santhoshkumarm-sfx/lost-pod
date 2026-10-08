import Link from 'next/link';
import { SelectAll, SubmitButton } from '@/components/buttons';
import { Aging, Empty, Flash, Kpi, PageHeader, Pagination, Panel, StatusBadge } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { applyLostFilters, applyRequestFilters, lostFilterEntries, lostQuery, parseLostFilters, REQUEST_STATUS, VIA_LABELS, type LostFilters } from '@/lib/cases/lost-filters';
import { requestIdsForAwbSearch } from '@/lib/lost';
import type { SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, fmtInr, fmtNum } from '@/lib/format';
import { getBuckets, getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { decideLost } from '../cases/actions';

export const metadata = { title: 'Lost approval' };

interface Req {
  id: string; case_id: string; requested_via: string; requested_at: string; request_reason: string | null; status: string;
  decided_at: string | null; decision_note: string | null; awb: string; client_id: string | null; client_display_name: string | null;
  escalation_date: string; current_aging_days: number; hub: string | null; location: string | null; product_value: number | null;
  requested_by_name: string | null; requested_by_role: string | null; decided_by_name: string | null; can_decide: boolean;
  request_id: string | null; request_number: number | null;
}

const COLS =
  'id, case_id, requested_via, requested_at, request_reason, status, decided_at, decision_note, awb, client_id, client_display_name, escalation_date, current_aging_days, hub, location, product_value, requested_by_name, requested_by_role, decided_by_name, can_decide, request_id, request_number';

export default async function LostApprovalPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const sp = await searchParams;
  const f = parseLostFilters(sp);
  return f.view === 'awb' ? <AwbView sp={sp} f={f} user={user} /> : <RequestView sp={sp} f={f} user={user} />;
}

type User = Awaited<ReturnType<typeof requireInternal>>;

async function approverScope(user: User) {
  const supabase = await createClient();
  const rights = await supabase.from('lost_approvers').select('client_id, clients(name)').eq('user_id', user.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scopes = (rights.data ?? []) as any[];
  const allClients = user.role === 'super_admin' || scopes.some((r) => r.client_id === null);
  const scopeText = user.role === 'super_admin'
    ? 'You are a Super Admin and can decide requests for every client.'
    : allClients
      ? 'You can decide requests for every client.'
      : scopes.length
        ? `You can decide requests for: ${scopes.map((r) => r.clients?.name).filter(Boolean).join(', ')}.`
        : 'You can view these requests but not decide them. A Super Admin grants approval rights under Users.';
  return { canDecideAny: allClients || scopes.length > 0, scopeText };
}

function ViewTabs({ f }: { f: LostFilters }) {
  const base = { ...f, page: 1 };
  return (
    <div className="mb-4 flex gap-1 border-b border-line">
      <Link href={`/lost-approval${lostQuery(base, { view: null, hub: null, aging: null })}`} className={`-mb-px border-b-2 px-4 py-2 no-underline ${f.view !== 'awb' ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>By request</Link>
      <Link href={`/lost-approval${lostQuery(base, { view: 'awb', state: null })}`} className={`-mb-px border-b-2 px-4 py-2 no-underline ${f.view === 'awb' ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>By AWB</Link>
    </div>
  );
}

interface ReqRow {
  id: string; request_number: number; client_id: string | null; client_name: string; requested_by_name: string | null; requested_via: string;
  reason: string | null; created_at: string; awb_count: number; pending: number; accepted: number; rejected: number; sent_back: number;
  max_aging: number; avg_aging: number; oldest_escalation: string; last_decided_at: string | null; total_value: number; waiting_days: number;
  status: string; can_decide: boolean;
}

async function RequestView({ sp, f, user }: { sp: Record<string, string | string[] | undefined>; f: LostFilters; user: User }) {
  const supabase = await createClient();
  const awbIds = await requestIdsForAwbSearch(supabase, f.q);
  const cols = 'id, request_number, client_id, client_name, requested_by_name, requested_via, reason, created_at, awb_count, pending, accepted, rejected, sent_back, max_aging, avg_aging, oldest_escalation, last_decided_at, total_value, waiting_days, status, can_decide';
  const countQ = (extra: (q: any) => any) => extra(applyRequestFilters(supabase.from('v_lost_request_summary').select('id', { count: 'exact', head: true }), f, awbIds)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [clients, scope, listRes, mineRes, awbRes] = await Promise.all([
    getClients(supabase),
    approverScope(user),
    applyRequestFilters(supabase.from('v_lost_request_summary').select(cols, { count: 'exact' }), f, awbIds)
      .order(f.state === 'decided' ? 'last_decided_at' : 'created_at', { ascending: f.state !== 'decided' && f.state !== 'all' })
      .range((f.page - 1) * f.size, f.page * f.size - 1),
    countQ((q) => q.eq('can_decide', true)),
    applyRequestFilters(supabase.from('v_lost_request_summary').select('pending, awb_count'), f, awbIds).limit(5000),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);
  const rows = (listRes.data ?? []) as ReqRow[];
  const total = listRes.count ?? 0;
  const sums = ((awbRes.data ?? []) as { pending: number; awb_count: number }[]).reduce((a, r) => ({ pending: a.pending + r.pending, awbs: a.awbs + r.awb_count }), { pending: 0, awbs: 0 });
  const back = `/lost-approval${lostQuery(f)}`;
  const hasFilters = lostFilterEntries(f).some(([k]) => k !== 'view');
  const via = (r: ReqRow) => (r.requested_via === 'google_sheet' ? 'Google Sheet' : `${r.requested_by_name ?? 'Unknown'}${r.requested_via === 'poc_portal' ? ' (client)' : ''}`);

  return (
    <>
      <PageHeader
        title="Lost approval"
        sub="Each row is one Lost request: everything a client, the team or a tracker asked for together. Open a request to decide AWB by AWB, or decide whole requests here."
      />
      <Flash sp={sp} />
      <ViewTabs f={f} />
      <form action="/lost-approval" className="panel mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <label className="min-w-[260px] flex-1">
          <span className="label">Request no., AWB(s) or text</span>
          <input name="q" defaultValue={f.q} className="input" placeholder="LR-12, pasted AWBs, client, reason, requester" />
        </label>
        <label>
          <span className="label">Client</span>
          <select name="client" defaultValue={f.client} className="input w-40">
            <option value="">All</option>
            <option value="none">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Requested via</span>
          <select name="via" defaultValue={f.via} className="input w-36">
            <option value="">Any</option>
            {Object.entries(VIA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Show</span>
          <select name="state" defaultValue={f.state} className="input w-44">
            <option value="">Waiting for a decision</option>
            <option value="decided">Fully decided</option>
            <option value="all">All requests</option>
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
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="mine" value="1" defaultChecked={f.mine === '1'} /> Only ones I can decide
        </label>
        <button className="btn btn-primary">Apply</button>
        {hasFilters && <Link href="/lost-approval" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={f.state === 'decided' ? 'Decided requests' : f.state === 'all' ? 'Requests' : 'Requests waiting'} value={total} tone={total && !f.state ? 'warn' : undefined} />
        <Kpi label="AWBs in these requests" value={sums.awbs} />
        <Kpi label="AWBs still to decide" value={sums.pending} tone={sums.pending ? 'warn' : undefined} href={`/lost-approval${lostQuery({ ...f, page: 1 }, { view: 'awb', state: null })}`} />
        <Kpi label="Requests you can decide" value={mineRes.count ?? 0} href={`/lost-approval${lostQuery(f, { mine: '1', page: 1 })}`} />
      </div>

      <form action={decideLost} className="panel">
        <input type="hidden" name="back" value={back} />
        {lostFilterEntries(f).map(([k, v]) => <input key={k} type="hidden" name={`f_${k}`} value={v} />)}
        <p className="border-b border-line px-4 py-2 text-xs text-ink-soft">{scope.scopeText}</p>
        {scope.canDecideAny && rows.some((r) => r.can_decide && r.pending > 0) && (
          <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-line bg-panel px-4 py-3">
            <label className="flex items-center gap-2 pb-2 font-medium">
              <SelectAll name="request_id" /> Select all on this page
            </label>
            <fieldset className="flex flex-col gap-1 text-xs">
              <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="selected" defaultChecked /> Ticked requests only</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="all" /> All requests I can decide{hasFilters ? ' matching the filters' : ''}</label>
            </fieldset>
            <label className="min-w-[240px] flex-1">
              <span className="label">Note (shared with the requester; required to reject or send back)</span>
              <input name="note" className="input" />
            </label>
            <SubmitButton name="decision" value="approved" className="btn btn-danger" pending="Accepting…" confirm="Accept the loss for every waiting AWB in the chosen requests? The client is told.">Accept loss (all AWBs)</SubmitButton>
            <SubmitButton name="decision" value="rejected" className="btn" pending="Rejecting…">Reject</SubmitButton>
            <SubmitButton name="decision" value="sent_back" className="btn" pending="Sending back…">Send back</SubmitButton>
          </div>
        )}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8" />
                <th>Request</th>
                <th>Status</th>
                <th>Client</th>
                <th>Requested by</th>
                <th>Requested</th>
                <th className="text-right">Waiting</th>
                <th className="text-right">AWBs</th>
                <th className="text-right">To decide</th>
                <th className="text-right">Accepted</th>
                <th className="text-right">Rejected / sent back</th>
                <th>Oldest aging</th>
                <th className="text-right">Avg aging</th>
                <th className="text-right">Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.can_decide && r.pending > 0
                      ? <input type="checkbox" name="request_id" value={r.id} aria-label={`Select LR-${r.request_number}`} />
                      : <span className="text-ink-faint" title={r.pending ? 'You do not have approval rights for this client' : 'Nothing left to decide'}>—</span>}
                  </td>
                  <td className="whitespace-nowrap"><Link className="font-semibold" href={`/lost-approval/requests/${r.id}`}>LR-{r.request_number}</Link></td>
                  <td><StatusBadge label={REQUEST_STATUS[r.status]?.label ?? r.status} color={REQUEST_STATUS[r.status]?.color ?? 'slate'} /></td>
                  <td>{r.client_name}</td>
                  <td>{via(r)}</td>
                  <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(r.created_at)}</td>
                  <td className={`whitespace-nowrap text-right ${r.pending && r.waiting_days >= 3 ? 'font-semibold text-age-4' : ''}`}>{r.pending ? `${r.waiting_days} d` : '—'}</td>
                  <td className="text-right font-semibold">{fmtNum(r.awb_count)}</td>
                  <td className="text-right">{r.pending ? fmtNum(r.pending) : '—'}</td>
                  <td className="text-right">{r.accepted ? fmtNum(r.accepted) : '—'}</td>
                  <td className="text-right">{r.rejected + r.sent_back ? fmtNum(r.rejected + r.sent_back) : '—'}</td>
                  <td><Aging days={r.max_aging} /></td>
                  <td className="text-right">{r.avg_aging} d</td>
                  <td className="whitespace-nowrap text-right">{r.total_value ? fmtInr(r.total_value) : '—'}</td>
                  <td className="max-w-[240px] truncate" title={r.reason ?? ''}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title={hasFilters ? 'No Lost requests match these filters' : 'No Lost requests waiting'}>New requests appear here, in Notifications and by email.</Empty>}
        </div>
        <Pagination page={f.page} size={f.size} total={total} hrefFor={(p) => `/lost-approval${lostQuery(f, { page: p })}`} />
      </form>
    </>
  );
}

async function AwbView({ sp, f, user }: { sp: Record<string, string | string[] | undefined>; f: LostFilters; user: User }) {
  const supabase = await createClient();

  const pendingQ = () => applyLostFilters(supabase.from('v_lost_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'), f);
  const [clients, buckets, listRes, decidableRes, portalRes, sheetRes, decidedRes] = await Promise.all([
    getClients(supabase),
    getBuckets(supabase),
    applyLostFilters(supabase.from('v_lost_requests').select(COLS, { count: 'exact' }).eq('status', 'pending'), f)
      .order('requested_at')
      .order('awb')
      .range((f.page - 1) * f.size, f.page * f.size - 1),
    pendingQ().eq('can_decide', true),
    pendingQ().eq('requested_via', 'poc_portal'),
    pendingQ().eq('requested_via', 'google_sheet'),
    applyLostFilters(supabase.from('v_lost_requests').select(COLS).neq('status', 'pending'), { ...f, from: '', to: '', mine: '' })
      .order('decided_at', { ascending: false })
      .limit(50),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);
  const pending = (listRes.data ?? []) as Req[];
  const decided = (decidedRes.data ?? []) as Req[];
  const total = listRes.count ?? 0;
  const decidable = decidableRes.count ?? 0;

  const { canDecideAny, scopeText } = await approverScope(user);
  const back = `/lost-approval${lostQuery(f)}`;
  const hasFilters = lostFilterEntries(f).some(([k]) => k !== 'view');
  const requester = (r: Req) =>
    r.requested_via === 'google_sheet' ? 'Google Sheet' : r.requested_via === 'email' ? 'Email' : `${r.requested_by_name ?? 'Unknown'}${r.requested_by_role === 'client_poc' ? ' (client)' : ''}`;

  return (
    <>
      <PageHeader
        title="Lost approval"
        sub="Every AWB waiting for a decision, across all requests. Nothing is Lost until an approver accepts it; Lost aging runs from the escalation date to the approval date."
      />
      <Flash sp={sp} />
      <ViewTabs f={f} />

      <form action="/lost-approval" className="panel mb-4 flex flex-wrap items-end gap-3 px-4 py-3">
        <input type="hidden" name="view" value="awb" />
        <label className="min-w-[260px] flex-1">
          <span className="label">AWB(s), request no. or text</span>
          <input name="q" defaultValue={f.q} className="input" placeholder="Paste AWBs (space, comma or new line) or search client, reason, requester" />
        </label>
        <label>
          <span className="label">Client</span>
          <select name="client" defaultValue={f.client} className="input w-40">
            <option value="">All</option>
            <option value="none">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Requested via</span>
          <select name="via" defaultValue={f.via} className="input w-36">
            <option value="">Any</option>
            {Object.entries(VIA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Hub / location</span>
          <input name="hub" defaultValue={f.hub} className="input w-36" />
        </label>
        <label>
          <span className="label">Aging</span>
          <select name="aging" defaultValue={f.aging} className="input w-28">
            <option value="">Any</option>
            {buckets.map((b) => <option key={b.label} value={b.label}>{b.label} days</option>)}
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
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="mine" value="1" defaultChecked={f.mine === '1'} /> Only ones I can decide
        </label>
        <label>
          <span className="label">Rows</span>
          <select name="size" defaultValue={String(f.size)} className="input w-20">
            {[100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn btn-primary">Apply</button>
        {hasFilters && <Link href="/lost-approval?view=awb" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={hasFilters ? 'Waiting (matching filters)' : 'Waiting for a decision'} value={total} tone={total ? 'warn' : undefined} />
        <Kpi label="You can decide" value={decidable} href={`/lost-approval${lostQuery(f, { mine: '1', page: 1 })}`} />
        <Kpi label="From client portal" value={portalRes.count ?? 0} href={`/lost-approval${lostQuery(f, { via: 'poc_portal', page: 1 })}`} />
        <Kpi label="From Google Sheets" value={sheetRes.count ?? 0} href={`/lost-approval${lostQuery(f, { via: 'google_sheet', page: 1 })}`} />
      </div>

      <form action={decideLost} className="panel mb-6">
        <input type="hidden" name="back" value={back} />
        {lostFilterEntries(f).map(([k, v]) => <input key={k} type="hidden" name={`f_${k}`} value={v} />)}
        <p className="border-b border-line px-4 py-2 text-xs text-ink-soft">{scopeText}</p>
        {canDecideAny && total > 0 && (
          <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-line bg-panel px-4 py-3">
            <label className="flex items-center gap-2 pb-2 font-medium">
              <SelectAll name="approval_id" /> Select all on this page
            </label>
            <fieldset className="flex flex-col gap-1 text-xs">
              <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="selected" defaultChecked /> Ticked rows only</label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="scope" value="all" /> All {decidable.toLocaleString('en-IN')} I can decide{hasFilters ? ' matching the filters' : ''}{decidable > 2000 ? ' (first 2,000)' : ''}
              </label>
            </fieldset>
            <label className="min-w-[260px] flex-1">
              <span className="label">Note (shared with the requester; required to reject or send back)</span>
              <input name="note" className="input" />
            </label>
            <SubmitButton name="decision" value="approved" className="btn btn-danger" pending="Approving…" confirm="Approve Lost for the chosen requests? The shipments become Lost and the client is told.">Approve Lost</SubmitButton>
            <SubmitButton name="decision" value="rejected" className="btn" pending="Rejecting…">Reject</SubmitButton>
            <SubmitButton name="decision" value="sent_back" className="btn" pending="Sending back…">Send back</SubmitButton>
          </div>
        )}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8" />
                <th>AWB</th>
                <th>Request</th>
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
              {pending.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.can_decide
                      ? <input type="checkbox" name="approval_id" value={a.id} aria-label={`Select ${a.awb}`} />
                      : <span className="text-ink-faint" title="You do not have approval rights for this client">—</span>}
                  </td>
                  <td><Link className="awb" href={`/cases/${a.case_id}`}>{a.awb}</Link></td>
                  <td className="whitespace-nowrap">{a.request_id ? <Link href={`/lost-approval/requests/${a.request_id}`}>LR-{a.request_number}</Link> : '—'}</td>
                  <td>{a.client_display_name ?? '—'}</td>
                  <td className="whitespace-nowrap">{fmtDate(a.escalation_date)}</td>
                  <td><Aging days={a.current_aging_days} /></td>
                  <td>{a.hub ?? a.location ?? '—'}</td>
                  <td className="whitespace-nowrap">{fmtInr(a.product_value)}</td>
                  <td>{requester(a)}</td>
                  <td className="max-w-[280px]">{a.request_reason}</td>
                  <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(a.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!pending.length && <Empty title={hasFilters ? 'No Lost requests match these filters' : 'No Lost requests waiting'}>New requests appear here and on the dashboard.</Empty>}
        </div>
        <Pagination page={f.page} size={f.size} total={total} hrefFor={(p) => `/lost-approval${lostQuery(f, { page: p })}`} />
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
            {decided.map((a) => (
              <tr key={a.id}>
                <td><Link className="awb" href={`/cases/${a.case_id}`}>{a.awb}</Link></td>
                <td>{a.client_display_name ?? '—'}</td>
                <td className={a.status === 'approved' ? 'font-medium text-age-5' : ''}>
                  {a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : 'Sent back'}
                </td>
                <td className="max-w-[300px] text-ink-soft">{a.decision_note ?? ''}</td>
                <td>{a.decided_by_name ?? '—'}</td>
                <td className="whitespace-nowrap">{fmtDateTime(a.decided_at)}</td>
                <td>{requester(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!decided.length && <Empty title="No decisions yet" />}
      </Panel>
    </>
  );
}
