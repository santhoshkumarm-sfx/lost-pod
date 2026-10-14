import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'POD' };

/** The POD files of one shipment (the link in client emails when a POD was shared as files). */
export default async function PodFilesPage({ params }: { params: Promise<{ caseId: string }> }) {
  const user = await requireUser();
  const { caseId } = await params;
  const sb = await createClient();
  const ok = /^[0-9a-f-]{36}$/i.test(caseId);
  const [{ data: c }, { data: files }] = ok
    ? await Promise.all([
      sb.from('v_cases').select('id, awb, client_display_name').eq('id', caseId).maybeSingle(),
      sb.from('pod_files').select('id, filename, content_type, created_at').eq('case_id', caseId).order('created_at'),
    ])
    : [{ data: null }, { data: [] }];
  const home = user.role === 'client_poc' ? '/portal' : `/cases/${caseId}`;
  return (
    <main className="mx-auto max-w-[1000px] px-6 py-10">
      <h1 className="mb-1">POD {c?.awb ?? ''}</h1>
      <p className="mb-5 text-ink-soft">{c?.client_display_name ?? ''}</p>
      {files?.length ? (
        <div className="space-y-5">
          {files.map((f) => (
            <section key={f.id} className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <a href={`/api/pod-file/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a>
                <span className="text-xs text-ink-soft">{fmtDateTime(f.created_at)}</span>
              </div>
              {/^image\//.test(f.content_type ?? '') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/pod-file/${f.id}`} alt={f.filename} className="mx-auto max-h-[80vh]" />
              ) : /pdf/.test(f.content_type ?? '') ? (
                <iframe src={`/api/pod-file/${f.id}`} title={f.filename} className="h-[80vh] w-full border-0" />
              ) : (
                <p className="px-4 py-3"><a href={`/api/pod-file/${f.id}`}>Download</a></p>
              )}
            </section>
          ))}
        </div>
      ) : <p>No POD files for this shipment, or you do not have access to it.</p>}
      <p className="mt-6"><Link href={home}>Back</Link></p>
    </main>
  );
}
