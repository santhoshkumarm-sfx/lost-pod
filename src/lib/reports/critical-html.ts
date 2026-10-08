import ExcelJS from 'exceljs';
import { AGING_HEX, agingStep, fmtDate, fmtNum } from '../format';

export interface CriticalRow {
  awb: string; client_display_name: string | null; escalation_date: string; aging_days: number; status_label: string;
  hub: string | null; location: string | null; agent_display_name: string | null; assigned_agent: string | null; team_remark: string | null;
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const th = (t: string, a = 'left') => `<th style="background:#14223A;color:#fff;font-size:12px;padding:5px 8px;text-align:${a};white-space:nowrap">${esc(t)}</th>`;
const td = (v: unknown, a = 'left') => `<td style="padding:4px 8px;font-size:12px;border:1px solid #DCDFD8;text-align:${a}">${v === null || v === undefined || v === '' ? '—' : v}</td>`;
const BODY_ROWS = 200;

function group(rows: CriticalRow[], key: (r: CriticalRow) => string) {
  const m = new Map<string, { n: number; oldest: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { n: 0, oldest: 0 };
    g.n++;
    g.oldest = Math.max(g.oldest, r.aging_days);
    m.set(k, g);
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[1].oldest - a[1].oldest);
}

export function criticalSubject(rows: CriticalRow[], days: number, forAgent?: string): string {
  return forAgent
    ? `Your critical pending PODs: ${fmtNum(rows.length)} shipment${rows.length === 1 ? '' : 's'} over ${days} days`
    : `Critical pending POD: ${fmtNum(rows.length)} shipment${rows.length === 1 ? '' : 's'} over ${days} days — ${fmtDate(new Date().toISOString())}`;
}

export function renderCriticalHtml(rows: CriticalRow[], o: { days: number; siteUrl: string; forAgent?: string; attachmentName?: string | null }): string {
  const newToday = rows.filter((r) => r.aging_days === o.days + 1).length;
  const oldest = rows.reduce((m, r) => Math.max(m, r.aging_days), 0);
  const kpi = (l: string, v: string, c = '#1B2330') =>
    `<td style="padding:6px 22px 6px 0"><div style="font-size:11px;color:#4A5566">${esc(l)}</div><div style="font-size:22px;font-weight:700;color:${c}">${v}</div></td>`;
  const small = (title: string, data: [string, { n: number; oldest: number }][]) =>
    `<td style="vertical-align:top;padding-right:24px"><div style="font-weight:700;font-size:13px;margin:10px 0 4px">${esc(title)}</div>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th(title === 'By client' ? 'Client' : 'Agent')}${th('Critical', 'right')}${th('Oldest', 'right')}</tr>
${data.slice(0, 15).map(([k, g]) => `<tr>${td(esc(k))}${td(fmtNum(g.n), 'right')}${td(`${g.oldest} d`, 'right')}</tr>`).join('')}</table></td>`;
  const list = rows.slice(0, BODY_ROWS).map((r) =>
    `<tr>${td(`<span style="font-family:Consolas,monospace">${esc(r.awb)}</span>`)}${td(esc(r.client_display_name))}${td(fmtDate(r.escalation_date))}${td(`<strong style="color:${AGING_HEX[agingStep(r.aging_days)]}">${r.aging_days}</strong>`, 'right')}${td(esc(r.status_label))}${td(esc(r.hub ?? r.location))}${o.forAgent ? '' : td(esc(r.agent_display_name ?? 'Unassigned'))}${td(esc(r.team_remark))}</tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F3F4F1">
<div style="font-family:Segoe UI,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:18px;background:#fff;color:#1B2330">
<div style="border-left:6px solid #A9402B;padding-left:12px;margin-bottom:10px">
<div style="font-size:18px;font-weight:700">${o.forAgent ? `${esc(o.forAgent)}, these shipments need a POD or a Lost request today` : 'Critical pending POD'}</div>
<div style="font-size:12px;color:#4A5566">Shipments still waiting for a POD more than ${o.days} days after escalation. Oldest first.</div></div>
<table cellpadding="0" cellspacing="0"><tr>${kpi('Critical', fmtNum(rows.length), '#A9402B')}${kpi('Became critical today', fmtNum(newToday))}${kpi('Oldest', `${oldest} days`)}</tr></table>
${o.forAgent || !rows.length ? '' : `<table cellpadding="0" cellspacing="0"><tr>${small('By client', group(rows, (r) => r.client_display_name ?? 'No client'))}${small('By agent', group(rows, (r) => r.agent_display_name ?? 'Unassigned'))}</tr></table>`}
${rows.length ? `<div style="font-weight:700;font-size:13px;margin:14px 0 4px">Shipments</div>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('AWB')}${th('Client')}${th('Escalated')}${th('Aging', 'right')}${th('Status')}${th('Hub')}${o.forAgent ? '' : th('Agent')}${th('Last remark')}</tr>${list}</table>
${rows.length > BODY_ROWS ? `<p style="font-size:12px;color:#4A5566">Showing ${BODY_ROWS} of ${fmtNum(rows.length)}${o.attachmentName ? '; all are in the attachment' : ''}.</p>` : ''}` : '<p>Nothing is critical today.</p>'}
<p style="font-size:12px;margin-top:14px"><a href="${esc(o.siteUrl)}/cases?category=critical&sort=aging_days&dir=desc" style="color:#1F5FBF">Open the critical list</a>${o.attachmentName ? ` · Attached: ${esc(o.attachmentName)}` : ''}</p>
</div></body></html>`;
}

export async function buildCriticalWorkbook(rows: CriticalRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Critical pending POD', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'AWB', key: 'awb', width: 22 }, { header: 'Client', key: 'client_display_name', width: 18 },
    { header: 'Escalated', key: 'escalation_date', width: 12 }, { header: 'Aging (days)', key: 'aging_days', width: 12 },
    { header: 'Status', key: 'status_label', width: 20 }, { header: 'Hub', key: 'hub', width: 22 }, { header: 'Location', key: 'location', width: 14 },
    { header: 'Agent', key: 'agent_display_name', width: 18 }, { header: 'Last remark', key: 'team_remark', width: 40 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA9402B' } };
  rows.forEach((r) => ws.addRow(r));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
