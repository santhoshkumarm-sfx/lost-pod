'use server';
import { redirect } from 'next/navigation';
import { requirePoc } from '@/lib/auth';
import { errorText, str, withFlash } from '@/lib/flash';
import { notifyAdminsByEmail } from '@/lib/notify';
import { createClient } from '@/lib/supabase/server';

/** A POC can only ask for Lost. The database checks the case belongs to their client and never sets final Lost. */
export async function pocRequestLost(fd: FormData) {
  await requirePoc();
  const id = str(fd, 'id');
  let dest = withFlash(`/portal/cases/${id}`, 'ok', 'Lost request sent. Shadowfax will review it; the shipment is not Lost until approved.');
  try {
    const reason = str(fd, 'reason');
    if (reason.length < 5) throw new Error('Tell us why the shipment should be declared Lost.');
    const sb = await createClient();
    const { error } = await sb.rpc('request_lost', { p_case_id: id, p_reason: reason });
    if (error) throw error;
    await notifyAdminsByEmail(id, reason);
  } catch (e) {
    dest = withFlash(`/portal/cases/${id}`, 'error', errorText(e));
  }
  redirect(dest);
}

export async function pocComment(fd: FormData) {
  const user = await requirePoc();
  const id = str(fd, 'id');
  let dest = withFlash(`/portal/cases/${id}`, 'ok', 'Message sent to the Shadowfax team.');
  try {
    const body = str(fd, 'body');
    if (!body) throw new Error('Write a message first.');
    const sb = await createClient();
    const { error } = await sb.from('case_comments').insert({ case_id: id, user_id: user.id, body, visibility: 'client' });
    if (error) throw error;
  } catch (e) {
    dest = withFlash(`/portal/cases/${id}`, 'error', errorText(e));
  }
  redirect(dest);
}
