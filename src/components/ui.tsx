import Link from 'next/link';
import { AGING_HEX, agingStep, fmtNum } from '@/lib/format';

const STATUS_STYLES: Record<string, string> = {
  slate: 'bg-[#EEF0F2] text-[#3E4A59]',
  blue: 'bg-[#E6EEFA] text-[#1F4F9A]',
  indigo: 'bg-[#ECEBFA] text-[#3B3A9A]',
  violet: 'bg-[#F1EAF8] text-[#5E3A8C]',
  teal: 'bg-[#E3F2EF] text-[#1F6E66]',
  amber: 'bg-[#FCF0DC] text-[#8A5410]',
  red: 'bg-[#F8E4E0] text-[#8E2E22]',
  green: 'bg-[#E5F2E6] text-[#2F6B35]',
};

export const STATUS_COLORS = Object.keys(STATUS_STYLES);

export function StatusBadge({ label, color }: { label: string; color: string }) {
  return <span className={`chip whitespace-nowrap ${STATUS_STYLES[color] ?? STATUS_STYLES.slate}`}>{label}</span>;
}

/** Aging number in its heat colour with a seven-step bar: the one bold device used across the app. */
export function Aging({ days, final = false }: { days: number; final?: boolean }) {
  const step = agingStep(days);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={final ? 'Final aging (frozen at closure)' : 'Days since escalation'}>
      <span className="w-8 text-right font-semibold tabular-nums" style={{ color: AGING_HEX[step] }}>
        {fmtNum(days)}
      </span>
      <span className="flex gap-[2px]" aria-hidden>
        {AGING_HEX.map((c, i) => (
          <span key={c} className="h-2.5 w-1 rounded-[1px]" style={{ background: i <= step ? c : '#E3E6E0' }} />
        ))}
      </span>
      {final && <span className="text-2xs text-ink-faint">final</span>}
    </span>
  );
}

/** Open cases split by aging bucket, as one proportional ribbon. */
export function AgingRibbon({ buckets, hrefFor }: { buckets: { label: string; count: number }[]; hrefFor?: (label: string) => string }) {
  const total = buckets.reduce((n, b) => n + b.count, 0);
  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-sm bg-[#E3E6E0]">
        {total > 0 &&
          buckets.map((b, i) =>
            b.count ? (
              <Link
                key={b.label}
                href={hrefFor ? hrefFor(b.label) : '#'}
                className="flex items-center justify-center text-xs font-semibold text-white no-underline hover:brightness-110 hover:no-underline"
                style={{ width: `${(b.count / total) * 100}%`, background: AGING_HEX[Math.min(i, 6)], minWidth: 28 }}
                title={`${b.label} days: ${b.count}`}
              >
                {fmtNum(b.count)}
              </Link>
            ) : null,
          )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {buckets.map((b, i) => (
          <span key={b.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[1px]" style={{ background: AGING_HEX[Math.min(i, 6)] }} />
            {b.label} days <span className="font-semibold text-ink">{fmtNum(b.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Kpi({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: 'alert' | 'warn' }) {
  const color = tone === 'alert' ? 'text-age-5' : tone === 'warn' ? 'text-age-3' : 'text-ink';
  const inner = (
    <>
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${color}`}>{typeof value === 'number' ? fmtNum(value) : value}</div>
    </>
  );
  return href ? (
    <Link href={href} className="panel block px-4 py-3 text-inherit no-underline hover:border-ink-faint hover:no-underline">
      {inner}
    </Link>
  ) : (
    <div className="panel px-4 py-3">{inner}</div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-ink-soft">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === 'string' ? sp.ok : null;
  const error = typeof sp.error === 'string' ? sp.error : null;
  if (!ok && !error) return null;
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`mb-4 rounded border px-3 py-2 text-sm ${error ? 'border-age-5/40 bg-[#FBEDEA] text-age-6' : 'border-age-0/40 bg-[#E6F3F1] text-[#1F5F59]'}`}
    >
      {error ?? ok}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="font-medium text-ink">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-ink-soft">{children}</div>}
    </div>
  );
}

export function Pagination({ page, size, total, hrefFor }: { page: number; size: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-ink-soft">
      <span>
        {fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}
      </span>
      <span className="flex items-center gap-1">
        {page > 1 ? <Link className="btn btn-sm" href={hrefFor(page - 1)}>Previous</Link> : <span className="btn btn-sm opacity-40">Previous</span>}
        <span className="px-2">
          Page {page} of {pages}
        </span>
        {page < pages ? <Link className="btn btn-sm" href={hrefFor(page + 1)}>Next</Link> : <span className="btn btn-sm opacity-40">Next</span>}
      </span>
    </div>
  );
}

export function SortHeader({ label, col, sort, dir, hrefFor, className }: {
  label: string; col: string; sort: string; dir: 'asc' | 'desc'; hrefFor: (col: string, dir: 'asc' | 'desc') => string; className?: string;
}) {
  const active = sort === col;
  const next = active && dir === 'desc' ? 'asc' : 'desc';
  return (
    <th className={className}>
      <Link href={hrefFor(col, next)} className="text-ink-soft no-underline hover:text-ink hover:no-underline" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {label}
        <span className="ml-1 text-ink-faint">{active ? (dir === 'asc' ? '↑' : '↓') : ''}</span>
      </Link>
    </th>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Panel({ title, actions, children, className, bodyClass }: {
  title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {(title || actions) && (
        <div className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClass ?? 'panel-body'}>{children}</div>
    </section>
  );
}

export function SourceTag({ source }: { source: string }) {
  const map: Record<string, string> = { google_sheet: 'Sheet', email: 'Email', manual: 'Manual' };
  return <span className="chip border border-line bg-white text-ink-soft">{map[source] ?? source}</span>;
}
