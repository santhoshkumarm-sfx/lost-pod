import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel, StatusBadge, STATUS_COLORS } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google/auth';
import { getBuckets, getStatuses } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { saveBuckets, saveSettings, saveStatus } from './actions';

export const metadata = { title: 'Settings' };

const LABELS: Record<string, { label: string; kind: 'list' | 'bool' | 'json' | 'text' }> = {
  report_recipients: { label: 'Daily report recipients', kind: 'list' },
  report_aging_order: { label: 'Top 10 aging column order', kind: 'text' },
  report_lost_body_days: { label: 'Approved Lost listed in the email body (days)', kind: 'json' },
  default_sla_days: { label: 'Default TAT (days)', kind: 'json' },
  dedupe_window_days: { label: 'Same AWB counts as one case within (days)', kind: 'json' },
  notify_admins_by_email: { label: 'Email admins about new Lost requests', kind: 'bool' },
  internal_email_domains: { label: 'Internal email domains', kind: 'list' },
  awb_patterns: { label: 'AWB patterns (regular expressions)', kind: 'json' },
  hub_city_codes: { label: 'Extra hub prefix → city', kind: 'json' },
  timezone: { label: 'Timezone for aging', kind: 'text' },
};

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [settingsRes, statuses, buckets] = await Promise.all([
    supabase.from('app_settings').select('*').order('key'),
    getStatuses(supabase),
    getBuckets(supabase),
  ]);
  const g = googleStatus();
  const show = (key: string, value: unknown) => {
    const kind = LABELS[key]?.kind ?? 'json';
    if (kind === 'list') return (value as string[]).join(', ');
    if (kind === 'text') return String(value);
    if (kind === 'bool') return String(value);
    return JSON.stringify(value);
  };
  return (
    <>
      <PageHeader title="Settings" sub="Everything here takes effect without a deploy. Secrets (Supabase and Google keys) are environment variables, not settings." />
      <Flash sp={sp} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="General">
          <form action={saveSettings} className="space-y-3">
            {(settingsRes.data ?? []).map((s) => {
              const meta = LABELS[s.key];
              return (
                <Field key={s.key} label={meta?.label ?? s.key} hint={`${s.description ?? ''}${s.updated_at ? ` Last changed ${fmtDateTime(s.updated_at)}.` : ''}`}>
                  {meta?.kind === 'bool' ? (
                    <select name={`setting:${s.key}`} defaultValue={String(s.value)} className="input">
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : s.key === 'report_aging_order' ? (
                    <select name={`setting:${s.key}`} defaultValue={String(s.value)} className="input">
                      <option value="asc">1 → 10+ (left to right)</option>
                      <option value="desc">10+ → 1 (right to left)</option>
                    </select>
                  ) : (
                    <input name={`setting:${s.key}`} defaultValue={show(s.key, s.value)} className={`input ${meta?.kind === 'json' ? 'font-mono text-xs' : ''}`} />
                  )}
                </Field>
              );
            })}
            <SubmitButton>Save settings</SubmitButton>
          </form>
        </Panel>
        <div className="space-y-5">
          <Panel title="Connections">
            <dl className="kv">
              <dt>Google Sheets</dt><dd>{g.sheets ? 'Connected' : <span className="text-age-4">Not connected</span>}</dd>
              <dt>Gmail</dt><dd>{g.gmail ? `Connected${g.mailbox ? ` (${g.mailbox})` : ''}` : <span className="text-age-4">Not connected</span>}</dd>
              <dt>Method</dt><dd>{g.method === 'service_account' ? 'Service account' : g.method === 'oauth' ? 'OAuth refresh token' : '—'}</dd>
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
