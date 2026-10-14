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
      sb.from('pod_files').select('id, filename, created_at').eq('case_id', caseId).order('created_at'),
    ])
    : [{ data: null }, { data: [] }];
  const home = user.role === 'client_poc' ? '/portal' : `/cases/${caseId}`;
  return (
    <main className="mx-auto max-w-[720px] px-6 py-10">
      <h1 className="mb-1">POD {c?.awb ?? ''}</h1>
      <p className="mb-5 text-ink-soft">{c?.client_display_name ?? ''}</p>
      {files?.length ? (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="panel flex items-center justify-between px-4 py-3">
              <a href={`/api/pod-file/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a>
              <span className="text-xs text-ink-soft">{fmtDateTime(f.created_at)}</span>
            </li>
          ))}
        </ul>
      ) : <p>No POD files for this shipment, or you do not have access to it.</p>}
      <p className="mt-6"><Link href={home}>Back</Link></p>
    </main>
  );
}
