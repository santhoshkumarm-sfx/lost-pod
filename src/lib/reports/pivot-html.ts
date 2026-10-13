import { fmtNum } from '../format';
import type { PodStats } from '../cases/filters';

/*
 * Email report: numbered sections, plain bordered tables, full numbers (zeros shown), one table by ₹ product
 * value and a separate one by AWB count. No per-AWB lists and no attachment, so Gmail always accepts it.
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
  /** Extra total over the first N columns, shown before the Total (e.g. "Total 1–7 days"). */
  firstTotal?: { label: string; upTo: number };
  /** Columns not added into Total (e.g. Critical, which is part of Pending). */
  notInTotal?: number[];
  totalRow?: boolean;
  /** Leave out the Total column (when the columns are different things). */
  noTotalCol?: boolean;
  /** Keep the rows in the given order (no largest-first sort). */
  keepOrder?: boolean;
  /** Teal header (product value table) even when the title does not say ₹. */
  valueTable?: boolean;
}

export function mailTable(t: MailTable): string {
  const skip = new Set(t.notInTotal ?? []);
  const total = (c: number[]) => c.reduce((s, v, i) => s + (skip.has(i) ? 0 : Number(v) || 0), 0);
  // Largest to smallest (by Total), for AWB and for value tables alike.
  if (!t.noTotalCol && !t.keepOrder) t = { ...t, rows: [...t.rows].sort((a, b) => total(b.cells) - total(a.cells)) };
  const first = (c: number[]) => c.slice(0, t.firstTotal?.upTo ?? 0).reduce((s, v) => s + (Number(v) || 0), 0);
  // Even spacing: label columns 150px, every number column (totals included) the same width.
  const value = t.valueTable || /Product value|₹/.test(t.title);
  const headBg = value ? '#E3EEF0' : HEAD;
  const numW = t.columns.length > 8 ? 64 : 110;
  const th = (x: string, hot = false, w = numW) => `<th bgcolor="${headBg}" align="center" width="${w}" style="width:${w}px${hot ? `;color:${HOT}` : ''}">${esc(x)}</th>`;
  const td = (v: number, bold = false) => `<td align="center">${bold ? `<b>${n0(v)}</b>` : n0(v)}</td>`;
  const head = `<tr>${t.labels.map((l) => th(l, false, 150)).join('')}${t.columns.map((c, i) => th(c, t.hotFrom !== undefined && i >= t.hotFrom)).join('')}${t.firstTotal ? th(t.firstTotal.label) : ''}${t.noTotalCol ? '' : th('Total')}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.labels.map((l, i) => `<td${i ? ' align="center"' : ''}><b>${esc(l ?? '—')}</b></td>`).join('')}${r.cells.map((v) => td(v)).join('')}${t.firstTotal ? td(first(r.cells)) : ''}${t.noTotalCol ? '' : td(total(r.cells), true)}</tr>`).join('');
  const cols = t.columns.map((_, i) => t.rows.reduce((s, r) => s + (Number(r.cells[i]) || 0), 0));
  const foot = t.totalRow === false || !t.rows.length ? '' :
    `<tr bgcolor="${HEAD}"><td colspan="${t.labels.length}"><b>Total</b></td>${cols.map((v) => td(v, true)).join('')}${t.firstTotal ? td(first(cols), true) : ''}${t.noTotalCol ? '' : td(total(cols), true)}</tr>`;
  const empty = t.rows.length ? '' : `<tr><td colspan="${t.labels.length + t.columns.length + 2}" align="center">Nothing to show.</td></tr>`;
  return `<p style="margin:18px 0 6px"><b>${esc(t.title)}</b></p>
<table border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;border-color:${BORDER};font-size:12px;font-family:Arial,sans-serif">${head}${body}${empty}${foot}</table>`;
}

