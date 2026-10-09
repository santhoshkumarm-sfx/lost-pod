/** Spreadsheet error values and placeholders that mean "no value". */
const BLANK_VALUES = new Set([
  '#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!', '#ERROR!', '#SPILL!',
  'N/A', 'NA', 'NAN', '-', '--', 'NULL', 'NONE', 'NIL', '`', "'", '.',
]);

export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || BLANK_VALUES.has(s.toUpperCase());
}

/** Value as trimmed text, or null for blanks / spreadsheet errors. */
export function clean(v: unknown): string | null {
  if (isBlank(v)) return null;
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Header key: lower case, letters and digits only ("Seller name " -> "sellername", "POD status\"" -> "podstatus"). */
export function normHeader(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/** Free text key: lower case, single spaces. */
export function normText(s: string): string {
  return s.toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

export function firstUrl(s: string): string | null {
  const m = s.match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0] : null;
}

/** "₹1,290.00", "Rs 500", "1290" -> 1290. Returns null when not a sensible amount. */
export function parseAmount(v: unknown): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s.replace(/(rs\.?|inr|₹)/gi, '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
}

export function uniqueNonEmpty(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const k = v.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}
