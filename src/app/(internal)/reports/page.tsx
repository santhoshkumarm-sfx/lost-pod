import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google';
import { createClient } from '@/lib/supabase/server';
import { saveRecipients, sendNow } from './actions';
import { RECIPIENT_KEYS, RECIPIENT_LABELS, type RecipientKind } from '@/lib/reports/recipients';

export const metadata = { title: 'Reports' };
export const maxDuration = 120;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hh = (h: unknown) => `${String(Number(h) || 0).padStart(2, '0')}:00 IST`;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const r = param(sp, 'r');
  if (r === 'other') return <OtherEmails me={me} sp={sp} />;
  const kind = r === 'weekly' ? 'weekly' : r === 'critical' ? 'critical' : 'daily';
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
      : `Sent daily at ${hh(get('critical_alert_hour') ?? 9)}.`
    : weekly
    ? get('weekly_report_enabled') === false
      ? 'Weekly report is switched off.'
      : `Sent every ${DAYS[Number(get('weekly_report_day') ?? 1)] ?? 'Monday'} at ${hh(get('weekly_report_hour') ?? 9)}.`
    : get('daily_report_enabled') === false
      ? 'Daily report is switched off.'
      : `Sent daily at ${hh(get('daily_report_hour') ?? 9)}.`;
  const g = googleStatus();
  const type = kind === 'critical' ? 'critical_alert' : weekly ? 'weekly_summary' : 'daily_admin';
  const label = kind === 'critical' ? 'critical alert' : weekly ? 'weekly report' : 'daily report';
  const [toKey, ccKey] = RECIPIENT_KEYS[kind];
  const history = (runs.data ?? []).filter((r) => (r.report_type ?? 'daily_admin') === type);

  return (
    <>
      <PageHeader
        title="Reports"
        sub={schedule}
        actions={<a href={`/reports/download?r=${kind}`} className="btn">Download Excel</a>}
      />
      <Flash sp={sp} />
      <ReportTabs kind={kind} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel title={`Preview of the ${label}`} bodyClass="p-0">
          <iframe src={`/reports/preview?r=${kind}`} title="Report preview" className="h-[75vh] w-full rounded-b-md border-0 bg-white" />
        </Panel>
        <div className="space-y-5">
          <Panel title="Send now">
            {!g.gmail && <p className="mb-3 text-age-4">Gmail is not connected, so reports cannot be sent yet.</p>}
            <form action={sendNow} className="space-y-3">
              <input type="hidden" name="kind" value={kind} />
              <Field label="To">
                <textarea name="to" rows={2} className="input" defaultValue={list(toKey)} placeholder="name@shadowfax.in, …" />
              </Field>
              <Field label="CC">
                <textarea name="cc" rows={2} className="input" defaultValue={list(ccKey)} placeholder="name@shadowfax.in, …" />
              </Field>
              {me.role === 'super_admin' && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="save" value="1" /> Save as the usual To / CC</label>
              )}
              <SubmitButton cancel pending="Building and sending…" disabled={!g.gmail} confirm={`Send the ${label} now?`}>
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

function ReportTabs({ kind }: { kind: string }) {
  const tab = (href: string, k: string, text: string) => (
    <Link href={href} className={`-mb-px border-b-2 px-4 py-2 no-underline ${kind === k ? 'border-signal font-semibold text-ink' : 'border-transparent text-ink-soft'}`}>{text}</Link>
  );
  return (
    <div className="mb-4 flex gap-1 border-b border-line">
      {tab('/reports?r=critical', 'critical', 'Critical alert')}
      {tab('/reports', 'daily', 'Daily report')}
      {tab('/reports?r=weekly', 'weekly', 'Weekly report')}
      {tab('/reports?r=other', 'other', 'Other emails — To / CC')}
    </div>
  );
}

const OTHER: RecipientKind[] = ['lost_request', 'loss_accepted', 'lost_decision', 'pod_request'];
const OTHER_NOTE: Partial<Record<RecipientKind, string>> = {
  lost_request: 'Also to the approvers of that client.',
  loss_accepted: 'The person who asked is always copied.',
  lost_decision: 'The person who asked is always copied.',
  pod_request: 'Always to the client who asked.',
};

async function OtherEmails({ me, sp }: { me: { role: string }; sp: Awaited<SearchParams> }) {
  const supabase = await createClient();
  const keys = OTHER.flatMap((k) => [...RECIPIENT_KEYS[k]]);
  const { data } = await supabase.from('app_settings').select('key, value').in('key', keys);
  const list = (k: string) => ((data?.find((r) => r.key === k)?.value ?? []) as string[]).join(', ');
  const edit = me.role === 'super_admin';
  return (
    <>
      <PageHeader title="Reports" />
      <Flash sp={sp} />
      <ReportTabs kind="other" />
      <Panel title="To / CC" bodyClass="tbl-wrap">
        <form action={saveRecipients}>
          <table className="tbl w-full table-fixed">
            <colgroup><col style={{ width: 230 }} /><col /><col /></colgroup>
            <thead><tr><th>Email</th><th>To</th><th>CC</th></tr></thead>
            <tbody>
              {OTHER.map((k) => {
                const [to, cc] = RECIPIENT_KEYS[k];
                return (
                  <tr key={k}>
                    <td className="align-top"><div className="font-medium">{RECIPIENT_LABELS[k]}</div>{OTHER_NOTE[k] && <div className="text-xs text-ink-soft">{OTHER_NOTE[k]}</div>}</td>
                    <td><textarea name={to} rows={2} className="input" defaultValue={list(to)} disabled={!edit} /></td>
                    <td><textarea name={cc} rows={2} className="input" defaultValue={list(cc)} disabled={!edit} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {edit
            ? <div className="p-3"><SubmitButton cancel pending="Saving…">Save To / CC</SubmitButton></div>
            : <p className="p-3 text-ink-soft">Only a Super Admin can change these.</p>}
        </form>
      </Panel>
    </>
  );
}
