import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '../env';
import { sendMail } from '../google';
import { sendCriticalAlert } from './critical';
import { sendDailyReport } from './daily';
import { buildWeeklyWorkbook, dueReports, renderWeeklyReportHtml, weeklySubject, type PendingCaseRow, type WeeklyReportData } from './weekly-html';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function settings(sb: SupabaseClient) {
  const { data } = await sb.from('app_settings').select('key, value').in('key', [
    'weekly_report_recipients', 'weekly_report_cc', 'daily_report_enabled', 'daily_report_hour', 'weekly_report_enabled', 'weekly_report_day', 'weekly_report_hour',
    'critical_alert_enabled', 'critical_alert_hour',
  ]);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const list = (k: string) => ((get(k) as string[] | undefined) ?? []).filter((e) => typeof e === 'string' && e.includes('@'));
  const num = (k: string, d: number) => (Number.isInteger(Number(get(k))) ? Number(get(k)) : d);
  return {
    weeklyTo: list('weekly_report_recipients'),
    weeklyCc: list('weekly_report_cc'),
    dailyEnabled: get('daily_report_enabled') !== false,
    dailyHour: num('daily_report_hour', 9),
    weeklyEnabled: get('weekly_report_enabled') !== false,
    weeklyDay: num('weekly_report_day', 1),
    weeklyHour: num('weekly_report_hour', 9),
    criticalEnabled: get('critical_alert_enabled') !== false,
    criticalHour: num('critical_alert_hour', 9),
  };
}

async function pendingCases(sb: SupabaseClient): Promise<PendingCaseRow[]> {
  const out: PendingCaseRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('v_cases')
      .select('client_display_name, awb, escalation_date, aging_days, status_label, hub, location, team_remark, agent_display_name')
      .eq('status_category', 'open')
      .order('aging_days', { ascending: false })
      .order('awb')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as PendingCaseRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function buildWeeklyReport(sb: SupabaseClient, opts: { withAttachment: boolean }) {
  const { data, error } = await sb.rpc('weekly_report_data', { p_days: 7 });
  if (error) throw new Error(error.message);
  const d = data as WeeklyReportData;
  const filename = `lost-pod-weekly-${d.period_to}.xlsx`;
  const html = renderWeeklyReportHtml(d, { siteUrl: publicEnv.siteUrl, attachmentName: opts.withAttachment ? filename : null });
  const xlsx = opts.withAttachment ? await buildWeeklyWorkbook(d, await pendingCases(sb)) : null;
  return { data: d, html, filename, xlsx, subject: weeklySubject(d) };
}

/** Builds and emails the weekly summary, logged in report_runs. Use a service-role client. */
export async function sendWeeklyReport(
  sb: SupabaseClient,
  opts: { trigger: 'cron' | 'manual' | 'cli'; triggeredBy?: string | null; to?: string[]; periodKey?: string | null },
): Promise<{ recipients: string[] }> {
  const cfg = await settings(sb);
  const to = opts.to?.length ? opts.to : cfg.weeklyTo;
  const cc = opts.to?.length ? [] : cfg.weeklyCc.filter((e) => !to.includes(e));
  try {
    if (!to.length) throw new Error('No weekly report recipients (Settings → Scheduled reports).');
    const r = await buildWeeklyReport(sb, { withAttachment: true });
    await sendMail({ to, cc, subject: r.subject, html: r.html, attachments: [{ filename: r.filename, contentType: XLSX, content: r.xlsx! }] });
    await sb.from('report_runs').insert({
      report_type: 'weekly_summary', status: 'sent', recipients: [...to, ...cc], summary: r.data.summary,
      triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger, period_key: opts.periodKey ?? null,
    });
    return { recipients: [...to, ...cc] };
  } catch (e) {
    await sb.from('report_runs').insert({
      report_type: 'weekly_summary', status: 'failed', recipients: to, error: e instanceof Error ? e.message : String(e),
      triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger, period_key: opts.periodKey ?? null,
    });
    throw e;
  }
}

/**
 * Called by the hourly scheduler. Sends whatever is due (Settings → Scheduled reports, IST) and not yet sent
 * by the scheduler for that period. A missed hour is caught up later the same day.
 */
export async function runScheduledReports(sb: SupabaseClient, now = new Date()) {
  const cfg = await settings(sb);
  const results: { type: string; periodKey: string; status: 'sent' | 'already_sent' | 'failed'; error?: string }[] = [];
  for (const due of dueReports(now, cfg)) {
    const { count } = await sb
      .from('report_runs')
      .select('id', { count: 'exact', head: true })
      .eq('report_type', due.type)
      .eq('status', 'sent')
      .eq('trigger_type', 'cron')
      .gte('run_at', due.periodStart);
    if (count) {
      results.push({ type: due.type, periodKey: due.periodKey, status: 'already_sent' });
      continue;
    }
    try {
      if (due.type === 'daily_admin') await sendDailyReport(sb, { trigger: 'cron', periodKey: due.periodKey });
      else if (due.type === 'critical_alert') await sendCriticalAlert(sb, { trigger: 'cron', periodKey: due.periodKey });
      else await sendWeeklyReport(sb, { trigger: 'cron', periodKey: due.periodKey });
      results.push({ type: due.type, periodKey: due.periodKey, status: 'sent' });
    } catch (e) {
      results.push({ type: due.type, periodKey: due.periodKey, status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
