import 'server-only';
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PodStats } from '../cases/filters';
import { reportRows } from './pivot-html';

const HEAD = 'FF14223A';
const TEAL = 'FF1D4250';

function header(ws: ExcelJS.Worksheet, row: number, teal = false) {
  const r = ws.getRow(row);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: teal ? TEAL : HEAD } }; c.alignment = { horizontal: 'center' }; });
}

/** The dashboard tables in one sheet, same order and numbers (each as ₹ first, then AWBs, largest first). */
export async function dashboardXlsx(s: PodStats): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'POD lost';
  const ws = wb.addWorksheet('POD lost');
  ws.getColumn(1).width = 26;
  for (let i = 2; i <= 20; i++) ws.getColumn(i).width = 12;
  const r = reportRows(s);
  const ages = s.pending_age.map((b) => b.label);
  let n = 0;
  const table = (title: string, labels: string[], cols: string[], rows: { labels: (string | null)[]; cells: number[] }[], opts: { total?: boolean; teal?: boolean; foot?: boolean } = {}) => {
    n++;
    const t = ws.addRow([`${n}. ${title}`]);
    t.font = { bold: true, size: 12 };
    const h = ws.addRow([...labels, ...cols, ...(opts.total === false ? [] : ['Total'])]);
    header(ws, h.number, opts.teal);
    for (const x of rows) {
      const row = ws.addRow([...x.labels.map((l) => l ?? '—'), ...x.cells, ...(opts.total === false ? [] : [x.cells.reduce((a, b) => a + (Number(b) || 0), 0)])]);
      row.eachCell((c, i) => { if (i > labels.length) c.numFmt = '#,##0'; });
    }
    if (rows.length && opts.foot !== false) {
      const sums = cols.map((_, i) => rows.reduce((a, x) => a + (Number(x.cells[i]) || 0), 0));
      const f = ws.addRow(['Total', ...labels.slice(1).map(() => ''), ...sums, ...(opts.total === false ? [] : [sums.reduce((a, b) => a + b, 0)])]);
      f.font = { bold: true };
      f.eachCell((c, i) => { if (i > labels.length) c.numFmt = '#,##0'; });
    }
    ws.addRow([]);
  };
  const age = (title: string, labels: string[], rows: { labels: (string | null)[]; cells: number[] }[], teal: boolean) => table(title, labels, ages, rows, { teal });
  const one = { total: false } as const;
  table('POD pending (₹)', [''], ages, [{ labels: ['Product value (₹)'], cells: s.pending_age.map((b) => Number(b.value)) }], { foot: false, teal: true });
  table('POD pending (AWBs)', [''], ages, [{ labels: ['AWBs'], cells: s.pending_age.map((b) => b.count) }], { foot: false });
  table('POD accepted lost — client wise (₹)', ['Client'], ['Loss accepted (₹)'], r.lostClientsV.map((c) => ({ labels: [c.client], cells: [Number(c.lost_value)] })), { ...one, teal: true });
  table('POD accepted lost — client wise (AWBs)', ['Client'], ['Loss accepted (AWBs)'], r.lostClientsA.map((c) => ({ labels: [c.client], cells: [c.lost] })), one);
  age('Top 15 hubs — POD pending (₹)', ['Hub', 'City'], r.hubsV.map((h) => ({ labels: [h.hub, h.city], cells: h.age_value.map(Number) })), true);
  age('Top 15 hubs — POD pending (AWBs)', ['Hub', 'City'], r.hubsA.map((h) => ({ labels: [h.hub, h.city], cells: h.age })), false);
  age('Top 15 clients — POD pending (₹)', ['Client'], r.clientsV.map((c) => ({ labels: [c.client], cells: c.age_value.map(Number) })), true);
  age('Top 15 clients — POD pending (AWBs)', ['Client'], r.clientsA.map((c) => ({ labels: [c.client], cells: c.age })), false);
  age('POD pending — agent wise (₹)', ['Agent'], r.agentsV.map((a) => ({ labels: [a.agent], cells: a.age_value.map(Number) })), true);
  age('POD pending — agent wise (AWBs)', ['Agent'], r.agentsA.map((a) => ({ labels: [a.agent], cells: a.age })), false);
  table('POD accepted lost — agent wise (₹)', ['Agent'], ['Loss accepted (₹)'], r.lostAgentsV.map((a) => ({ labels: [a.agent], cells: [Number(a.lost_value)] })), { ...one, teal: true });
  table('POD accepted lost — agent wise (AWBs)', ['Agent'], ['Loss accepted (AWBs)'], r.lostAgentsA.map((a) => ({ labels: [a.agent], cells: [a.lost] })), one);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

interface Approval {
  case_id: string; request_id: string | null; requested_by: string | null; requested_via: string; requested_at: string;
  request_reason: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null;
}
interface CaseInfo { id: string; awb: string; client_display_name: string | null; final_value: number | null; escalation_date: string; aging_days: number; hub: string | null; location: string | null }

