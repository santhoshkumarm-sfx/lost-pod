import { fmtDate, fmtNum } from '../format';
import type { PodStats } from '../cases/filters';

/*
 * Email report in the familiar "detail report" layout: numbered sections, plain bordered tables, full numbers
 * (zeros shown), one table by AWB count and a separate one by ₹ product value. No per-AWB lists in the body —
 * every case is in the attached Excel, so the email stays small enough for Gmail.
 */

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BORDER = '#5B7DB1';
const HEAD = '#F2F2F2';
const HOT = '#A9402B';
const n0 = (v: unknown) => fmtNum(Math.round(Number(v) || 0));

export interface MailTable {
  title: string;
  /** Label columns on the left (e.g. Hub, City). */
  labels: string[];
  columns: string[];
  rows: { labels: (string | null)[]; cells: number[] }[];
  /** Columns from this index on are critical (header in red). */
  hotFrom?: number;
  /** Extra total over the first N columns, shown before the Total (e.g. "Total 0–7 days"). */
  firstTotal?: { label: string; upTo: number };
  /** Columns not added into Total (e.g. Critical, which is part of Pending). */
  notInTotal?: number[];
  totalRow?: boolean;
  /** Leave out the Total column (when the columns are different things). */
  noTotalCol?: boolean;
}

export function mailTable(t: MailTable): string {
  const skip = new Set(t.notInTotal ?? []);
  const total = (c: number[]) => c.reduce((s, v, i) => s + (skip.has(i) ? 0 : Number(v) || 0), 0);
  const first = (c: number[]) => c.slice(0, t.firstTotal?.upTo ?? 0).reduce((s, v) => s + (Number(v) || 0), 0);
  const th = (x: string, hot = false) => `<th bgcolor="${HEAD}" align="center" style="white-space:nowrap${hot ? `;color:${HOT}` : ''}">${esc(x)}</th>`;
  const td = (v: number, bold = false) => `<td align="center">${bold ? `<b>${n0(v)}</b>` : n0(v)}</td>`;
  const head = `<tr>${t.labels.map((l) => th(l)).join('')}${t.columns.map((c, i) => th(c, t.hotFrom !== undefined && i >= t.hotFrom)).join('')}${t.firstTotal ? th(t.firstTotal.label) : ''}${t.noTotalCol ? '' : th('Total')}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.labels.map((l, i) => `<td${i ? ' align="center"' : ''}><b>${esc(l ?? '—')}</b></td>`).join('')}${r.cells.map((v) => td(v)).join('')}${t.firstTotal ? td(first(r.cells)) : ''}${t.noTotalCol ? '' : td(total(r.cells), true)}</tr>`).join('');
  const cols = t.columns.map((_, i) => t.rows.reduce((s, r) => s + (Number(r.cells[i]) || 0), 0));
  const foot = t.totalRow === false || !t.rows.length ? '' :
    `<tr bgcolor="${HEAD}"><td colspan="${t.labels.length}"><b>Total</b></td>${cols.map((v) => td(v, true)).join('')}${t.firstTotal ? td(first(cols), true) : ''}${t.noTotalCol ? '' : td(total(cols), true)}</tr>`;
  const empty = t.rows.length ? '' : `<tr><td colspan="${t.labels.length + t.columns.length + 2}" align="center">Nothing to show.</td></tr>`;
  return `<p style="margin:18px 0 6px"><b>${esc(t.title)}</b></p>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;border-color:${BORDER};font-size:12px;font-family:Arial,sans-serif">${head}${body}${empty}${foot}</table>`;
}

export interface Yesterday { day: string; new: { count: number; value: number }; pod_shared: { count: number; value: number }; lost_requested: { count: number; value: number }; lost_accepted: { count: number; value: number } }

