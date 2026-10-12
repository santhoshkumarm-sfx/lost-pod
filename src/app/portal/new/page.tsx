import { SubmitButton } from '@/components/buttons';
import { UPLOAD_COLUMNS_SQL, UploadResult, type PodItemRow, type UploadLog } from '@/components/uploads';
import { Field, Flash, Panel } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { UPLOAD_COLUMNS } from '@/lib/cases/upload';
import { param, type SearchParams } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';
import { pocAddCases, pocUploadCases } from '../actions';

export const metadata = { title: 'Request POD' };

export default async function PortalNew({ searchParams }: { searchParams: SearchParams }) {
  await requirePoc();
  const sp = await searchParams;
  const supabase = await createClient();
  const uploadId = param(sp, 'upload');
  const [clientsRes, current, podItems] = await Promise.all([
    supabase.from('clients').select('id, name').order('name'),
    /^[0-9a-f-]{36}$/.test(uploadId) ? supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).eq('id', uploadId).maybeSingle() : Promise.resolve({ data: null }),
    /^[0-9a-f-]{36}$/.test(uploadId) ? supabase.from('pod_request_items').select('awb, result, pod_link, other_links, case_id').eq('upload_id', uploadId) : Promise.resolve({ data: [] }),
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
        <h1>Request POD</h1>
        <p className="mt-1 text-ink-soft">Type the AWBs, or upload many at once with the Excel template. As soon as you submit, every AWB is checked against the Shadowfax POD records: the PODs found are shared here and in one email; the rest become pending shipments that our team works on.</p>
      </div>
      <Flash sp={sp} />
      {current.data && <UploadResult u={current.data as unknown as UploadLog} casesHref="/portal?category=pending_pod&sort=updated_at&dir=desc" items={(podItems.data ?? []) as PodItemRow[]} caseHref={(id) => `/portal/cases/${id}`} />}
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
            <SubmitButton cancel pending="Checking PODs…">Request POD</SubmitButton>
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
            <SubmitButton cancel pending="Reading and checking PODs…">Upload and request POD</SubmitButton>
          </form>
        </Panel>
      </div>
      <p className="text-ink-soft">Earlier requests and their PODs: <a href="/portal/pod-requests">Requested PODs</a>.</p>
    </>
  );
}
