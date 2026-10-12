import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '../env';
import { sendMail } from '../google';
import { fmtDate } from '../format';
import type { PodStats } from '../cases/filters';
import { statsEmailHtml, type Yesterday } from './pivot-html';
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
 * tables (AWBs and ₹ value) plus what happened yesterday; every case is in the attached Excel.
 */
export async function buildDailyReport(sb: SupabaseClient, opts: { withAttachment: boolean }): Promise<BuiltReport> {
  const settings = await reportSettings(sb);
  const [rep, st, yd] = await Promise.all([
    sb.rpc('daily_report_data', { p_lost_days: settings.lostDays }),
    sb.rpc('pod_stats', { p: {} }),
    sb.rpc('report_yesterday'),
  ]);
  for (const r of [rep, st, yd]) if (r.error) throw new Error(r.error.message);
  const report = rep.data as DailyReportData;
  const s = st.data as PodStats;
  const y = yd.data as Yesterday;
  const filename = `lost-pod-report-${report.report_date}.xlsx`;
  const html = statsEmailHtml(s, y, {
    intro: `Lost &amp; POD daily report for <b>${fmtDate(y.day)}</b> (yesterday's work; today's comes in tomorrow's report). Numbers as of ${fmtDate(report.report_date)} morning.`,
    footer: `${opts.withAttachment ? `Every case is in the attached Excel (${filename}). ` : ''}Open the dashboard for the lists: <a href="${publicEnv.siteUrl}/dashboard">${publicEnv.siteUrl}/dashboard</a>`,
    agents: true,
  });
  const xlsx = opts.withAttachment ? await buildReportWorkbook(report, await fetchAllCases(sb), settings.agingOrder) : null;
  return {
    data: report, html, filename, xlsx, recipients: settings.recipients, cc: settings.cc,
    subject: `Lost / POD daily report — ${fmtDate(y.day)} — ${s.pending} pending POD (${s.critical} critical), ${s.lost_pending} loss requested`,
  };
}

/** Builds and emails the report, and logs the run in report_runs. Use a service-role client. */
export async function sendDailyReport(
  sb: SupabaseClient,
  opts: { trigger: 'cron' | 'manual' | 'cli'; triggeredBy?: string | null; to?: string[]; periodKey?: string | null },
): Promise<{ recipients: string[]; messageId: string | null }> {
  let recipients: string[] = opts.to ?? [];
  try {
    const r = await buildDailyReport(sb, { withAttachment: true });
    recipients = opts.to?.length ? opts.to : r.recipients;
    if (!recipients.length) throw new Error('No report recipients configured (Settings → report_recipients).');
    const cc = opts.to?.length ? [] : r.cc.filter((e) => !recipients.includes(e));
    const messageId = await sendMail({
      to: recipients, cc, subject: r.subject, html: r.html,
      attachments: [{ filename: r.filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: r.xlsx! }],
    });
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
