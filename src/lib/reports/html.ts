import { AGING_HEX, agingStep, fmtDate, fmtDateTime, fmtInr, fmtNum } from '../format';
import type { DailyReportData } from './types';

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAVY = '#14223A';
const LINE = '#DCDFD8';
const INK = '#1B2330';
const SOFT = '#4A5566';

const th = (t: string, align: 'left' | 'right' | 'center' = 'left') =>
  `<th style="background:${NAVY};color:#fff;font-weight:600;font-size:12px;padding:6px 8px;text-align:${align};border:1px solid ${NAVY};white-space:nowrap">${esc(t)}</th>`;
const td = (v: unknown, align: 'left' | 'right' | 'center' = 'left', extra = '') =>
  `<td style="padding:5px 8px;font-size:12px;color:${INK};border:1px solid ${LINE};text-align:${align};${extra}">${v === null || v === undefined || v === '' ? '—' : v}</td>`;
const agingCell = (days: number) =>
  td(`<span style="color:${AGING_HEX[agingStep(days)]};font-weight:700">${fmtNum(days)}</span>`, 'right');
const heatCell = (n: number, step: number) =>
  td(n ? `<strong>${fmtNum(n)}</strong>` : '<span style="color:#9aa3ad">0</span>', 'center', n ? `background:${AGING_HEX[step]}1f;` : '');

