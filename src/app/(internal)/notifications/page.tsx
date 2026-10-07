import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { SubmitButton } from '@/components/buttons';
import { Empty, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Notifications' };

async function markAllRead() {
  'use server';
  await requireUser();
  const sb = await createClient();
  await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  revalidatePath('/', 'layout');
}

export default async function NotificationsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  const rows = data ?? [];
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={rows.some((r) => !r.read_at) && (
          <form action={markAllRead}><SubmitButton className="btn">Mark all as read</SubmitButton></form>
        )}
      />
      <section className="panel divide-y divide-line">
        {rows.map((n) => (
          <div key={n.id} className={`px-4 py-3 ${n.read_at ? '' : 'border-l-4 border-l-age-3'}`}>
            <div className="flex justify-between gap-3">
              <span className="font-medium">{n.link || n.case_id ? <Link href={n.link ?? `/cases/${n.case_id}`}>{n.title}</Link> : n.title}</span>
              <span className="whitespace-nowrap text-xs text-ink-faint">{fmtDateTime(n.created_at)}</span>
            </div>
            {n.body && <p className="mt-0.5 text-ink-soft">{n.body}</p>}
          </div>
        ))}
        {!rows.length && <Empty title="No notifications" />}
      </section>
    </>
  );
}
