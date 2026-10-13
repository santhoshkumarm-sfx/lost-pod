import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { mailTable, reportRows, statsEmailHtml } from '@/lib/reports/pivot-html';
import type { CaseExportRow, DailyReportData } from '@/lib/reports/types';
import { buildCasesCsv, buildReportWorkbook, PORTAL_SHEET_COLUMNS } from '@/lib/reports/xlsx';

const data: DailyReportData = {
  generated_at: '2026-10-03T03:30:00Z',
  report_date: '2026-10-03',
  summary: { total_cases: 11, total_open: 9, new_escalations: 3, pending: 4, working_on_it: 2, pod_shared: 2, shipment_at_dc: 0, shipment_at_hub: 0, lost_pending: 1, lost: 1, closed: 1, tat_breached: 5 },
  client_wise: [{ client: 'Velocity', total: 8, open: 7, pending: 4, lost_pending: 1, lost: 1, pod_shared: 1, aging_0_7: 4, aging_8_15: 0, aging_16_30: 2, aging_30_plus: 1 }],
  aging_wise: [{ label: '0–2', count: 3 }, { label: '90+', count: 0 }],
  top10_aging: [{ client: 'Velocity', total: 7, by_day: { '1': 3, '3': 1, '11': 3 } }],
  top10_value: [{ rank: 1, awb: 'SF3583535088VEO', client: 'Velocity', product_name: null, product_value: 24999, aging_days: 18, status: 'Working on it' }],
  top10_awb_count: [{ rank: 1, client: 'Velocity', awb_count: 8, pending_count: 7, lost_count: 1, avg_aging: 12 }],
  lost_cases: [{ client: 'Velocity', awb: 'R2178493750VEO', escalation_date: '2026-08-01', aging_days: 19, hub: 'ST_Godadara_RTS', reason: null, final_remark: '<b>x</b>', approved_at: '2026-08-20T06:00:00Z' }],
  lost_total: 1,
  pending_lost: [],
  pending_lost_total: 0,
};

