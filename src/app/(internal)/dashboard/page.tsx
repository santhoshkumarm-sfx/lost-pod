import Link from 'next/link';
import { HBarChart } from '@/components/charts';
import { Aging, AgingRibbon, Flash, Kpi, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { CaseFilterForm } from '@/components/CaseFilterForm';
import { applyCaseFilters, filtersToQuery, parseCaseFilters, statsFilter as toStats, type PodStats } from '@/lib/cases/filters';
import { PodTiles } from '@/components/pod';
import { PivotTable } from '@/components/pivot';
import { requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { getAgents, getBuckets, getClients, getPocs, getStatuses } from '@/lib/lookups';
import { fmtInrShort, fmtNum, SOURCE_LABELS } from '@/lib/format';
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

async function DetailedDashboard({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const f = parseCaseFilters(sp, { category: 'all' });
  const supabase = await createClient();
  const statsFilter = {
    q: f.q, client: f.client, status: f.status, category: f.category, aging: f.aging, hub: f.hub, agent: f.agent, poc: f.poc,
    source: f.source, from: f.from, to: f.to, sla: f.sla, reason: f.reason,
  };

  const [statsRes, clients, statuses, buckets, agents, pocs, oldestRes] = await Promise.all([
    supabase.rpc('case_stats_f', { p: statsFilter }),
    getClients(supabase),
    getStatuses(supabase),
    getBuckets(supabase),
    getAgents(supabase),
    getPocs(supabase, f.client && f.client !== 'none' ? f.client : null),
    applyCaseFilters(
      supabase.from('v_cases').select('id, awb, client_display_name, aging_days, status_label, status_color, hub, location'),
      { ...f, category: f.category === 'all' ? 'active' : f.category },
    )
      .order('aging_days', { ascending: false })
      .limit(10),
  ]);
  if (statsRes.error) throw new Error(statsRes.error.message);
  const s = statsRes.data as Stats;
  const count = (code: string) => s.by_status.find((x) => x.code === code)?.count ?? 0;
  const lostPending = s.by_status.filter((x) => x.category === 'lost_pending').reduce((n, x) => n + x.count, 0);
  const lost = s.by_status.filter((x) => x.category === 'lost').reduce((n, x) => n + x.count, 0);
  const closed = s.by_status.filter((x) => x.category === 'closed').reduce((n, x) => n + x.count, 0);
  const filtered = Object.entries(statsFilter).some(([k, v]) => v && !(k === 'category' && v === 'all'));
  const casesHref = (extra: Record<string, string>) => `/cases${filtersToQuery({ ...statsFilter }, extra)}`;
  const lostApprovalHref = `/lost-approval${filtersToQuery({ client: f.client, hub: f.hub, aging: f.aging, q: f.q })}`;
  const oldest = (oldestRes.data ?? []) as Pick<CaseRow, 'id' | 'awb' | 'client_display_name' | 'aging_days' | 'status_label' | 'status_color' | 'hub' | 'location'>[];

  return (
    <>
      <PageHeader title="Dashboard — detailed" sub="Every status, hub, agent and source. Numbers follow the filters below." />
      <Flash sp={sp} />
      <DashTabs detailed />
      <CaseFilterForm
        f={f}
        hidden={{ view: 'detailed' }}
        action="/dashboard"
        clearHref="/dashboard?view=detailed"
        fields={['q', 'client', 'category', 'status', 'aging', 'hub', 'agent', 'poc', 'source', 'reason', 'dates', 'sla']}
        clients={clients}
        statuses={statuses}
        buckets={buckets}
        agents={agents}
        pocs={pocs}
      />
      {filtered && <p className="-mt-2 mb-3 text-xs text-ink-soft">Showing counts for the filtered cases only.</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Open cases" value={s.open} href={casesHref({ category: 'active' })} />
        <Kpi label="New since yesterday" value={s.new_today} href={casesHref({ category: 'all', from: new Date(Date.now() - 86400000 + 19800000).toISOString().slice(0, 10) })} />
        <Kpi label="TAT breached" value={s.sla_breached} tone={s.sla_breached ? 'alert' : undefined} href={casesHref({ sla: '1' })} />
        <Kpi label="Lost — awaiting approval" value={lostPending} tone={lostPending ? 'warn' : undefined} href={lostApprovalHref} />
        <Kpi label="Loss accepted" value={lost} href={casesHref({ category: 'lost' })} />
        <Kpi label="POD shared" value={count('pod_shared')} href={casesHref({ status: 'pod_shared', category: 'all' })} />
        <Kpi label="Closed" value={closed} href={casesHref({ category: 'closed' })} />
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

      <Panel title={filtered ? 'Oldest cases (matching filters)' : 'Oldest open cases'} actions={<Link href={casesHref({ category: f.category === 'all' ? 'active' : f.category, sort: 'aging_days', dir: 'desc' })} className="btn btn-sm">See all</Link>} bodyClass="tbl-wrap">
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

function DashTabs({ detailed }: { detailed: boolean }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-line">
      <Link href="/dashboard" className={`-mb-px border-b-2 px-4 py-2 no-underline ${!detailed ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>Summary</Link>
      <Link href="/dashboard?view=detailed" className={`-mb-px border-b-2 px-4 py-2 no-underline ${detailed ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>Detailed (Super Admin)</Link>
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const sp = await searchParams;
  const isSuper = user.role === 'super_admin';
  if (isSuper && sp.view === 'detailed') return <DetailedDashboard sp={sp} />;
  const f = parseCaseFilters(sp, { category: 'all' });
  const supabase = await createClient();
  const p = toStats(f, { category: 'all' });
  const [statsRes, mineRes, clients, agents] = await Promise.all([
    supabase.rpc('pod_stats', { p }),
    user.role === 'internal_team' ? supabase.rpc('pod_stats', { p: { ...p, agent: user.id } }) : Promise.resolve({ data: null }),
    getClients(supabase),
    getAgents(supabase),
  ]);
  if (statsRes.error) throw new Error(statsRes.error.message);
  const s = statsRes.data as PodStats;
  const mine = mineRes.data as PodStats | null;
  const base = { q: f.q, client: f.client, agent: f.agent, hub: f.hub, source: f.source, from: f.from, to: f.to, poc: f.poc };
  const cases = (extra: Record<string, string | null>) => `/cases${filtersToQuery({ ...base, sort: 'aging_days', dir: 'desc' } as never, extra)}`;
  const rangeHref = (b: { min: number; max: number | null }, extra: Record<string, string | null> = {}) =>
    cases({ category: 'pending_pod', agemin: String(b.min), agemax: b.max === null ? null : String(b.max), ...extra });
  const tileHref = (k: string) =>
    k === 'pending' ? cases({ category: 'pending_pod' }) : k === 'critical' ? cases({ category: 'critical' })
      : k === 'shared' ? cases({ category: 'pod_done' }) : k === 'lost_pending' ? `/lost-approval${f.client ? `?client=${f.client}` : ''}`
        : cases({ category: 'lost' });
  const byValue = sp.measure === 'value';
  const fmt = byValue ? fmtInrShort : fmtNum;
  const ageCols = s.pending_age.map((b) => ({ label: b.max === b.min ? `${b.label} d` : b.label }));
  const hotFrom = s.pending_age.findIndex((b) => b.min > s.critical_days);
  const clientKey = (id: string | null) => id ?? 'none';
  const measureHref = (m: 'count' | 'value') => `/dashboard${filtersToQuery(f as never, { measure: m === 'value' ? 'value' : null, page: null, size: null, sort: null, dir: null, category: null })}`;
  const measureToggle = (
    <div className="flex overflow-hidden rounded border border-line text-xs">
      <Link href={measureHref('count')} className={`px-3 py-1.5 no-underline ${byValue ? 'text-ink-soft' : 'bg-night font-semibold text-white'}`}>AWBs</Link>
      <Link href={measureHref('value')} className={`px-3 py-1.5 no-underline ${byValue ? 'bg-night font-semibold text-white' : 'text-ink-soft'}`}>Product value ₹</Link>
    </div>
  );
  const agentHref = (a: { agent_id: string | null; agent: string }, extra: Record<string, string | null> = {}) =>
    a.agent_id ? { agent: a.agent_id, ...extra } : a.agent === 'Unassigned' ? { agent: 'unassigned', ...extra } : { q: a.agent, ...extra };
  const valueNote = byValue && s.value?.pending_no_value ? ` ${fmtNum(s.value.pending_no_value)} pending AWB(s) have no product value yet (counted as ₹0) — add them under Product value & OTP.` : '';
  const statusCols = [
    { label: 'Pending POD' }, { label: `Critical (> ${s.critical_days} d)` }, { label: 'POD shared / closed' },
    { label: 'Loss requested' }, { label: 'Loss accepted' },
  ];
  const statusCats = ['pending_pod', 'critical', 'pod_done', 'lost_pending', 'lost'];

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`Every shipment ends with a POD shared or a loss accepted. Pending POD over ${s.critical_days} days is critical. Click any number to open those cases.`}
        actions={<Link href={cases({ category: 'critical' })} className="btn btn-danger">Open critical list ({fmtNum(s.critical)})</Link>}
      />
      <Flash sp={sp} />
      {isSuper && <DashTabs detailed={false} />}
      <CaseFilterForm
        f={f}
        action="/dashboard"
        clearHref="/dashboard"
        fields={['q', 'client', 'agent']}
        more={['hub', 'poc', 'source', 'dates', 'value']}
        hidden={byValue ? { measure: 'value' } : {}}
        clients={clients}
        agents={agents}
        criticalDays={s.critical_days}
      />
      {mine && (
        <p className="mb-3 rounded border border-line bg-panel px-4 py-2">
          <strong>Your queue:</strong> <Link href={cases({ category: 'pending_pod', agent: user.id })}>{fmtNum(mine.pending)} pending POD</Link>
          {' · '}<Link className={mine.critical ? 'font-semibold text-age-5' : ''} href={cases({ category: 'critical', agent: user.id })}>{fmtNum(mine.critical)} critical</Link>
        </p>
      )}
      <PodTiles s={s} href={tileHref} />

      <PivotTable
        title={`Pending POD — by age${byValue ? ' (product value)' : ''}`}
        note={`Days since escalation. Over ${s.critical_days} days is critical (red columns): ${fmtNum(s.critical)} of ${fmtNum(s.pending)} pending.${valueNote}`}
        actions={measureToggle}
        rowHeader="Client"
        columns={ageCols}
        hotFrom={hotFrom >= 0 ? hotFrom : undefined}
        format={fmt}
        rows={s.by_client.filter((c) => c.pending > 0).map((c) => ({
          label: c.client,
          href: cases({ client: clientKey(c.client_id), category: 'pending_pod' }),
          cells: (byValue ? c.age_value : c.age).map((v, i) => ({ value: Number(v), href: rangeHref(s.pending_age[i], { client: clientKey(c.client_id) }) })),
        }))}
        columnHref={(i) => rangeHref(s.pending_age[i])}
        totalHref={cases({ category: 'pending_pod' })}
      />

      <PivotTable
        title={`All cases — client × status${byValue ? ' (product value)' : ''}`}
        rowHeader="Client"
        columns={statusCols}
        format={fmt}
        actions={measureToggle}
        rows={s.by_client.map((c) => ({
          label: c.client,
          href: cases({ client: clientKey(c.client_id), category: 'all' }),
          cells: (byValue
            ? [c.pending_value, c.critical_value, c.pod_shared_value, c.lost_pending_value, c.lost_value]
            : [c.pending, c.critical, c.pod_shared, c.lost_pending, c.lost]).map((v, i) => ({
            value: Number(v),
            href: statusCats[i] === 'lost_pending' ? `/lost-approval?client=${clientKey(c.client_id)}` : cases({ client: clientKey(c.client_id), category: statusCats[i] }),
          })),
        }))}
        columnHref={(i) => (statusCats[i] === 'lost_pending' ? '/lost-approval' : cases({ category: statusCats[i] }))}
        totalHref={cases({ category: 'all' })}
        notInTotal={[1]}
        note="Grand Total counts each case once; Critical is part of Pending POD, so it is not added again."
      />

      {user.role !== 'client_poc' && (
        <PivotTable
          title={`Pending POD — agent × age${byValue ? ' (product value)' : ''}`}
          note="Agent = the person assigned in the dashboard, or the agent name in the tracker."
          actions={measureToggle}
          rowHeader="Agent"
          columns={ageCols}
          hotFrom={hotFrom >= 0 ? hotFrom : undefined}
          format={fmt}
          rows={s.by_agent.map((a) => ({
            label: a.agent,
            href: cases({ ...agentHref(a), category: 'pending_pod' }),
            cells: (byValue ? a.age_value : a.age).map((v, i) => ({ value: Number(v), href: rangeHref(s.pending_age[i], agentHref(a)) })),
          }))}
          columnHref={(i) => rangeHref(s.pending_age[i])}
          totalHref={cases({ category: 'pending_pod' })}
        />
      )}
    </>
  );
}
