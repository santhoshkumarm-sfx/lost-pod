import { cleanAwb } from './awb';
import { isTargetField, type TargetField } from './fields';
import { looksLikeHub } from './hub';
import { clean, isUrl, levenshtein, normHeader } from './text';

export type AliasMap = Map<string, TargetField>;

/** A per-tab mapping choice, by column position (set on the mapping screen) or by header text (for tabs whose layout varies). */
export interface ColumnOverride {
  index?: number;
  header?: string;
  target: string;
}

export interface ColumnMapping {
  index: number;
  header: string;
  target: TargetField | null;
  via: 'override' | 'alias' | 'fuzzy' | 'content' | null;
}

export function buildAliasMap(rows: { alias: string; target_field: string }[]): AliasMap {
  const m: AliasMap = new Map();
  for (const r of rows) if (isTargetField(r.target_field)) m.set(normHeader(r.alias), r.target_field);
  return m;
}

function aliasFor(header: string, aliases: AliasMap): { target: TargetField; via: 'alias' | 'fuzzy' } | null {
  const key = normHeader(header);
  if (!key) return null;
  const exact = aliases.get(key);
  if (exact) return { target: exact, via: 'alias' };
  if (key.length < 5) return null;
  const maxDist = key.length >= 6 ? 2 : 1;
  let best: { target: TargetField; d: number } | null = null;
  for (const [alias, target] of aliases) {
    if (Math.abs(alias.length - key.length) > maxDist || alias.length < 5) continue;
    const d = levenshtein(alias, key);
    if (d <= maxDist && (!best || d < best.d)) best = { target, d };
  }
  return best ? { target: best.target, via: 'fuzzy' } : null;
}

/** The header row is the row (within the first 15) whose cells match the most known aliases. */
export function detectHeaderRow(rows: string[][], aliases: AliasMap, maxScan = 15): number {
  let bestRow = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
    let score = 0;
    for (const cell of rows[i] ?? []) {
      const hit = cell ? aliases.get(normHeader(String(cell))) : undefined;
      if (hit === 'awb') score += 3;
      else if (hit === 'ignore') score += 0.5;
      else if (hit) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
}

function sniff(values: string[]): TargetField | null {
  const vals = values.map((v) => clean(v)).filter((v): v is string => !!v).slice(0, 50);
  if (vals.length < 3) return null;
  const share = (fn: (v: string) => boolean) => vals.filter(fn).length / vals.length;
  if (share((v) => cleanAwb(v) !== null && /[A-Z]/i.test(v) && /\d{6,}/.test(v)) > 0.8) return 'awb';
  if (share(looksLikeHub) > 0.6) return 'hub';
  if (share(isUrl) > 0.6) return 'pod_link';
  return null;
}

/**
 * Map each source column to a standard field: per-tab override → exact alias → fuzzy alias
 * (typos like "Client reamrks", "AEGING") → content sniffing for blank/unknown headers (AWB, hub code, URL).
 * Only the first column mapped to AWB is used as the AWB.
 */
export function mapColumns(
  headers: string[],
  sampleRows: string[][],
  aliases: AliasMap,
  overrides: ColumnOverride[] = [],
): ColumnMapping[] {
  const width = Math.max(headers.length, ...sampleRows.map((r) => r.length), 0);
  const valid = overrides.filter((o) => isTargetField(o.target));
  const overrideByIndex = new Map(valid.filter((o) => typeof o.index === 'number').map((o) => [o.index, o.target as TargetField]));
  const overrideByHeader = new Map(valid.filter((o) => o.header).map((o) => [normHeader(o.header!), o.target as TargetField]));
  const out: ColumnMapping[] = [];
  for (let i = 0; i < width; i++) {
    const header = String(headers[i] ?? '').trim();
    const ov = overrideByIndex.get(i) ?? (header ? overrideByHeader.get(normHeader(header)) : undefined);
    if (ov) {
      out.push({ index: i, header, target: ov, via: 'override' });
      continue;
    }
    const a = header ? aliasFor(header, aliases) : null;
    if (a) {
      out.push({ index: i, header, target: a.target, via: a.via });
      continue;
    }
    const s = sniff(sampleRows.map((r) => r[i] ?? ''));
    out.push({ index: i, header, target: s, via: s ? 'content' : null });
  }
  let awbSeen = false;
  for (const m of out) {
    if (m.target !== 'awb') continue;
    if (awbSeen && m.via !== 'override') {
      m.target = null;
      m.via = null;
    }
    awbSeen = true;
  }
  return out;
}

export function mappingSignature(mapping: ColumnMapping[]): string {
  return mapping.map((m) => `${m.index}:${m.target ?? '-'}`).join('|');
}
