'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireInternal } from '@/lib/auth';
import { flushClientOutbox, podFilesLink, type FlushResult } from '@/lib/client-mail';
import { errorText, must, str, withFlash } from '@/lib/flash';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { driveViewLink, logPodFiles } from '@/lib/drive';

const safeBack = (b: string) => (b.startsWith('/') && !b.startsWith('//') ? b : '/client-mail');

function describe(rs: FlushResult[]): string {
  if (!rs.length) return 'Nothing waiting to be sent.';
  return rs.map((r) => (r.status === 'sent'
    ? `${r.client}: one email with ${r.items} AWB(s)${r.files ? ` and ${r.files} file(s)` : ''} sent to ${r.to.join(', ')}.`
    : `${r.client}: not sent — ${r.error}`)).join(' ');
}

interface ShareItem { case_id: string; link?: string; files?: { path: string; name: string; type: string; size: number }[] }

/** Team: POD links / files for AWBs (files are already in storage). Optionally send the client's email right away. */
export async function sharePods(fd: FormData) {
  const user = await requireInternal();
  const back = safeBack(str(fd, 'back'));
  let dest: string;
  try {
    const items = JSON.parse(str(fd, 'items') || '[]') as ShareItem[];
    const useful = items.filter((i) => i.case_id && ((i.link ?? '').trim() || (i.files ?? []).length));
    if (!useful.length) throw new Error('Add a POD link or file for at least one AWB.');
    const sb = await createClient();
    const r = must(await sb.rpc('share_pods', { p_items: useful.map((i) => ({ ...i, files_link: podFilesLink(i.case_id) })) })) as { shared: number; files: number; clients: string[] };
    const nFiles = new Set(useful.flatMap((i) => (i.files ?? []).map((f) => f.path))).size;
    // Every file is also listed in the "POD connect — POD files" sheet next to the Drive folder.
    if (nFiles) {
      try {
        const { data: cs } = await sb.from('v_cases').select('id, awb, client_display_name').in('id', useful.map((i) => i.case_id));
        const byId = new Map(((cs ?? []) as { id: string; awb: string; client_display_name: string | null }[]).map((c) => [c.id, c]));
        const when = new Date(Date.now() + 19800000).toISOString().slice(0, 16).replace('T', ' ');
        await logPodFiles(createAdminClient(), useful.flatMap((i) => (i.files ?? []).filter((f) => f.path.startsWith('drive:')).map((f) => [
          when, byId.get(i.case_id)?.client_display_name ?? '', byId.get(i.case_id)?.awb ?? '', f.name, driveViewLink(f.path.slice(6)), user.full_name ?? user.email,
        ])));
      } catch (e) {
        console.error('POD file log sheet', e);
      }
    }
    let msg = `${r.shared} AWB(s) marked POD shared${nFiles ? ` with ${nFiles} file(s)` : ''} and added to the client email.`;
    if (str(fd, 'send') === '1') msg += ` ${describe(await flushClientOutbox(createAdminClient(), { clientIds: r.clients, trigger: 'manual', sentBy: user.id }))}`;
    else msg += ' Press "Send to client" when you are done — everything goes in one email.';
    dest = withFlash(back, 'ok', msg);
  } catch (e) {
    dest = withFlash(back, 'error', errorText(e));
  }
  revalidatePath(back.split('?')[0]);
  redirect(dest);
}

/** Team: send the waiting updates of one client (or all) now, as one email per client. */
export async function sendClientMail(fd: FormData) {
  const user = await requireInternal();
  const back = safeBack(str(fd, 'back'));
  let dest: string;
  try {
    const ids = fd.getAll('client_id').map(String).filter(Boolean);
    const rs = await flushClientOutbox(createAdminClient(), { clientIds: ids.length ? ids : undefined, trigger: 'manual', sentBy: user.id });
    dest = withFlash(back, rs.some((r) => r.status === 'failed') ? 'error' : 'ok', describe(rs));
  } catch (e) {
    dest = withFlash(back, 'error', errorText(e));
  }
  revalidatePath('/client-mail');
  redirect(dest);
}

/** Team: take an update out of the client email (it is not sent). */
export async function dropOutboxItem(fd: FormData) {
  await requireInternal();
  let dest: string;
  try {
    const sb = await createClient();
    must(await sb.from('client_outbox').update({ dropped: true }).eq('id', str(fd, 'id')).is('sent_at', null).select('id'));
    dest = withFlash('/client-mail', 'ok', 'Removed from the client email.');
  } catch (e) {
    dest = withFlash('/client-mail', 'error', errorText(e));
  }
  revalidatePath('/client-mail');
  redirect(dest);
}
