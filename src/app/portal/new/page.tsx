import { SubmitButton } from '@/components/buttons';
import { UPLOAD_COLUMNS_SQL, UploadHistory, UploadResult, type UploadLog } from '@/components/uploads';
import { Field, Flash, Panel } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { UPLOAD_COLUMNS } from '@/lib/cases/upload';
import { param, type SearchParams } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';
import { pocAddCases, pocUploadCases } from '../actions';

export const metadata = { title: 'Add pending shipments' };

export default async function PortalNew({ searchParams }: { searchParams: SearchParams }) {
  await requirePoc();
  const sp = await searchParams;
  const supabase = await createClient();
  const uploadId = param(sp, 'upload');
  const [clientsRes, recent, current] = await Promise.all([
    supabase.from('clients').select('id, name').order('name'),
    supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).order('created_at', { ascending: false }).limit(15),
    /^[0-9a-f-]{36}$/.test(uploadId) ? supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).eq('id', uploadId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const clients = (clientsRes.data ?? []) as { id: string; name: string }[];
  const pick = clients.length > 1 && (
    <Field label="Client">
      <select name="client_id" className="input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    </Field>
  );
  return (
    <>
      <div className="mb-5">
        <h1>Add shipments that need a POD</h1>
        <p className="mt-1 text-ink-soft">Type the AWBs, or upload many at once with the Excel template. Shipments already being worked on are not added twice.</p>
      </div>
      <Flash sp={sp} />
      {current.data && <UploadResult u={current.data as unknown as UploadLog} casesHref="/portal?category=pending_pod&sort=updated_at&dir=desc" />}
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Add by hand">
          <form action={pocAddCases} className="space-y-3">
            {pick}
            <Field label="AWB(s)" hint="One per line, or separated by commas or spaces.">
              <textarea name="awbs" required rows={5} className="input font-mono" />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Escalation date"><input type="date" name="escalation_date" required max={todayIn()} defaultValue={todayIn()} className="input" /></Field>
              <Field label="Hub / location (optional)"><input name="hub" className="input" /></Field>
            </div>
            <Field label="Reason (optional)"><input name="reason" className="input" placeholder="e.g. Customer says not received" /></Field>
            <Field label="Remark (optional)"><input name="remark" className="input" /></Field>
            <SubmitButton pending="Adding…">Add shipments</SubmitButton>
          </form>
        </Panel>
        <Panel title="Upload Excel">
          <form action={pocUploadCases} className="space-y-3">
            <p><a href="/api/template/pending-cases" className="btn">Download the template</a></p>
            <p className="text-xs text-ink-soft">
              Columns: {UPLOAD_COLUMNS.filter((c) => !('internalOnly' in c)).map((c) => `${c.header}${c.required ? ' *' : ''}`).join(', ')}. Keep the header row as it is; dates as DD-MM-YYYY.
            </p>
            {pick}
            <Field label="Filled-in template (.xlsx)"><input type="file" name="file" accept=".xlsx" required className="input" /></Field>
            <SubmitButton pending="Reading and adding…">Upload and add</SubmitButton>
          </form>
        </Panel>
      </div>
      <UploadHistory uploads={(recent.data ?? []) as unknown as UploadLog[]} hrefFor={(id) => `/portal/new?upload=${id}`} />
    </>
  );
}
