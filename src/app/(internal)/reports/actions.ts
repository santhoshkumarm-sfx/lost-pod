'use server';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { errorText, str, withFlash } from '@/lib/flash';
import { sendDailyReport } from '@/lib/reports/daily';
import { createAdminClient } from '@/lib/supabase/admin';

export async function sendReportNow(fd: FormData) {
  const user = await requireAdmin();
  let dest: string;
  try {
    const to = str(fd, 'to') ? str(fd, 'to').split(/[,\s]+/).filter((e) => e.includes('@')) : undefined;
    const r = await sendDailyReport(createAdminClient(), { trigger: 'manual', triggeredBy: user.id, to });
    dest = withFlash('/reports', 'ok', `Report sent to ${r.recipients.join(', ')}.`);
  } catch (e) {
    dest = withFlash('/reports', 'error', `Report not sent: ${errorText(e)}`);
  }
  redirect(dest);
}
