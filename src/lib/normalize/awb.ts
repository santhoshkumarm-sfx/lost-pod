import { isBlank } from './text';

/** Shadowfax-style AWBs seen in the trackers: SF3583535088VEO, R2466544662BDM, R10017137SFH, SF16148043612640GOP. */
export const DEFAULT_AWB_PATTERNS = ['\\b(?:SF|R)\\d{7,16}[A-Z]{1,4}\\b'];

/**
 * Clean a value from an AWB column: trims, uppercases, strips spaces.
 * Accepts any 6–30 char alphanumeric code with at least 6 digits so new client formats still import.
 */
export function cleanAwb(v: unknown): string | null {
  if (isBlank(v)) return null;
  const s = String(v).toUpperCase().replace(/\s+/g, '').replace(/^'+/, '');
  if (!/^[A-Z0-9-]{6,30}$/.test(s)) return null;
  if (s.replace(/\D/g, '').length < 6) return null;
  return s;
}

function compile(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns.length ? patterns : DEFAULT_AWB_PATTERNS) {
    try {
      out.push(new RegExp(p, 'gi'));
    } catch {
      // ignore invalid admin-entered pattern
    }
  }
  return out;
}

/** True when the whole value is an AWB by the configured patterns. */
export function looksLikeAwb(v: string, patterns: string[] = DEFAULT_AWB_PATTERNS): boolean {
  const s = v.trim().toUpperCase();
  return compile(patterns).some((re) => {
    re.lastIndex = 0;
    const m = re.exec(s);
    return !!m && m[0].length === s.length;
  });
}

/** All AWBs in free text, uppercased, in order of first appearance. */
export function findAwbs(text: string, patterns: string[] = DEFAULT_AWB_PATTERNS): string[] {
  const found: { awb: string; at: number }[] = [];
  for (const re of compile(patterns)) {
    for (const m of text.matchAll(re)) found.push({ awb: m[0].toUpperCase(), at: m.index ?? 0 });
  }
  found.sort((a, b) => a.at - b.at);
  return [...new Set(found.map((f) => f.awb))];
}
