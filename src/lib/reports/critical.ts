import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '../env';
import { sendMail } from '../google';
import { buildCriticalWorkbook, criticalSubject, renderCriticalHtml, type CriticalRow } from './critical-html';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function cfg(sb: SupabaseClient) {
  const { data } = await sb.from('app_settings').select('key, value')
    .in('key', ['critical_aging_days', 'critical_alert_email_to', 'critical_alert_email_cc', 'critical_alert_to_agents']);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const list = (k: string) => ((get(k) as string[] | undefined) ?? []).filter((e) => typeof e === 'string' && e.includes('@'));
  const days = Number(get('critical_aging_days'));
  return { days: Number.isInteger(days) && days > 0 ? days : 7, to: list('critical_alert_email_to'), cc: list('critical_alert_email_cc'), toAgents: get('critical_alert_to_agents') !== false };
}

export async function loadCritical(sb: SupabaseClient, days: number, agentId?: string): Promise<CriticalRow[]> {
  const out: CriticalRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('v_cases')
      .select('awb, client_display_name, escalation_date, aging_days, status_label, hub, location, agent_display_name, assigned_agent, team_remark')
      .eq('status_category', 'open').neq('team_status', 'pod_shared').neq('pod_status', 'shared').gt('aging_days', days);
    if (agentId) q = q.eq('assigned_agent', agentId);
    const { data, error } = await q.order('aging_days', { ascending: false }).order('awb').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as CriticalRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function buildCriticalAlert(sb: SupabaseClient, opts: { withAttachment: boolean }) {
  const c = await cfg(sb);
  const rows = await loadCritical(sb, c.days);
  const filename = `critical-pending-pod-${new Date(Date.now() + 19800000).toISOString().slice(0, 10)}.xlsx`;
  return {
    cfg: c, rows, filename,
    subject: criticalSubject(rows, c.days),
    html: renderCriticalHtml(rows, { days: c.days, siteUrl: publicEnv.siteUrl, attachmentName: opts.withAttachment ? filename : null }),
    xlsx: opts.withAttachment ? await buildCriticalWorkbook(rows) : null,
  };
}

/** Daily critical-aging email to the configured list, plus (optionally) one email per agent with their own critical shipments. */
export async function sendCriticalAlert(
  sb: SupabaseClient,
  opts: { trigger: 'cron' | 'manual' | 'cli'; triggeredBy?: string | null; to?: string[]; periodKey?: string | null },
): Promise<{ recipients: string[]; agents: number; critical: number }> {
  let recipients: string[] = opts.to ?? [];
  try {
    const r = await buildCriticalAlert(sb, { withAttachment: true });
    recipients = opts.to?.length ? opts.to : r.cfg.to;
    if (!recipients.length) throw new Error('No critical-alert recipients (Settings → Scheduled reports).');
    const cc = opts.to?.length ? [] : r.cfg.cc.filter((e) => !recipients.includes(e));
    await sendMail({ to: recipients, cc, subject: r.subject, html: r.html, attachments: [{ filename: r.filename, contentType: XLSX, content: r.xlsx! }] });
    let agents = 0;
    if (r.cfg.toAgents && !opts.to?.length) {
      const byAgent = new Map<string, CriticalRow[]>();
      for (const row of r.rows) if (row.assigned_agent) byAgent.set(row.assigned_agent, [...(byAgent.get(row.assigned_agent) ?? []), row]);
      if (byAgent.size) {
        const { data } = await sb.from('profiles').select('id, email, full_name, is_active').in('id', [...byAgent.keys()]);
        for (const p of (data ?? []) as { id: string; email: string; full_name: string | null; is_active: boolean }[]) {
          if (!p.is_active) continue;
          const mine = byAgent.get(p.id)!;
          try {
            await sendMail({
              to: [p.email], subject: criticalSubject(mine, r.cfg.days, p.full_name ?? p.email),
              html: renderCriticalHtml(mine, { days: r.cfg.days, siteUrl: publicEnv.siteUrl, forAgent: p.full_name ?? p.email }),
            });
            agents++;
          } catch (e) {
            console.error('Critical email to agent failed', p.email, e);
          }
        }
      }
    }
    await sb.from('report_runs').insert({
      report_type: 'critical_alert', status: 'sent', recipients: [...recipients, ...cc], summary: { critical: r.rows.length, agents },
      triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger, period_key: opts.periodKey ?? null,
    });
    return { recipients: [...recipients, ...cc], agents, critical: r.rows.length };
  } catch (e) {
    await sb.from('report_runs').insert({
      report_type: 'critical_alert', status: 'failed', recipients, error: e instanceof Error ? e.message : String(e),
      triggered_by: opts.triggeredBy ?? null, trigger_type: opts.trigger, period_key: opts.periodKey ?? null,
    });
    throw e;
  }
}
