import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderDailyReportHtml } from '@/lib/reports/html';
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

describe('daily report email', () => {
  const html = renderDailyReportHtml(data, { agingOrder: 'asc', lostDays: 30, attachmentName: 'lost-pod-report-2026-10-03.xlsx', siteUrl: 'https://x.test' });
  it('puts the three Top 10 tables before the attachment note', () => {
    const at = html.indexOf('Attached:');
    for (const t of ['Top 10 aging', 'Top 10 — highest product value', 'Top 10 — highest AWB count']) {
      expect(html.indexOf(t)).toBeGreaterThan(0);
      expect(html.indexOf(t)).toBeLessThan(at);
    }
  });
  it('orders aging columns 1 → 10+ or the reverse', () => {
    const cols = (h: string) => h.slice(h.indexOf('Top 10 aging'), h.indexOf('highest product value')).match(/>(10\+|[1-9]|10)</g)!.slice(0, 11).join('');
    expect(cols(html)).toBe('>1<>2<>3<>4<>5<>6<>7<>8<>9<>10<>10+<');
    const desc = renderDailyReportHtml(data, { agingOrder: 'desc', lostDays: 30, attachmentName: null, siteUrl: 'https://x.test' });
    expect(cols(desc)).toBe('>10+<>10<>9<>8<>7<>6<>5<>4<>3<>2<>1<');
  });
  it('shows Lost aging from escalation to approval and escapes text', () => {
    expect(html).toContain('R2178493750VEO');
    expect(html).toContain('>19<');
    expect(html).not.toContain('<b>x</b>');
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
