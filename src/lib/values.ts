import 'server-only';
import ExcelJS from 'exceljs';
import { cleanAwb } from './normalize/awb';
import { normHeader } from './normalize/text';

/*
 * Product value and OTP delivered, per AWB. Download the AWBs that have no value, fill the two columns next
 * to the AWB, upload the file back. Only AWB is required; empty cells leave the stored value as it is.
 */

export interface ValueRow { row: number; awb: string; product_value?: string; otp_delivered?: boolean }
export interface ValueProblem { row: number; awb?: string; message: string }

const AWB = ['awb', 'awbno', 'awbnumber', 'trackingid', 'trackingnumber', 'waybill'];
const VALUE = ['productvalue', 'value', 'price', 'amount', 'declaredvalue', 'invoicevalue', 'productvaluers', 'productvalueinr'];
const OTP = ['otpdelivered', 'otp', 'deliveredwithotp', 'otpverified', 'otpdeliveredyesno'];

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

export function parseOtp(v: string): boolean | undefined {
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  if (['yes', 'y', 'true', '1', 'otp delivered', 'delivered with otp', 'otp verified'].includes(t)) return true;
  if (['no', 'n', 'false', '0', 'not otp', 'without otp'].includes(t)) return false;
  return undefined;
}

export async function parseValueUpload(buf: ArrayBuffer): Promise<{ rows: ValueRow[]; problems: ValueProblem[]; total: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.state === 'visible') ?? wb.worksheets[0];
  if (!ws) throw new Error('The file has no sheet.');
  let headerRow = 0;
  let cols = { awb: -1, value: -1, otp: -1 };
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const keys = (ws.getRow(r).values as ExcelJS.CellValue[]).map((v) => normHeader(cellText(v)));
    const find = (names: string[]) => names.map((n) => keys.indexOf(n)).find((i) => i >= 0) ?? -1;
    if (find(AWB) >= 0) {
      headerRow = r;
      cols = { awb: find(AWB), value: find(VALUE), otp: find(OTP) };
      break;
    }
  }
  if (!headerRow) throw new Error('No "AWB" column found in the first 10 rows.');
  if (cols.value < 0 && cols.otp < 0) throw new Error('No "Product value" or "OTP delivered" column found.');
  const rows: ValueRow[] = [];
  const problems: ValueProblem[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values as ExcelJS.CellValue[];
    const rawAwb = cellText(vals[cols.awb]);
    const rawValue = cols.value >= 0 ? cellText(vals[cols.value]).replace(/[,₹\s]|Rs\.?/gi, '') : '';
    const rawOtp = cols.otp >= 0 ? cellText(vals[cols.otp]) : '';
    if (!rawAwb && !rawValue && !rawOtp) continue;
    total++;
    const awb = cleanAwb(rawAwb);
    if (!awb) { problems.push({ row: r, awb: rawAwb, message: 'AWB missing or not valid' }); continue; }
    if (rawValue && !/^\d+(\.\d+)?$/.test(rawValue)) { problems.push({ row: r, awb, message: `Product value "${rawValue}" is not a number` }); continue; }
    const otp = parseOtp(rawOtp);
    if (rawOtp && otp === undefined) { problems.push({ row: r, awb, message: `OTP delivered "${rawOtp}" should be Yes or No` }); continue; }
    if (!rawValue && otp === undefined) continue;   // nothing filled in for this AWB
    if (seen.has(awb)) { problems.push({ row: r, awb, message: 'Same AWB again — the first row was used' }); continue; }
    seen.add(awb);
    rows.push({ row: r, awb, ...(rawValue ? { product_value: rawValue } : {}), ...(otp !== undefined ? { otp_delivered: otp } : {}) });
  }
  return { rows, problems, total };
}

export interface MissingValueRow {
  escalation_date: string; client_display_name: string | null; awb: string; final_value: number | null; otp_delivered: boolean | null;
  status_label: string; hub: string | null; location: string | null; aging_days: number;
}

/** The download: one row per AWB, "Product value" and "OTP delivered" right next to the AWB, ready to fill in. */
export async function buildValuesXlsx(rows: MissingValueRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Product value', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 }, { header: 'Client', key: 'client', width: 18 }, { header: 'AWB', key: 'awb', width: 22 },
    { header: 'Product value', key: 'value', width: 14 }, { header: 'OTP delivered', key: 'otp', width: 14 },
    { header: 'Status', key: 'status', width: 22 }, { header: 'Hub / location', key: 'hub', width: 22 }, { header: 'Days', key: 'days', width: 8 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14223A' } };
  for (const c of ['D1', 'E1']) ws.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5FBF' } };
  for (const r of rows) {
    ws.addRow({
      date: r.escalation_date ? new Date(`${r.escalation_date}T00:00:00Z`) : null, client: r.client_display_name, awb: r.awb,
      value: r.final_value == null ? null : Number(r.final_value), otp: r.otp_delivered == null ? '' : r.otp_delivered ? 'Yes' : 'No',
      status: r.status_label, hub: r.hub ?? r.location, days: r.aging_days,
    });
  }
  ws.getColumn('date').numFmt = 'dd-mm-yyyy';
  ws.getColumn('value').numFmt = '#,##0.00';
  const last = Math.max(rows.length + 1, 2);
  for (let i = 2; i <= last; i++) {
    ws.getCell(`E${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
    ws.getCell(`D${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
    ws.getCell(`E${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
