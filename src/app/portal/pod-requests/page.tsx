import { UPLOAD_COLUMNS_SQL, UploadHistory, UploadResult, type PodItemRow, type UploadLog } from '@/components/uploads';
import { Flash } from '@/components/ui';
import { requirePoc } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Requested PODs' };

/** Every POD request of this client (PR-n) and, when one is opened, its consolidated result with links. */
export default async function PodRequests({ searchParams }: { searchParams: SearchParams }) {
  await requirePoc();
  const sp = await searchParams;
  const supabase = await createClient();
  const id = param(sp, 'upload');
  const valid = /^[0-9a-f-]{36}$/.test(id);
  const [list, current, items] = await Promise.all([
    supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).order('created_at', { ascending: false }).limit(100),
    valid ? supabase.from('case_uploads').select(UPLOAD_COLUMNS_SQL).eq('id', id).maybeSingle() : Promise.resolve({ data: null }),
    valid ? supabase.from('pod_request_items').select('awb, result, pod_link, other_links, case_id').eq('upload_id', id) : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Requested PODs</h1>
          <p className="mt-1 text-ink-soft">Your POD requests. Open one to see the PODs found (with links and an Excel) and which are still being worked on.</p>
        </div>
        <a href="/portal/new" className="btn btn-primary">Request POD</a>
      </div>
      <Flash sp={sp} />
      {current.data && (
        <UploadResult u={current.data as unknown as UploadLog} casesHref="/portal?category=pending_pod" items={(items.data ?? []) as PodItemRow[]} caseHref={(c) => `/portal/cases/${c}`} />
      )}
      <UploadHistory uploads={(list.data ?? []) as unknown as UploadLog[]} hrefFor={(u) => `/portal/pod-requests?upload=${u}`} />
    </>
  );
}