const VIA: Record<string, string> = { app: 'Shadowfax team', poc_portal: 'Client portal', google_sheet: 'Client tracker', email: 'Email', auto: 'Automatic (POD not shared in time)' };

/** Loss accepted, one row per AWB: value, who requested, who accepted. Uses the caller's access (RLS). */
export async function lossAcceptedXlsx(sb: SupabaseClient, o: { from?: string | null; to?: string | null; status?: 'approved' | 'pending' }): Promise<Buffer> {
  const approved = (o.status ?? 'approved') === 'approved';
  const rows: Approval[] = [];
  for (let off = 0; ; off += 1000) {
    let q = sb.from('lost_approvals').select('case_id, request_id, requested_by, requested_via, requested_at, request_reason, decided_by, decided_at, decision_note')
      .eq('status', approved ? 'approved' : 'pending').order(approved ? 'decided_at' : 'requested_at', { ascending: false });
    const col = approved ? 'decided_at' : 'requested_at';
    if (o.from) q = q.gte(col, `${o.from}T00:00:00+05:30`);
    if (o.to) q = q.lte(col, `${o.to}T23:59:59+05:30`);
    const { data, error } = await q.range(off, off + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Approval[]));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(rows.map((r) => r.case_id))];
  const cases = new Map<string, CaseInfo>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('v_cases').select('id, awb, client_display_name, final_value, escalation_date, aging_days, hub, location').in('id', ids.slice(i, i + 200));
    for (const c of (data ?? []) as CaseInfo[]) cases.set(c.id, c);
  }
  const people = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (let i = 0; i < people.length; i += 200) {
    const { data } = await sb.from('profiles').select('id, full_name, email').in('id', people.slice(i, i + 200));
    for (const p of (data ?? []) as { id: string; full_name: string | null; email: string }[]) names.set(p.id, p.full_name ?? p.email);
  }
  const reqIds = [...new Set(rows.map((r) => r.request_id).filter((x): x is string => !!x))];
  const lr = new Map<string, number>();
  for (let i = 0; i < reqIds.length; i += 200) {
    const { data } = await sb.from('lost_requests').select('id, request_number').in('id', reqIds.slice(i, i + 200));
    for (const x of (data ?? []) as { id: string; request_number: number }[]) lr.set(x.id, x.request_number);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'POD lost';
  const ws = wb.addWorksheet(approved ? 'Loss accepted' : 'Loss requested', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: approved ? 'Accepted on' : 'Requested on', key: 'on', width: 18 },
    { header: 'Client', key: 'client', width: 18 },
    { header: 'AWB', key: 'awb', width: 22 },
    { header: 'Product value (₹)', key: 'value', width: 16 },
    { header: 'Escalated on', key: 'esc', width: 13 },
    { header: 'Lost aging (days)', key: 'age', width: 14 },
    { header: 'Hub', key: 'hub', width: 22 },
    { header: 'Request', key: 'lr', width: 10 },
    { header: 'Reason', key: 'reason', width: 30 },
    { header: 'Requested by', key: 'rb', width: 22 },
    { header: 'Requested via', key: 'via', width: 18 },
    { header: 'Requested on', key: 'ron', width: 18 },
    ...(approved ? [{ header: 'Accepted by', key: 'ab', width: 22 }, { header: 'Note', key: 'note', width: 30 }] : []),
  ];
  header(ws, 1);
  const ist = (v: string | null) => (v ? new Date(new Date(v).getTime() + 19800000) : null);
  let total = 0;
  for (const r of rows) {
    const c = cases.get(r.case_id);
    if (!c) continue;
    total += Number(c.final_value) || 0;
    ws.addRow({
      on: ist(approved ? r.decided_at : r.requested_at), client: c.client_display_name, awb: c.awb,
      value: c.final_value == null ? null : Number(c.final_value), esc: c.escalation_date ? new Date(`${c.escalation_date}T00:00:00Z`) : null,
      age: c.aging_days, hub: c.hub ?? c.location, lr: r.request_id && lr.has(r.request_id) ? `LR-${lr.get(r.request_id)}` : '',
      reason: r.request_reason, rb: r.requested_by ? names.get(r.requested_by) ?? '' : r.requested_via === 'google_sheet' ? 'Client tracker' : r.requested_via === 'auto' ? 'Automatic' : '',
      via: VIA[r.requested_via] ?? r.requested_via, ron: ist(r.requested_at),
      ab: r.decided_by ? names.get(r.decided_by) ?? '' : '', note: r.decision_note,
    });
  }
  const f = ws.addRow({ on: 'Total', value: total, awb: `${ws.rowCount - 1} AWBs` });
  f.font = { bold: true };
  ws.getColumn('on').numFmt = 'dd-mm-yyyy hh:mm';
  ws.getColumn('ron').numFmt = 'dd-mm-yyyy hh:mm';
  ws.getColumn('esc').numFmt = 'dd-mm-yyyy';
  ws.getColumn('value').numFmt = '#,##0';
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
