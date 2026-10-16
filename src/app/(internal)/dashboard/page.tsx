import Link from 'next/link';
import { HBarChart } from '@/components/charts';
import { Aging, AgingRibbon, Flash, Kpi, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { CaseFilterForm } from '@/components/CaseFilterForm';
import { applyCaseFilters, filtersToQuery, parseCaseFilters, statsFilter as toStats, type PodStats } from '@/lib/cases/filters';
import { PodTiles } from '@/components/pod';
import { PivotTable } from '@/components/pivot';
import { reportRows } from '@/lib/reports/pivot-html';
import { requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { getAgents, getClients, getPocs } from '@/lib/lookups';
import { fmtInr, fmtNum, SOURCE_LABELS } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { CaseRow } from '@/lib/types';

export const metadata = { title: 'POD connect' };

interface StatusStats {
  by_status: { code: string; label: string; category: string; color: string; count: number }[];
  by_source: { source: string; total: number; open: number }[];
}

const STATUS_HEX: Record<string, string> = {
  slate: '#7B8594', blue: '#1F5FBF', indigo: '#4B49B5', violet: '#7A4FB0', teal: '#2C8C83', amber: '#D98A2B', red: '#A9402B', green: '#3E8A46',
};

/** A plain table with a label column and equal-width number columns, numbers right-aligned. */
function NumTable({ head, rows, labelWidth = 180, empty }: {
  head: string[];
  rows: { key: string; label: React.ReactNode; cells: { v: React.ReactNode; strong?: boolean; hot?: boolean }[] }[];
  labelWidth?: number;
  empty?: string;
}) {
  return (
    <table className="tbl w-full table-fixed">
      <colgroup>
        <col style={{ width: labelWidth }} />
        {head.slice(1).map((h) => <col key={h} />)}
      </colgroup>
      <thead>
        <tr>{head.map((h, i) => <th key={h} className={i ? 'text-right' : ''}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="truncate">{r.label}</td>
            {r.cells.map((c, i) => (
              <td key={i} className={`text-right tabular-nums ${c.strong ? 'font-semibold' : ''} ${c.hot ? 'font-semibold text-age-5' : ''}`}>{c.v}</td>
            ))}
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={head.length} className="py-6 text-center text-ink-soft">{empty ?? 'Nothing to show.'}</td></tr>
        )}
      </tbody>
    </table>
  );
}

/**
 * Super Admin detailed view. Same numbers and meanings as the summary (pending POD, critical, loss requested,
 * loss accepted, POD shared / closed), with more breakdowns: status, hubs, agents, sources and the oldest pending.
 */
async function DetailedDashboard({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const f = parseCaseFilters(sp, { category: 'all' });
  const supabase = await createClient();
  const p = toStats(f, { category: 'all' });
  const [podRes, statusRes, clients, agents, pocs, oldestRes] = await Promise.all([
    supabase.rpc('pod_stats', { p }),
    supabase.rpc('case_stats_f', { p }),
    getClients(supabase),
    getAgents(supabase),
    getPocs(supabase, f.client && f.client !== 'none' ? f.client : null),
    applyCaseFilters(
      supabase.from('v_cases').select('id, awb, client_display_name, aging_days, status_label, status_color, hub, location, final_value'),
      { ...f, category: 'pending_pod' },
    )
      .order('aging_days', { ascending: false })
      .limit(10),
  ]);
  if (podRes.error) throw new Error(podRes.error.message);
  if (statusRes.error) throw new Error(statusRes.error.message);
  const s = podRes.data as PodStats;
  const st = statusRes.data as StatusStats;
  const base = { q: f.q, client: f.client, agent: f.agent, hub: f.hub, source: f.source, from: f.from, to: f.to, poc: f.poc, reason: f.reason };
  const cases = (extra: Record<string, string | null>) => `/cases${filtersToQuery({ ...base, sort: 'aging_days', dir: 'desc' } as never, extra)}`;
  const filtered = Object.values(base).some(Boolean) || !!f.value;
  const tileHref = (k: string) =>
    k === 'pending' ? cases({ category: 'pending_pod' }) : k === 'critical' ? cases({ category: 'critical' })
      : k === 'shared' ? cases({ category: 'pod_done' }) : k === 'lost_pending' ? `/lost-approval${f.client ? `?client=${f.client}` : ''}`
        : cases({ category: 'lost' });
  const rs = (v: number | null | undefined) => fmtInr(Number(v) || 0);
  const clientKey = (id: string | null) => id ?? 'none';

  // Pending POD by age, grouped for the ribbon: 1–7 days, then the longer ranges as they are.
  const daily = s.pending_age.filter((b) => b.max !== null && b.max <= 7);
  const ribbon = [
    { label: '1–7', min: 0, max: 7 as number | null, count: daily.reduce((n, b) => n + b.count, 0) },
    ...s.pending_age.filter((b) => !daily.includes(b)).map((b) => ({ label: b.label, min: b.min, max: b.max, count: b.count })),
  ];
  const ribbonHref = (label: string) => {
    const b = ribbon.find((x) => x.label === label)!;
    return cases({ category: 'pending_pod', agemin: String(b.min), agemax: b.max === null ? null : String(b.max) });
  };
  const byClient = s.by_client
    .filter((c) => c.pending + c.lost_pending + c.lost + c.pod_shared > 0 || c.total > 0)
    .sort((a, b) => b.pending - a.pending || b.lost - a.lost || b.total - a.total);
  const oldest = (oldestRes.data ?? []) as (Pick<CaseRow, 'id' | 'awb' | 'client_display_name' | 'aging_days' | 'status_label' | 'status_color' | 'hub' | 'location'> & { final_value: number | null })[];
  const byStatus = [...st.by_status].filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  const bySource = [...st.by_source].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);

  return (
    <>
      <PageHeader title="POD connect — detailed" />
      <Flash sp={sp} />
      <DashTabs detailed />
      <CaseFilterForm
        f={f}
        hidden={{ view: 'detailed' }}
        action="/dashboard"
        clearHref="/dashboard?view=detailed"
        fields={['q', 'client', 'agent']}
        more={['hub', 'poc', 'source', 'reason', 'dates', 'value']}
        clients={clients}
        agents={agents}
        pocs={pocs}
        criticalDays={s.critical_days}
      />
      {filtered && <p className="-mt-2 mb-3 text-xs text-ink-soft">Showing numbers for the filtered cases only.</p>}

      <PodTiles s={s} href={tileHref} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="New since yesterday" value={s.new_today} href={cases({ category: 'all', from: new Date(Date.now() - 86400000 + 19800000).toISOString().slice(0, 10) })} />
        <Kpi label="Pending POD without product value" value={s.value?.pending_no_value ?? 0} tone={s.value?.pending_no_value ? 'warn' : undefined} href={cases({ category: 'pending_pod', value: 'missing' })} />
        <Kpi label="POD shared (open)" value={s.pod_shared} href={cases({ category: 'pod_done' })} />
        <Kpi label="Closed" value={s.closed} href={cases({ category: 'closed' })} />
        <Kpi label="All cases" value={s.total} href={cases({ category: 'all' })} sub={s.value ? `${rs(s.value.total)} value` : undefined} />
      </div>

      <Panel title="POD pending by age" className="mb-5">
        <AgingRibbon buckets={ribbon} hrefFor={ribbonHref} />
      </Panel>

      <Panel title="Client wise — pendency and loss" className="mb-5" bodyClass="tbl-wrap">
        <NumTable
          head={['Client', 'Pending POD', `Critical (> ${s.critical_days} d)`, 'Loss requested', 'Loss accepted', 'POD shared', 'All AWBs', 'Pending ₹', 'Loss accepted ₹']}
          empty="No cases yet. Sync a Google Sheet or add an email escalation."
          rows={byClient.map((c) => {
            const k = clientKey(c.client_id);
            return {
              key: c.client + k,
              label: <Link href={cases({ client: k, category: 'all' })}>{c.client}</Link>,
              cells: [
                { v: <Link href={cases({ client: k, category: 'pending_pod' })}>{fmtNum(c.pending)}</Link>, strong: true },
                { v: <Link href={cases({ client: k, category: 'critical' })}>{fmtNum(c.critical)}</Link>, hot: c.critical > 0 },
                { v: <Link href={`/lost-approval?client=${k}`}>{fmtNum(c.lost_pending)}</Link> },
                { v: <Link href={cases({ client: k, category: 'lost' })}>{fmtNum(c.lost)}</Link> },
                { v: fmtNum(c.pod_shared) },
                { v: fmtNum(c.total) },
                { v: rs(c.pending_value) },
                { v: rs(c.lost_value) },
              ],
            };
          })}
        />
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Top hubs — pending POD (AWBs)">
          {s.by_hub.length
            ? <HBarChart data={[...s.by_hub].sort((a, b) => b.pending - a.pending).slice(0, 15).map((h) => ({ name: h.hub, value: h.pending }))} color="#2A4066" />
            : <p className="text-ink-soft">No pending POD.</p>}
        </Panel>
        <Panel title="All cases by status">
          <HBarChart data={byStatus.map((x) => ({ name: x.label, value: x.count }))} colors={byStatus.map((x) => STATUS_HEX[x.color] ?? '#7B8594')} />
        </Panel>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[3fr_2fr]">
        <Panel title="Agents — pending POD" bodyClass="tbl-wrap">
          <NumTable
            head={['Agent', 'Pending POD', 'Critical', 'Oldest (days)', 'Pending ₹']}
            labelWidth={160}
            rows={s.by_agent.map((a) => {
              const q: Record<string, string> = a.agent_id ? { agent: a.agent_id } : a.agent === 'Unassigned' ? { agent: 'unassigned' } : { q: a.agent };
              return {
                key: (a.agent_id ?? '') + a.agent,
                label: a.agent,
                cells: [
                  { v: <Link href={cases({ ...q, category: 'pending_pod' })}>{fmtNum(a.pending)}</Link>, strong: true },
                  { v: <Link href={cases({ ...q, category: 'critical' })}>{fmtNum(a.critical)}</Link>, hot: a.critical > 0 },
                  { v: a.oldest ?? '—' },
                  { v: rs(a.pending_value) },
                ],
              };
            })}
          />
        </Panel>
        <Panel title="Sources" bodyClass="tbl-wrap">
          <NumTable
            head={['Source', 'Open', 'All AWBs']}
            labelWidth={160}
            rows={bySource.map((x) => ({
              key: x.source,
              label: <Link href={cases({ source: x.source, category: 'all' })}>{SOURCE_LABELS[x.source] ?? x.source}</Link>,
              cells: [{ v: fmtNum(x.open) }, { v: fmtNum(x.total) }],
            }))}
          />
        </Panel>
      </div>

      <Panel title="Oldest pending POD" actions={<Link href={cases({ category: 'pending_pod' })} className="btn btn-sm">See all</Link>} bodyClass="tbl-wrap">
        <table className="tbl w-full table-fixed">
          <colgroup>
            <col style={{ width: 200 }} /><col /><col style={{ width: 110 }} /><col /><col /><col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr>
              <th>AWB</th>
              <th>Client</th>
              <th>Aging</th>
              <th>Status</th>
              <th>Hub / location</th>
              <th className="text-right">Product value</th>
            </tr>
          </thead>
          <tbody>
            {oldest.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/cases/${c.id}`} className="awb">{c.awb}</Link></td>
                <td className="truncate">{c.client_display_name ?? '—'}</td>
                <td><Aging days={c.aging_days} /></td>
                <td><StatusBadge label={c.status_label} color={c.status_color} /></td>
                <td className="truncate">{c.hub ?? c.location ?? '—'}</td>
                <td className="text-right tabular-nums">{c.final_value == null ? '—' : rs(c.final_value)}</td>
              </tr>
            ))}
            {!oldest.length && <tr><td colSpan={6} className="py-6 text-center text-ink-soft">No pending POD.</td></tr>}
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
  const internal = user.role === 'internal_team';
  // Internal team: only their aligned clients (set by an Admin on Users), or their own cases when none are aligned.
  const aligned = internal
    ? ((await supabase.from('agent_clients').select('client_id').eq('user_id', user.id)).data ?? []).map((r) => r.client_id as string)
    : [];
  const scope: Record<string, unknown> = !internal ? {} : aligned.length ? { clients: aligned } : { agent: user.id };
  const p = { ...toStats(f, { category: 'all' }), ...scope };
  const [statsRes, mineRes, allClients, agents] = await Promise.all([
    supabase.rpc('pod_stats', { p }),
    internal ? supabase.rpc('pod_stats', { p: { ...p, agent: user.id } }) : Promise.resolve({ data: null }),
    getClients(supabase),
    getAgents(supabase),
  ]);
  const clients = internal && aligned.length ? allClients.filter((c) => aligned.includes(c.id)) : allClients;
  const scopeNote = !internal ? '' : aligned.length
    ? `Your clients: ${clients.map((c) => c.name).join(', ')}`
    : 'Cases assigned to you';
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
  const ageCols = s.pending_age.map((b) => ({ label: /^\d+$/.test(b.label) ? `${b.label} d` : b.label }));
  const fmtRs = (v: number) => fmtNum(Math.round(v));
  const hotFrom = s.pending_age.findIndex((b) => b.min > s.critical_days);
  const hot = hotFrom >= 0 ? hotFrom : undefined;
  const clientKey = (id: string | null) => id ?? 'none';
  const agentQ = (a: { agent_id: string | null; agent: string }): Record<string, string> =>
    a.agent_id ? { agent: a.agent_id } : a.agent === 'Unassigned' ? { agent: 'unassigned' } : { q: a.agent };
  const r = reportRows(s);
  const both = ['count', 'value'] as const;   // AWBs first, then ₹ value

  return (
    <>
      <PageHeader
        title="POD connect"
        sub={scopeNote || undefined}
        actions={
          <div className="flex gap-2">
            <a href={`/api/export/dashboard${filtersToQuery(f)}`} className="btn">Download Excel</a>
            <Link href={cases({ category: 'critical' })} className="btn btn-danger">Critical list ({fmtNum(s.critical)})</Link>
          </div>
        }
      />
      <Flash sp={sp} />
      {isSuper && <DashTabs detailed={false} />}
      <CaseFilterForm
        f={f}
        action="/dashboard"
        clearHref="/dashboard"
        fields={['q', 'client', 'agent']}
        more={['hub', 'poc', 'source', 'dates', 'value']}
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

      {both.map((m, k) => (
        <PivotTable
          key={`client-${m}`}
          title={`${k + 1}. POD pending — client wise`}
          rowHeader="Client"
          columns={ageCols}
          hotFrom={hot}
          format={m === 'value' ? fmtRs : fmtNum}
          variant={m}
          keepOrder
          columnHref={(i) => rangeHref(s.pending_age[i])}
          totalHref={cases({ category: 'pending_pod' })}
          rows={(m === 'value' ? r.clientsV : r.clientsA).map((c) => ({
            label: c.client,
            href: cases({ client: clientKey(c.client_id), category: 'pending_pod' }),
            cells: (m === 'value' ? c.age_value : c.age).map((v, i) => ({ value: Number(v), href: rangeHref(s.pending_age[i], { client: clientKey(c.client_id) }) })),
          }))}
        />
      ))}

      {both.map((m, k) => (
        <PivotTable
          key={`lostc-${m}`}
          title={`${k + 3}. POD accepted lost — client wise`}
          rowHeader="Client"
          columns={[{ label: m === 'value' ? 'Loss accepted (₹)' : 'Loss accepted (AWBs)' }]}
          format={m === 'value' ? fmtRs : fmtNum}
          variant={m}
          noTotalCol
          rows={(m === 'value' ? r.lostClientsV : r.lostClientsA).map((c) => ({
            label: c.client,
            href: cases({ client: clientKey(c.client_id), category: 'lost' }),
            cells: [{ value: m === 'value' ? Number(c.lost_value) : c.lost, href: cases({ client: clientKey(c.client_id), category: 'lost' }) }],
          }))}
        />
      ))}

      {both.map((m, k) => (
        <PivotTable
          key={`hub-${m}`}
          title={`${k + 5}. Top 15 hubs — POD pending`}
          rowHeader="Hub"
          columns={ageCols}
          hotFrom={hot}
          format={m === 'value' ? fmtRs : fmtNum}
          variant={m}
          keepOrder
          rows={(m === 'value' ? r.hubsV : r.hubsA).map((h) => ({
            label: h.hub,
            href: cases({ hub: h.hub, category: 'pending_pod' }),
            cells: (m === 'value' ? h.age_value : h.age).map((v, i) => ({ value: Number(v), href: rangeHref(s.pending_age[i], { hub: h.hub }) })),
          }))}
        />
      ))}

      {both.map((m, k) => (
        <PivotTable
          key={`agent-${m}`}
          title={`${k + 7}. POD pending — agent wise`}
          rowHeader="Agent"
          columns={ageCols}
          hotFrom={hot}
          format={m === 'value' ? fmtRs : fmtNum}
          variant={m}
          keepOrder
          rows={(m === 'value' ? r.agentsV : r.agentsA).map((a) => ({
            label: a.agent,
            href: cases({ ...agentQ(a), category: 'pending_pod' }),
            cells: (m === 'value' ? a.age_value : a.age).map((v, i) => ({ value: Number(v), href: rangeHref(s.pending_age[i], agentQ(a)) })),
          }))}
          columnHref={(i) => rangeHref(s.pending_age[i])}
          totalHref={cases({ category: 'pending_pod' })}
        />
      ))}

      {both.map((m, k) => (
        <PivotTable
          key={`losta-${m}`}
          title={`${k + 9}. POD accepted lost — agent wise`}
          rowHeader="Agent"
          columns={[{ label: m === 'value' ? 'Loss accepted (₹)' : 'Loss accepted (AWBs)' }]}
          format={m === 'value' ? fmtRs : fmtNum}
          variant={m}
          noTotalCol
          rows={(m === 'value' ? r.lostAgentsV : r.lostAgentsA).map((a) => ({
            label: a.agent,
            href: cases({ ...agentQ(a), category: 'lost' }),
            cells: [{ value: m === 'value' ? Number(a.lost_value) : a.lost, href: cases({ ...agentQ(a), category: 'lost' }) }],
          }))}
        />
      ))}
    </>
  );
}
