import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '../env';
import { sendMail } from '../google/gmail';
import { fmtDate } from '../format';
import { renderDailyReportHtml } from './html';
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
  const { data } = await sb.from('app_settings').select('key, value').in('key', ['report_recipients', 'report_aging_order', 'report_lost_body_days']);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const recipients = (get('report_recipients') as string[] | undefined) ?? [];
  return {
    recipients: recipients.filter((r) => typeof r === 'string' && r.includes('@')),
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
  xlsx: Buffer | null;
}

/** Everything is computed from the consolidated database at the moment the report is generated. */
export async function buildDailyReport(sb: SupabaseClient, opts: { withAttachment: boolean }): Promise<BuiltReport> {
  const settings = await reportSettings(sb);
  const { data, error } = await sb.rpc('daily_report_data', { p_lost_days: settings.lostDays });
  if (error) throw new Error(error.message);
  const report = data as DailyReportData;
  const filename = `lost-pod-report-${report.report_date}.xlsx`;
  const html = renderDailyReportHtml(report, {
    agingOrder: settings.agingOrder, lostDays: settings.lostDays, attachmentName: opts.withAttachment ? filename : null, siteUrl: publicEnv.siteUrl,
  });
  const xlsx = opts.withAttachment ? await buildReportWorkbook(report, await fetchAllCases(sb), settings.agingOrder) : null;
  return {
    data: report, html, filename, xlsx, recipients: settings.recipients,
    subject: `Lost / POD daily report — ${fmtDate(report.report_date)} — ${report.summary.total_open} open, ${report.summary.lost_pending} awaiting Lost approval`,
  };
}

/** Builds and emails the report, and logs the run in report_runs. Use a service-role client. */
export async function sendDailyReport(
  sb: SupabaseClient,
  opts: { trigger: 'cron' | 'manual' | 'cli'; triggeredBy?: string | null; to?: string[] },
): Promise<{ recipients: string[]; messageId: string | null }> {
  let recipients: string[] = opts.to ?? [];
  try {
    const r = await buildDailyReport(sb, { withAttachment: true });
    recipients = opts.to?.length ? opts.to : r.recipients;
    if (!recipients.length) throw new Error('No report recipients configured (Settings → report_recipients).');
    const messageId = await sendMail({
      to: recipients, subject: r.subject, html: r.html,
      attachments: [{ filename: r.filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: r.xlsx! }],
    });
    await sb.from('report_runs').insert({
      status: 'sent', recipients, summary: r.data.summary, triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger,
    });
    return { recipients, messageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sb.from('report_runs').insert({ status: 'failed', recipients, error: message, triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger });
    throw e;
  }
}
