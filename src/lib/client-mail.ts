import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from './env';
import { bridgeConfigured, sendMail, type MailAttachment } from './google';
import { fmtDMY } from './format';
import { todayIn } from './time';

/*
 * Client mail: everything the client should hear about (POD shared, Lost accepted / rejected / sent back) is queued
 * per client (client_outbox) and sent as ONE email per client: a table AWB → update → POD, with the POD files
 * attached and named by AWB. Sent when the team presses "Send to client", or automatically once the client's queue
 * has been quiet for a while (Settings: client_mail_quiet_minutes; needs automatic emails switched on).
 */

export const POD_BUCKET = 'pod-files';
const MAX_ATTACH = 15 * 1024 * 1024;   // Gmail allows 25 MB per email; keep a margin for encoding

export interface OutboxItem {
  id: string; client_id: string | null; case_id: string | null; awb: string; kind: string; pod_link: string | null; note: string | null;
  requested_by: string | null; created_by?: string | null; created_at: string; updated_at: string;
}
interface PodFile { id: string; outbox_id: string | null; case_id: string | null; awb: string; path: string; filename: string; content_type: string | null; size_bytes: number | null }

export const KIND_LABEL: Record<string, string> = {
  pod_shared: 'POD shared', loss_accepted: 'Loss accepted', loss_rejected: 'Lost request rejected', loss_sent_back: 'Lost request sent back for investigation',
};

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isEmail = (e: unknown): e is string => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(isEmail))];

/** Public link to the app page that lists the POD files of a case (sign-in needed). */
export const podFilesLink = (caseId: string) => `${publicEnv.siteUrl}/pod/${caseId}`;

async function settingList(sb: SupabaseClient, key: string): Promise<string[]> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as string[]).filter(isEmail) : [];
}

/** Who gets the client's email: the client people who asked, else the client's portal users; plus the To / CC settings. */
async function recipients(sb: SupabaseClient, clientId: string | null, items: OutboxItem[]): Promise<{ to: string[]; cc: string[] }> {
  const asked = new Set(items.map((i) => i.requested_by).filter((x): x is string => !!x));
  const caseIds = items.filter((i) => i.kind === 'pod_shared' && i.case_id).map((i) => i.case_id!);
  for (let i = 0; i < caseIds.length; i += 200) {
    const { data } = await sb.from('pod_request_items').select('case_uploads(uploaded_by)').in('case_id', caseIds.slice(i, i + 200));
    for (const r of (data ?? []) as unknown as { case_uploads: { uploaded_by: string | null } | null }[]) if (r.case_uploads?.uploaded_by) asked.add(r.case_uploads.uploaded_by);
  }
  let to: string[] = [];
  if (asked.size) {
    const { data } = await sb.from('profiles').select('email, role, is_active').in('id', [...asked]);
    to = ((data ?? []) as { email: string; role: string; is_active: boolean }[]).filter((p) => p.is_active && p.role === 'client_poc').map((p) => p.email);
  }
  if (!to.length && clientId) {
    const { data } = await sb.from('client_pocs').select('profiles(email, is_active, role)').eq('client_id', clientId).eq('is_active', true).not('user_id', 'is', null);
    to = ((data ?? []) as unknown as { profiles: { email: string; is_active: boolean; role: string } | null }[])
      .filter((p) => p.profiles?.is_active && p.profiles.role === 'client_poc').map((p) => p.profiles!.email);
  }
  const accepted = items.some((i) => i.kind === 'loss_accepted');
  const other = items.some((i) => i.kind === 'loss_rejected' || i.kind === 'loss_sent_back');
  const none = Promise.resolve([] as string[]);
  const lists = await Promise.all([
    settingList(sb, 'client_update_to'), settingList(sb, 'client_update_cc'),
    accepted ? settingList(sb, 'loss_accepted_email_to') : none, accepted ? settingList(sb, 'loss_accepted_email_cc') : none,
    other ? settingList(sb, 'lost_decision_email_to') : none, other ? settingList(sb, 'lost_decision_email_cc') : none,
  ]);
  const toList = uniq([...to, ...lists[0]]);
  const ccList = uniq([...lists[1], ...lists[2], ...lists[3], ...lists[4], ...lists[5]]).filter((e) => !toList.includes(e));
  return toList.length ? { to: toList, cc: ccList } : { to: ccList, cc: [] };
}

