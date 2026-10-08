import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel, StatusBadge, STATUS_COLORS } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google';
import { getBuckets, getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { saveBuckets, saveSettings, saveStatus } from './actions';

export const metadata = { title: 'Settings' };

type Kind = 'list' | 'bool' | 'json' | 'text' | 'hour' | 'day' | 'order';
const LABELS: Record<string, { label: string; kind: Kind }> = {
  // Email routing (Admins and Super Admins)
  notify_admins_by_email: { label: 'Send emails automatically (new Lost requests and decisions)', kind: 'bool' },
  lost_request_email_to: { label: 'Lost requests — To', kind: 'list' },
  lost_request_email_cc: { label: 'Lost requests — CC', kind: 'list' },
  lost_decision_email_to: { label: 'Rejected / sent back — To', kind: 'list' },
  lost_decision_email_cc: { label: 'Rejected / sent back — CC', kind: 'list' },
  loss_accepted_email_to: { label: 'Loss accepted — To', kind: 'list' },
  loss_accepted_email_cc: { label: 'Loss accepted — CC', kind: 'list' },
  // Scheduled reports (Super Admin only)
  daily_report_enabled: { label: 'Send the daily report', kind: 'bool' },
  daily_report_hour: { label: 'Daily report time (IST)', kind: 'hour' },
  report_recipients: { label: 'Daily report — To', kind: 'list' },
  report_cc: { label: 'Daily report — CC', kind: 'list' },
  report_aging_order: { label: 'Top 10 aging column order', kind: 'order' },
  report_lost_body_days: { label: 'Approved Lost listed in the daily email body (days)', kind: 'json' },
  weekly_report_enabled: { label: 'Send the weekly summary (pending, Lost requested, loss accepted)', kind: 'bool' },
  weekly_report_day: { label: 'Weekly report day', kind: 'day' },
  weekly_report_hour: { label: 'Weekly report time (IST)', kind: 'hour' },
  weekly_report_recipients: { label: 'Weekly report — To', kind: 'list' },
  weekly_report_cc: { label: 'Weekly report — CC', kind: 'list' },
  critical_aging_days: { label: 'Critical after (days pending POD)', kind: 'json' },
  critical_alert_enabled: { label: 'Send the daily critical alert', kind: 'bool' },
  critical_alert_hour: { label: 'Critical alert time (IST)', kind: 'hour' },
  critical_alert_email_to: { label: 'Critical alert — To', kind: 'list' },
  critical_alert_email_cc: { label: 'Critical alert — CC', kind: 'list' },
  critical_alert_to_agents: { label: 'Also email each agent their own critical list', kind: 'bool' },
  // General
  default_sla_days: { label: 'Default TAT (days)', kind: 'json' },
  dedupe_window_days: { label: 'Same AWB counts as one case within (days)', kind: 'json' },
  internal_email_domains: { label: 'Internal email domains', kind: 'list' },
  awb_patterns: { label: 'AWB patterns (regular expressions)', kind: 'json' },
  hub_city_codes: { label: 'Extra hub prefix → city', kind: 'json' },
  timezone: { label: 'Timezone for aging', kind: 'text' },
};

const ROUTING_KEYS = ['notify_admins_by_email', 'lost_request_email_to', 'lost_request_email_cc', 'lost_decision_email_to', 'lost_decision_email_cc'];
const ACCEPTED_KEYS = ['loss_accepted_email_to', 'loss_accepted_email_cc'];
const CRITICAL_KEYS = ['critical_alert_enabled', 'critical_alert_hour', 'critical_alert_email_to', 'critical_alert_email_cc', 'critical_alert_to_agents'];
const DAILY_KEYS = ['daily_report_enabled', 'daily_report_hour', 'report_recipients', 'report_cc', 'report_aging_order', 'report_lost_body_days'];
const WEEKLY_KEYS = ['weekly_report_enabled', 'weekly_report_day', 'weekly_report_hour', 'weekly_report_recipients', 'weekly_report_cc'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00${h === 0 ? ' (midnight)' : h === 12 ? ' (noon)' : ''}`;

interface Setting { key: string; value: unknown; description: string | null; updated_at: string | null }

function SettingInput({ s, disabled }: { s: Setting; disabled?: boolean }) {
  const kind = LABELS[s.key]?.kind ?? 'json';
  const name = `setting:${s.key}`;
  if (kind === 'bool')
    return (
      <select name={name} defaultValue={String(s.value)} className="input" disabled={disabled}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (kind === 'order')
    return (
      <select name={name} defaultValue={String(s.value)} className="input" disabled={disabled}>
        <option value="asc">1 → 10+ (left to right)</option>
        <option value="desc">10+ → 1 (right to left)</option>
      </select>
    );
  if (kind === 'hour')
    return (
      <select name={name} defaultValue={String(s.value)} className="input" disabled={disabled}>
        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
      </select>
    );
  if (kind === 'day')
    return (
      <select name={name} defaultValue={String(s.value)} className="input" disabled={disabled}>
        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
      </select>
    );
  if (kind === 'list')
    return (
      <textarea name={name} rows={2} defaultValue={Array.isArray(s.value) ? (s.value as string[]).join(', ') : ''} className="input" disabled={disabled}
        placeholder="name@shadowfax.in, other@shadowfax.in" />
    );
  const text = kind === 'text' ? String(s.value) : JSON.stringify(s.value);
  return <input name={name} defaultValue={text} className={`input ${kind === 'json' ? 'font-mono text-xs' : ''}`} disabled={disabled} />;
}

function SettingFields({ keys, all, disabled }: { keys: string[]; all: Setting[]; disabled?: boolean }) {
  return (
    <>
      {keys.map((k) => all.find((s) => s.key === k)).filter((s): s is Setting => !!s).map((s) => (
        <Field key={s.key} label={LABELS[s.key]?.label ?? s.key} hint={`${s.description ?? ''}${s.updated_at ? ` Last changed ${fmtDateTime(s.updated_at)}.` : ''}`}>
          <SettingInput s={s} disabled={disabled} />
        </Field>
      ))}
    </>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireAdmin();
  const isSuper = me.role === 'super_admin';
  const sp = await searchParams;
  const supabase = await createClient();
  const [settingsRes, statuses, buckets] = await Promise.all([
    supabase.from('app_settings').select('*').order('key'),
    getStatuses(supabase),
    getBuckets(supabase),
  ]);
  const g = googleStatus();
  const all = (settingsRes.data ?? []) as Setting[];
  const special = new Set([...ROUTING_KEYS, ...ACCEPTED_KEYS, ...CRITICAL_KEYS, ...DAILY_KEYS, ...WEEKLY_KEYS]);
  const general = all.filter((s) => !special.has(s.key)).map((s) => s.key);
  return (
    <>
      <PageHeader title="Settings" sub="Everything here takes effect without a deploy. Secrets (Supabase and Google keys) are environment variables, not settings." />
      <Flash sp={sp} />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Panel title="Lost email routing">
            <form action={saveSettings} className="space-y-3">
              <p className="text-xs text-ink-soft">
                Off by default. When on: one email per Lost request made by a person, one summary per tracker sync, and one email per decision.
                Request emails also go to that client’s approvers. Separate addresses with commas. Sent from the bridge’s Gmail.
              </p>
              <SettingFields keys={ROUTING_KEYS} all={all} />
              <SubmitButton>Save email routing</SubmitButton>
            </form>
          </Panel>
          <Panel title="Loss accepted emails">
            <form action={saveSettings} className="space-y-3">
              <p className="text-xs text-ink-soft">Sent every time a loss is accepted, one email per request, with the AWBs and their Lost aging. The person who asked is always copied.</p>
              {!isSuper && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-soft">Only a Super Admin can change who receives these.</p>}
              <SettingFields keys={ACCEPTED_KEYS} all={all} disabled={!isSuper} />
              {isSuper && <SubmitButton>Save loss accepted recipients</SubmitButton>}
            </form>
          </Panel>
          <Panel title="Scheduled reports">
            <form action={saveSettings} className="space-y-3">
              {!isSuper && <p className="rounded bg-canvas px-3 py-2 text-xs text-ink-soft">Only a Super Admin can change report schedules and recipients.</p>}
              <h3 className="font-semibold">Daily critical alert (pending POD over the critical days)</h3>
              <SettingFields keys={CRITICAL_KEYS} all={all} disabled={!isSuper} />
              <h3 className="pt-2 font-semibold">Daily report</h3>
              <SettingFields keys={DAILY_KEYS} all={all} disabled={!isSuper} />
              <h3 className="pt-2 font-semibold">Weekly summary</h3>
              <SettingFields keys={WEEKLY_KEYS} all={all} disabled={!isSuper} />
              {isSuper && <SubmitButton>Save report schedule</SubmitButton>}
              <p className="text-xs text-ink-faint">The scheduler checks every hour (once a day at 09:00 IST on the Vercel free plan). Preview or send now from Reports.</p>
            </form>
          </Panel>
          <Panel title="General">
            <form action={saveSettings} className="space-y-3">
              <SettingFields keys={general} all={all} />
              <SubmitButton>Save settings</SubmitButton>
            </form>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Connections">
            <dl className="kv">
              <dt>Google Sheets</dt><dd>{g.sheets ? 'Connected' : <span className="text-age-4">Not connected</span>}</dd>
              <dt>Gmail</dt><dd>{g.gmail ? 'Connected (Apps Script bridge)' : <span className="text-age-4">Not connected</span>}</dd>
            </dl>
          </Panel>
          <Panel title="Aging buckets">
            <form action={saveBuckets} className="space-y-3">
              <Field label="One bucket per line" hint="Used by the dashboard, filters and the daily report.">
                <textarea
                  name="buckets"
                  rows={8}
                  className="input font-mono text-xs"
                  defaultValue={buckets.map((b) => (b.max_days === null ? `${b.min_days}+` : `${b.min_days}-${b.max_days}`)).join('\n')}
                />
              </Field>
              <SubmitButton className="btn">Save buckets</SubmitButton>
            </form>
          </Panel>
        </div>
      </div>
      <Panel title="Case statuses" className="mt-5" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Kind</th>
              <th>Colour</th>
              <th>Order</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => (
              <tr key={s.code}>
                <td className="font-mono text-xs">{s.code}</td>
                <td colSpan={6} className="p-0">
                  <form action={saveStatus} className="grid grid-cols-[1fr_120px_120px_80px_70px_auto] items-center gap-2 px-3 py-1.5">
                    <input type="hidden" name="code" value={s.code} />
                    <input type="hidden" name="existing" value="1" />
                    <input name="label" defaultValue={s.label} className="input input-sm" />
                    <span className="text-xs text-ink-soft">{s.category === 'lost_pending' ? 'Lost request' : s.category}{s.is_system ? ' (built in)' : ''}</span>
                    <select name="color" defaultValue={s.color} className="input input-sm">
                      {STATUS_COLORS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <input name="sort_order" type="number" defaultValue={s.sort_order} className="input input-sm" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" value="1" defaultChecked={s.is_active} disabled={s.is_system} />{s.is_system && <input type="hidden" name="is_active" value="1" />}</label>
                    <span className="flex items-center gap-2"><StatusBadge label={s.label} color={s.color} /><SubmitButton className="btn btn-sm">Save</SubmitButton></span>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={saveStatus} className="grid gap-2 border-t border-line p-4 md:grid-cols-[150px_1fr_150px_120px_90px_auto] md:items-end">
          <input type="hidden" name="is_active" value="1" />
          <Field label="Code"><input name="code" required className="input" placeholder="awaiting_client" /></Field>
          <Field label="Label"><input name="label" required className="input" placeholder="Awaiting client reply" /></Field>
          <Field label="Kind">
            <select name="category" className="input">
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
          <Field label="Colour">
            <select name="color" className="input">{STATUS_COLORS.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Order"><input name="sort_order" type="number" defaultValue={45} className="input" /></Field>
          <SubmitButton className="btn">Add status</SubmitButton>
        </form>
        <p className="px-4 pb-4 text-xs text-ink-faint">Order also decides which status wins when a tracker row mentions several. Lost statuses are built in and can only be reached through approval.</p>
      </Panel>
    </>
  );
}
