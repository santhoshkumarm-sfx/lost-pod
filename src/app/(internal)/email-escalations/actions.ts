'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireInternal } from '@/lib/auth';
import { importGmailThread, importPastedEmail, extractAndSave, type StoredMessage } from '@/lib/email/import';
import { errorText, must, str, withFlash } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';

export async function importThread(fd: FormData) {
  const user = await requireInternal();
  const threadId = str(fd, 'thread_id');
  let dest = '';
  try {
    const sb = await createClient();
    const r = await importGmailThread(sb, threadId, user.id);
    dest = withFlash(`/email-escalations/${r.id}`, 'ok', r.existing ? 'This thread was imported before. Showing it again with the latest messages.' : 'Email read. Check the extracted details, then create the cases.');
  } catch (e) {
    dest = withFlash(`/email-escalations/new?${new URLSearchParams({ subject: str(fd, 'subject') })}`, 'error', errorText(e));
  }
  redirect(dest);
}

export async function pasteEmail(fd: FormData) {
  const user = await requireInternal();
  let dest = '';
  try {
    const body = str(fd, 'body');
    if (body.length < 10) throw new Error('Paste the email text, including the AWBs.');
    const date = str(fd, 'date');
    const sb = await createClient();
    const id = await importPastedEmail(sb, {
      subject: str(fd, 'subject'), from: str(fd, 'from'), body,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T06:00:00.000Z` : new Date().toISOString(),
    }, user.id);
    dest = withFlash(`/email-escalations/${id}`, 'ok', 'Email read. Check the extracted details, then create the cases.');
  } catch (e) {
    dest = withFlash('/email-escalations/new?mode=paste', 'error', errorText(e));
  }
  redirect(dest);
}

export async function reExtract(fd: FormData) {
  await requireInternal();
  const id = str(fd, 'id');
  let dest = withFlash(`/email-escalations/${id}`, 'ok', 'Extraction refreshed.');
  try {
    const sb = await createClient();
    const row = must(await sb.from('emails').select('messages').eq('id', id).single()) as { messages: StoredMessage[] };
    await extractAndSave(sb, id, row.messages);
  } catch (e) {
    dest = withFlash(`/email-escalations/${id}`, 'error', errorText(e));
  }
  redirect(dest);
}

export async function setEmailStatus(fd: FormData) {
  await requireInternal();
  const id = str(fd, 'id');
  const status = str(fd, 'status') === 'ignored' ? 'ignored' : 'needs_review';
  const sb = await createClient();
  const { error } = await sb.from('emails').update({ status }).eq('id', id).neq('status', 'processed');
  revalidatePath('/email-escalations');
  redirect(withFlash(status === 'ignored' ? '/email-escalations' : `/email-escalations/${id}`, error ? 'error' : 'ok', error ? errorText(error) : status === 'ignored' ? 'Email ignored. No cases were created.' : 'Email back in review.'));
}

export interface ReviewPayload {
  common: {
    client_id: string; client_poc_id: string; escalation_date: string; complaint_type: string; reason: string; priority: string;
    team_remark: string; assigned_agent: string;
  };
  rows: { awb: string; include: boolean; link_case_id: string; location: string; hub: string; delivery_date: string; seller_name: string; reason: string; product_value: string; order_id: string; remark: string }[];
}

/** "Needs manual review" form → one case per AWB (or link to an existing case), in one transaction. */
export async function createFromEmail(fd: FormData) {
  await requireInternal();
  const id = str(fd, 'id');
  let dest = '';
  try {
    const payload = JSON.parse(str(fd, 'payload')) as ReviewPayload;
    const rows = payload.rows
      .filter((r) => r.include && r.awb.trim())
      .map((r) => ({
        awb: r.awb, link_case_id: r.link_case_id || null, location: r.location, hub: r.hub, delivery_date: r.delivery_date || null,
        seller_name: r.seller_name, reason: r.reason, product_value: r.product_value ? Number(r.product_value.replace(/[,₹\s]/g, '')) : null,
        order_id: r.order_id, remark: r.remark,
      }));
    if (!rows.length) throw new Error('Tick at least one AWB.');
    if (!payload.common.client_id) throw new Error('Choose the client.');
    if (!payload.common.escalation_date) throw new Error('Escalation date is required.');
    const sb = await createClient();
    const res = must(await sb.rpc('create_email_cases', { p_email_id: id, p_common: payload.common, p_rows: rows })) as { created: number; linked: number };
    const awbs = rows.map((r) => r.awb.toUpperCase()).join(' ');
    revalidatePath('/email-escalations');
    dest = withFlash(`/cases?q=${encodeURIComponent(awbs)}&category=all`, 'ok',
      `${res.created} case${res.created === 1 ? '' : 's'} created${res.linked ? `, ${res.linked} linked to existing case${res.linked === 1 ? '' : 's'}` : ''} from the email.`);
  } catch (e) {
    dest = withFlash(`/email-escalations/${id}`, 'error', errorText(e));
  }
  redirect(dest);
}
