import { cleanAwb } from '../normalize/awb';

export interface CaseFilters {
  q: string;
  client: string;
  status: string;
  category: string;   // open | active | pending_pod | critical | lost_pending | lost | closed | all
  agemin: string;     // aging days from
  agemax: string;     // aging days to
  aging: string;      // aging bucket label
  hub: string;
  agent: string;      // profile id | 'unassigned'
  poc: string;
  source: string;
  from: string;
  to: string;
  sla: string;        // '1' = TAT breached only
  reason: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  size: number;
}

export const SORTABLE = ['case_number', 'awb', 'client_display_name', 'escalation_date', 'aging_days', 'status_label', 'hub', 'updated_at', 'product_value', 'lost_approved_at'] as const;

export function parseCaseFilters(sp: Record<string, string | string[] | undefined>, defaults: Partial<CaseFilters> = {}): CaseFilters {
  const g = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? '').trim();
  };
  const sort = g('sort');
  const size = Number(g('size')) || defaults.size || 50;
  return {
    q: g('q'), client: g('client'), status: g('status'), category: g('category') || defaults.category || 'active',
    aging: g('aging'), hub: g('hub'), agent: g('agent'), poc: g('poc'), source: g('source'), from: g('from'), to: g('to'),
    sla: g('sla'), reason: g('reason'), agemin: /^\d+$/.test(g('agemin')) ? g('agemin') : '', agemax: /^\d+$/.test(g('agemax')) ? g('agemax') : '',
    sort: (SORTABLE as readonly string[]).includes(sort) ? sort : defaults.sort || 'aging_days',
    dir: g('dir') === 'asc' ? 'asc' : g('dir') === 'desc' ? 'desc' : defaults.dir || 'desc',
    page: Math.max(1, Number(g('page')) || 1),
    size: Math.min(200, Math.max(10, size)),
  };
}

const safe = (s: string) => s.replace(/["\\(),]/g, ' ').trim();

/** AWBs pasted as a list ("R1…, SF2…" or one per line) → exact match on all of them. */
export function awbList(q: string): string[] | null {
  const tokens = q.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const awbs = tokens.map((t) => cleanAwb(t));
  return awbs.every((a): a is string => !!a && /[A-Z]/.test(a)) ? [...new Set(awbs)] : null;
}

/** Apply filters to a query on v_cases. RLS still decides which rows the user may see. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCaseFilters(q: any, f: CaseFilters, opts: { dateField?: 'escalation_date' | 'lost_approved_at'; criticalDays?: number } = {}): any {
  const dateField = opts.dateField ?? 'escalation_date';
  if (f.q) {
    const list = awbList(f.q);
    if (list) q = q.in('awb', list);
    else {
      const t = safe(f.q);
      const awb = cleanAwb(t);
      const cols = ['awb', 'client_display_name', 'email_subject', 'location', 'hub', 'poc_name', 'agent_display_name', 'seller_name', 'order_id'];
      q = q.or(cols.map((c) => `${c}.ilike."%${c === 'awb' && awb ? awb : t}%"`).join(','));
    }
  }
  if (f.client) q = f.client === 'none' ? q.is('client_id', null) : q.eq('client_id', f.client);
  if (f.status) q = q.eq('team_status', f.status);
  if (f.category && f.category !== 'all') {
    if (f.category === 'active') q = q.in('status_category', ['open', 'lost_pending']);
    else if (f.category === 'pending_pod' || f.category === 'critical') {
      q = q.eq('status_category', 'open').neq('team_status', 'pod_shared').neq('pod_status', 'shared');
      if (f.category === 'critical') q = q.gt('aging_days', opts.criticalDays ?? 7);
    } else if (f.category === 'pod_done') {
      q = q.or('status_category.eq.closed,and(status_category.eq.open,or(team_status.eq.pod_shared,pod_status.eq.shared))');
    } else q = q.eq('status_category', f.category);
  }
  if (f.aging) q = q.eq('aging_bucket', f.aging);
  if (f.agemin) q = q.gte('aging_days', Number(f.agemin));
  if (f.agemax) q = q.lte('aging_days', Number(f.agemax));
  if (f.hub) q = q.or(`hub.ilike."%${safe(f.hub)}%",location.ilike."%${safe(f.hub)}%"`);
  if (f.agent) q = f.agent === 'unassigned' ? q.is('assigned_agent', null) : q.eq('assigned_agent', f.agent);
  if (f.poc) q = q.eq('client_poc_id', f.poc);
  if (f.source) q = q.eq('source_type', f.source);
  if (f.reason) q = q.ilike('reason', `%${safe(f.reason)}%`);
  if (f.sla === '1') q = q.eq('sla_breached', true);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte(dateField, dateField === 'lost_approved_at' ? `${f.from}T00:00:00+05:30` : f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte(dateField, dateField === 'lost_approved_at' ? `${f.to}T23:59:59+05:30` : f.to);
  return q;
}

export function filtersToQuery(f: Partial<CaseFilters>, overrides: Record<string, string | number | null> = {}): string {
  const sp = new URLSearchParams();
  const all: Record<string, unknown> = { ...f, ...overrides };
  for (const [k, v] of Object.entries(all)) {
    if (v === null || v === undefined || v === '') continue;
    if (k === 'page' && Number(v) === 1) continue;
    if (k === 'size' && Number(v) === 50) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Pending POD older than this is critical (Settings → critical_aging_days). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCriticalDays(sb: any): Promise<number> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'critical_aging_days').maybeSingle();
  const n = Number(data?.value);
  return Number.isInteger(n) && n > 0 ? n : 7;
}

/** The filter object the database functions (pod_stats, case_stats_f) take. */
export function statsFilter(f: CaseFilters, extra: Record<string, string> = {}): Record<string, string> {
  return {
    q: f.q, client: f.client, status: f.status, category: f.category, aging: f.aging, hub: f.hub, agent: f.agent, poc: f.poc,
    source: f.source, from: f.from, to: f.to, sla: f.sla, reason: f.reason, agemin: f.agemin, agemax: f.agemax, ...extra,
  };
}

export interface PodStats {
  critical_days: number; total: number; pending: number; critical: number; pod_shared: number; closed: number;
  lost_pending: number; lost: number; new_today: number;
  pending_age: { label: string; min: number; max: number | null; count: number }[];
  by_client: { client_id: string | null; client: string; pending: number; critical: number; pod_shared: number; lost_pending: number; lost: number; oldest: number | null }[];
  by_agent: { agent_id: string | null; agent: string; pending: number; critical: number; oldest: number | null }[];
}
