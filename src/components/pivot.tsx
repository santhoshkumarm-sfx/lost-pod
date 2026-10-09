import Link from 'next/link';
import { fmtNum } from '@/lib/format';

export interface PivotColumn { label: string }
export interface PivotRow { label: string; href?: string; cells: { value: number; href?: string }[] }

/**
 * Excel-style pivot table: row labels down the side, columns across, Grand Total row and column.
 * Zeros are left blank, like a pivot table; every number links to the matching list of cases.
 */
export function PivotTable({ title, rowHeader, columns, rows, totalHref, columnHref, note, notInTotal = [] }: {
  title: string;
  rowHeader: string;
  columns: PivotColumn[];
  rows: PivotRow[];
  totalHref?: string;
  columnHref?: (i: number) => string | undefined;
  note?: string;
  /** Column indexes that are a subset of another column and must not be added into the Grand Total. */
  notInTotal?: number[];
}) {
  const colTotals = columns.map((_, i) => rows.reduce((t, r) => t + (r.cells[i]?.value ?? 0), 0));
  const sum = (vals: number[]) => vals.reduce((t, v, i) => t + (notInTotal.includes(i) ? 0 : v), 0);
  const grand = sum(colTotals);
  const cell = (v: number, href?: string, bold?: boolean) =>
    v ? (href ? <Link href={href} className={`text-ink no-underline hover:underline ${bold ? 'font-semibold' : ''}`}>{fmtNum(v)}</Link> : fmtNum(v)) : '';
  const th = 'border border-[#BFBFBF] bg-[#F2F2F2] px-3 py-1.5 text-xs font-semibold text-ink';
  const td = 'border border-[#D9D9D9] px-3 py-1.5 text-right tabular-nums';
  return (
    <section className="mb-5">
      <h2 className="mb-1.5 text-sm font-semibold">{title}</h2>
      {note && <p className="mb-1.5 text-xs text-ink-soft">{note}</p>}
      <div className="overflow-x-auto">
        <table className="border-collapse bg-white text-sm">
          <thead>
            <tr>
              <th className={`${th} min-w-[160px] text-left`}>{rowHeader}</th>
              {columns.map((c) => (
                <th key={c.label} className={`${th} min-w-[72px] text-right`}>{c.label}</th>
              ))}
              <th className={`${th} min-w-[96px] text-right`}>Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const total = sum(r.cells.map((c) => c.value));
              return (
                <tr key={r.label} className="hover:bg-[#F2F2F2]">
                  <td className="border border-[#D9D9D9] px-3 py-1.5">{r.href ? <Link href={r.href} className="text-ink no-underline hover:underline">{r.label}</Link> : r.label}</td>
                  {r.cells.map((c, i) => <td key={i} className={td}>{cell(c.value, c.href)}</td>)}
                  <td className={`${td} font-semibold`}>{cell(total, r.href, true)}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={columns.length + 2} className="border border-[#D9D9D9] px-3 py-4 text-center text-ink-soft">No data for these filters.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-[#F2F2F2] font-semibold">
                <td className="border border-[#BFBFBF] border-t-2 border-t-[#7F7F7F] px-3 py-1.5">Grand Total</td>
                {colTotals.map((v, i) => <td key={i} className="border border-[#BFBFBF] border-t-2 border-t-[#7F7F7F] px-3 py-1.5 text-right tabular-nums">{cell(v, columnHref?.(i), true)}</td>)}
                <td className="border border-[#BFBFBF] border-t-2 border-t-[#7F7F7F] px-3 py-1.5 text-right tabular-nums">{cell(grand, totalHref, true)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