/** The rows of the report tables, shared by the email and the dashboard so both always show the same thing. */
export function reportRows(s: PodStats) {
  const byValue = <T extends { pending_value: number; pending: number }>(xs: T[]) =>
    [...xs].sort((a, b) => Number(b.pending_value) - Number(a.pending_value) || b.pending - a.pending);
  return {
    clients: byValue(s.by_client.filter((c) => c.pending > 0)).slice(0, 15),
    hubs: byValue(s.by_hub).slice(0, 15),
    agents: byValue(s.by_agent),
    lostClients: s.by_client.filter((c) => c.lost > 0).sort((a, b) => Number(b.lost_value) - Number(a.lost_value) || b.lost - a.lost),
    lostAgents: (s.agent_loss ?? []).filter((a) => a.lost > 0).sort((a, b) => Number(b.lost_value) - Number(a.lost_value) || b.lost - a.lost),
  };
}

/** The report body: the same tables as the dashboard, product value (₹) first, then AWBs. */
export function statsEmailHtml(s: PodStats, o: { intro: string; footer: string }): string {
  const ageCols = s.pending_age.map((b) => b.label);
  const hotFrom = s.pending_age.findIndex((b) => b.min > s.critical_days);
  const hot = hotFrom >= 0 ? hotFrom : undefined;
  const firstTotal = { label: `Total 1–${s.critical_days} days`, upTo: hot ?? ageCols.length };
  const r = reportRows(s);
  const sections: string[] = [];
  const add = (t: MailTable) => sections.push(mailTable({ ...t, title: `${sections.length + 1}. ${t.title}` }));
  const age = { columns: ageCols, hotFrom: hot, firstTotal };

  add({ title: 'POD pending', labels: [''], ...age, keepOrder: true, totalRow: false, rows: [
    { labels: ['Product value (₹)'], cells: s.pending_age.map((b) => Number(b.value)) },
    { labels: ['AWBs'], cells: s.pending_age.map((b) => b.count) },
  ] });
  add({ title: 'POD accepted lost — client wise', labels: ['Client'], columns: ['Product value (₹)', 'AWBs'], noTotalCol: true, valueTable: true,
    rows: r.lostClients.map((c) => ({ labels: [c.client], cells: [Number(c.lost_value), c.lost] })) });
  add({ title: 'Top 15 hubs — POD pending (₹)', labels: ['Hub', 'City'], ...age, rows: r.hubs.map((h) => ({ labels: [h.hub, h.city], cells: h.age_value.map(Number) })) });
  add({ title: 'Top 15 hubs — POD pending (AWBs)', labels: ['Hub', 'City'], ...age, rows: r.hubs.map((h) => ({ labels: [h.hub, h.city], cells: h.age })) });
  add({ title: 'Top 15 clients — POD pending (₹)', labels: ['Client'], ...age, rows: r.clients.map((c) => ({ labels: [c.client], cells: c.age_value.map(Number) })) });
  add({ title: 'Top 15 clients — POD pending (AWBs)', labels: ['Client'], ...age, rows: r.clients.map((c) => ({ labels: [c.client], cells: c.age })) });
  add({ title: 'POD pending — agent wise (₹)', labels: ['Agent'], ...age, rows: r.agents.map((a) => ({ labels: [a.agent], cells: a.age_value.map(Number) })) });
  add({ title: 'POD pending — agent wise (AWBs)', labels: ['Agent'], ...age, rows: r.agents.map((a) => ({ labels: [a.agent], cells: a.age })) });
  add({ title: 'POD accepted lost — agent wise', labels: ['Agent'], columns: ['Product value (₹)', 'AWBs'], noTotalCol: true, valueTable: true,
    rows: r.lostAgents.map((a) => ({ labels: [a.agent], cells: [Number(a.lost_value), a.lost] })) });
  return `<div style="font-family:Arial,sans-serif;color:#1B2330;font-size:13px">
<p>Hi All,</p><p>${o.intro}</p>
${sections.join('\n')}
<p style="margin-top:16px">${o.footer}</p></div>`;
}
