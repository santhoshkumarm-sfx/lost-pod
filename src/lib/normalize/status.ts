import { escapeRegex, normText } from './text';

export interface StatusMappingRule {
  pattern: string;
  match_type: 'exact' | 'contains' | 'regex';
  status_code: string;
  priority: number;
}

export interface StatusDef {
  code: string;
  label: string;
  category: 'open' | 'lost_pending' | 'lost' | 'closed';
  sort_order: number;
}

export function mapStatusText(text: string, rules: StatusMappingRule[]): string | null {
  const t = normText(text);
  if (!t) return null;
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    const p = normText(r.pattern);
    if (r.match_type === 'exact' && t === p) return r.status_code;
    if (r.match_type === 'contains' && new RegExp(`(^|[^a-z0-9])${escapeRegex(p)}([^a-z0-9]|$)`).test(t)) return r.status_code;
    if (r.match_type === 'regex') {
      try {
        if (new RegExp(r.pattern, 'i').test(text)) return r.status_code;
      } catch {
        /* invalid admin regex: skip */
      }
    }
  }
  return null;
}

/** Wording that describes where the shipment is, not where the case is ("delivered", "RTO Delivered"). */
const SHIPMENT_WORDS = /\b(delivered|undelivered|rto|rts|in transit|out for delivery|ofd|picked|pickup|dispatched|shipped|manifested|rvp|returned|ndr)\b/i;

export interface StatusInputs {
  status: string[];
  clientRemark: string[];
  teamRemark: string[];
  podStatus: string[];
}

export interface ResolvedStatus {
  code: string;
  raw: string | null;          // tracker wording that decided it
  podShared: boolean;
  shipmentStatus: string | null;
  unmapped: string[];          // status-column values nobody has mapped yet (shown in Data quality)
}

/**
 * Trackers spread the case state over several columns (Status, SFX remark, POD status, Client remark).
 * Any Lost signal wins — it only ever becomes a request for Admin approval. Otherwise the most advanced
 * mapped status wins (Closed > POD Shared > At Hub > At DC > Working > Pending).
 */
export function resolveStatus(inp: StatusInputs, rules: StatusMappingRule[], statuses: StatusDef[]): ResolvedStatus {
  const byCode = new Map(statuses.map((s) => [s.code, s]));
  const hits: { code: string; text: string }[] = [];
  const unmapped: string[] = [];
  let shipmentStatus: string | null = null;

  const consider = (text: string, isStatusColumn: boolean) => {
    const code = mapStatusText(text, rules);
    if (code && byCode.has(code)) hits.push({ code, text });
    else if (isStatusColumn) {
      if (SHIPMENT_WORDS.test(text)) shipmentStatus = shipmentStatus ?? text;
      else unmapped.push(text);
    }
  };
  inp.status.forEach((t) => consider(t, true));
  inp.clientRemark.forEach((t) => consider(t, false));
  inp.teamRemark.forEach((t) => consider(t, false));
  inp.podStatus.forEach((t) => consider(t, false));

  const podShared =
    inp.podStatus.some((t) => /shared|sent|uploaded|received/i.test(t)) ||
    hits.some((h) => h.code === 'pod_shared');

  const lost = hits.find((h) => {
    const cat = byCode.get(h.code)?.category;
    return cat === 'lost' || cat === 'lost_pending';
  });
  if (lost) return { code: 'lost_pending_approval', raw: lost.text, podShared, shipmentStatus, unmapped };

  if (!hits.length) return { code: 'pending', raw: null, podShared, shipmentStatus, unmapped };
  const best = hits.reduce((a, b) => ((byCode.get(b.code)?.sort_order ?? 0) > (byCode.get(a.code)?.sort_order ?? 0) ? b : a));
  return { code: best.code, raw: best.text, podShared, shipmentStatus, unmapped };
}
