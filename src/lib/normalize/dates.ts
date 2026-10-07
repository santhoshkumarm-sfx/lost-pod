import { clean } from './text';

export type DateOrder = 'DMY' | 'MDY';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export interface ParsedDate {
  iso: string;            // YYYY-MM-DD
  yearInferred: boolean;  // "17 Jul" -> year chosen relative to today
  swappable: boolean;     // numeric day and month both <= 12 (could be read the other way)
  swappedIso?: string;    // the other reading, when swappable
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function valid(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isoToDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function dayDiff(aIso: string, bIso: string): number {
  return isoToDay(aIso) - isoToDay(bIso);
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/** Year for a date written without one: the most recent occurrence, allowing up to 7 days in the future. */
function inferYear(m: number, d: number, todayIso: string): number {
  const ty = Number(todayIso.slice(0, 4));
  return dayDiff(toIso(ty, m, d), todayIso) > 7 ? ty - 1 : ty;
}

function result(y: number, m: number, d: number, yearInferred: boolean, numeric: boolean): ParsedDate | null {
  if (!valid(y, m, d)) return null;
  const out: ParsedDate = { iso: toIso(y, m, d), yearInferred, swappable: false };
  if (numeric && m !== d && m <= 12 && d <= 12 && valid(y, d, m)) {
    out.swappable = true;
    out.swappedIso = toIso(y, d, m);
  }
  return out;
}

/**
 * Parse the date formats found in the trackers:
 * 17 Jul · 3-Jul · 06 March 2026 · 02-Jan-26 · 1-Apr-2026 · 29-July-2026 · 1 June 26 · 16th July 2026 ·
 * 7/1/2026 (with order) · 20-06-2026 17:11 · 2026-03-31 · Sep 12, 2026 · Google Sheets serial numbers.
 */
export function parseDate(raw: unknown, order: DateOrder, todayIso: string): ParsedDate | null {
  if (typeof raw === 'number') return fromSerial(raw);
  const s0 = clean(raw);
  if (!s0) return null;
  const s = s0.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  if (/^\d{5}(\.\d+)?$/.test(s)) return fromSerial(Number(s));

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return result(+m[1], +m[2], +m[3], false, true);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3]);
    let d: number, mo: number;
    if (a > 12 && b <= 12) [d, mo] = [a, b];
    else if (b > 12 && a <= 12) [mo, d] = [a, b];
    else if (order === 'MDY') [mo, d] = [a, b];
    else [d, mo] = [a, b];
    return result(y, mo, d, false, true);
  }

  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([A-Za-z]{3,9})\.?(?:[\s\-/.]+(\d{2,4}))?\b/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const mo = MONTHS[m[2].toLowerCase()], d = +m[1];
    if (m[3]) return result(fullYear(+m[3]), mo, d, false, false);
    return result(inferYear(mo, d, todayIso), mo, d, true, false);
  }

  m = s.match(/^([A-Za-z]{3,9})\.?[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s\-/.]+(\d{4}))?\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
    if (m[3]) return result(+m[3], mo, d, false, false);
    return result(inferYear(mo, d, todayIso), mo, d, true, false);
  }

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m) {
    const [d, mo] = order === 'MDY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return result(inferYear(mo, d, todayIso), mo, d, true, true);
  }
  return null;
}

function fromSerial(n: number): ParsedDate | null {
  if (!Number.isFinite(n) || n < 30000 || n > 80000) return null;
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return result(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), false, false);
}

/** Look for a date inside text such as a mail subject: 'Request for POD "SFX-16th July 2026"', 'POD needed - 11-09-26'. */
export function findDateInText(text: string, order: DateOrder, todayIso: string): string | null {
  const patterns = [
    /\b\d{1,2}(?:st|nd|rd|th)?[\s\-/.]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\s\-/.]+\d{2,4}\b/i,
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const p = parseDate(m[0], order, todayIso);
      if (p && dayDiff(p.iso, todayIso) <= 1) return p.iso;
    }
  }
  return null;
}

/**
 * Decide DMY vs MDY for a whole column. Unambiguous values (a part > 12) vote; ties fall back to null.
 * Kartrocket's "7/13/2026" style dates make the column MDY while every other tracker is DMY.
 */
export function detectColumnOrder(values: unknown[]): DateOrder | null {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const s = clean(v);
    if (!s) continue;
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (!dmy && !mdy) return null;
  return dmy >= mdy ? 'DMY' : 'MDY';
}

/**
 * When the escalation column alone is ambiguous (e.g. only 7/1 … 7/12), pick the order under which
 * escalations come on/after delivery for most rows.
 */
export function voteOrderAgainst(escValues: unknown[], deliveryIsos: (string | null)[], todayIso: string): DateOrder | null {
  let dmy = 0, mdy = 0;
  escValues.forEach((v, i) => {
    const del = deliveryIsos[i];
    if (!del) return;
    const a = parseDate(v, 'DMY', todayIso);
    const b = parseDate(v, 'MDY', todayIso);
    if (!a || !b || a.iso === b.iso) return;
    const okA = dayDiff(a.iso, del) >= -3 && dayDiff(a.iso, todayIso) <= 1;
    const okB = dayDiff(b.iso, del) >= -3 && dayDiff(b.iso, todayIso) <= 1;
    if (okA && !okB) dmy++;
    if (okB && !okA) mdy++;
  });
  if (!dmy && !mdy) return null;
  return dmy >= mdy ? 'DMY' : 'MDY';
}

/**
 * Delivery happens before (or around) escalation and not in the future. When a numeric delivery date
 * breaks that but its day/month swap fits, use the swap — fixes "2026-01-07" meaning 1 July.
 */
export function plausibleDelivery(p: ParsedDate, escIso: string | null, todayIso: string): { iso: string; corrected: boolean } {
  const fits = (iso: string) =>
    dayDiff(iso, todayIso) <= 1 && (!escIso || (dayDiff(iso, escIso) <= 3 && dayDiff(escIso, iso) <= 180));
  if (!p.swappable || !p.swappedIso) return { iso: p.iso, corrected: false };
  const fitsAsIs = fits(p.iso);
  const fitsSwapped = fits(p.swappedIso);
  if (!fitsAsIs && fitsSwapped) return { iso: p.swappedIso, corrected: true };
  // Both readings are possible: POD escalations come within weeks of delivery, so prefer the
  // reading that is close to the escalation when the literal one is months away.
  if (fitsAsIs && fitsSwapped && escIso) {
    const gap = Math.abs(dayDiff(escIso, p.iso));
    const swappedGap = Math.abs(dayDiff(escIso, p.swappedIso));
    if (gap > 60 && swappedGap <= 60) return { iso: p.swappedIso, corrected: true };
  }
  return { iso: p.iso, corrected: false };
}
