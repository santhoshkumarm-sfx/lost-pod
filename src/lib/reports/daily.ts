import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '../env';
import { sendMail } from '../google';
import { fmtDMY } from '../format';
import { todayIn } from '../time';
import type { PodStats } from '../cases/filters';
import { statsEmailHtml } from './pivot-html';
import { CASE_EXPORT_COLUMNS, type CaseExportRow, type DailyReportData } from './types';
import { buildReportWorkbook } from './xlsx';

export async function fetchAllCases(sb: SupabaseClient, columns = CASE_EXPORT_COLUMNS, apply?: (q: any) => any): Promise<CaseExportRow[]> {
  const out: CaseExportRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = sb.from('v_cases').select(columns).order('escalation_date', { ascending: true }).order('case_number');
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as CaseExportRow[]));
    if (!data || data.length < page) break;
  }
  return out;
}

async function reportSettings(sb: SupabaseClient) {
  const { data } = await sb.from('app_settings').select('key, value').in('key', ['report_recipients', 'report_cc', 'report_aging_order', 'report_lost_body_days']);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const list = (k: string) => ((get(k) as string[] | undefined) ?? []).filter((r) => typeof r === 'string' && r.includes('@'));
  return {
    recipients: list('report_recipients'),
    cc: list('report_cc'),
    agingOrder: (get('report_aging_order') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
    lostDays: Number(get('report_lost_body_days') ?? 30) || 30,
  };
}

export interface BuiltReport {
  data: DailyReportData;
  html: string;
  subject: string;
  filename: string;
  recipients: string[];
  cc: string[];
  xlsx: Buffer | null;
}

/**
 * Everything is computed from the consolidated database when the report is built. The body has the dashboard
 * tables (₹ product value, then AWBs). The Excel is only built for the Download button, never attached.
 */
export async function buildDailyReport(sb: SupabaseClient, opts: { withAttachment: boolean }): Promise<BuiltReport> {
  const settings = await reportSettings(sb);
  const [rep, st] = await Promise.all([
    sb.rpc('daily_report_data', { p_lost_days: settings.lostDays }),
    sb.rpc('pod_stats', { p: {} }),
  ]);
  for (const r of [rep, st]) if (r.error) throw new Error(r.error.message);
  const report = rep.data as DailyReportData;
  const s = st.data as PodStats;
  const today = fmtDMY(todayIn());
  const filename = `pod-connect-report-${report.report_date}.xlsx`;
  const html = statsEmailHtml(s, {
    intro: `Please find below the POD connect daily report as on ${today}.`,
    footer: `Dashboard: <a href="${publicEnv.siteUrl}/dashboard">${publicEnv.siteUrl}/dashboard</a><br><br>Regards,<br>Trust &amp; Safety`,
  });
  const xlsx = opts.withAttachment ? await buildReportWorkbook(report, await fetchAllCases(sb), settings.agingOrder) : null;
  return { data: report, html, filename, xlsx, recipients: settings.recipients, cc: settings.cc, subject: `POD connect daily report ${today}` };
}

/** Builds and emails the report, and logs the run in report_runs. Use a service-role client. */
export async function sendDailyReport(
  sb: SupabaseClient,
  opts: { trigger: 'cron' | 'manual' | 'cli'; triggeredBy?: string | null; to?: string[]; cc?: string[]; periodKey?: string | null },
): Promise<{ recipients: string[]; messageId: string | null }> {
  let recipients: string[] = opts.to ?? [];
  try {
    const r = await buildDailyReport(sb, { withAttachment: false });
    recipients = opts.to?.length ? opts.to : r.recipients;
    if (!recipients.length) throw new Error('No report recipients (Reports → Daily report → To).');
    const cc = (opts.to?.length ? opts.cc ?? [] : r.cc).filter((e) => !recipients.includes(e));
    const messageId = await sendMail({ to: recipients, cc, subject: r.subject, html: r.html });
    await sb.from('report_runs').insert({
      report_type: 'daily_admin', status: 'sent', recipients: [...recipients, ...cc], summary: r.data.summary,
      triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger, period_key: opts.periodKey ?? null,
    });
    return { recipients, messageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sb.from('report_runs').insert({
      report_type: 'daily_admin', status: 'failed', recipients, error: message, triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger, period_key: opts.periodKey ?? null,
    });
    throw e;
  }
}