function subjectFor(client: string, items: OutboxItem[], names: string[]): string {
  const kinds = new Set(items.map((i) => i.kind));
  const day = fmtDMY(todayIn());
  if (kinds.size === 1 && kinds.has('loss_accepted')) return `POD lost accepted by ${names.join(', ') || 'Shadowfax'}`;
  if (kinds.size === 1 && kinds.has('pod_shared')) return `POD shared — ${client} — ${items.length} AWB${items.length === 1 ? '' : 's'} — ${day}`;
  return `POD lost update — ${client} — ${items.length} AWB${items.length === 1 ? '' : 's'} — ${day}`;
}

/** File name in the email: the AWB, then a number when one AWB has several files. */
function attachmentName(awb: string, original: string, n: number): string {
  const ext = (original.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '').toLowerCase();
  return `${awb}${n > 1 ? `-${n}` : ''}${ext}`;
}

function html(client: string, items: OutboxItem[], files: Map<string, { name: string; attached: boolean; id: string }[]>): string {
  const th = (t: string) => `<th bgcolor="#F2F2F2" align="left" style="padding:5px 8px;border:1px solid #5B7DB1;font-size:12px">${t}</th>`;
  const td = (t: string) => `<td style="padding:5px 8px;border:1px solid #5B7DB1;font-size:12px">${t}</td>`;
  const order = ['pod_shared', 'loss_accepted', 'loss_rejected', 'loss_sent_back'];
  const rows = [...items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.awb.localeCompare(b.awb)).map((i) => {
    const fs = files.get(i.id) ?? [];
    const pod = [
      ...(i.pod_link && !i.pod_link.includes('/pod/') ? [`<a href="${esc(i.pod_link)}">Open POD</a>`] : []),
      ...fs.map((f) => (f.attached ? `${esc(f.name)} (attached)` : `<a href="${esc(`${publicEnv.siteUrl}/api/pod-file/${f.id}`)}">${esc(f.name)}</a>`)),
    ].join('<br>') || (i.kind === 'pod_shared' && i.pod_link ? `<a href="${esc(i.pod_link)}">Open POD</a>` : '—');
    return `<tr>${td(`<span style="font-family:Consolas,monospace">${esc(i.awb)}</span>`)}${td(esc(KIND_LABEL[i.kind] ?? i.kind))}${td(pod)}${td(esc(i.note ?? ''))}</tr>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;color:#1B2330;font-size:13px">
<p>Hi,</p><p>Please find below the update for ${esc(client)} (${items.length} AWB${items.length === 1 ? '' : 's'}).</p>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr>${th('AWB')}${th('Update')}${th('POD')}${th('Note')}</tr>${rows}</table>
<p>You can also see these on the dashboard: <a href="${publicEnv.siteUrl}/portal">${publicEnv.siteUrl}/portal</a></p>
<p>Regards,<br>Shadowfax Trust &amp; Safety</p></div>`;
}

export interface FlushResult { client: string; items: number; files: number; to: string[]; status: 'sent' | 'failed' | 'skipped'; error?: string }

/**
 * Sends the queued updates as one email per client. Use a service-role client.
 * `clientIds` limits it to those clients; `quietMinutes` only sends queues with nothing new for that long.
 */
export async function flushClientOutbox(sb: SupabaseClient, opts: { clientIds?: (string | null)[]; quietMinutes?: number; trigger: 'manual' | 'auto'; sentBy?: string | null }): Promise<FlushResult[]> {
  let q = sb.from('client_outbox').select('id, client_id, case_id, awb, kind, pod_link, note, requested_by, created_by, created_at, updated_at')
    .is('sent_at', null).eq('dropped', false).order('created_at').limit(5000);
  const ids = (opts.clientIds ?? []).filter((x): x is string => !!x);
  if (ids.length) q = q.in('client_id', ids);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const groups = new Map<string, OutboxItem[]>();
  for (const it of (data ?? []) as OutboxItem[]) groups.set(it.client_id ?? 'none', [...(groups.get(it.client_id ?? 'none') ?? []), it]);
  const out: FlushResult[] = [];
  const now = Date.now();
  for (const [clientKey, items] of groups) {
    if (opts.quietMinutes && Math.max(...items.map((i) => Date.parse(i.updated_at))) > now - opts.quietMinutes * 60_000) continue;
    const clientId = clientKey === 'none' ? null : clientKey;
    const { data: cl } = clientId ? await sb.from('clients').select('name').eq('id', clientId).maybeSingle() : { data: null };
    const client = (cl as { name: string } | null)?.name ?? 'No client';
    // Files of these items, attached while they fit; the rest as links.
    const { data: fdata } = await sb.from('pod_files').select('id, outbox_id, case_id, awb, path, filename, content_type, size_bytes').in('outbox_id', items.map((i) => i.id));
    const pf = (fdata ?? []) as PodFile[];
    const attachments: MailAttachment[] = [];
    const shown = new Map<string, { name: string; attached: boolean; id: string }[]>();
    // One file can cover several AWBs: it is attached once, under its own name; a file for one AWB is named by the AWB.
    const awbsOfPath = new Map<string, Set<string>>();
    for (const f of pf) awbsOfPath.set(f.path, (awbsOfPath.get(f.path) ?? new Set()).add(f.awb));
    const perAwb = new Map<string, number>();
    const done = new Map<string, { name: string; attached: boolean }>();
    const used = new Set<string>();
    let size = 0;
    for (const f of pf.sort((a, b) => a.awb.localeCompare(b.awb))) {
      let got = done.get(f.path);
      if (!got) {
        const shared = (awbsOfPath.get(f.path)?.size ?? 1) > 1;
        let name: string;
        if (shared) name = f.filename;
        else {
          const n = (perAwb.get(f.awb) ?? 0) + 1;
          perAwb.set(f.awb, n);
          name = attachmentName(f.awb, f.filename, n);
        }
        for (let k = 2; used.has(name.toLowerCase()); k++) name = name.replace(/(\.[^.]+)?$/, (ext) => `-${k}${ext}`);
        used.add(name.toLowerCase());
        let attached = false;
        if (size + (f.size_bytes ?? 0) <= MAX_ATTACH) {
          const dl = await sb.storage.from(POD_BUCKET).download(f.path);
          if (!dl.error && dl.data) {
            const buf = Buffer.from(await dl.data.arrayBuffer());
            if (size + buf.length <= MAX_ATTACH) {
              attachments.push({ filename: name, contentType: f.content_type || 'application/octet-stream', content: buf });
              size += buf.length;
              attached = true;
            }
          }
        }
        got = { name, attached };
        done.set(f.path, got);
      }
      shown.set(f.outbox_id!, [...(shown.get(f.outbox_id!) ?? []), { ...got, id: f.id }]);
    }
    const r: FlushResult = { client, items: items.length, files: new Set(pf.map((f) => f.path)).size, to: [], status: 'sent' };
    try {
      if (!bridgeConfigured()) throw new Error('Gmail is not connected');
      const { to, cc } = await recipients(sb, clientId, items);
      if (!to.length) throw new Error(`No email address for ${client}: add a client POC with a portal login, or "Client updates — To" on Reports → Other emails.`);
      r.to = [...to, ...cc];
      const deciderIds = [...new Set(items.filter((i) => i.kind === 'loss_accepted').map((i) => i.created_by).filter((x): x is string => !!x))];
      const { data: who } = deciderIds.length ? await sb.from('profiles').select('full_name, email').in('id', deciderIds) : { data: [] };
      const names = ((who ?? []) as { full_name: string | null; email: string }[]).map((w) => w.full_name ?? w.email);
      const subject = subjectFor(client, items, names);
      await sendMail({ to, cc, subject, html: html(client, items, shown), attachments });
      const { data: b } = await sb.from('client_mail_batches').insert({
        client_id: clientId, items: items.length, files: r.files, recipients: r.to, subject, status: 'sent', trigger: opts.trigger, sent_by: opts.sentBy ?? null,
      }).select('id').single();
      for (let i = 0; i < items.length; i += 200) {
        await sb.from('client_outbox').update({ sent_at: new Date().toISOString(), batch_id: (b as { id: string } | null)?.id ?? null }).in('id', items.slice(i, i + 200).map((x) => x.id));
      }
    } catch (e) {
      r.status = 'failed';
      r.error = (e as Error).message.slice(0, 300);
      await sb.from('client_mail_batches').insert({ client_id: clientId, items: items.length, files: r.files, recipients: r.to, status: 'failed', error: r.error, trigger: opts.trigger, sent_by: opts.sentBy ?? null });
    }
    out.push(r);
  }
  return out;
}

/** Scheduler: send the quiet queues when automatic emails are switched on. */
export async function autoFlushClientOutbox(sb: SupabaseClient): Promise<FlushResult[]> {
  const { data } = await sb.from('app_settings').select('key, value').in('key', ['notify_admins_by_email', 'client_mail_quiet_minutes']);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  if (get('notify_admins_by_email') !== true) return [];
  return flushClientOutbox(sb, { trigger: 'auto', quietMinutes: Math.max(5, Number(get('client_mail_quiet_minutes') ?? 30) || 30) });
}
