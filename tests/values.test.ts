import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { splitAwbCell } from '@/lib/pod/sheets';
import { parseOtp, parseValueUpload } from '@/lib/values';

async function book(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('x');
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe('product value / OTP upload', () => {
  it('reads AWB, value and OTP in any column order and skips empty rows', async () => {
    const out = await parseValueUpload(await book([
      ['OTP delivered', 'Client', 'AWB', 'Product Value'],
      ['Yes', 'Velocity', 'sf123456789veo', '₹1,250.50'],
      ['', 'Velocity', 'R2000000001VEO', ''],
      ['no', '', 'R2000000002VEO', 99],
      ['maybe', '', 'R2000000003VEO', ''],
      ['', '', 'bad', '10'],
      ['', '', 'SF123456789VEO', '5'],
    ]));
    expect(out.rows).toEqual([
      { row: 2, awb: 'SF123456789VEO', product_value: '1250.50', otp_delivered: true },
      { row: 4, awb: 'R2000000002VEO', product_value: '99', otp_delivered: false },
    ]);
    expect(out.problems.map((p) => p.message)).toEqual([
      'OTP delivered "maybe" should be Yes or No', 'AWB missing or not valid', 'Same AWB again — the first row was used',
    ]);
  });
  it('explains a file without the needed columns', async () => {
    await expect(parseValueUpload(await book([['Tracking', 'Price']]))).rejects.toThrow('No "AWB" column');
    await expect(parseValueUpload(await book([['AWB', 'Client']]))).rejects.toThrow('No "Product value" or "OTP delivered"');
  });
  it('understands yes / no wording', () => {
    expect([parseOtp('Y'), parseOtp('Delivered with OTP'), parseOtp('0'), parseOtp(''), parseOtp('later')]).toEqual([true, true, false, undefined, undefined]);
  });
});

describe('POD sheets', () => {
  it('splits a cell with several AWBs', () => {
    expect(splitAwbCell('SF3694465584N, SF3694239738N,SF3694465584N / R2400767189WAI')).toEqual(['SF3694465584N', 'SF3694239738N', 'R2400767189WAI']);
    expect(splitAwbCell('')).toEqual([]);
  });
});
