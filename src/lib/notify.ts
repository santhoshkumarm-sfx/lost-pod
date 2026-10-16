import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/admin';
import { googleStatus } from './google';
import { sendMail } from './google';
import { publicEnv } from './env';
import { fmtDate, fmtDateTime } from './format';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isEmail = (e: unknown): e is string => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(isEmail))];

/** The one switch for automatic emails (Settings → "Send emails automatically"). Off unless set to true. */
async function emailsOn(sb: SupabaseClient): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'notify_admins_by_email').maybeSingle();
  return data?.value === true;
}

async function settingList(sb: SupabaseClient, key: string): Promise<string[]> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as string[]).filter(isEmail) : [];
}

interface CaseLine {
  id: string;
  awb: string;
  client_id: string | null;
  client_display_name: string | null;
  escalation_date: string;
  current_aging_days: number;
  hub: string | null;
  location: string | null;
}

function table(rows: CaseLine[], extra?: (r: CaseLine) => string, extraHead?: string): string {
  const th = (t: string) => `<th style="text-align:left;padding:5px 8px;background:#14223A;color:#fff;font-size:12px">${t}</th>`;
  const td = (t: unknown) => `<td style="padding:5px 8px;border-bottom:1px solid #DCDFD8;font-size:12px">${t}</td>`;
  const shown = rows.slice(0, 200);
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr>${th('AWB')}${th('Client')}${th('Escalated')}${th('Aging (days)')}${th('Hub / location')}${extraHead ? th(extraHead) : ''}</tr>
${shown.map((r) => `<tr>${td(`<span style="font-family:Consolas,monospace">${esc(r.awb)}</span>`)}${td(esc(r.client_display_name ?? '—'))}${td(fmtDate(r.escalation_date))}${td(r.current_aging_days)}${td(esc(r.hub ?? r.location ?? '—'))}${extra ? td(extra(r)) : ''}</tr>`).join('')}
</table>${rows.length > shown.length ? `<p style="font-size:12px;color:#4A5566">…and ${rows.length - shown.length} more (see the dashboard).</p>` : ''}`;
}

async function loadCases(sb: SupabaseClient, caseIds: string[]): Promise<CaseLine[]> {
  const out: CaseLine[] = [];
  for (let i = 0; i < caseIds.length; i += 200) {
    const { data } = await sb
      .from('v_cases')
      .select('id, awb, client_id, client_display_name, escalation_date, current_aging_days, hub, location')
      .in('id', caseIds.slice(i, i + 200));
    out.push(...((data ?? []) as CaseLine[]));
  }
  return out.sort((a, b) => (a.client_display_name ?? '').localeCompare(b.client_display_name ?? '') || a.awb.localeCompare(b.awb));
}

interface RequestRow {
  id: string; request_number: number; client_id: string | null; requested_by: string | null; requested_by_name: string | null;
  requested_via: string; reason: string | null; created_at: string;
}

const VIA: Record<string, string> = { app: 'the Shadowfax dashboard', poc_portal: 'the client portal', google_sheet: 'Google Sheets', email: 'email', auto: 'the automatic rule (POD not shared in time)' };

async function requestCases(sb: SupabaseClient, requestId: string): Promise<(CaseLine & { assigned_agent: string | null })[]> {
  const { data } = await sb.from('lost_approvals').select('case_id').eq('request_id', requestId);
  const ids = ((data ?? []) as { case_id: string }[]).map((r) => r.case_id);
  const cases = await loadCases(sb, ids);
  const agents = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: a } = await sb.from('cases').select('id, assigned_agent').in('id', ids.slice(i, i + 200));
    for (const r of (a ?? []) as { id: string; assigned_agent: string | null }[]) agents.set(r.id, r.assigned_agent);
  }
  return cases.map((c) => ({ ...c, assigned_agent: agents.get(c.id) ?? null }));
}

async function emailsOf(sb: SupabaseClient, ids: (string | null)[]): Promise<string[]> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return [];
  const { data } = await sb.from('profiles').select('email').in('id', list).eq('is_active', true);
  return ((data ?? []) as { email: string }[]).map((r) => r.email);
}

const agingLine = (cases: CaseLine[]) => {
  if (!cases.length) return '';
  const ages = cases.map((c) => c.current_aging_days);
  const avg = Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10;
  return `${cases.length} AWB${cases.length === 1 ? '' : 's'} · oldest ${Math.max(...ages)} days · average ${avg} days since escalation`;
};

/**
 * One email per new Lost request (LR-n). To = "Lost requests — To" + that client's approvers and Super Admins;
 * CC = "Lost requests — CC" + the agents on those AWBs + the person who asked. Never blocks the request itself.
 */
export async function emailNewLostRequests(): Promise<void> {
  if (!googleStatus().gmail) return;
  try {
    const sb = createAdminClient();
    // Requests are always marked as handled, so switching emails on later does not send an old backlog.
    const { data, error } = await sb.rpc('claim_lost_request_emails', { p_max: 500 });
    if (error) throw error;
    const reqs = (data ?? []) as RequestRow[];
    if (!reqs.length || !(await emailsOn(sb))) return;
    const [to, cc] = await Promise.all([settingList(sb, 'lost_request_email_to'), settingList(sb, 'lost_request_email_cc')]);
    // Tracker rows marked Lost: one summary email per sync; requests made by people: one email each.
    const fromSheets = reqs.filter((r) => r.requested_via === 'google_sheet');
    if (fromSheets.length) await sheetDigest(sb, fromSheets, to, cc);
    for (const r of reqs.filter((x) => x.requested_via !== 'google_sheet')) {
      try {
        const cases = await requestCases(sb, r.id);
        if (!cases.length) continue;
        const { data: appr } = await sb.rpc('lost_approver_emails', { p_client_id: r.client_id });
        const toList = uniq([...to, ...((appr ?? []) as { email: string }[]).map((x) => x.email)]);
        if (!toList.length) continue;
        const ccList = uniq([...cc, ...(await emailsOf(sb, [...cases.map((c) => c.assigned_agent), r.requested_by]))]).filter((e) => !toList.includes(e));
        const client = cases[0].client_display_name ?? 'Unknown client';
        const who = r.requested_by_name ?? (r.requested_via === 'google_sheet' ? 'The client tracker (Google Sheet)' : 'Someone');
        await sendMail({
          to: toList,
          cc: ccList,
          subject: `POD connect requested by ${client}`,
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1B2330">
<p><strong>${esc(who)}</strong> ${r.requested_via === 'google_sheet' ? 'marked' : `asked via ${esc(VIA[r.requested_via] ?? r.requested_via)} to accept the loss of`} ${cases.length === 1 ? 'this shipment' : `these ${cases.length} shipments`}${r.requested_via === 'google_sheet' ? ' as Lost' : ''} for <strong>${esc(client)}</strong>.</p>
<p><strong>Request:</strong> LR-${r.request_number} · ${fmtDateTime(r.created_at)} IST<br><strong>Reason:</strong> ${esc(r.reason ?? '—')}<br>${esc(agingLine(cases))}</p>
${table(cases)}
<p>Nothing is Lost until an approver accepts it. <a href="${publicEnv.siteUrl}/lost-approval/requests/${r.id}">Open request LR-${r.request_number}</a></p></div>`,
        });
      } catch (e) {
        console.error(`Lost request email LR-${r.request_number} failed`, e);
      }
    }
  } catch (e) {
    console.error('Lost request emails failed', e);
  }
}

