import Link from 'next/link';
import { requirePoc } from '@/lib/auth';
import { KIND_LABEL } from '@/lib/client-mail';
import { fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Updates' };

interface Item { id: string; case_id: string | null; awb: string; kind: string; pod_link: string | null; note: string | null; created_at: string }

/** Client: everything Shadowfax shared or decided (PODs, Lost decisions), newest first. Opening the page marks the alerts read. */
export default async function UpdatesPage() {
  const user = await requirePoc();
  const sb = await createClient();
  const [{ data: notes }, { data: items }] = await Promise.all([
    sb.from('notifications').select('id, title, body, created_at, read_at').order('created_at', { ascending: false }).limit(20),
    sb.from('client_outbox').select('id, case_id, awb, kind, pod_link, note, created_at').order('created_at', { ascending: false }).limit(300),
  ]);
  const list = (items ?? []) as Item[];
  const ids = list.map((i) => i.case_id).filter((x): x is string => !!x);
  const { data: files } = ids.length ? await sb.from('pod_files').select('id, case_id, filename').in('case_id', ids) : { data: [] };
  const byCase = new Map<string, { id: string; filename: string }[]>();
  for (const f of (files ?? []) as { id: string; case_id: string; filename: string }[]) byCase.set(f.case_id, [...(byCase.get(f.case_id) ?? []), f]);
  const unread = (notes ?? []).filter((n) => !n.read_at).map((n) => n.id);
  if (unread.length) await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread).eq('user_id', user.id);
  return (
    <>
      <h1 className="mb-4">Updates</h1>
      {(notes ?? []).filter((n) => !n.read_at).map((n) => (
        <p key={n.id} className="mb-2 rounded border border-signal/40 bg-[#EEF3FB] px-4 py-2"><strong>New:</strong> {n.title} <span className="text-ink-soft">({fmtDateTime(n.created_at)})</span></p>
      ))}
      <section className="panel tbl-wrap">
        <table className="tbl w-full">
          <thead><tr><th>When</th><th>AWB</th><th>Update</th><th>POD</th><th>Note</th></tr></thead>
          <tbody>
            {list.map((i) => {
              const fs = i.case_id ? byCase.get(i.case_id) ?? [] : [];
              return (
                <tr key={i.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(i.created_at)}</td>
                  <td className="font-mono text-xs">{i.case_id ? <Link href={`/portal/cases/${i.case_id}`}>{i.awb}</Link> : i.awb}</td>
                  <td>{KIND_LABEL[i.kind] ?? i.kind}</td>
                  <td>
                    {fs.map((f, k) => <span key={f.id}>{k ? ', ' : ''}<a href={`/api/pod-file/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a></span>)}
                    {!fs.length && i.pod_link && <a href={i.pod_link} target="_blank" rel="noreferrer">Open POD</a>}
                    {!fs.length && !i.pod_link && '—'}
                  </td>
                  <td className="text-ink-soft">{i.note ?? ''}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={5} className="py-6 text-center text-ink-soft">No updates yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
