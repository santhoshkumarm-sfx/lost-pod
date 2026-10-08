import ExcelJS from 'exceljs';
import { AGING_HEX, agingStep, fmtDate, fmtDateTime, fmtNum } from '../format';

/** Shape returned by public.weekly_report_data(). */
export interface WeeklyReportData {
  generated_at: string;
  period_from: string;
  period_to: string;
  summary: {
    pending: number;
    lost_requested: number;
    loss_accepted_total: number;
    loss_accepted_period: number;
    new_period: number;
    closed_period: number;
  };
  client_wise: { client: string; pending: number; lost_requested: number; loss_accepted_period: number; loss_accepted_total: number; avg_pending_aging: number | null }[];
  accepted_period: { client: string | null; awb: string; escalation_date: string; aging_days: number; hub: string | null; reason: string | null; final_remark: string | null; approved_at: string }[];
  requested_open: { client: string | null; awb: string; escalation_date: string; aging_days: number; hub: string | null; reason: string | null; requested_at: string; requested_via: string }[];
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAVY = '#14223A';
const LINE = '#DCDFD8';
const INK = '#1B2330';
const SOFT = '#4A5566';
const BODY_ROWS = 100;

const th = (t: string, align = 'left') =>
  `<th style="background:${NAVY};color:#fff;font-weight:600;font-size:12px;padding:6px 8px;text-align:${align};border:1px solid ${NAVY};white-space:nowrap">${esc(t)}</th>`;
const td = (v: unknown, align = 'left', extra = '') =>
  `<td style="padding:5px 8px;font-size:12px;color:${INK};border:1px solid ${LINE};text-align:${align};${extra}">${v === null || v === undefined || v === '' ? '—' : v}</td>`;
const agingCell = (days: number) => td(`<span style="color:${AGING_HEX[agingStep(days)]};font-weight:700">${fmtNum(days)}</span>`, 'right');
const mono = (s: string) => `<span style="font-family:Consolas,Menlo,monospace">${esc(s)}</span>`;
const h2 = (t: string, note?: string) =>
  `<h2 style="font-size:15px;color:${INK};margin:22px 0 2px;font-weight:700">${esc(t)}</h2>${note ? `<p style="font-size:12px;color:${SOFT};margin:0 0 6px">${esc(note)}</p>` : ''}`;

function table(headers: string[], rows: string[], aligns: string[] = []): string {
  if (!rows.length) return `<p style="font-size:12px;color:${SOFT};margin:4px 0 16px">Nothing to report.</p>`;
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 18px;min-width:420px">
<thead><tr>${headers.map((h, i) => th(h, aligns[i])).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const viaLabel = (v: string) => ({ app: 'Shadowfax team', poc_portal: 'Client portal', google_sheet: 'Google Sheet', email: 'Email' })[v] ?? v;

export function weeklySubject(d: WeeklyReportData): string {
  const s = d.summary;
  return `Lost / POD weekly summary — ${fmtDate(d.period_from)} to ${fmtDate(d.period_to)} — ${fmtNum(s.pending)} pending, ${fmtNum(s.lost_requested)} loss requested, ${fmtNum(s.loss_accepted_period)} loss accepted`;
}

export function renderWeeklyReportHtml(d: WeeklyReportData, o: { siteUrl: string; attachmentName: string | null }): string {
  const s = d.summary;
  const kpis: [string, number, string?][] = [
    ['Pending (open)', s.pending],
    ['Loss requested — awaiting decision', s.lost_requested, s.lost_requested ? '#C8612A' : undefined],
    ['Loss accepted this week', s.loss_accepted_period, s.loss_accepted_period ? '#A9402B' : undefined],
    ['Loss accepted (all time)', s.loss_accepted_total],
    ['New escalations this week', s.new_period],
    ['Closed this week', s.closed_period],
  ];
  const kpiRow = `<tr>${kpis
    .map(([l, v, c]) => `<td style="padding:8px 18px 8px 0;vertical-align:top"><div style="font-size:11px;color:${SOFT}">${esc(l)}</div><div style="font-size:22px;font-weight:700;color:${c ?? INK}">${fmtNum(v)}</div></td>`)
    .join('')}</tr>`;

  const clients = table(
    ['Client', 'Pending', 'Loss requested', 'Loss accepted (week)', 'Loss accepted (total)', 'Avg pending aging'],
    d.client_wise
      .filter((c) => c.pending + c.lost_requested + c.loss_accepted_period > 0)
      .map((c) => `<tr>${td(esc(c.client))}${td(fmtNum(c.pending), 'right')}${td(fmtNum(c.lost_requested), 'right')}${td(fmtNum(c.loss_accepted_period), 'right')}${td(fmtNum(c.loss_accepted_total), 'right')}${td(c.avg_pending_aging === null ? '—' : `${c.avg_pending_aging} d`, 'right')}</tr>`),
    ['left', 'right', 'right', 'right', 'right', 'right'],
  );
  const accepted = table(
    ['Client', 'AWB', 'Escalated', 'Lost aging', 'Hub / location', 'Reason', 'Final remark', 'Accepted on'],
    d.accepted_period.slice(0, BODY_ROWS).map((r) => `<tr>${td(esc(r.client))}${td(mono(r.awb))}${td(fmtDate(r.escalation_date))}${agingCell(r.aging_days)}${td(esc(r.hub))}${td(esc(r.reason))}${td(esc(r.final_remark))}${td(fmtDateTime(r.approved_at))}</tr>`),
  );
  const requested = table(
    ['Client', 'AWB', 'Escalated', 'Aging', 'Hub / location', 'Requested via', 'Reason', 'Requested on'],
    d.requested_open.slice(0, BODY_ROWS).map((r) => `<tr>${td(esc(r.client))}${td(mono(r.awb))}${td(fmtDate(r.escalation_date))}${agingCell(r.aging_days)}${td(esc(r.hub))}${td(esc(viaLabel(r.requested_via)))}${td(esc(r.reason))}${td(fmtDateTime(r.requested_at))}</tr>`),
  );
  const more = (n: number) => (n > BODY_ROWS ? `<p style="font-size:12px;color:${SOFT};margin:-10px 0 16px">Showing ${BODY_ROWS} of ${fmtNum(n)}; all are in the attachment.</p>` : '');

  return `<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F1">
<div style="font-family:'Public Sans',Segoe UI,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:20px;background:#ffffff;color:${INK}">
<div style="border-left:6px solid ${NAVY};padding:2px 0 2px 12px;margin-bottom:12px">
  <div style="font-size:19px;font-weight:700">Lost / POD — weekly summary</div>
  <div style="font-size:12px;color:${SOFT}">${fmtDate(d.period_from)} to ${fmtDate(d.period_to)}. Generated ${fmtDateTime(d.generated_at)} IST from the consolidated database.</div>
</div>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${kpiRow}</table>
${h2('Client-wise', 'Pending = still being worked on. Loss requested = waiting for an approver. Loss accepted = declared Lost.')}
${clients}
${h2('Loss accepted this week', `${fmtNum(d.accepted_period.length)} shipment(s). Lost aging runs from escalation to acceptance.`)}
${accepted}${more(d.accepted_period.length)}
${h2('Loss requested — still waiting for a decision', `${fmtNum(d.requested_open.length)} request(s), oldest first.`)}
${requested}${more(d.requested_open.length)}
<div style="margin-top:20px;padding:10px 12px;background:#F3F4F1;border:1px solid ${LINE};font-size:12px;color:${SOFT}">
${o.attachmentName ? `Attached: <strong style="color:${INK}">${esc(o.attachmentName)}</strong> — the tables above in full, plus every pending case.<br>` : ''}
Lost approvals: <a href="${esc(o.siteUrl)}/lost-approval" style="color:#1F5FBF">${esc(o.siteUrl)}/lost-approval</a> · Dashboard: <a href="${esc(o.siteUrl)}/dashboard" style="color:#1F5FBF">${esc(o.siteUrl)}/dashboard</a>
</div>
</div></body></html>`;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14223A' } };
function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = HEADER_FILL;
  rows.forEach((r) => ws.addRow(r));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

export interface PendingCaseRow { client_display_name: string | null; awb: string; escalation_date: string; aging_days: number; status_label: string; hub: string | null; location: string | null; team_remark: string | null; agent_display_name: string | null }

export async function buildWeeklyWorkbook(d: WeeklyReportData, pendingCases: PendingCaseRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lost / POD dashboard';
  const s = d.summary;
  sheet(wb, 'Summary', [{ header: 'Measure', key: 'k', width: 36 }, { header: 'Value', key: 'v', width: 14 }], [
    { k: 'Period', v: `${d.period_from} to ${d.period_to}` },
    { k: 'Pending (open)', v: s.pending }, { k: 'Loss requested — awaiting decision', v: s.lost_requested },
    { k: 'Loss accepted this week', v: s.loss_accepted_period }, { k: 'Loss accepted (all time)', v: s.loss_accepted_total },
    { k: 'New escalations this week', v: s.new_period }, { k: 'Closed this week', v: s.closed_period },
  ]);
  sheet(wb, 'Client-wise', [
    { header: 'Client', key: 'client', width: 20 }, { header: 'Pending', key: 'pending' }, { header: 'Loss requested', key: 'lost_requested' },
    { header: 'Loss accepted (week)', key: 'loss_accepted_period' }, { header: 'Loss accepted (total)', key: 'loss_accepted_total' },
    { header: 'Avg pending aging', key: 'avg_pending_aging' },
  ], d.client_wise);
  sheet(wb, 'Loss accepted (week)', [
    { header: 'Client', key: 'client', width: 16 }, { header: 'AWB', key: 'awb', width: 22 }, { header: 'Escalated', key: 'escalation_date' },
    { header: 'Lost aging', key: 'aging_days' }, { header: 'Hub / location', key: 'hub', width: 22 }, { header: 'Reason', key: 'reason', width: 30 },
    { header: 'Final remark', key: 'final_remark', width: 30 }, { header: 'Accepted on', key: 'approved_at', width: 22 },
  ], d.accepted_period);
  sheet(wb, 'Loss requested (open)', [
    { header: 'Client', key: 'client', width: 16 }, { header: 'AWB', key: 'awb', width: 22 }, { header: 'Escalated', key: 'escalation_date' },
    { header: 'Aging', key: 'aging_days' }, { header: 'Hub / location', key: 'hub', width: 22 }, { header: 'Requested via', key: 'via', width: 16 },
    { header: 'Reason', key: 'reason', width: 36 }, { header: 'Requested on', key: 'requested_at', width: 22 },
  ], d.requested_open.map((r) => ({ ...r, via: viaLabel(r.requested_via) })));
  sheet(wb, 'Pending cases', [
    { header: 'Client', key: 'client_display_name', width: 16 }, { header: 'AWB', key: 'awb', width: 22 }, { header: 'Escalated', key: 'escalation_date' },
    { header: 'Aging', key: 'aging_days' }, { header: 'Status', key: 'status_label', width: 22 }, { header: 'Hub', key: 'hub', width: 22 },
    { header: 'Location', key: 'location', width: 14 }, { header: 'Shadowfax remark', key: 'team_remark', width: 34 }, { header: 'Agent', key: 'agent_display_name', width: 16 },
  ], pendingCases as unknown as Record<string, unknown>[]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** IST clock parts for the scheduler. */
export function istParts(now: Date): { date: string; hour: number; dow: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours(), dow: ist.getUTCDay() };
}

/** Which scheduled reports are due at this moment (before checking whether they were already sent). */
export function dueReports(
  now: Date,
  cfg: { dailyEnabled: boolean; dailyHour: number; weeklyEnabled: boolean; weeklyDay: number; weeklyHour: number; criticalEnabled?: boolean; criticalHour?: number },
): { type: 'daily_admin' | 'weekly_summary' | 'critical_alert'; periodKey: string; periodStart: string }[] {
  const t = istParts(now);
  const out: { type: 'daily_admin' | 'weekly_summary' | 'critical_alert'; periodKey: string; periodStart: string }[] = [];
  const startIso = `${t.date}T00:00:00+05:30`;
  if (cfg.dailyEnabled && t.hour >= cfg.dailyHour) out.push({ type: 'daily_admin', periodKey: t.date, periodStart: startIso });
  if (cfg.criticalEnabled && t.hour >= (cfg.criticalHour ?? 10)) out.push({ type: 'critical_alert', periodKey: `critical-${t.date}`, periodStart: startIso });
  if (cfg.weeklyEnabled && t.dow === cfg.weeklyDay && t.hour >= cfg.weeklyHour) out.push({ type: 'weekly_summary', periodKey: `week-${t.date}`, periodStart: startIso });
  return out;
}
