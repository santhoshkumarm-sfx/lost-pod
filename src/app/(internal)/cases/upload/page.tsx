import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { UPLOAD_COLUMNS_SQL, UploadHistory, UploadResult, type UploadLog } from '@/components/uploads';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import { UPLOAD_COLUMNS } from '@/lib/cases/upload';
import { param, type SearchParams } from '@/lib/flash';
import { googleStatus } from '@/lib/google';
import { getAgents, getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { uploadCases } from './actions';

export const metadata = { title: 'Upload pending cases' };

export default async function UploadCasesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const uploadId = param(sp, 'upload');
  const [clients, agents, recent, current] = await Promise.all([
    getClients(supabase, true),
    getAgents(supabase),
    supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).order('created_at', { ascending: false }).limit(20),
    /^[0-9a-f-]{36}$/.test(uploadId) ? supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).eq('id', uploadId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const g = googleStatus();
  return (
    <>
      <PageHeader
        title="Upload pending cases"
        sub="Add many escalations at once from the fixed-format Excel. Each row becomes a pending case; AWBs that are already open are skipped and listed."
        actions={<><Link href="/cases/new" className="btn">Add by hand</Link><a href="/api/template/pending-cases" className="btn btn-primary">Download template</a></>}
      />
      <Flash sp={sp} />
      {current.data && <UploadResult u={current.data as unknown as UploadLog} casesHref="/cases?category=pending_pod&sort=updated_at&dir=desc" />}
      <div className="mb-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel title="Upload the filled-in template">
          <form action={uploadCases} className="space-y-3">
            <Field label="Excel file (.xlsx)">
              <input type="file" name="file" accept=".xlsx" required className="input" />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Client for rows without a Client" hint="Leave empty if every row has a Client.">
                <select name="client_id" className="input" defaultValue="">
                  <option value="">Use the Client column</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Assign to">
                <select name="assigned_agent" className="input" defaultValue="">
                  <option value="">Nobody yet</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
                </select>
              </Field>
            </div>
            {isAdminRole(user.role) && (
              <label className="flex items-center gap-2"><input type="checkbox" name="force" value="1" /> Create even if an open case already exists for the AWB</label>
            )}
            <SubmitButton pending="Reading and creating…">Upload and create cases</SubmitButton>
            <p className="text-xs text-ink-soft">
              {g.sheets ? 'The file is also saved in Google Drive (Lost POD uploads / Shadowfax team).' : 'Connect the Google bridge to also keep the files in Google Drive.'}
            </p>
          </form>
        </Panel>
        <Panel title="Template columns">
          <ul className="space-y-1 text-xs">
            {UPLOAD_COLUMNS.map((c) => <li key={c.key}><strong>{c.header}</strong>{c.required ? ' (required)' : ''} — <span className="text-ink-soft">{c.note || 'optional'}</span></li>)}
          </ul>
        </Panel>
      </div>
      <UploadHistory uploads={(recent.data ?? []) as unknown as UploadLog[]} showClient hrefFor={(id) => `/cases/upload?upload=${id}`} />
    </>
  );
}
