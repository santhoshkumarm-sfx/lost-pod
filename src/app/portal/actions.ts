'use server';
import { redirect } from 'next/navigation';
import { requirePoc } from '@/lib/auth';
import { errorText, str, withFlash } from '@/lib/flash';
import { requestLostForCases } from '@/lib/lost';
import { addPendingCases } from '@/lib/cases/add';
import { parseUpload, type UploadRow } from '@/lib/cases/upload';
import { cleanAwb } from '@/lib/normalize/awb';
import { strOrNull } from '@/lib/flash';
import { todayIn } from '@/lib/time';
import { createClient } from '@/lib/supabase/server';

/** A POC can only ask for Lost. The database checks the case belongs to their client and never sets final Lost. */
export async function pocRequestLost(fd: FormData) {
  const user = await requirePoc();
  const id = str(fd, 'id');
  let dest = withFlash(`/portal/cases/${id}`, 'ok', 'Lost request sent. Shadowfax will review it; the shipment is not Lost until approved.');
  try {
    await requestLostForCases(user, [id], str(fd, 'reason'), 'the client portal');
  } catch (e) {
    dest = withFlash(`/portal/cases/${id}`, 'error', errorText(e));
  }
  redirect(dest);
}

/** Several shipments at once from the portal list. */
export async function pocRequestLostBulk(fd: FormData) {
  const user = await requirePoc();
  const back = str(fd, 'back') || '/portal';
  let dest: string;
  try {
    const ids = fd.getAll('ids').map(String).filter(Boolean);
    const msg = await requestLostForCases(user, ids, str(fd, 'reason'), 'the client portal');
    dest = withFlash(back, 'ok', `${msg} Track it under Lost requests. Shipments are not Lost until Shadowfax approves.`);
  } catch (e) {
    dest = withFlash(back, 'error', errorText(e));
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

async function pocClient(fd: FormData): Promise<string> {
  const sb = await createClient();
  const { data } = await sb.from('clients').select('id').order('name');
  const mine = ((data ?? []) as { id: string }[]).map((c) => c.id);
  const chosen = str(fd, 'client_id') || mine[0];
  if (!chosen || !mine.includes(chosen)) throw new Error('Your login is not linked to a client yet. Ask Shadowfax to link it.');
  return chosen;
}

/** Client adds shipments that still need a POD, by hand. */
export async function pocAddCases(fd: FormData) {
  const user = await requirePoc();
  let dest: string;
  try {
    const clientId = await pocClient(fd);
    const today = todayIn();
    const esc = str(fd, 'escalation_date') || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(esc) || esc > today) throw new Error('Choose an escalation date that is not in the future.');
    const raw = str(fd, 'awbs').split(/[\s,;]+/).filter(Boolean);
    const awbs = [...new Set(raw.map((a) => cleanAwb(a)).filter((a): a is string => !!a))];
    if (!awbs.length) throw new Error('Enter at least one valid AWB.');
    if (awbs.length > 500) throw new Error('At most 500 AWBs at once — use the Excel upload for more.');
    const common = { hub: strOrNull(fd, 'hub') ?? undefined, location: strOrNull(fd, 'location') ?? undefined, reason: strOrNull(fd, 'reason') ?? undefined, remark: strOrNull(fd, 'remark') ?? undefined };
    const rows: UploadRow[] = awbs.map((awb, i) => ({ row: i + 1, awb, escalation_date: esc, ...common }));
    const r = await addPendingCases({ user, clientId, rows, total: rows.length, method: 'manual' });
    dest = withFlash(`/portal/new?upload=${r.uploadId ?? ''}`, r.created ? 'ok' : 'error', `${r.created} shipment(s) added${r.skipped ? `, ${r.skipped} not added — see why below` : ''}. Shadowfax will share the POD or update you.`);
  } catch (e) {
    dest = withFlash('/portal/new', 'error', errorText(e));
  }
  redirect(dest);
}

/** Client uploads the fixed-format Excel. */
export async function pocUploadCases(fd: FormData) {
  const user = await requirePoc();
  let dest: string;
  try {
    const clientId = await pocClient(fd);
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choose the filled-in Excel file.');
    if (file.size > 4 * 1024 * 1024) throw new Error('The file is larger than 4 MB. Split it into smaller files.');
    const parsed = await parseUpload(await file.arrayBuffer(), { forClient: true, clients: [], today: todayIn() });
    const r = await addPendingCases({ user, clientId, rows: parsed.rows, parseProblems: parsed.problems, total: parsed.total, method: 'excel', file });
    dest = withFlash(`/portal/new?upload=${r.uploadId ?? ''}`, r.created ? 'ok' : 'error', `${r.created} shipment(s) added${r.skipped ? `, ${r.skipped} row(s) not added — see why below` : ''}.`);
  } catch (e) {
    dest = withFlash('/portal/new', 'error', errorText(e));
  }
  redirect(dest);
}
