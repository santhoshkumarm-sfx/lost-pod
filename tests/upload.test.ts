import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildUploadTemplate, parseUpload } from '@/lib/cases/upload';

const clients = [{ id: 'c-vel', name: 'Velocity', aliases: ['Velocity Express'], email_domains: [] }];

async function fileFrom(rows: unknown[][], headers?: string[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pending cases');
  ws.addRow(headers ?? ['AWB *', 'Escalation date *', 'Client', 'Hub', 'Reason', 'Product value', 'Priority']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('pending cases Excel', () => {
  it('template has the fixed headers (no Client column for clients)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildUploadTemplate(true, '2026-10-07')) as unknown as ArrayBuffer);
    const head = (wb.getWorksheet('Pending cases')!.getRow(1).values as string[]).filter(Boolean);
    expect(head.slice(0, 2)).toEqual(['AWB *', 'Escalation date *']);
    expect(head).not.toContain('Client');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await buildUploadTemplate(false, '2026-10-07')) as unknown as ArrayBuffer);
    expect(wb2.getWorksheet('Pending cases')!.getRow(1).values).toContain('Client');
  });
  it('reads rows, dates in several formats, clients, and reports bad rows', async () => {
    const buf = await fileFrom([
      ['SF1234567890ABC', '07-10-2026'],                                   // template example → ignored
      ['sf3159783852kac', '05-10-2026', 'velocity express', 'HAR_Pataudi_FM', 'Not received', '₹1,299', 'urgent'],
      ['R2466544662BDM', new Date(Date.UTC(2026, 9, 1)), 'Velocity'],
      ['R2466544662BDM', '01-10-2026', 'Velocity'],                        // duplicate in file
      ['BAD', '01-10-2026'],                                               // bad AWB
      ['SF9000000009KAC', '31-12-2026'],                                   // future
      ['SF9000000010KAC', '02-10-2026', 'Unknown Co'],                     // unknown client
      [],                                                                  // blank
    ]);
    const r = await parseUpload(buf, { forClient: false, clients, today: '2026-10-07' });
    expect(r.total).toBe(6);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ awb: 'SF3159783852KAC', escalation_date: '2026-10-05', client_id: 'c-vel', hub: 'HAR_Pataudi_FM', product_value: '1299', priority: 'High' });
    expect(r.rows[1]).toMatchObject({ awb: 'R2466544662BDM', escalation_date: '2026-10-01' });
    expect(r.problems.map((p) => p.message)).toEqual([
      'Same AWB appears twice in the file', 'AWB is not valid', 'Escalation date is in the future', 'Unknown client "Unknown Co"',
    ]);
  });
  it('refuses files without the fixed headers', async () => {
    await expect(parseUpload(await fileFrom([['x']], ['Tracking no', 'Date']), { forClient: true, clients: [], today: '2026-10-07' }))
      .rejects.toThrow(/Missing columns: AWB, Escalation date/);
    await expect(parseUpload(Buffer.from('hello'), { forClient: true, clients: [], today: '2026-10-07' })).rejects.toThrow(/not an Excel/);
  });
});
