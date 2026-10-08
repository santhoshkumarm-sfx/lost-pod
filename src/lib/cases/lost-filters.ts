import { awbList } from './filters';
import { cleanAwb } from '../normalize/awb';

/** Filters for the Lost approval queue (v_lost_requests). */
export interface LostFilters {
  q: string;       // AWB list or text
  client: string;  // client id | 'none'
  via: string;     // app | poc_portal | google_sheet | email
  hub: string;
  aging: string;   // aging bucket label
  from: string;    // requested on/after (YYYY-MM-DD, IST)
  to: string;
  mine: string;    // '1' = only requests I can decide
  state: string;   // requests view: open (default) | decided | all
  view: string;    // '' = requests, 'awb' = one row per AWB
  page: number;
  size: number;
}

const KEYS = ['q', 'client', 'via', 'hub', 'aging', 'from', 'to', 'mine', 'state', 'view'] as const;

export function parseLostFilters(sp: Record<string, string | string[] | undefined>): LostFilters {
  const g = (k: string) => ((Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? '').trim();
  return {
    q: g('q'), client: g('client'), via: g('via'), hub: g('hub'), aging: g('aging'), from: g('from'), to: g('to'), mine: g('mine'),
    state: ['decided', 'all', 'open'].includes(g('state')) ? g('state') : '', view: g('view') === 'awb' ? 'awb' : '',
    page: Math.max(1, Number(g('page')) || 1),
    size: Math.min(500, Math.max(25, Number(g('size')) || 100)),
  };
}

/** The same filters, carried as hidden fields or form data. */
export function lostFiltersFromForm(fd: FormData): LostFilters {
  const o: Record<string, string> = {};
  for (const k of KEYS) o[k] = String(fd.get(`f_${k}`) ?? '');
  return parseLostFilters(o);
}

export function lostFilterEntries(f: LostFilters): [string, string][] {
  return KEYS.map((k) => [k, f[k]] as [string, string]).filter(([, v]) => v);
}

export function lostQuery(f: LostFilters, overrides: Record<string, string | number | null> = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of lostFilterEntries(f)) sp.set(k, v);
  if (f.page > 1) sp.set('page', String(f.page));
  if (f.size !== 100) sp.set('size', String(f.size));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === '' || (k === 'page' && Number(v) === 1)) sp.delete(k);
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const safe = (s: string) => s.replace(/["\\(),]/g, ' ').trim();

/** Apply to a query on v_lost_requests (pending rows). RLS still limits what the user sees. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLostFilters(q: any, f: LostFilters): any {
  const num = requestNumber(f.q);
  if (num) q = q.eq('request_number', num);
  else if (f.q) {
    const list = awbList(f.q);
    if (list) q = q.in('awb', list);
    else {
      const t = safe(f.q);
      const awb = cleanAwb(t) ?? t;
      q = q.or([`awb.ilike."%${awb}%"`, `client_display_name.ilike."%${t}%"`, `request_reason.ilike."%${t}%"`, `requested_by_name.ilike."%${t}%"`, `hub.ilike."%${t}%"`, `location.ilike."%${t}%"`].join(','));
    }
  }
  if (f.client) q = f.client === 'none' ? q.is('client_id', null) : q.eq('client_id', f.client);
  if (f.via) q = q.eq('requested_via', f.via);
  if (f.hub) q = q.or(`hub.ilike."%${safe(f.hub)}%",location.ilike."%${safe(f.hub)}%"`);
  if (f.aging) q = q.eq('aging_bucket', f.aging);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte('requested_at', `${f.from}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte('requested_at', `${f.to}T23:59:59+05:30`);
  if (f.mine === '1') q = q.eq('can_decide', true);
  return q;
}

export const VIA_LABELS: Record<string, string> = {
  app: 'Shadowfax team',
  poc_portal: 'Client portal',
  google_sheet: 'Google Sheet',
  email: 'Email',
};

/** "LR-12", "lr12" or "12" → 12. */
export function requestNumber(q: string): number | null {
  const m = q.trim().match(/^(?:LR-?)?(\d{1,7})$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Filters for the request-wise list (v_lost_request_summary). AWB searches are resolved to request ids first
 * (pass them as awbRequestIds); hub / aging apply to the AWB view only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRequestFilters(q: any, f: LostFilters, awbRequestIds: string[] | null): any {
  const num = requestNumber(f.q);
  if (num) q = q.eq('request_number', num);
  else if (awbRequestIds) q = q.in('id', awbRequestIds.length ? awbRequestIds : ['00000000-0000-0000-0000-000000000000']);
  else if (f.q) {
    const t = safe(f.q);
    q = q.or([`client_name.ilike."%${t}%"`, `reason.ilike."%${t}%"`, `requested_by_name.ilike."%${t}%"`, `hubs.ilike."%${t}%"`].join(','));
  }
  if (f.client) q = f.client === 'none' ? q.is('client_id', null) : q.eq('client_id', f.client);
  if (f.via) q = q.eq('requested_via', f.via);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte('created_at', `${f.from}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte('created_at', `${f.to}T23:59:59+05:30`);
  if (f.mine === '1') q = q.eq('can_decide', true);
  if (f.state === 'decided') q = q.eq('pending', 0);
  else if (f.state !== 'all') q = q.gt('pending', 0);
  return q;
}

export const REQUEST_STATUS: Record<string, { label: string; client: string; color: string }> = {
  pending: { label: 'Waiting for a decision', client: 'Under review', color: 'amber' },
  partly_decided: { label: 'Partly decided', client: 'Partly decided — rest under review', color: 'blue' },
  accepted: { label: 'Loss accepted', client: 'Loss accepted', color: 'red' },
  partly_accepted: { label: 'Partly accepted', client: 'Loss partly accepted', color: 'violet' },
  rejected: { label: 'Rejected', client: 'Not accepted', color: 'slate' },
  sent_back: { label: 'Sent back / closed', client: 'Being investigated', color: 'teal' },
};
