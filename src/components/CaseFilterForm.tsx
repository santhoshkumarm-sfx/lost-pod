import Link from 'next/link';
import type { CaseFilters } from '@/lib/cases/filters';
import { clientStatusLabel } from '@/lib/format';

type FieldKey = 'q' | 'client' | 'category' | 'status' | 'aging' | 'hub' | 'agent' | 'poc' | 'source' | 'sla' | 'reason' | 'dates';

export function CaseFilterForm({ f, fields, more = [], clients, statuses, buckets, agents, pocs, action, dateLabel = 'Escalated', clearHref, clientView, criticalDays = 7, hidden = {} }: {
  f: CaseFilters;
  fields: FieldKey[];
  clients?: { id: string; name: string }[];
  statuses?: { code: string; label: string; category?: string }[];
  buckets?: { label: string }[];
  agents?: { id: string; full_name: string | null; email: string }[];
  pocs?: { id: string; name: string }[];
  action: string;
  dateLabel?: string;
  clearHref: string;
  clientView?: boolean;
  /** Fields shown under "More filters" (collapsed unless one of them is in use). */
  more?: FieldKey[];
  criticalDays?: number;
  hidden?: Record<string, string>;
}) {
  const main = (k: FieldKey) => fields.includes(k);
  const extra = (k: FieldKey) => more.includes(k);
  const used: Record<FieldKey, boolean> = {
    q: !!f.q, client: !!f.client, category: false, status: !!f.status, aging: !!f.aging || !!f.agemin || !!f.agemax, hub: !!f.hub, agent: !!f.agent,
    poc: !!f.poc, source: !!f.source, sla: f.sla === '1', reason: !!f.reason, dates: !!(f.from || f.to),
  };
  const open = more.some((k) => used[k]);
  const render = (has: (k: FieldKey) => boolean) => (
    <>
      {has('q') && (
        <label className="min-w-[240px] flex-1">
          <span className="label">Search</span>
          <input name="q" defaultValue={f.q} className="input" placeholder="AWB(s), client, subject, hub, POC, agent" />
        </label>
      )}
      {has('client') && clients && (
        <label>
          <span className="label">Client</span>
          <select name="client" defaultValue={f.client} className="input w-40">
            <option value="">All</option>
            <option value="none">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {has('category') && (
        <label>
          <span className="label">Show</span>
          <select name="category" defaultValue={f.category} className="input w-44">
            <option value="pending_pod">Pending POD</option>
            <option value="critical">Critical — pending over {criticalDays} days</option>
            <option value="pod_done">POD shared / closed</option>
            <option value="active">{clientView ? 'Open (incl. loss requested)' : 'Open (incl. Lost requests)'}</option>
            <option value="open">Open, incl. POD shared</option>
            <option value="lost_pending">{clientView ? 'Loss requested — under review' : 'Awaiting Lost approval'}</option>
            <option value="lost">{clientView ? 'Loss accepted' : 'Lost'}</option>
            <option value="closed">Closed</option>
            <option value="all">Everything</option>
          </select>
        </label>
      )}
      {has('status') && statuses && (
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={f.status} className="input w-44">
            <option value="">Any</option>
            {statuses.map((s) => <option key={s.code} value={s.code}>{clientView ? clientStatusLabel(s.category, s.label) : s.label}</option>)}
          </select>
        </label>
      )}
      {has('aging') && buckets && (
        <label>
          <span className="label">Aging</span>
          <select name="aging" defaultValue={f.aging} className="input w-28">
            <option value="">Any</option>
            {buckets.map((b) => <option key={b.label} value={b.label}>{b.label} days</option>)}
          </select>
        </label>
      )}
      {has('hub') && (
        <label>
          <span className="label">Hub / location</span>
          <input name="hub" defaultValue={f.hub} className="input w-40" />
        </label>
      )}
      {has('agent') && agents && (
        <label>
          <span className="label">Agent</span>
          <select name="agent" defaultValue={f.agent} className="input w-40">
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
          </select>
        </label>
      )}
      {has('poc') && pocs && (
        <label>
          <span className="label">Client POC</span>
          <select name="poc" defaultValue={f.poc} className="input w-40">
            <option value="">Any</option>
            {pocs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {has('source') && (
        <label>
          <span className="label">Source</span>
          <select name="source" defaultValue={f.source} className="input w-32">
            <option value="">Any</option>
            <option value="google_sheet">Google Sheet</option>
            <option value="email">Email</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      )}
      {has('reason') && (
        <label>
          <span className="label">Reason contains</span>
          <input name="reason" defaultValue={f.reason} className="input w-40" />
        </label>
      )}
      {has('dates') && (
        <>
          <label>
            <span className="label">{dateLabel} from</span>
            <input type="date" name="from" defaultValue={f.from} className="input" />
          </label>
          <label>
            <span className="label">to</span>
            <input type="date" name="to" defaultValue={f.to} className="input" />
          </label>
        </>
      )}
      {has('sla') && (
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="sla" value="1" defaultChecked={f.sla === '1'} /> TAT breached only
        </label>
      )}
    </>
  );
  return (
    <form action={action} className="panel mb-4 px-4 py-3">
      <input type="hidden" name="sort" value={f.sort} />
      <input type="hidden" name="dir" value={f.dir} />
      {f.agemin && <input type="hidden" name="agemin" value={f.agemin} />}
      {f.agemax && <input type="hidden" name="agemax" value={f.agemax} />}
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex flex-wrap items-end gap-3">
        {render(main)}
        <button className="btn btn-primary">Apply</button>
        <Link href={clearHref} className="btn btn-ghost">Clear</Link>
      </div>
      {more.length > 0 && (
        <details open={open} className="mt-2">
          <summary className="cursor-pointer text-xs text-ink-soft">More filters</summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">{render(extra)}</div>
        </details>
      )}
    </form>
  );
}
