const TZ = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
});
const numFmt = new Intl.NumberFormat('en-IN');
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** "2026-08-01" → "01 Aug 2026" (calendar dates are stored without a timezone). */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? v : dateFmt.format(d);
}

/** Timestamps are shown in IST. */
export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : dateTimeFmt.format(d);
}

export function fmtNum(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? numFmt.format(n) : String(v);
}

export function fmtInr(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? inrFmt.format(n) : String(v);
}

/** Aging heat step 0..6, aligned with the default buckets (0–2, 3–7, 8–15, 16–30, 31–60, 61–90, 90+). */
export function agingStep(days: number | null | undefined): number {
  const d = Number(days ?? 0);
  if (d <= 2) return 0;
  if (d <= 7) return 1;
  if (d <= 15) return 2;
  if (d <= 30) return 3;
  if (d <= 60) return 4;
  if (d <= 90) return 5;
  return 6;
}

export const AGING_HEX = ['#2C8C83', '#5FA37B', '#B9A443', '#D98A2B', '#C8612A', '#A9402B', '#7E2A26'];

export const SOURCE_LABELS: Record<string, string> = { google_sheet: 'Google Sheet', email: 'Email', manual: 'Manual' };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

/** What a client sees: the Lost workflow in their words. */
export function clientStatusLabel(category: string | null | undefined, label: string): string {
  if (category === 'lost') return 'Loss accepted';
  if (category === 'lost_pending') return 'Loss requested — under review';
  return label;
}
