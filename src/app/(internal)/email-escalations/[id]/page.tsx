import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/buttons';
import { EmailReviewForm } from '@/components/EmailReviewForm';
import { Flash, Panel } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import type { Extraction } from '@/lib/email/extract';
import type { StoredMessage } from '@/lib/email/import';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { getAgents, getClients, getPocs } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { createFromEmail, reExtract, setEmailStatus } from '../actions';

export const metadata = { title: 'Review email' };

export default async function EmailReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireInternal();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: email } = await supabase.from('emails').select('*').eq('id', id).maybeSingle();
  if (!email) notFound();
  const x = (email.extraction ?? { rows: [], common: {}, confidence: {}, missing: [], notes: [] }) as Extraction;
  const messages = (email.messages ?? []) as StoredMessage[];
  const awbs = x.rows.map((r) => r.awb);
  const [clients, pocs, agents, existing, linked] = await Promise.all([
    getClients(supabase, true),
    getPocs(supabase),
    getAgents(supabase),
    awbs.length ? supabase.rpc('find_existing_cases', { p_awbs: awbs }) : Promise.resolve({ data: [] }),
    supabase.from('v_cases').select('id, case_number, awb, status_label').eq('email_id', id),
  ]);
  const processed = email.status === 'processed';

  return (
    <>
      <div className="mb-1 text-xs text-ink-faint">
        <Link href="/email-escalations">Email escalations</Link> / review
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{email.subject || '(no subject)'}</h1>
          <p className="mt-1 text-ink-soft">
            From {email.sender ?? 'unknown sender'} on {fmtDateTime(email.email_date)}. {messages.length} message{messages.length === 1 ? '' : 's'} in the thread.
          </p>
        </div>
        <div className="flex gap-2">
          {!processed && (
            <>
              <form action={reExtract}>
                <input type="hidden" name="id" value={id} />
                <SubmitButton className="btn" pending="Reading…">Read again</SubmitButton>
              </form>
              {email.status === 'ignored' ? (
                <form action={setEmailStatus}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value="needs_review" />
                  <SubmitButton className="btn">Move back to review</SubmitButton>
                </form>
              ) : (
                <form action={setEmailStatus}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value="ignored" />
                  <SubmitButton className="btn btn-ghost" confirm="Ignore this email? No cases will be created.">Ignore email</SubmitButton>
                </form>
              )}
            </>
          )}
        </div>
      </div>
      <Flash sp={sp} />
      {processed && (
        <div className="mb-4 rounded border border-age-0/40 bg-[#E6F3F1] px-3 py-2">
          Cases were created from this email on {fmtDateTime(email.processed_at)}:{' '}
          {(linked.data ?? []).map((c, i) => (
            <span key={c.id}>
              {i ? ', ' : ''}
              <Link href={`/cases/${c.id}`} className="awb">{c.awb}</Link>
            </span>
          ))}
        </div>
      )}
      {!!x.notes?.length && (
        <ul className="mb-4 list-inside list-disc text-ink-soft">
          {x.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]">
        <div>
          <EmailReviewForm
            emailId={id}
            extraction={x}
            clients={clients}
            pocs={pocs.filter((p) => p.is_active)}
            agents={agents}
            existing={(existing.data ?? []) as never[]}
            defaultAgent={user.id}
            action={createFromEmail}
            readOnly={processed || email.status === 'ignored'}
          />
        </div>
        <Panel title="Email thread" bodyClass="max-h-[78vh] overflow-y-auto">
          <ol className="divide-y divide-line">
            {messages.map((m) => (
              <li key={m.id} className={`px-4 py-3 ${m.id === x.source_message_id ? 'bg-signal-soft/40' : ''}`}>
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
                  <span className="font-medium text-ink">{m.from ?? 'Unknown sender'}</span>
                  <span className="text-ink-faint">{fmtDateTime(m.date)}</span>
                </div>
                {m.id === x.source_message_id && <div className="mb-1 text-2xs font-semibold text-signal">Details were read from this message</div>}
                <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink">{m.text}</pre>
                {!!m.attachments?.length && <div className="mt-1 text-xs text-ink-faint">Attachments: {m.attachments.join(', ')}</div>}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