/** The report body: numbered sections, each as AWBs and as ₹ product value. */
export function statsEmailHtml(s: PodStats, y: Yesterday | null, o: { intro: string; footer: string; agents?: boolean }): string {
  const ageCols = s.pending_age.map((b) => b.label);
  const hotFrom = s.pending_age.findIndex((b) => b.min > s.critical_days);
  const hot = hotFrom >= 0 ? hotFrom : undefined;
  const upTo = hot ?? ageCols.length;
  const firstTotal = { label: `Total 0–${s.critical_days} days`, upTo };
  const pending = s.by_client.filter((c) => c.pending > 0);
  const v = s.value;
  const statusCols = ['Pending POD', `Critical (> ${s.critical_days} days)`, 'POD shared / closed', 'Loss requested', 'Loss accepted'];
  const sections: string[] = [];
  const add = (t: MailTable) => sections.push(mailTable({ ...t, title: `${sections.length + 1}. ${t.title}` }));

  if (y) {
    add({
      title: `Yesterday (${fmtDate(y.day)}):`, labels: [''], columns: ['New escalations', 'POD shared', 'Loss requested', 'Loss accepted'], totalRow: false,
      rows: [
        { labels: ['AWBs'], cells: [y.new.count, y.pod_shared.count, y.lost_requested.count, y.lost_accepted.count] },
        { labels: ['Product value (₹)'], cells: [y.new.value, y.pod_shared.value, y.lost_requested.value, y.lost_accepted.value] },
      ],
      noTotalCol: true,
    });
  }
  add({ title: 'Pending POD client wise — AWBs (days since escalation):', labels: ['Client'], columns: ageCols, hotFrom: hot, firstTotal,
    rows: pending.map((c) => ({ labels: [c.client], cells: c.age })) });
  add({ title: `Pending POD client wise — Product value (₹):${v?.pending_no_value ? ` ${fmtNum(v.pending_no_value)} pending AWB(s) have no product value yet (counted as 0).` : ''}`,
    labels: ['Client'], columns: ageCols, hotFrom: hot, firstTotal, rows: pending.map((c) => ({ labels: [c.client], cells: c.age_value.map(Number) })) });
  add({ title: 'Top 20 hubs — Pending POD by Product value (₹):', labels: ['Hub', 'City'], columns: ageCols, hotFrom: hot, firstTotal,
    rows: s.by_hub.map((h) => ({ labels: [h.hub, h.city], cells: h.age_value.map(Number) })) });
  add({ title: 'Top 20 hubs — Pending POD AWBs (same hubs):', labels: ['Hub', 'City'], columns: ageCols, hotFrom: hot, firstTotal,
    rows: s.by_hub.map((h) => ({ labels: [h.hub, h.city], cells: h.age })) });
  add({ title: 'All cases client wise — AWBs (Critical is part of Pending POD, not added again in Total):', labels: ['Client'], columns: statusCols, notInTotal: [1],
    rows: s.by_client.map((c) => ({ labels: [c.client], cells: [c.pending, c.critical, c.pod_shared, c.lost_pending, c.lost] })) });
  add({ title: 'All cases client wise — Product value (₹):', labels: ['Client'], columns: statusCols, notInTotal: [1],
    rows: s.by_client.map((c) => ({ labels: [c.client], cells: [c.pending_value, c.critical_value, c.pod_shared_value, c.lost_pending_value, c.lost_value].map(Number) })) });
  add({ title: 'Top 15 hubs — Loss accepted by Product value (₹):', labels: ['Hub', 'City'], columns: ['Loss accepted AWBs', 'Loss accepted ₹', 'Loss requested AWBs', 'Loss requested ₹'], noTotalCol: true,
    rows: s.hub_loss.map((h) => ({ labels: [h.hub, h.city], cells: [h.lost, Number(h.lost_value), h.lost_pending, Number(h.lost_pending_value)] })) });
  if (o.agents) {
    add({ title: 'Pending POD agent wise — AWBs:', labels: ['Agent'], columns: ageCols, hotFrom: hot, firstTotal, rows: s.by_agent.map((a) => ({ labels: [a.agent], cells: a.age })) });
    add({ title: 'Pending POD agent wise — Product value (₹):', labels: ['Agent'], columns: ageCols, hotFrom: hot, firstTotal, rows: s.by_agent.map((a) => ({ labels: [a.agent], cells: a.age_value.map(Number) })) });
  }
  return `<div style="font-family:Arial,sans-serif;color:#1B2330;font-size:13px">
<p>Hi All,</p><p>${o.intro}</p>
<p>Pending POD: <b>${fmtNum(s.pending)}</b> AWBs (₹${n0(v?.pending)}) · Critical over ${s.critical_days} days: <b style="color:${HOT}">${fmtNum(s.critical)}</b> (₹${n0(v?.critical)}) · Loss requested: <b>${fmtNum(s.lost_pending)}</b> (₹${n0(v?.lost_pending)}) · Loss accepted: <b>${fmtNum(s.lost)}</b> (₹${n0(v?.lost)})</p>
${sections.join('\n')}
<p style="margin-top:16px">${o.footer}</p></div>`;
}
