import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Flash, PageHeader, Panel } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { KIND_LABEL } from '@/lib/client-mail';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google';
import { createClient } from '@/lib/supabase/server';
import { dropOutboxItem, sendClientMail } from './actions';

export const metadata = { title: 'Client mail' };

interface Item { id: string; client_id: string | null; case_id: string | null; awb: string; kind: string; pod_link: string | null; note: string | null; created_at: string; updated_at: string; clients: { name: string } | null }

/** Updates waiting to go to each client — sent as ONE email per client. */
export default async function ClientMailPage({ searchParams }: { searchParams: SearchParams }) {
  await requireInternal();
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: items }, { data: files }, { data: batches }, { data: quiet }] = await Promise.all([
    sb.from('client_outbox').select('id, client_id, case_id, awb, kind, pod_link, note, created_at, updated_at, clients(name)')
      .is('sent_at', null).eq('dropped', false).order('created_at').limit(3000),
    sb.from('pod_files').select('outbox_id, filename').not('outbox_id', 'is', null).limit(5000),
    sb.from('client_mail_batches').select('id, client_id, items, files, recipients, subject, status, error, trigger, created_at, clients(name)').order('created_at', { ascending: false }).limit(30),
    sb.from('app_settings').select('value').eq('key', 'client_mail_quiet_minutes').maybeSingle(),
  ]);
  const list = (items ?? []) as unknown as Item[];
  const fileCount = new Map<string, string[]>();
  for (const f of (files ?? []) as { outbox_id: string; filename: string }[]) fileCount.set(f.outbox_id, [...(fileCount.get(f.outbox_id) ?? []), f.filename]);
  const groups = new Map<string, Item[]>();
  for (const i of list) groups.set(i.client_id ?? '', [...(groups.get(i.client_id ?? '') ?? []), i]);
  const gmail = googleStatus().gmail;
  return (
    <>
      <PageHeader
        title="Client mail"
        actions={groups.size > 1 ? (
          <form action={sendClientMail}><input type="hidden" name="back" value="/client-mail" />
            <SubmitButton className="btn btn-primary" pending="Sending…" disabled={!gmail} confirm="Send every client their email now?">Send all ({groups.size} clients)</SubmitButton>
          </form>
        ) : undefined}
      />
      <Flash sp={sp} />
      {!gmail && <p className="mb-4 text-age-4">Gmail is not connected, so nothing can be sent yet.</p>}
      <p className="mb-4 text-ink-soft">Each client gets one email with all their AWBs, POD files attached and named by AWB. Sent automatically {Number(quiet?.value ?? 30)} minutes after the last change, when automatic emails are on.</p>
      {[...groups.entries()].map(([cid, its]) => (
        <Panel key={cid} className="mb-5" title={`${its[0].clients?.name ?? 'No client'} — ${its.length} AWB${its.length === 1 ? '' : 's'} waiting`}
          actions={
            <form action={sendClientMail}>
              <input type="hidden" name="client_id" value={cid} /><input type="hidden" name="back" value="/client-mail" />
              <SubmitButton className="btn btn-primary btn-sm" pending="Sending…" disabled={!gmail}>Send to client</SubmitButton>
            </form>
          }
          bodyClass="tbl-wrap">
          <table className="tbl w-full table-fixed">
            <colgroup><col style={{ width: 190 }} /><col style={{ width: 200 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 90 }} /></colgroup>
            <thead><tr><th>AWB</th><th>Update</th><th>POD / note</th><th>Added</th><th /></tr></thead>
            <tbody>
              {its.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs">{i.case_id ? <Link href={`/cases/${i.case_id}`}>{i.awb}</Link> : i.awb}</td>
                  <td>{KIND_LABEL[i.kind] ?? i.kind}</td>
                  <td className="truncate">
                    {(fileCount.get(i.id) ?? []).length > 0 && <span>{fileCount.get(i.id)!.length} file(s): {fileCount.get(i.id)!.join(', ')} </span>}
                    {i.pod_link && !i.pod_link.includes('/pod/') && <a href={i.pod_link} target="_blank" rel="noreferrer">Open POD</a>}
                    {i.note && <span className="text-ink-soft"> {i.note}</span>}
                  </td>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(i.updated_at)}</td>
                  <td>
                    <form action={dropOutboxItem}><input type="hidden" name="id" value={i.id} />
                      <SubmitButton className="btn btn-sm" confirm={`Leave AWB ${i.awb} out of the client email?`}>Remove</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
      {!groups.size && <Panel className="mb-5"><p className="text-ink-soft">Nothing waiting. PODs shared by the team and Lost decisions appear here until they are emailed.</p></Panel>}
      <Panel title="Sent" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th>Client</th><th className="text-right">AWBs</th><th className="text-right">Files</th><th>To</th><th>Result</th></tr></thead>
          <tbody>
            {((batches ?? []) as unknown as { id: string; items: number; files: number; recipients: string[]; subject: string | null; status: string; error: string | null; trigger: string; created_at: string; clients: { name: string } | null }[]).map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap">{fmtDateTime(b.created_at)}</td>
                <td>{b.clients?.name ?? '—'}</td>
                <td className="text-right">{b.items}</td>
                <td className="text-right">{b.files}</td>
                <td className="max-w-[320px] truncate" title={b.recipients.join(', ')}>{b.recipients.join(', ')}</td>
                <td className={b.status === 'failed' ? 'text-age-5' : ''}>{b.status === 'sent' ? `Sent${b.trigger === 'auto' ? ' (automatic)' : ''}` : `Failed: ${b.error ?? ''}`}</td>
              </tr>
            ))}
            {!batches?.length && <tr><td colSpan={6} className="py-4 text-center text-ink-soft">Nothing sent yet.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
