'use server';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { errorText, str, withFlash } from '@/lib/flash';
import { sendDailyReport } from '@/lib/reports/daily';
import { sendWeeklyReport } from '@/lib/reports/weekly';
import { sendCriticalAlert } from '@/lib/reports/critical';
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

export async function sendWeeklyNow(fd: FormData) {
  const user = await requireAdmin();
  let dest: string;
  try {
    const to = str(fd, 'to') ? str(fd, 'to').split(/[,\s]+/).filter((e) => e.includes('@')) : undefined;
    const r = await sendWeeklyReport(createAdminClient(), { trigger: 'manual', triggeredBy: user.id, to });
    dest = withFlash('/reports?r=weekly', 'ok', `Weekly summary sent to ${r.recipients.join(', ')}.`);
  } catch (e) {
    dest = withFlash('/reports?r=weekly', 'error', `Weekly summary not sent: ${errorText(e)}`);
  }
  redirect(dest);
}

export async function sendCriticalNow(fd: FormData) {
  const user = await requireAdmin();
  let dest: string;
  try {
    const to = str(fd, 'to') ? str(fd, 'to').split(/[,\s]+/).filter((e) => e.includes('@')) : undefined;
    const r = await sendCriticalAlert(createAdminClient(), { trigger: 'manual', triggeredBy: user.id, to });
    dest = withFlash('/reports?r=critical', 'ok', `Critical alert (${r.critical} shipments) sent to ${r.recipients.join(', ')}${r.agents ? ` and ${r.agents} agent(s)` : ''}.`);
  } catch (e) {
    dest = withFlash('/reports?r=critical', 'error', `Critical alert not sent: ${errorText(e)}`);
  }
  redirect(dest);
}
