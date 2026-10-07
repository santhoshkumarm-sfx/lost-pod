import Link from 'next/link';
import { HBarChart } from '@/components/charts';
import { Aging, AgingRibbon, Flash, Kpi, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { param, type SearchParams } from '@/lib/flash';
import { fmtNum, SOURCE_LABELS } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { CaseRow } from '@/lib/types';

export const metadata = { title: 'Dashboard' };

interface Stats {
  total: number;
  open: number;
  sla_breached: number;
  new_today: number;
  by_status: { code: string; label: string; category: string; color: string; count: number }[];
  by_aging: { label: string; count: number }[];
  by_client: { client: string; client_id: string | null; total: number; open: number; pending: number; lost_pending: number; lost: number; pod_shared: number; sla_breached: number }[];
  by_hub: { hub: string; open: number; sla_breached: number }[];
  by_agent: { agent: string; open: number; sla_breached: number; avg_aging: number }[];
  by_source: { source: string; total: number; open: number }[];
}

const STATUS_HEX: Record<string, string> = {
  slate: '#7B8594', blue: '#1F5FBF', indigo: '#4B49B5', violet: '#7A4FB0', teal: '#2C8C83', amber: '#D98A2B', red: '#A9402B', green: '#3E8A46',
};

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const client = param(sp, 'client');
  const from = param(sp, 'from');
  const to = param(sp, 'to');
  const source = param(sp, 'source');
  const supabase = await createClient();

  const [statsRes, clientsRes, oldestRes] = await Promise.all([
    supabase.rpc('case_stats', { p_client_id: client || null, p_from: from || null, p_to: to || null, p_source: source || null }),
    supabase.from('clients').select('id, name').order('name'),
    (() => {
      let q = supabase
        .from('v_cases')
        .select('id, awb, client_display_name, aging_days, status_label, status_color, hub, location')
        .in('status_category', ['open', 'lost_pending'])
        .order('aging_days', { ascending: false })
        .limit(10);
      if (client) q = q.eq('client_id', client);
      if (source) q = q.eq('source_type', source);
      if (from) q = q.gte('escalation_date', from);
      if (to) q = q.lte('escalation_date', to);
      return q;
    })(),
  ]);
  if (statsRes.error) throw new Error(statsRes.error.message);
  const s = statsRes.data as Stats;
  const count = (code: string) => s.by_status.find((x) => x.code === code)?.count ?? 0;
  const base = new URLSearchParams(Object.entries({ client, from, to, source }).filter(([, v]) => v) as [string, string][]);
  const casesHref = (extra: Record<string, string>) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/cases?${p.toString()}`;
  };
  const oldest = (oldestRes.data ?? []) as Pick<CaseRow, 'id' | 'awb' | 'client_display_name' | 'aging_days' | 'status_label' | 'status_color' | 'hub' | 'location'>[];

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub="Every number comes from the consolidated case database. Aging is counted from the escalation date, never from tracker columns."
      />
      <Flash sp={sp} />
      <form className="panel mb-5 flex flex-wrap items-end gap-3 px-4 py-3">
        <label>
          <span className="label">Client</span>
          <select name="client" defaultValue={client} className="input w-48">
            <option value="">All clients</option>
            {(clientsRes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Escalated from</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label>
          <span className="label">to</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <label>
          <span className="label">Source</span>
          <select name="source" defaultValue={source} className="input w-40">
            <option value="">All sources</option>
            <option value="google_sheet">Google Sheet</option>
            <option value="email">Email</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <button className="btn btn-primary">Apply</button>
        {base.toString() && <Link href="/dashboard" className="btn btn-ghost">Clear</Link>}
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Open cases" value={s.open} href={casesHref({ category: 'active' })} />
        <Kpi label="New since yesterday" value={s.new_today} href={casesHref({ category: 'all', from: new Date(Date.now() - 86400000).toISOString().slice(0, 10) })} />
        <Kpi label="TAT breached" value={s.sla_breached} tone={s.sla_breached ? 'alert' : undefined} href={casesHref({ sla: '1' })} />
        <Kpi label="Lost — awaiting approval" value={count('lost_pending_approval')} tone={count('lost_pending_approval') ? 'warn' : undefined} href="/lost-approval" />
        <Kpi label="Lost" value={count('lost')} href="/lost" />
        <Kpi label="POD shared" value={count('pod_shared')} href={casesHref({ status: 'pod_shared', category: 'all' })} />
        <Kpi label="Closed" value={count('closed')} href={casesHref({ category: 'closed' })} />
        <Kpi label="All cases" value={s.total} href={casesHref({ category: 'all' })} />
      </div>

      <Panel title="Open cases by aging" className="mb-5">
        <AgingRibbon buckets={s.by_aging} hrefFor={(label) => casesHref({ aging: label, category: 'active' })} />
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]">
        <Panel title="Client-wise" bodyClass="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th className="text-right">Open</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Lost awaiting approval</th>
                <th className="text-right">Lost</th>
                <th className="text-right">POD shared</th>
                <th className="text-right">TAT breached</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.by_client.map((c) => (
                <tr key={c.client + (c.client_id ?? '')}>
                  <td>
                    <Link href={casesHref({ client: c.client_id ?? 'none', category: 'active' })}>{c.client}</Link>
                  </td>
                  <td className="text-right font-semibold">{fmtNum(c.open)}</td>
                  <td className="text-right">{fmtNum(c.pending)}</td>
                  <td className="text-right">{fmtNum(c.lost_pending)}</td>
                  <td className="text-right">{fmtNum(c.lost)}</td>
                  <td className="text-right">{fmtNum(c.pod_shared)}</td>
                  <td className={`text-right ${c.sla_breached ? 'font-semibold text-age-5' : ''}`}>{fmtNum(c.sla_breached)}</td>
                  <td className="text-right text-ink-soft">{fmtNum(c.total)}</td>
                </tr>
              ))}
              {!s.by_client.length && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-ink-soft">No cases yet. Sync a Google Sheet or add an email escalation.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
        <Panel title="Status">
          <HBarChart
            data={s.by_status.map((x) => ({ name: x.label, value: x.count }))}
            colors={s.by_status.map((x) => STATUS_HEX[x.color] ?? '#7B8594')}
          />
        </Panel>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Panel title="Open cases by hub (top 15)">
          {s.by_hub.length ? <HBarChart data={s.by_hub.map((h) => ({ name: h.hub, value: h.open }))} color="#2A4066" /> : <p className="text-ink-soft">No open cases.</p>}
        </Panel>
        <Panel title="Agents" bodyClass="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="text-right">Open</th>
                <th className="text-right">TAT breached</th>
                <th className="text-right">Avg aging</th>
              </tr>
            </thead>
            <tbody>
              {s.by_agent.map((a) => (
                <tr key={a.agent}>
                  <td>{a.agent}</td>
                  <td className="text-right">{fmtNum(a.open)}</td>
                  <td className="text-right">{fmtNum(a.sla_breached)}</td>
                  <td className="text-right">{a.avg_aging} d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Sources">
          <table className="tbl">
            <thead>
              <tr>
                <th>Source</th>
                <th className="text-right">Open</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {s.by_source.map((x) => (
                <tr key={x.source}>
                  <td>
                    <Link href={casesHref({ source: x.source, category: 'active' })}>{SOURCE_LABELS[x.source]}</Link>
                  </td>
                  <td className="text-right">{fmtNum(x.open)}</td>
                  <td className="text-right">{fmtNum(x.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Oldest open cases" actions={<Link href={casesHref({ category: 'active', sort: 'aging_days', dir: 'desc' })} className="btn btn-sm">All open cases</Link>} bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>AWB</th>
              <th>Client</th>
              <th>Aging</th>
              <th>Status</th>
              <th>Hub / location</th>
            </tr>
          </thead>
          <tbody>
            {oldest.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/cases/${c.id}`} className="awb">{c.awb}</Link>
                </td>
                <td>{c.client_display_name ?? '—'}</td>
                <td><Aging days={c.aging_days} /></td>
                <td><StatusBadge label={c.status_label} color={c.status_color} /></td>
                <td>{c.hub ?? c.location ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
