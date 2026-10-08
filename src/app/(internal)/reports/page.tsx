import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google';
import { createClient } from '@/lib/supabase/server';
import { sendCriticalNow, sendReportNow, sendWeeklyNow } from './actions';

export const metadata = { title: 'Reports' };
export const maxDuration = 120;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hh = (h: unknown) => `${String(Number(h) || 0).padStart(2, '0')}:00 IST`;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const kind = param(sp, 'r') === 'weekly' ? 'weekly' : param(sp, 'r') === 'critical' ? 'critical' : 'daily';
  const weekly = kind === 'weekly';
  const supabase = await createClient();
  const [runs, settingsRes] = await Promise.all([
    supabase.from('report_runs').select('*').order('run_at', { ascending: false }).limit(40),
    supabase.from('app_settings').select('key, value'),
  ]);
  const get = (k: string) => settingsRes.data?.find((r) => r.key === k)?.value;
  const list = (k: string) => ((get(k) ?? []) as string[]).join(', ');
  const schedule = kind === 'critical'
    ? get('critical_alert_enabled') === false
      ? 'Critical alert is switched off.'
      : `Sent every day at ${hh(get('critical_alert_hour') ?? 9)} to ${list('critical_alert_email_to') || 'nobody yet'}${list('critical_alert_email_cc') ? `, CC ${list('critical_alert_email_cc')}` : ''}${get('critical_alert_to_agents') === false ? '' : ', and each agent gets their own list'}. Critical = pending POD over ${Number(get('critical_aging_days') ?? 7)} days.`
    : weekly
    ? get('weekly_report_enabled') === false
      ? 'Weekly summary is switched off.'
      : `Sent every ${DAYS[Number(get('weekly_report_day') ?? 1)] ?? 'Monday'} at ${hh(get('weekly_report_hour') ?? 9)} to ${list('weekly_report_recipients') || 'nobody yet'}${list('weekly_report_cc') ? `, CC ${list('weekly_report_cc')}` : ''}.`
    : get('daily_report_enabled') === false
      ? 'Daily report is switched off.'
      : `Sent every day at ${hh(get('daily_report_hour') ?? 9)} to ${list('report_recipients') || 'nobody yet'}${list('report_cc') ? `, CC ${list('report_cc')}` : ''}.`;
  const g = googleStatus();
  const type = kind === 'critical' ? 'critical_alert' : weekly ? 'weekly_summary' : 'daily_admin';
  const label = kind === 'critical' ? 'critical alert' : weekly ? 'weekly summary' : 'daily report';
  const history = (runs.data ?? []).filter((r) => (r.report_type ?? 'daily_admin') === type);

  return (
    <>
      <PageHeader
        title="Reports"
        sub={`${schedule} ${me.role === 'super_admin' ? 'Change it under Settings → Scheduled reports.' : 'A Super Admin can change the schedule and recipients.'}`}
        actions={<a href={`/reports/download?r=${kind}`} className="btn">Download Excel</a>}
      />
      <Flash sp={sp} />
      <div className="mb-4 flex gap-1 border-b border-line">
        <Link href="/reports?r=critical" className={`-mb-px border-b-2 px-4 py-2 no-underline ${kind === 'critical' ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>Critical alert (daily)</Link>
        <Link href="/reports" className={`-mb-px border-b-2 px-4 py-2 no-underline ${kind === 'daily' ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>Daily report</Link>
        <Link href="/reports?r=weekly" className={`-mb-px border-b-2 px-4 py-2 no-underline ${weekly ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>Weekly summary</Link>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel title={`Preview of the ${label}`} bodyClass="p-0">
          <iframe src={`/reports/preview?r=${kind}`} title="Report preview" className="h-[75vh] w-full rounded-b-md border-0 bg-white" />
        </Panel>
        <div className="space-y-5">
          <Panel title="Send now">
            {!g.gmail && <p className="mb-3 text-age-4">Gmail is not connected, so reports cannot be sent yet.</p>}
            <form action={kind === 'critical' ? sendCriticalNow : weekly ? sendWeeklyNow : sendReportNow} className="space-y-3">
              <Field label="Recipients" hint="Empty = the usual To and CC lists">
                <input name="to" className="input" placeholder="Leave empty for the usual list" />
              </Field>
              <SubmitButton pending="Building and sending…" disabled={!g.gmail} confirm={`Send the ${label} now?`}>
                Send {label}
              </SubmitButton>
            </form>
          </Panel>
          <Panel title="History" bodyClass="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Result</th>
                  <th>How</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.run_at)}</td>
                    <td className={r.status === 'failed' ? 'text-age-5' : ''} title={r.error ?? r.recipients.join(', ')}>
                      {r.status === 'sent' ? `Sent to ${r.recipients.length}` : `Failed: ${r.error ?? ''}`}
                    </td>
                    <td>{r.trigger_type === 'cron' ? 'Scheduled' : r.trigger_type}</td>
                  </tr>
                ))}
                {!history.length && (
                  <tr><td colSpan={3} className="py-4 text-center text-ink-soft">Not sent yet.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}
