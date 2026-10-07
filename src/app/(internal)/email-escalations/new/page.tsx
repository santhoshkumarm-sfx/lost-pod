import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Empty, Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { errorText, param, type SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google/auth';
import { searchThreads, type ThreadHit } from '@/lib/google/gmail';
import { todayIn } from '@/lib/time';
import { importThread, pasteEmail } from '../actions';

export const metadata = { title: 'Add email escalation' };

export default async function NewEmailPage({ searchParams }: { searchParams: SearchParams }) {
  await requireInternal();
  const sp = await searchParams;
  const mode = param(sp, 'mode') === 'paste' ? 'paste' : 'gmail';
  const subject = param(sp, 'subject');
  const from = param(sp, 'from');
  const days = Number(param(sp, 'days')) || 0;
  const g = googleStatus();
  let hits: ThreadHit[] = [];
  let searchError: string | null = null;
  if (mode === 'gmail' && subject && g.gmail) {
    try {
      hits = await searchThreads(subject, { from: from || null, newerThanDays: days || null });
    } catch (e) {
      searchError = errorText(e);
    }
  }

  return (
    <>
      <PageHeader
        title="Add email escalation"
        sub="The email body is read directly (tables, lists and sentences). Gmail’s own summary is never used."
        actions={
          <nav className="flex gap-1">
            <Link href="/email-escalations/new" className={`btn btn-sm ${mode === 'gmail' ? 'border-ink bg-ink text-white hover:bg-ink' : ''}`}>Search Gmail</Link>
            <Link href="/email-escalations/new?mode=paste" className={`btn btn-sm ${mode === 'paste' ? 'border-ink bg-ink text-white hover:bg-ink' : ''}`}>Paste an email</Link>
          </nav>
        }
      />
      <Flash sp={sp} />
      {mode === 'gmail' ? (
        <>
          {!g.gmail && (
            <div className="mb-4 rounded border border-age-3/40 bg-[#FFF8EC] px-3 py-2">
              Gmail is not connected yet. Add the Google credentials (see README → Gmail) or use “Paste an email” meanwhile.
            </div>
          )}
          <Panel title={g.mailbox ? `Search the ${g.mailbox} mailbox` : 'Search Gmail'} className="mb-5">
            <form className="grid gap-3 md:grid-cols-[1fr_220px_140px_auto] md:items-end">
              <Field label="Email subject" hint="Re: and Fwd: are ignored, so the whole thread is found.">
                <input name="subject" required defaultValue={subject} className="input" placeholder="Re: POD needed - Shadowfax - 11-09-26" />
              </Field>
              <Field label="Sender (optional)"><input name="from" defaultValue={from} className="input" placeholder="name@client.com" /></Field>
              <Field label="Within (days)"><input name="days" type="number" min={1} defaultValue={days || ''} className="input" placeholder="Any" /></Field>
              <button className="btn btn-primary" disabled={!g.gmail}>Search</button>
            </form>
          </Panel>
          {subject && g.gmail && (
            <Panel title={`Threads matching “${subject}”`} bodyClass="tbl-wrap">
              {searchError ? (
                <p className="p-4 text-age-5">{searchError}</p>
              ) : hits.length ? (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Started by</th>
                      <th>Date</th>
                      <th className="text-right">Messages</th>
                      <th>Latest message</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h) => (
                      <tr key={h.threadId}>
                        <td className="font-medium">{h.subject ?? '(no subject)'}</td>
                        <td className="max-w-[220px] truncate">{h.from}</td>
                        <td className="whitespace-nowrap">{fmtDateTime(h.date)}</td>
                        <td className="text-right">{h.messageCount}</td>
                        <td className="max-w-[320px] truncate text-ink-soft">{h.snippet}</td>
                        <td>
                          <form action={importThread}>
                            <input type="hidden" name="thread_id" value={h.threadId} />
                            <input type="hidden" name="subject" value={subject} />
                            <SubmitButton className="btn btn-sm btn-primary" pending="Reading…">Use this thread</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty title="No thread with this subject">Check the spelling, remove the date part of the subject, or widen the day range.</Empty>
              )}
            </Panel>
          )}
        </>
      ) : (
        <Panel title="Paste an email">
          <form action={pasteEmail} className="grid gap-4 md:grid-cols-3">
            <Field label="Subject"><input name="subject" className="input" /></Field>
            <Field label="From"><input name="from" className="input" placeholder="Name <name@client.com>" /></Field>
            <Field label="Date received"><input type="date" name="date" defaultValue={todayIn()} max={todayIn()} className="input" /></Field>
            <Field label="Email text" className="md:col-span-3" hint="Paste the whole message, including any AWB table.">
              <textarea name="body" required rows={12} className="input font-mono text-xs" />
            </Field>
            <div><SubmitButton pending="Reading…">Read email</SubmitButton></div>
          </form>
        </Panel>
      )}
    </>
  );
}
