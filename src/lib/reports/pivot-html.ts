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

/**
 * The rows of the report tables, shared by the email, the dashboard and the Excel so all three always match.
 * Every table is largest to smallest by its own measure: ₹ tables by product value, AWB tables by AWB count.
 */
export function reportRows(s: PodStats) {
  const desc = <T,>(xs: T[], main: (x: T) => number, tie: (x: T) => number) =>
    [...xs].sort((a, b) => main(b) - main(a) || tie(b) - tie(a));
  const pv = (x: { pending_value: number }) => Number(x.pending_value) || 0;
  const pc = (x: { pending: number }) => x.pending;
  const lv = (x: { lost_value: number }) => Number(x.lost_value) || 0;
  const lc = (x: { lost: number }) => x.lost;
  const pendingClients = s.by_client.filter((c) => c.pending > 0);
  const lostClients = s.by_client.filter((c) => c.lost > 0);
  const lostAgents = (s.agent_loss ?? []).filter((a) => a.lost > 0);
  return {
    hubsV: desc(s.by_hub, pv, pc).slice(0, 15), hubsA: desc(s.by_hub, pc, pv).slice(0, 15),
    clientsV: desc(pendingClients, pv, pc), clientsA: desc(pendingClients, pc, pv),
    agentsV: desc(s.by_agent, pv, pc), agentsA: desc(s.by_agent, pc, pv),
    lostClientsV: desc(lostClients, lv, lc), lostClientsA: desc(lostClients, lc, lv),
    lostAgentsV: desc(lostAgents, lv, lc), lostAgentsA: desc(lostAgents, lc, lv),
  };
}

/** The report body: the same tables as the dashboard, each as AWBs first, then ₹ product value. */
export function statsEmailHtml(s: PodStats, o: { intro: string; footer: string }): string {
  const ageCols = s.pending_age.map((b) => b.label);
  const hotFrom = s.pending_age.findIndex((b) => b.min > s.critical_days);
  const hot = hotFrom >= 0 ? hotFrom : undefined;
  const firstTotal = { label: `Total 1–${s.critical_days} days`, upTo: hot ?? ageCols.length };
  const r = reportRows(s);
  const sections: string[] = [];
  const add = (t: MailTable) => sections.push(mailTable({ ...t, title: `${sections.length + 1}. ${t.title}` }));
  const age = { columns: ageCols, hotFrom: hot, firstTotal, keepOrder: true };
  const one = { noTotalCol: true };

  add({ title: 'POD pending — client wise (AWBs)', labels: ['Client'], ...age, rows: r.clientsA.map((c) => ({ labels: [c.client], cells: c.age })) });
  add({ title: 'POD pending — client wise (₹)', labels: ['Client'], ...age, rows: r.clientsV.map((c) => ({ labels: [c.client], cells: c.age_value.map(Number) })) });
  add({ title: 'POD accepted lost — client wise (AWBs)', labels: ['Client'], columns: ['Loss accepted (AWBs)'], ...one, rows: r.lostClientsA.map((c) => ({ labels: [c.client], cells: [c.lost] })) });
  add({ title: 'POD accepted lost — client wise (₹)', labels: ['Client'], columns: ['Loss accepted (₹)'], ...one, valueTable: true, rows: r.lostClientsV.map((c) => ({ labels: [c.client], cells: [Number(c.lost_value)] })) });
  add({ title: 'Top 15 hubs — POD pending (AWBs)', labels: ['Hub', 'City'], ...age, rows: r.hubsA.map((h) => ({ labels: [h.hub, h.city], cells: h.age })) });
  add({ title: 'Top 15 hubs — POD pending (₹)', labels: ['Hub', 'City'], ...age, rows: r.hubsV.map((h) => ({ labels: [h.hub, h.city], cells: h.age_value.map(Number) })) });
  add({ title: 'POD pending — agent wise (AWBs)', labels: ['Agent'], ...age, rows: r.agentsA.map((a) => ({ labels: [a.agent], cells: a.age })) });
  add({ title: 'POD pending — agent wise (₹)', labels: ['Agent'], ...age, rows: r.agentsV.map((a) => ({ labels: [a.agent], cells: a.age_value.map(Number) })) });
  add({ title: 'POD accepted lost — agent wise (AWBs)', labels: ['Agent'], columns: ['Loss accepted (AWBs)'], ...one, rows: r.lostAgentsA.map((a) => ({ labels: [a.agent], cells: [a.lost] })) });
  add({ title: 'POD accepted lost — agent wise (₹)', labels: ['Agent'], columns: ['Loss accepted (₹)'], ...one, valueTable: true, rows: r.lostAgentsV.map((a) => ({ labels: [a.agent], cells: [Number(a.lost_value)] })) });
  return `<div style="font-family:Arial,sans-serif;color:#1B2330;font-size:13px">
<p>Hi All,</p><p>${o.intro}</p>
${sections.join('\n')}
<p style="margin-top:16px">${o.footer}</p></div>`;
}
