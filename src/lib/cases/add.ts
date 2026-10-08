import 'server-only';
import type { SessionUser } from '../auth';
import { bridgeConfigured, callBridge } from '../google';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { todayIn } from '../time';
import type { UploadProblem, UploadRow } from './upload';

export interface AddResult { created: number; skipped: number; uploadId: string | null; driveUrl: string | null }

/** Keeps the uploaded file in the bridge owner's Drive: "Lost POD uploads/<client or Shadowfax team>/". */
async function saveToDrive(file: File, folder: string, who: string): Promise<{ url: string | null; error: string | null }> {
  if (!bridgeConfigured()) return { url: null, error: 'Google bridge not connected' };
  try {
    const stamp = new Date(Date.now() + 19800000).toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    const r = await callBridge<{ url: string }>('saveFile', {
      folder: 'Lost POD uploads', subFolder: folder, filename: `${stamp} ${who} — ${file.name}`,
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    }, 60_000);
    return { url: r.url, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url: null, error: /Unknown action/i.test(msg) ? 'Update Bridge.gs to the latest version to keep uploads in Drive' : msg.slice(0, 300) };
  }
}

/** Creates the cases (database checks who may add what), keeps the file in Drive and logs the upload. */
export async function addPendingCases(input: {
  user: SessionUser; clientId: string | null; rows: UploadRow[]; parseProblems?: UploadProblem[]; total?: number;
  force?: boolean; method: 'excel' | 'manual'; file?: File | null; agentId?: string | null;
}): Promise<AddResult> {
  const sb = await createClient();
  const rows = input.rows.map((r) => ({ ...r, assigned_agent: input.agentId ?? undefined }));
  let created = 0;
  const dbProblems: UploadProblem[] = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const { data, error } = await sb.rpc('create_pending_cases', { p_client_id: input.clientId, p_rows: rows.slice(i, i + 1000), p_force: !!input.force });
    if (error) throw error;
    const r = data as { created: number; skipped: UploadProblem[] };
    created += r.created;
    dbProblems.push(...r.skipped);
  }
  const problems = [...(input.parseProblems ?? []), ...dbProblems].sort((a, b) => a.row - b.row);
  const admin = createAdminClient();
  let folder = 'Shadowfax team';
  if (input.user.role === 'client_poc' && input.clientId) {
    const { data } = await admin.from('clients').select('name').eq('id', input.clientId).maybeSingle();
    folder = data?.name ?? 'Clients';
  }
  const drive = input.file ? await saveToDrive(input.file, folder, input.user.full_name ?? input.user.email) : { url: null, error: null };
  const { data: log } = await admin.from('case_uploads').insert({
    uploaded_by: input.user.id, uploader_name: input.user.full_name ?? input.user.email, client_id: input.clientId,
    method: input.method, filename: input.file?.name ?? null, total_rows: input.total ?? input.rows.length, created,
    skipped: problems.length, problems: problems.slice(0, 2000), drive_url: drive.url, drive_error: drive.error,
  }).select('id').single();
  return { created, skipped: problems.length, uploadId: (log as { id: string } | null)?.id ?? null, driveUrl: drive.url };
}

export const today = () => todayIn();