function table(headers: string[], rows: string[], aligns: ('left' | 'right' | 'center')[] = []): string {
  if (!rows.length) return `<p style="font-size:12px;color:${SOFT};margin:4px 0 16px">Nothing to report.</p>`;
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 18px;min-width:420px">
<thead><tr>${headers.map((h, i) => th(h, aligns[i] ?? 'left')).join('')}</tr></thead>
<tbody>${rows.join('')}</tbody></table>`;
}

const h2 = (t: string, note?: string) =>
  `<h2 style="font-size:15px;color:${INK};margin:22px 0 2px;font-weight:700">${esc(t)}</h2>${note ? `<p style="font-size:12px;color:${SOFT};margin:0 0 6px">${esc(note)}</p>` : ''}`;

export interface ReportHtmlOptions {
  agingOrder: 'asc' | 'desc';
  lostDays: number;
  attachmentName: string | null;
  siteUrl: string;
}

/**
 * Daily admin report. The three Top 10 tables come first in the body (before the attachment note),
 * as requested, so the key numbers are readable without opening the file.
 */
export function renderDailyReportHtml(d: DailyReportData, o: ReportHtmlOptions): string {
  const s = d.summary;
  const kpis: [string, number][] = [
    ['Total open', s.total_open], ['New escalations', s.new_escalations], ['Pending', s.pending], ['Working', s.working_on_it],
    ['POD Shared', s.pod_shared], ['Shipment at DC', s.shipment_at_dc], ['Shipment at Hub', s.shipment_at_hub],
    ['Lost — pending approval', s.lost_pending], ['Lost', s.lost], ['Closed', s.closed], ['TAT breached', s.tat_breached],
  ];
  const kpiRows = [];
  for (let i = 0; i < kpis.length; i += 4) {
    kpiRows.push(
      `<tr>${kpis
        .slice(i, i + 4)
        .map(([l, v]) => `<td style="padding:8px 14px 8px 0;vertical-align:top"><div style="font-size:11px;color:${SOFT}">${esc(l)}</div><div style="font-size:20px;font-weight:700;color:${l === 'TAT breached' && v ? '#A9402B' : INK}">${fmtNum(v)}</div></td>`)
        .join('')}</tr>`,
    );
  }

  // Top 10 aging: days 1..10 and 10+ (configurable direction).
  const days = Array.from({ length: 11 }, (_, i) => String(i + 1));
  const ordered = o.agingOrder === 'desc' ? [...days].reverse() : days;
  const dayLabel = (k: string) => (k === '11' ? '10+' : k);
  const dayStep = (k: string) => agingStep(Number(k === '11' ? 31 : k));
  const top10Aging = table(
    ['Client', ...ordered.map(dayLabel), 'Total'],
    d.top10_aging.map(
      (r) => `<tr>${td(esc(r.client))}${ordered.map((k) => heatCell(r.by_day?.[k] ?? 0, dayStep(k))).join('')}${td(`<strong>${fmtNum(r.total)}</strong>`, 'right')}</tr>`,
    ),
    ['left', ...ordered.map(() => 'center' as const), 'right'],
  );

  const top10Value = table(
    ['Rank', 'AWB', 'Client', 'Product name', 'Product value', 'Aging', 'Current status'],
    d.top10_value.map(
      (r) => `<tr>${td(r.rank, 'center')}${td(`<span style="font-family:Consolas,Menlo,monospace">${esc(r.awb)}</span>`)}${td(esc(r.client))}${td(esc(r.product_name))}${td(fmtInr(r.product_value), 'right')}${agingCell(r.aging_days)}${td(esc(r.status))}</tr>`,
    ),
    ['center', 'left', 'left', 'left', 'right', 'right', 'left'],
  );

  const top10Count = table(
    ['Rank', 'Client', 'AWB count', 'Pending count', 'Lost count', 'Average aging'],
    d.top10_awb_count.map(
      (r) => `<tr>${td(r.rank, 'center')}${td(esc(r.client))}${td(fmtNum(r.awb_count), 'right')}${td(fmtNum(r.pending_count), 'right')}${td(fmtNum(r.lost_count), 'right')}${td(r.avg_aging === null ? '—' : `${r.avg_aging} d`, 'right')}</tr>`,
    ),
    ['center', 'left', 'right', 'right', 'right', 'right'],
  );

  const clientWise = table(
    ['Client', 'Total', 'Open', 'Pending', 'Lost pending approval', 'Lost', 'POD Shared', 'Aging 0–7', '8–15', '16–30', '30+'],
    d.client_wise.map(
      (r) =>
        `<tr>${td(esc(r.client))}${[r.total, r.open, r.pending, r.lost_pending, r.lost, r.pod_shared].map((n) => td(fmtNum(n), 'right')).join('')}${heatCell(r.aging_0_7, 1)}${heatCell(r.aging_8_15, 2)}${heatCell(r.aging_16_30, 3)}${heatCell(r.aging_30_plus, 5)}</tr>`,
    ),
    ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'center', 'center', 'center', 'center'],
  );

  const agingWise = table(
    d.aging_wise.map((a) => `${a.label} days`),
    [`<tr>${d.aging_wise.map((a, i) => heatCell(a.count, Math.min(i, 6))).join('')}</tr>`],
    d.aging_wise.map(() => 'center' as const),
  );

  const lost = table(
    ['Client', 'AWB', 'Escalation date', 'Lost aging', 'Location / hub', 'Reason', 'Final remark', 'Approval date'],
    d.lost_cases.map(
      (r) => `<tr>${td(esc(r.client))}${td(`<span style="font-family:Consolas,Menlo,monospace">${esc(r.awb)}</span>`)}${td(fmtDate(r.escalation_date))}${agingCell(r.aging_days)}${td(esc(r.hub))}${td(esc(r.reason))}${td(esc(r.final_remark))}${td(fmtDateTime(r.approved_at))}</tr>`,
    ),
  );

  const pending = table(
    ['Client', 'AWB', 'Escalation date', 'Aging', 'Location / hub', 'Requested by', 'Reason', 'Requested on'],
    d.pending_lost.map(
      (r) => `<tr>${td(esc(r.client))}${td(`<span style="font-family:Consolas,Menlo,monospace">${esc(r.awb)}</span>`)}${td(fmtDate(r.escalation_date))}${agingCell(r.aging_days)}${td(esc(r.hub))}${td(esc(r.requested_by ?? (r.requested_via === 'google_sheet' ? 'Google Sheet' : r.requested_via)))}${td(esc(r.reason))}${td(fmtDateTime(r.requested_at))}</tr>`,
    ),
  );

  const agingNote = o.agingOrder === 'desc' ? 'Columns run from 10+ days down to 1 day.' : 'Columns run from 1 day to 10+ days.';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F1">
<div style="font-family:'Public Sans',Segoe UI,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:20px;background:#ffffff;color:${INK}">
<div style="border-left:6px solid ${NAVY};padding:2px 0 2px 12px;margin-bottom:12px">
  <div style="font-size:19px;font-weight:700">Lost / POD escalations — daily report</div>
  <div style="font-size:12px;color:${SOFT}">Report for ${fmtDate(d.report_date)}, generated ${fmtDateTime(d.generated_at)} IST from the consolidated database (Google Sheets, email and manual cases).</div>
</div>
${h2('Daily summary')}
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${kpiRows.join('')}</table>
${h2('Top 10 aging', `Open cases per client by days since escalation. Top 10 clients by open cases. ${agingNote}`)}
${top10Aging}
${h2('Top 10 — highest product value', 'Open shipments with the highest product value.')}
${top10Value}
${h2('Top 10 — highest AWB count', 'Clients with the most escalated AWBs. Pending = open, including Lost requests awaiting approval.')}
${top10Count}
${h2('Client-wise', 'Aging columns count open cases only.')}
${clientWise}
${h2('Aging-wise', 'Open cases in each aging bucket.')}
${agingWise}
${h2(`Approved Lost — last ${o.lostDays} days`, `Lost aging is counted from the original escalation date to the approval date. ${fmtNum(d.lost_total)} Lost cases in total (all are in the attachment).`)}
${lost}
${h2('Waiting for Lost approval', `${fmtNum(d.pending_lost_total)} request(s). These stay open until an approver accepts, rejects or sends them back.`)}
${pending}
<div style="margin-top:20px;padding:10px 12px;background:#F3F4F1;border:1px solid ${LINE};font-size:12px;color:${SOFT}">
${o.attachmentName ? `Attached: <strong style="color:${INK}">${esc(o.attachmentName)}</strong> — every case with source, aging, status, hub and remarks, plus the tables above.<br>` : ''}
Open the dashboard: <a href="${esc(o.siteUrl)}/dashboard" style="color:#1F5FBF">${esc(o.siteUrl)}/dashboard</a><br>Lost approvals: <a href="${esc(o.siteUrl)}/lost-approval" style="color:#1F5FBF">${esc(o.siteUrl)}/lost-approval</a>
</div>
</div></body></html>`;
}
