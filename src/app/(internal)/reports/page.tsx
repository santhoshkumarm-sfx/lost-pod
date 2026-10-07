import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime } from '@/lib/format';
import { googleStatus } from '@/lib/google/auth';
import { createClient } from '@/lib/supabase/server';
import { sendReportNow } from './actions';

export const metadata = { title: 'Reports' };
export const maxDuration = 120;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [runs, recipients] = await Promise.all([
    supabase.from('report_runs').select('*').order('run_at', { ascending: false }).limit(30),
    supabase.from('app_settings').select('value').eq('key', 'report_recipients').maybeSingle(),
  ]);
  const to = ((recipients.data?.value ?? []) as string[]).join(', ');
  const g = googleStatus();
  return (
    <>
      <PageHeader
        title="Daily admin report"
        sub="Sent every day at 09:00 IST to the recipients in Settings, with the consolidated Excel report attached. Everything is computed from the database when it is sent."
        actions={<a href="/reports/download" className="btn">Download Excel report</a>}
      />
      <Flash sp={sp} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel title="Preview of today’s email" bodyClass="p-0">
          <iframe src="/reports/preview" title="Report preview" className="h-[75vh] w-full rounded-b-md border-0 bg-white" />
        </Panel>
        <div className="space-y-5">
          <Panel title="Send now">
            {!g.gmail && <p className="mb-3 text-age-4">Gmail is not connected, so the report cannot be sent yet.</p>}
            <form action={sendReportNow} className="space-y-3">
              <Field label="Recipients" hint={`Empty = ${to || 'the Settings list'}`}>
                <input name="to" className="input" placeholder="Leave empty for the usual list" />
              </Field>
              <SubmitButton pending="Building and sending…" disabled={!g.gmail} confirm="Send the report now?">Send report</SubmitButton>
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
                {(runs.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.run_at)}</td>
                    <td className={r.status === 'failed' ? 'text-age-5' : ''} title={r.error ?? r.recipients.join(', ')}>
                      {r.status === 'sent' ? `Sent to ${r.recipients.length}` : `Failed: ${r.error ?? ''}`}
                    </td>
                    <td>{r.trigger_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}
