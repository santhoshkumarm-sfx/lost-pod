import Link from 'next/link';
import { fmtNum } from '@/lib/format';

export interface PivotColumn { label: string }
export interface PivotRow { label: string; href?: string; cells: { value: number; sub?: number; href?: string }[] }

/**
 * Excel-style pivot table: row labels down the side, columns across, Grand Total row and column.
 * Zeros are left blank, like a pivot table; every number links to the matching list of cases.
 */
export function PivotTable({ title, rowHeader, columns, rows, totalHref, columnHref, note, notInTotal = [], format = fmtNum, subFormat = fmtNum, hotFrom, actions }: {
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
  /** Second, smaller number under each cell (e.g. AWB count under the ₹ value). */
  subFormat?: (v: number) => string;
  /** Columns from this index on get the "critical" header colour. */
  hotFrom?: number;
  actions?: React.ReactNode;
}) {
  const hasSub = rows.some((r) => r.cells.some((c) => c.sub !== undefined));
  const colTotals = columns.map((_, i) => rows.reduce((t, r) => t + (r.cells[i]?.value ?? 0), 0));
  const colSubs = columns.map((_, i) => rows.reduce((t, r) => t + (r.cells[i]?.sub ?? 0), 0));
  const sum = (vals: number[]) => vals.reduce((t, v, i) => t + (notInTotal.includes(i) ? 0 : v), 0);
  const grand = sum(colTotals);
  const grandSub = sum(colSubs);
  const cell = (v: number, href?: string, bold?: boolean, sub?: number) => {
    if (!v && !sub) return '';
    const main = href ? <Link href={href} className={`text-inherit no-underline hover:underline ${bold ? 'font-semibold' : ''}`}>{format(v)}</Link> : format(v);
    if (!hasSub) return main;
    return (
      <>
        <div>{main}</div>
        <div className="text-[11px] font-normal leading-tight text-ink-faint">{sub ? `${subFormat(sub)} AWB` : ''}</div>
      </>
    );
  };
  const th = 'border border-[#2A4066] bg-[#14223A] px-1 py-2 text-xs font-semibold uppercase tracking-wide text-white';
  const td = `border border-[#DCDFD8] px-1 py-2 text-center tabular-nums ${columns.length > 10 ? 'text-[13px]' : 'text-[15px]'}`;
  const foot = `border border-[#B9C6DA] border-t-2 border-t-[#14223A] bg-[#E6ECF5] px-1 py-2 font-bold tabular-nums ${columns.length > 10 ? 'text-[13px]' : 'text-[15px]'}`;
  return (
    <section className="panel mb-5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
        </div>
        {actions}
      </div>
      <div className="overflow-x-auto p-3">
        <table className="w-full table-fixed border-collapse bg-white">
          <colgroup>
            <col className="w-[180px]" />
            {columns.map((c) => <col key={c.label} />)}
            <col className="w-[110px]" />
          </colgroup>
          <thead>
            <tr>
              <th className={`${th} px-3 text-left`}>{rowHeader}</th>
              {columns.map((c, i) => <th key={c.label} className={`${th} text-center ${hotFrom !== undefined && i >= hotFrom ? 'bg-[#7E2A26]' : ''}`}>{c.label}</th>)}
              <th className={`${th} bg-[#2A4066] text-center`}>Grand Total</th>
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
                  {r.cells.map((c, i) => <td key={i} className={td}>{cell(c.value, c.href, false, c.sub)}</td>)}
                  <td className={`${td} bg-[#F1F4F9] font-semibold`}>{cell(total, r.href, true, sum(r.cells.map((c) => c.sub ?? 0)))}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={columns.length + 2} className="border border-[#DCDFD8] px-3 py-4 text-center text-ink-soft">No data for these filters.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={`${foot} px-3 text-left`}>Grand Total</td>
                {colTotals.map((v, i) => <td key={i} className={`${foot} text-center`}>{cell(v, columnHref?.(i), true, colSubs[i])}</td>)}
                <td className={`${foot} bg-[#D5DFEE] text-center`}>{cell(grand, totalHref, true, grandSub)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
