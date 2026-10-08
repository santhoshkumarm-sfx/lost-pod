'use server';
import { redirect } from 'next/navigation';
import { isAdminRole, requireInternal } from '@/lib/auth';
import { addPendingCases } from '@/lib/cases/add';
import { parseUpload } from '@/lib/cases/upload';
import { errorText, str, strOrNull, withFlash } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';

/** Internal team: fixed-format Excel → pending cases (any client). */
export async function uploadCases(fd: FormData) {
  const user = await requireInternal();
  let dest: string;
  try {
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choose the filled-in Excel file.');
    if (file.size > 4 * 1024 * 1024) throw new Error('The file is larger than 4 MB. Split it into smaller files.');
    const sb = await createClient();
    const { data: clients } = await sb.from('clients').select('id, name, aliases, email_domains');
    const parsed = await parseUpload(await file.arrayBuffer(), { forClient: false, clients: (clients ?? []) as never, today: todayIn() });
    const clientId = strOrNull(fd, 'client_id');
    if (!clientId && parsed.rows.some((r) => !r.client_id)) throw new Error('Some rows have no Client. Fill the Client column or choose a client for the whole file.');
    const r = await addPendingCases({
      user, clientId, rows: parsed.rows, parseProblems: parsed.problems, total: parsed.total, method: 'excel', file,
      force: isAdminRole(user.role) && str(fd, 'force') === '1', agentId: strOrNull(fd, 'assigned_agent'),
    });
    dest = withFlash(`/cases/upload?upload=${r.uploadId ?? ''}`, r.created ? 'ok' : 'error', `${r.created} pending case(s) created${r.skipped ? `, ${r.skipped} row(s) not added — see the list` : ''}.`);
  } catch (e) {
    dest = withFlash('/cases/upload', 'error', errorText(e));
  }
  redirect(dest);
}
