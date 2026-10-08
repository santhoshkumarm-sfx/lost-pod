import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWeeklyWorkbook, dueReports, istParts, renderWeeklyReportHtml, weeklySubject, type WeeklyReportData } from '@/lib/reports/weekly-html';

const data: WeeklyReportData = {
  generated_at: '2026-10-05T03:30:00Z',
  period_from: '2026-09-29',
  period_to: '2026-10-05',
  summary: { pending: 120, lost_requested: 14, loss_accepted_total: 300, loss_accepted_period: 9, new_period: 40, closed_period: 22 },
  client_wise: [
    { client: 'Velocity', pending: 80, lost_requested: 10, loss_accepted_period: 6, loss_accepted_total: 200, avg_pending_aging: 12.5 },
    { client: 'Quiet', pending: 0, lost_requested: 0, loss_accepted_period: 0, loss_accepted_total: 5, avg_pending_aging: null },
  ],
  accepted_period: [{ client: 'Velocity', awb: 'R2178493750VEO', escalation_date: '2026-08-01', aging_days: 65, hub: 'ST_Godadara', reason: '<script>x</script>', final_remark: null, approved_at: '2026-10-02T06:00:00Z' }],
  requested_open: Array.from({ length: 130 }, (_, i) => ({ client: 'Naaptol', awb: `SF${1000 + i}NAP`, escalation_date: '2026-09-01', aging_days: 34, hub: null, reason: 'Not traced', requested_at: '2026-10-01T06:00:00Z', requested_via: 'poc_portal' })),
};

describe('weekly summary', () => {
  const html = renderWeeklyReportHtml(data, { siteUrl: 'https://x.test', attachmentName: 'lost-pod-weekly-2026-10-05.xlsx' });
  it('leads with pending, loss requested and loss accepted', () => {
    expect(html.indexOf('Pending (open)')).toBeLessThan(html.indexOf('Loss requested'));
    expect(html).toContain('>120<');
    expect(html).toContain('>14<');
    expect(weeklySubject(data)).toContain('120 pending, 14 loss requested, 9 loss accepted');
  });
  it('hides idle clients, escapes text and caps long lists in the body', () => {
    expect(html).not.toContain('>Quiet<');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('Showing 100 of 130');
    expect(html).toContain('Client portal');
  });
  it('builds the attachment with every row', async () => {
    const buf = await buildWeeklyWorkbook(data, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Client-wise', 'Loss accepted (week)', 'Loss requested (open)', 'Pending cases']);
    expect(wb.getWorksheet('Loss requested (open)')!.rowCount).toBe(131);
  });
});

describe('report schedule (IST)', () => {
  const cfg = { dailyEnabled: true, dailyHour: 9, weeklyEnabled: true, weeklyDay: 1, weeklyHour: 9 };
  it('converts to IST', () => {
    expect(istParts(new Date('2026-10-04T20:00:00Z'))).toEqual({ date: '2026-10-05', hour: 1, dow: 1 });
  });
  it('sends the daily report from its hour onwards, and the weekly one only on its day', () => {
    expect(dueReports(new Date('2026-10-05T03:00:00Z'), cfg)).toEqual([]); // 08:30 IST Monday
    const due = dueReports(new Date('2026-10-05T03:30:00Z'), cfg); // 09:00 IST Monday
    expect(due.map((d) => d.type)).toEqual(['daily_admin', 'weekly_summary']);
    expect(due[1].periodStart).toBe('2026-10-05T00:00:00+05:30');
    expect(dueReports(new Date('2026-10-06T05:00:00Z'), cfg).map((d) => d.type)).toEqual(['daily_admin']); // Tuesday
    expect(dueReports(new Date('2026-10-05T05:00:00Z'), { ...cfg, dailyEnabled: false, weeklyEnabled: false })).toEqual([]);
    const withCritical = { ...cfg, criticalEnabled: true, criticalHour: 9 };
    expect(dueReports(new Date('2026-10-06T03:30:00Z'), withCritical).map((d) => d.type)).toEqual(['daily_admin', 'critical_alert']);
    expect(dueReports(new Date('2026-10-06T03:00:00Z'), withCritical)).toEqual([]);
  });
});

import { renderCriticalHtml, criticalSubject, type CriticalRow } from '@/lib/reports/critical-html';
describe('daily critical alert', () => {
  const rows: CriticalRow[] = Array.from({ length: 205 }, (_, i) => ({
    awb: `SF${1000 + i}KAC`, client_display_name: i % 2 ? 'Kartrocket' : 'Velocity', escalation_date: '2026-09-01', aging_days: 8 + (i % 30),
    status_label: 'Pending', hub: 'HAR_Pataudi_FM', location: null, agent_display_name: i % 3 ? 'Assem Khan' : null, assigned_agent: null, team_remark: '<b>x</b>',
  }));
  it('summarises by client and agent and caps the list', () => {
    const html = renderCriticalHtml(rows, { days: 7, siteUrl: 'https://x.test', attachmentName: 'c.xlsx' });
    expect(html).toContain('By client');
    expect(html).toContain('Unassigned');
    expect(html).toContain('Showing 200 of 205');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('>205<');
    expect(criticalSubject(rows, 7)).toContain('205 shipments over 7 days');
  });
  it('agent version is personal and has no agent column', () => {
    const html = renderCriticalHtml(rows.slice(0, 3), { days: 7, siteUrl: 'https://x.test', forAgent: 'Assem' });
    expect(html).toContain('Assem, these shipments need a POD');
    expect(html).not.toContain('By agent');
  });
});
