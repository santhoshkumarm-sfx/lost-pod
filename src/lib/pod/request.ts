import 'server-only';
import ExcelJS from 'exceljs';
import type { SessionUser } from '../auth';
import { publicEnv } from '../env';
import { bridgeConfigured, sendMail } from '../google';
import { createAdminClient } from '../supabase/admin';
import { syncPodIndex } from './sheets';

export interface PodItem { awb: string; result: 'shared' | 'already_shared' | 'not_found' | 'not_open'; pod_link: string | null; other_links: number; case_id: string | null }
export const RESULT_LABEL: Record<PodItem['result'], string> = {
  shared: 'POD shared', already_shared: 'POD shared (earlier)', not_found: 'Not found yet — we are working on it', not_open: 'POD found (case already closed / Lost)',
};

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isEmail = (e: unknown): e is string => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/** One Excel for a submission: AWB, result, POD link. */
export async function podRequestXlsx(requestNo: number | null, clientName: string | null, items: PodItem[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`PR-${requestNo ?? ''}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'AWB', key: 'awb', width: 22 }, { header: 'Client', key: 'client', width: 18 },
    { header: 'Result', key: 'result', width: 34 }, { header: 'POD link', key: 'link', width: 70 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14223A' } };
  for (const i of [...items].sort((a, b) => Number(!a.pod_link) - Number(!b.pod_link) || a.awb.localeCompare(b.awb))) {
    const row = ws.addRow({ awb: i.awb, client: clientName, result: RESULT_LABEL[i.result], link: i.pod_link ?? '' });
    if (i.pod_link) row.getCell('link').value = { text: i.pod_link, hyperlink: i.pod_link };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function emailHtml(name: string, requestNo: number | null, clientName: string | null, items: PodItem[], link: string): string {
  const found = items.filter((i) => i.pod_link);
  const missing = items.filter((i) => !i.pod_link);
  const th = (t: string) => `<th style="text-align:left;padding:5px 8px;background:#14223A;color:#fff;font-size:12px">${t}</th>`;
  const td = (t: string) => `<td style="padding:5px 8px;border-bottom:1px solid #DCDFD8;font-size:12px">${t}</td>`;
  const rows = found.slice(0, 300).map((i) => `<tr>${td(`<span style="font-family:Consolas,monospace">${esc(i.awb)}</span>`)}${td(`<a href="${esc(i.pod_link)}">Open POD</a>`)}</tr>`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#14223A;font-size:14px">
<p>Hi ${esc(name)},</p>
<p>Your POD request <b>PR-${requestNo ?? ''}</b>${clientName ? ` for ${esc(clientName)}` : ''}: <b>${found.length} of ${items.length}</b> POD(s) found and shared.${missing.length ? ` The other ${missing.length} are with our team; we will update you on the dashboard.` : ''}</p>
${found.length ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('AWB')}${th('POD')}</tr>${rows}</table>${found.length > 300 ? `<p style="font-size:12px">…and ${found.length - 300} more in the attached Excel.</p>` : ''}` : ''}
${missing.length ? `<p style="font-size:13px">Not found yet: <span style="font-family:Consolas,monospace">${missing.slice(0, 50).map((i) => esc(i.awb)).join(', ')}${missing.length > 50 ? ' …' : ''}</span></p>` : ''}
<p>The attached Excel has every AWB of this request. See it any time on the dashboard: <a href="${esc(link)}">${esc(link)}</a></p>
<p style="font-size:12px;color:#4A5566">If a POD is wrong or unclear, open the shipment on the dashboard and use "Report a problem with this POD".</p>
<p>Shadowfax Trust &amp; Safety</p></div>`;
}

/**
 * Right after a submission: refresh the POD sheets quickly (new rows only), mark the AWBs that have a POD
 * as "POD shared", and send the requester ONE consolidated email with an Excel (client POCs only).
 */
export async function checkPodRequest(uploadId: string, awbs: string[], user: SessionUser): Promise<{ total: number; found: number; requestNo: number } | null> {
  if (!uploadId || !awbs.length) return null;
  const admin = createAdminClient();
  if (bridgeConfigured()) {
    try {
      await syncPodIndex(admin, { deadline: Date.now() + 20_000 });
    } catch {
      /* lookup uses what is already in pod_index */
    }
  }
  const { data, error } = await admin.rpc('apply_pod_request', { p_upload_id: uploadId, p_awbs: awbs, p_actor: user.id });
  if (error) throw new Error(error.message);
  const r = data as { total: number; found: number; request_no: number };

  if (user.role === 'client_poc' && r.total > 0) {
    const [{ data: setting }, { data: extraTo }, { data: cc }, { data: up }, { data: items }] = await Promise.all([
      admin.from('app_settings').select('value').eq('key', 'pod_request_email').maybeSingle(),
      admin.from('app_settings').select('value').eq('key', 'pod_request_to').maybeSingle(),
      admin.from('app_settings').select('value').eq('key', 'pod_request_cc').maybeSingle(),
      admin.from('case_uploads').select('client_id, clients(name)').eq('id', uploadId).single(),
      admin.from('pod_request_items').select('awb, result, pod_link, other_links, case_id').eq('upload_id', uploadId),
    ]);
    if (setting?.value !== false) {
      const clientName = ((up as { clients?: { name?: string } | null } | null)?.clients?.name) ?? null;
      const list = (items ?? []) as PodItem[];
      const link = `${publicEnv.siteUrl}/portal/pod-requests?upload=${uploadId}`;
      let note: string | null = null;
      try {
        if (!bridgeConfigured()) throw new Error('Gmail not connected');
        await sendMail({
          to: [...new Set([user.email, ...(Array.isArray(extraTo?.value) ? (extraTo!.value as string[]) : []).filter(isEmail)])],
          cc: (Array.isArray(cc?.value) ? (cc!.value as string[]) : []).filter(isEmail),
          subject: `POD request PR-${r.request_no}${clientName ? ` (${clientName})` : ''}: ${r.found} of ${r.total} shared`,
          html: emailHtml(user.full_name ?? user.email, r.request_no, clientName, list, link),
          attachments: [{ filename: `PR-${r.request_no} PODs.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: await podRequestXlsx(r.request_no, clientName, list) }],
        });
      } catch (e) {
        note = (e as Error).message.slice(0, 300);
      }
      await admin.from('case_uploads').update({ pod_email_to: user.email, pod_email_error: note }).eq('id', uploadId);
    }
  }
  return { total: r.total, found: r.found, requestNo: r.request_no };
}
