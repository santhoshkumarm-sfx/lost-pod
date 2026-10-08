import ExcelJS from 'exceljs';
import { cleanAwb } from '../normalize/awb';
import { resolveClient, type ClientLite } from '../normalize/clients';
import { parseDate } from '../normalize/dates';
import { normHeader } from '../normalize/text';

/** Fixed columns of the "add pending cases" Excel. Order does not matter; the header text does. */
export const UPLOAD_COLUMNS = [
  { key: 'awb', header: 'AWB', required: true, width: 22, note: 'One AWB per row' },
  { key: 'escalation_date', header: 'Escalation date', required: true, width: 16, note: 'DD-MM-YYYY, e.g. 07-10-2026' },
  { key: 'client', header: 'Client', required: false, width: 16, note: 'Client name as in the dashboard (internal team only)', internalOnly: true },
  { key: 'hub', header: 'Hub', required: false, width: 22, note: 'e.g. DEL_KirtiNagar_RTS' },
  { key: 'location', header: 'Location', required: false, width: 14, note: 'City' },
  { key: 'delivery_date', header: 'Delivery date', required: false, width: 14, note: 'DD-MM-YYYY' },
  { key: 'seller_name', header: 'Seller name', required: false, width: 18, note: '' },
  { key: 'order_id', header: 'Order ID', required: false, width: 16, note: '' },
  { key: 'product_name', header: 'Product name', required: false, width: 20, note: '' },
  { key: 'product_value', header: 'Product value', required: false, width: 14, note: 'Number, in rupees' },
  { key: 'complaint_type', header: 'Complaint type', required: false, width: 18, note: 'e.g. POD request, Fake delivery / not received' },
  { key: 'reason', header: 'Reason', required: false, width: 24, note: 'Why the POD is needed' },
  { key: 'priority', header: 'Priority', required: false, width: 10, note: 'Normal or High' },
  { key: 'remark', header: 'Remark', required: false, width: 30, note: 'Anything else' },
] as const;

export type UploadKey = (typeof UPLOAD_COLUMNS)[number]['key'];
export interface UploadRow { row: number; awb: string; escalation_date: string; client_id?: string; [k: string]: string | number | undefined }
export interface UploadProblem { row: number; awb?: string; message: string }

const columnsFor = (forClient: boolean) => UPLOAD_COLUMNS.filter((c) => !(forClient && 'internalOnly' in c && c.internalOnly));

/** The template people download, fill in and upload again. */
export async function buildUploadTemplate(forClient: boolean, today: string): Promise<Buffer> {
  const cols = columnsFor(forClient);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pending cases', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14223A' } };
  const [y, m, d] = today.split('-');
  ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.key === 'awb' ? 'SF1234567890ABC' : c.key === 'escalation_date' ? `${d}-${m}-${y}` : c.key === 'priority' ? 'Normal' : c.key === 'client' ? 'Velocity' : ''])));
  ws.getRow(2).font = { italic: true, color: { argb: 'FF7B8594' } };
  ws.getColumn(2).numFmt = '@';
  const help = wb.addWorksheet('How to fill');
  help.columns = [{ header: 'Column', key: 'h', width: 20 }, { header: 'Required', key: 'r', width: 10 }, { header: 'What to enter', key: 'n', width: 60 }];
  help.getRow(1).font = { bold: true };
  cols.forEach((c) => help.addRow({ h: c.header, r: c.required ? 'Yes' : '', n: c.note }));
  help.addRow({});
  help.addRow({ h: 'Notes', n: 'Keep the header row as it is. Delete the grey example row. Up to 5,000 rows per file.' });
  help.addRow({ n: 'AWBs that are already open are skipped and listed after the upload.' });
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? v.hyperlink);
  }
  return String(v).trim();
};

/**
 * Reads the uploaded Excel. Header text must match the template (case, spaces and "*" ignored).
 * Returns valid rows and one problem line per row that cannot be used.
 */
export async function parseUpload(
  buf: ArrayBuffer | Buffer,
  opts: { forClient: boolean; clients: ClientLite[]; today: string },
): Promise<{ rows: UploadRow[]; problems: UploadProblem[]; total: number }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    throw new Error('This is not an Excel (.xlsx) file. Download the template and fill that in.');
  }
  const ws = wb.worksheets.find((w) => w.name === 'Pending cases') ?? wb.worksheets[0];
  if (!ws) throw new Error('The file has no sheets.');
  const cols = columnsFor(opts.forClient);
  const want = new Map(cols.map((c) => [normHeader(c.header), c.key as string]));
  const at = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const k = want.get(normHeader(cellText(cell.value).replace(/\*/g, '')));
    if (k && !at.has(k)) at.set(k, col);
  });
  const missing = cols.filter((c) => c.required && !at.has(c.key)).map((c) => c.header);
  if (missing.length) throw new Error(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the template's header row unchanged.`);

  const rows: UploadRow[] = [];
  const problems: UploadProblem[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k: string) => (at.has(k) ? cellText(row.getCell(at.get(k)!).value) : '');
    const rawAwb = get('awb');
    if (!rawAwb && !get('escalation_date')) continue; // blank line
    if (rawAwb === 'SF1234567890ABC') continue;      // template example
    total++;
    const awb = cleanAwb(rawAwb);
    if (!awb) { problems.push({ row: r, awb: rawAwb, message: 'AWB is not valid' }); continue; }
    if (seen.has(awb)) { problems.push({ row: r, awb, message: 'Same AWB appears twice in the file' }); continue; }
    const esc = parseDate(get('escalation_date'), 'DMY', opts.today);
    if (!esc) { problems.push({ row: r, awb, message: 'Escalation date missing or not readable (use DD-MM-YYYY)' }); continue; }
    if (esc.iso > opts.today) { problems.push({ row: r, awb, message: 'Escalation date is in the future' }); continue; }
    const out: UploadRow = { row: r, awb, escalation_date: esc.iso };
    if (!opts.forClient && get('client')) {
      const c = resolveClient(get('client'), opts.clients);
      if (!c) { problems.push({ row: r, awb, message: `Unknown client "${get('client')}"` }); continue; }
      out.client_id = c.id;
    }
    const del = get('delivery_date') ? parseDate(get('delivery_date'), 'DMY', opts.today) : null;
    if (del) out.delivery_date = del.iso;
    for (const k of ['hub', 'location', 'seller_name', 'order_id', 'product_name', 'complaint_type', 'reason', 'remark']) {
      const v = get(k);
      if (v) out[k] = v.slice(0, 500);
    }
    const pv = get('product_value').replace(/[,₹\s]/g, '');
    if (pv && /^\d+(\.\d+)?$/.test(pv)) out.product_value = pv;
    const pr = get('priority');
    if (pr) out.priority = /high|urgent/i.test(pr) ? 'High' : 'Normal';
    seen.add(awb);
    rows.push(out);
  }
  if (total > 5000) throw new Error('At most 5,000 rows per file. Split it into smaller files.');
  return { rows, problems, total };
}
