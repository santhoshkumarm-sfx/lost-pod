import ExcelJS from 'exceljs';
import { SOURCE_LABELS } from '../format';
import type { CaseExportRow, DailyReportData } from './types';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14223A' } };

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number; numFmt?: string }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle' };
  rows.forEach((r) => ws.addRow(r));
  columns.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

const d = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null);

export function caseRowForExport(c: CaseExportRow): Record<string, unknown> {
  return {
    case_number: c.case_number, awb: c.awb, client: c.client_display_name, source: SOURCE_LABELS[c.source_type] ?? c.source_type,
    source_ref: c.source_type === 'google_sheet' ? [c.source_workbook, c.source_sheet].filter(Boolean).join(' › ') : c.email_subject,
    escalation_date: d(c.escalation_date), estimated: c.escalation_date_estimated ? 'Yes' : '', aging_days: c.aging_days,
    aging_bucket: c.aging_bucket, status: c.status_label, sla_breached: c.sla_breached ? 'Yes' : '', hub: c.hub, location: c.location,
    delivery_date: d(c.delivery_date), seller_name: c.seller_name, complaint_type: c.complaint_type, reason: c.reason,
    priority: c.priority, pod_status: c.pod_status, pod_link: c.pod_link, team_remark: c.team_remark, client_remark: c.client_remark,
    agent: c.agent_display_name, poc: c.poc_name, product_name: c.product_name, product_value: c.product_value === null ? null : Number(c.product_value),
    closure_date: d(c.closure_date), final_aging_days: c.final_aging_days, lost_approved_at: d(c.lost_approved_at),
  };
}

