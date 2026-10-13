import Link from 'next/link';
import { fmtNum } from '@/lib/format';

export interface PivotColumn { label: string }
export interface PivotRow { label: string; href?: string; cells: { value: number; href?: string }[] }

/**
 * Excel-style pivot table: row labels down the side, columns across, Grand Total row and column.
 * Zeros are left blank, like a pivot table; every number links to the matching list of cases.
 */
export function PivotTable({ title, rowHeader, columns, rows, totalHref, columnHref, note, notInTotal = [], format = fmtNum, hotFrom, noTotalCol, formats, keepOrder, noTotalRow, variant = 'count' }: {
  title: string;
  rowHeader: string;
  columns: PivotColumn[];
  rows: PivotRow[];
  totalHref?: string;
  columnHref?: (i: number) => string | undefined;
  note?: string;
  /** Column indexes that are a subset of another column and must not be added into the Grand Total. */
  notInTotal?: number[];
  /** How numbers are shown (counts by default; e.g. ₹ for product value). */
  format?: (v: number) => string;
  /** Columns from this index on get the "critical" header colour. */
  hotFrom?: number;
  /** "value" tables (₹) get their own header colour so they are not mixed up with AWB tables. */
  variant?: 'count' | 'value' | 'mixed';
  /** Leave out the Grand Total column (when the columns are different things). */
  noTotalCol?: boolean;
  /** Per-column number formats (overrides `format`). */
  formats?: ((v: number) => string)[];
  /** Keep the given row order (default: largest Grand Total first). */
  keepOrder?: boolean;
  /** Leave out the Grand Total row (when the rows are different things). */
  noTotalRow?: boolean;
}) {
  const sum = (vals: number[]) => vals.reduce((t, v, i) => t + (notInTotal.includes(i) ? 0 : v), 0);
  // Largest to smallest, like a sorted pivot table.
  if (!keepOrder && !noTotalCol) rows = [...rows].sort((a, b) => sum(b.cells.map((c) => c.value)) - sum(a.cells.map((c) => c.value)));
  const colTotals = columns.map((_, i) => rows.reduce((t, r) => t + (r.cells[i]?.value ?? 0), 0));
  const grand = sum(colTotals);
  const cell = (v: number, href?: string, bold?: boolean, i?: number) => {
    const f = (i !== undefined && formats?.[i]) || format;
    return v ? (href ? <Link href={href} className={`text-inherit no-underline hover:underline ${bold ? 'font-semibold' : ''}`}>{f(v)}</Link> : f(v)) : '';
  };
  const value = variant === 'value';
  const headBg = value ? 'bg-[#1D4250]' : 'bg-[#14223A]';
  const size = columns.length > 10 ? 'text-[13px]' : 'text-sm';
  const th = `border border-white/15 ${headBg} px-1 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white`;
  const td = `border border-[#E3E6E0] px-1 py-2 text-center tabular-nums text-ink ${size}`;
  const foot = `border border-[#C9D3E1] border-t-2 ${value ? 'border-t-[#1D4250] bg-[#E3EEF0]' : 'border-t-[#14223A] bg-[#E6ECF5]'} px-1 py-2 font-bold tabular-nums ${size}`;
  return (
    <section className="panel mb-5 overflow-hidden">
      <div className={`border-b border-l-4 border-b-line px-4 py-3 ${value ? 'border-l-[#1D4250]' : 'border-l-[#14223A]'}`}>
        <h2 className="text-[15px] font-semibold text-ink">
          {title}
          {variant !== 'mixed' && <span className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide ${value ? 'bg-[#E3EEF0] text-[#1D4250]' : 'bg-[#E6ECF5] text-[#14223A]'}`}>{value ? '₹ value' : 'AWBs'}</span>}
        </h2>
        {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
      </div>
      <div className="overflow-x-auto p-3">
        <table className="w-full table-fixed border-collapse bg-white">
          <colgroup>
            <col className="w-[180px]" />
            {/* every number column, Grand Total included, gets the same width */}
            {columns.map((c) => <col key={c.label} />)}
            {!noTotalCol && <col />}
          </colgroup>
          <thead>
            <tr>
              <th className={`${th} px-3 text-left`}>{rowHeader}</th>
              {columns.map((c, i) => <th key={c.label} className={`${th} text-center ${hotFrom !== undefined && i >= hotFrom ? '!bg-[#8B2E2A]' : ''}`}>{c.label}</th>)}
              {!noTotalCol && <th className={`${th} ${value ? '!bg-[#2C5A69]' : '!bg-[#2A4066]'} text-center`}>Total</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const total = sum(r.cells.map((c) => c.value));
              return (
                <tr key={r.label} className={`${idx % 2 ? 'bg-[#F7F8F6]' : 'bg-white'} hover:bg-[#EEF3FB]`}>
                  <td className="truncate border border-[#DCDFD8] px-3 py-2 text-left text-[15px] font-medium" title={r.label}>
                    {r.href ? <Link href={r.href} className="text-ink no-underline hover:underline">{r.label}</Link> : r.label}
                  </td>
                  {r.cells.map((c, i) => <td key={i} className={td}>{cell(c.value, c.href, false, i)}</td>)}
                  {!noTotalCol && <td className={`${td} bg-[#F1F4F9] font-semibold`}>{cell(total, r.href, true)}</td>}
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={columns.length + (noTotalCol ? 1 : 2)} className="border border-[#DCDFD8] px-3 py-4 text-center text-ink-soft">No data for these filters.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && !noTotalRow && (
            <tfoot>
              <tr>
                <td className={`${foot} px-3 text-left`}>Grand Total</td>
                {colTotals.map((v, i) => <td key={i} className={`${foot} text-center`}>{cell(v, columnHref?.(i), true, i)}</td>)}
                {!noTotalCol && <td className={`${foot} bg-[#D5DFEE] text-center`}>{cell(grand, totalHref, true)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