/** One summary of every Lost request the trackers raised in this sync (instead of one email each). */
async function sheetDigest(sb: SupabaseClient, reqs: RequestRow[], to: string[], cc: string[]): Promise<void> {
  try {
    const toList = uniq(to);
    if (!toList.length) return;
    const lines: { r: RequestRow; client: string; n: number; oldest: number }[] = [];
    for (const r of reqs) {
      const cases = await requestCases(sb, r.id);
      if (!cases.length) continue;
      lines.push({ r, client: cases[0].client_display_name ?? 'Unknown client', n: cases.length, oldest: Math.max(...cases.map((c) => c.current_aging_days)) });
    }
    if (!lines.length) return;
    lines.sort((a, b) => a.client.localeCompare(b.client) || a.r.request_number - b.r.request_number);
    const awbs = lines.reduce((t, l) => t + l.n, 0);
    const th = (t: string) => `<th style="text-align:left;padding:5px 8px;background:#14223A;color:#fff;font-size:12px">${t}</th>`;
    const td = (t: unknown) => `<td style="padding:5px 8px;border-bottom:1px solid #DCDFD8;font-size:12px">${t}</td>`;
    await sendMail({
      to: toList,
      cc: uniq(cc).filter((e) => !toList.includes(e)),
      subject: `POD connect requested by ${[...new Set(lines.map((l) => l.client))].join(', ')}`,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1B2330">
<p>The latest Google Sheet sync found <strong>${awbs}</strong> shipment${awbs === 1 ? '' : 's'} marked Lost in client trackers. Each tab became one Lost request. Nothing is Lost until an approver accepts it.</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('Request')}${th('Client')}${th('Tracker tab / reason')}${th('AWBs')}${th('Oldest aging')}</tr>
${lines.map((l) => `<tr>${td(`<a href="${publicEnv.siteUrl}/lost-approval/requests/${l.r.id}">LR-${l.r.request_number}</a>`)}${td(esc(l.client))}${td(esc(l.r.reason ?? ''))}${td(l.n)}${td(`${l.oldest} days`)}</tr>`).join('')}
</table>
<p><a href="${publicEnv.siteUrl}/lost-approval?via=google_sheet">Review them in Lost approval</a></p></div>`,
    });
  } catch (e) {
    console.error('Tracker Lost digest failed', e);
  }
}