describe('report email tables', () => {
  const stats = {
    critical_days: 7, total: 3, pending: 2, critical: 1, pod_shared: 1, closed: 0, lost_pending: 0, lost: 0, new_today: 0,
    value: { total: 1500, pending: 1200, critical: 200, pod_shared: 300, lost_pending: 0, lost: 0, pending_no_value: 0 },
    pending_age: [{ label: '1', min: 0, max: 1, count: 1, value: 1000 }, { label: '8–10', min: 8, max: 10, count: 1, value: 200 }],
    by_client: [{ client_id: 'c', client: 'A <b>', total: 3, age: [1, 1], age_value: [1000, 200], pending: 2, critical: 1, pod_shared: 1, lost_pending: 0, lost: 0, oldest: 9,
      total_value: 1500, pending_value: 1200, critical_value: 200, pod_shared_value: 300, lost_pending_value: 0, lost_value: 0 }],
    by_hub: [{ hub: 'DEL_X', city: 'Delhi', pending: 2, pending_value: 1200, critical: 1, age: [1, 1], age_value: [1000, 200] }],
    hub_loss: [],
    by_agent: [],
    agent_loss: [{ agent_id: null, agent: 'Assem', lost: 2, lost_value: 5000, lost_pending: 0, lost_pending_value: 0 }],
  };
  const html = statsEmailHtml(stats, { intro: 'x', footer: 'y' });
  it('has separate AWB and product value tables, numbered, with full numbers', () => {
    expect(html).toContain('1. POD pending (₹)');
    expect(html).toContain('2. POD pending (AWBs)');
    expect(html).toContain('3. POD accepted lost — client wise (₹)');
    expect(html).toContain('6. Top 15 hubs — POD pending (AWBs)');
    expect(html).toContain('8. Top 15 clients — POD pending (AWBs)');
    expect(html).toContain('12. POD accepted lost — agent wise (AWBs)');
    expect(html).toContain('>5,000<');
    expect(html).toContain('>1,000<');
    expect(html).toContain('Total 1–7 days');
    expect(html).not.toContain('A <b>');
  });
  it('sorts each table by its own measure, largest first', () => {
    const two = { ...stats, by_client: [
      { ...stats.by_client[0], client: 'Big value', pending: 1, pending_value: 9000 },
      { ...stats.by_client[0], client: 'Many AWBs', pending: 50, pending_value: 10 },
    ] };
    const r = reportRows(two as never);
    expect(r.clientsV.map((c) => c.client)).toEqual(['Big value', 'Many AWBs']);
    expect(r.clientsA.map((c) => c.client)).toEqual(['Many AWBs', 'Big value']);
  });
  it('keeps Critical out of the Total', () => {
    const t = mailTable({ title: 't', labels: ['r'], columns: ['a', 'b'], rows: [{ labels: ['x'], cells: [2, 1] }], notInTotal: [1] });
    expect(t).toContain('<td align="center"><b>2</b></td></tr>');
  });
  it('stays small with many clients', () => {
    const wide = { ...stats, pending_age: Array.from({ length: 13 }, (_, i) => ({ label: String(i + 1), min: i, max: i, count: 1, value: 123456 })) };
    const row = { ...stats.by_client[0], age: Array(13).fill(12), age_value: Array(13).fill(123456) };
    const many = { ...wide, by_client: Array.from({ length: 40 }, (_, i) => ({ ...row, client: `Client ${i}` })),
      by_hub: Array.from({ length: 20 }, (_, i) => ({ ...stats.by_hub[0], hub: `H${i}`, age: Array(13).fill(3), age_value: Array(13).fill(999) })),
      by_agent: Array.from({ length: 15 }, (_, i) => ({ agent_id: null, agent: `Agent ${i}`, pending: 1, critical: 1, oldest: 1, age: Array(13).fill(3), age_value: Array(13).fill(999), pending_value: 1 })) };
    expect(statsEmailHtml(many, { intro: '', footer: '' }).length).toBeLessThan(120_000);
  });
});

const row: CaseExportRow = {
  case_number: 1, awb: 'R2466544662BDM', client_display_name: 'Velocity', source_type: 'email', source_workbook: null, source_sheet: null,
  email_subject: 'POD needed', escalation_date: '2026-09-11', escalation_date_estimated: false, aging_days: 22, aging_bucket: '16–30',
  status_label: 'Pending', status_category: 'open', hub: null, location: 'Bangalore', delivery_date: null, seller_name: 'Secret seller',
  complaint_type: 'POD request', reason: 'Please provide POD', priority: 'Normal', pod_status: 'pending', pod_link: null,
  team_remark: 'a, "quoted" remark', client_remark: null, agent_display_name: 'Assem Khan', poc_name: null, product_name: null,
  product_value: 1200, closure_date: null, final_aging_days: null, lost_approved_at: null, sla_breached: true,
};

describe('exports', () => {
  it('builds the consolidated workbook', async () => {
    const buf = await buildReportWorkbook(data, [row], 'asc');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary', 'Client-wise', 'Aging-wise', 'Top 10 aging', 'Top 10 product value', 'Top 10 AWB count', 'Lost (approved)', 'Pending Lost approval', 'All cases',
    ]);
    expect(wb.getWorksheet('All cases')!.getRow(2).getCell(2).value).toBe('R2466544662BDM');
  });
  it('quotes CSV cells and hides internal columns from POCs', () => {
    const csv = buildCasesCsv([row]);
    expect(csv).toContain('"a, ""quoted"" remark"');
    expect(csv).toContain('Assem Khan');
    const portal = buildCasesCsv([row], PORTAL_SHEET_COLUMNS);
    expect(portal).not.toContain('Assem Khan');
    expect(portal).not.toContain('Secret seller');
  });
});