export const CASE_SHEET_COLUMNS = [
  { header: 'Case #', key: 'case_number', width: 9 },
  { header: 'AWB', key: 'awb', width: 22 },
  { header: 'Client', key: 'client', width: 16 },
  { header: 'Source', key: 'source', width: 13 },
  { header: 'Source reference', key: 'source_ref', width: 34 },
  { header: 'Esc date', key: 'escalation_date', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Esc date estimated', key: 'estimated', width: 10 },
  { header: 'Aging (days)', key: 'aging_days', width: 10 },
  { header: 'Aging bucket', key: 'aging_bucket', width: 10 },
  { header: 'Status', key: 'status', width: 26 },
  { header: 'TAT breached', key: 'sla_breached', width: 10 },
  { header: 'Hub', key: 'hub', width: 22 },
  { header: 'Location', key: 'location', width: 14 },
  { header: 'Delivery date', key: 'delivery_date', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Seller', key: 'seller_name', width: 20 },
  { header: 'Complaint type', key: 'complaint_type', width: 18 },
  { header: 'Reason', key: 'reason', width: 30 },
  { header: 'Priority', key: 'priority', width: 9 },
  { header: 'POD status', key: 'pod_status', width: 11 },
  { header: 'POD link', key: 'pod_link', width: 30 },
  { header: 'Shadowfax remark', key: 'team_remark', width: 30 },
  { header: 'Client remark', key: 'client_remark', width: 30 },
  { header: 'Agent', key: 'agent', width: 16 },
  { header: 'Client POC', key: 'poc', width: 16 },
  { header: 'Product', key: 'product_name', width: 20 },
  { header: 'Product value', key: 'product_value', width: 12, numFmt: '#,##0' },
  { header: 'Closure date', key: 'closure_date', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Final aging', key: 'final_aging_days', width: 10 },
  { header: 'Lost approved', key: 'lost_approved_at', width: 16, numFmt: 'dd-mmm-yyyy hh:mm' },
];

/** The consolidated report attached to the daily email. */
export async function buildReportWorkbook(data: DailyReportData, cases: CaseExportRow[], agingOrder: 'asc' | 'desc'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lost / POD dashboard';
  wb.created = new Date();

  const s = data.summary;
  sheet(wb, 'Summary', [{ header: 'Measure', key: 'k', width: 30 }, { header: 'Value', key: 'v', width: 14 }], [
    { k: 'Report date', v: data.report_date },
    { k: 'Total cases', v: s.total_cases }, { k: 'Total open', v: s.total_open }, { k: 'New escalations (since yesterday)', v: s.new_escalations },
    { k: 'Pending', v: s.pending }, { k: 'Working on it', v: s.working_on_it }, { k: 'POD Shared', v: s.pod_shared },
    { k: 'Shipment at DC', v: s.shipment_at_dc }, { k: 'Shipment at Hub', v: s.shipment_at_hub },
    { k: 'Lost — pending approval', v: s.lost_pending }, { k: 'Lost', v: s.lost }, { k: 'Closed', v: s.closed },
    { k: 'TAT breached', v: s.tat_breached },
  ]);

  sheet(wb, 'Client-wise', [
    { header: 'Client', key: 'client', width: 18 }, { header: 'Total', key: 'total' }, { header: 'Open', key: 'open' },
    { header: 'Pending', key: 'pending' }, { header: 'Lost pending approval', key: 'lost_pending', width: 20 }, { header: 'Lost', key: 'lost' },
    { header: 'POD Shared', key: 'pod_shared' }, { header: 'Aging 0–7', key: 'aging_0_7' }, { header: '8–15', key: 'aging_8_15' },
    { header: '16–30', key: 'aging_16_30' }, { header: '30+', key: 'aging_30_plus' },
  ], data.client_wise);

  sheet(wb, 'Aging-wise', [{ header: 'Aging bucket (days)', key: 'label', width: 20 }, { header: 'Open cases', key: 'count' }], data.aging_wise);

  const days = Array.from({ length: 11 }, (_, i) => String(i + 1));
  const ordered = agingOrder === 'desc' ? [...days].reverse() : days;
  sheet(wb, 'Top 10 aging', [
    { header: 'Client', key: 'client', width: 18 },
    ...ordered.map((k) => ({ header: k === '11' ? '10+' : k, key: `d${k}`, width: 7 })),
    { header: 'Total', key: 'total' },
  ], data.top10_aging.map((r) => ({ client: r.client, total: r.total, ...Object.fromEntries(days.map((k) => [`d${k}`, r.by_day?.[k] ?? 0])) })));

  sheet(wb, 'Top 10 product value', [
    { header: 'Rank', key: 'rank', width: 6 }, { header: 'AWB', key: 'awb', width: 22 }, { header: 'Client', key: 'client', width: 16 },
    { header: 'Product name', key: 'product_name', width: 26 }, { header: 'Product value', key: 'product_value', width: 14, numFmt: '#,##0' },
    { header: 'Aging', key: 'aging_days' }, { header: 'Current status', key: 'status', width: 26 },
  ], data.top10_value);

  sheet(wb, 'Top 10 AWB count', [
    { header: 'Rank', key: 'rank', width: 6 }, { header: 'Client', key: 'client', width: 18 }, { header: 'AWB count', key: 'awb_count' },
    { header: 'Pending count', key: 'pending_count' }, { header: 'Lost count', key: 'lost_count' }, { header: 'Average aging', key: 'avg_aging' },
  ], data.top10_awb_count);

  const lost = cases.filter((c) => c.status_category === 'lost');
  sheet(wb, 'Lost (approved)', CASE_SHEET_COLUMNS, lost.map(caseRowForExport));
  sheet(wb, 'Pending Lost approval', [
    { header: 'Client', key: 'client', width: 16 }, { header: 'AWB', key: 'awb', width: 22 }, { header: 'Esc date', key: 'escalation_date', width: 12 },
    { header: 'Aging', key: 'aging_days' }, { header: 'Hub / location', key: 'hub', width: 22 }, { header: 'Requested by', key: 'requested_by', width: 18 },
    { header: 'Via', key: 'requested_via' }, { header: 'Reason', key: 'reason', width: 36 }, { header: 'Requested at', key: 'requested_at', width: 22 },
  ], data.pending_lost);
  sheet(wb, 'All cases', CASE_SHEET_COLUMNS, cases.map(caseRowForExport));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** Columns a client POC may download (no agent, internal source references or seller data). */
const PORTAL_KEYS = new Set(['awb', 'escalation_date', 'aging_days', 'aging_bucket', 'status', 'hub', 'location', 'delivery_date', 'complaint_type', 'reason', 'pod_status', 'pod_link', 'team_remark', 'client_remark', 'closure_date', 'final_aging_days', 'lost_approved_at']);
export const PORTAL_SHEET_COLUMNS = CASE_SHEET_COLUMNS.filter((c) => PORTAL_KEYS.has(c.key));

/** Generic table export (cases list, Lost list). */
export async function buildCasesWorkbook(title: string, cases: CaseExportRow[], columns = CASE_SHEET_COLUMNS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  sheet(wb, title.slice(0, 31), columns, cases.map(caseRowForExport));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCasesCsv(cases: CaseExportRow[], columns = CASE_SHEET_COLUMNS): string {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = cases.map((c) => {
    const r = caseRowForExport(c);
    return columns.map((col) => csvCell(r[col.key])).join(',');
  });
  return '\uFEFF' + [head, ...body].join('\r\n');
}
