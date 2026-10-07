import Link from 'next/link';
import { Empty, Flash, PageHeader } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Email escalations' };

const TABS = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'processed', label: 'Cases created' },
  { key: 'ignored', label: 'Ignored' },
];

export default async function EmailsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireInternal();
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === param(sp, 'status')) ? param(sp, 'status') : 'needs_review';
  const q = param(sp, 'q');
  const supabase = await createClient();
  let query = supabase
    .from('emails')
    .select('id, subject, sender, email_date, status, extraction, client_id, created_at, processed_at, clients(name)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(200);
  if (q) query = query.ilike('subject', `%${q.replace(/[%_]/g, '')}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];

  return (
    <>
      <PageHeader
        title="Email escalations"
        sub="Find a client escalation in Gmail by its subject, check what was read from it, and create one case per AWB."
        actions={
          <>
            <Link href="/email-escalations/new?mode=paste" className="btn">Paste an email</Link>
            <Link href="/email-escalations/new" className="btn btn-primary">Find email in Gmail</Link>
          </>
        }
      />
      <Flash sp={sp} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <Link key={t.key} href={`/email-escalations?status=${t.key}`} className={`btn btn-sm ${status === t.key ? 'border-ink bg-ink text-white hover:bg-ink' : ''}`}>
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input name="q" defaultValue={q} placeholder="Subject contains" className="input w-64" />
          <button className="btn">Search</button>
        </form>
      </div>
      <section className="panel tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Sender</th>
              <th>Client</th>
              <th>Email date</th>
              <th className="text-right">AWBs found</th>
              <th>Needs attention</th>
              <th>Imported</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td><Link href={`/email-escalations/${e.id}`}>{e.subject || '(no subject)'}</Link></td>
                <td className="max-w-[220px] truncate">{e.sender ?? '—'}</td>
                <td>{e.clients?.name ?? <span className="text-age-3">Not identified</span>}</td>
                <td className="whitespace-nowrap">{fmtDateTime(e.email_date)}</td>
                <td className="text-right">{e.extraction?.rows?.length ?? 0}</td>
                <td className="text-ink-soft">{(e.extraction?.missing ?? []).map((m: string) => m.replace('_', ' ')).join(', ') || '—'}</td>
                <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <Empty title={status === 'needs_review' ? 'Nothing waiting for review' : 'No emails here'}>
            Use “Find email in Gmail” and type the mail subject, for example “Re: POD needed - Shadowfax - 11-09-26”.
          </Empty>
        )}
      </section>
    </>
  );
}
