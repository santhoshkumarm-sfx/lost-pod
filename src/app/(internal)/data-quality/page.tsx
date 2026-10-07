import Link from 'next/link';
import { Kpi, PageHeader, Panel } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Data quality' };

interface DQ {
  estimated_escalation_date: number;
  missing_client: number;
  missing_hub: number;
  open_duplicates: number;
  unmatched_clients: { client_name: string; cases: number }[];
  unmapped_statuses: { value: string; cases: number }[];
  emails_needing_review: number;
  failed_syncs: { id: string; workbook_name: string; sheet_name: string; last_sync_status: string; last_sync_message: string; last_synced_at: string }[];
}

export default async function DataQualityPage() {
  await requireInternal();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('data_quality_summary');
  if (error) throw new Error(error.message);
  const d = data as DQ;
  return (
    <>
      <PageHeader title="Data quality" sub="Things the importers could not settle on their own. Fixing them makes aging and reports more accurate." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Escalation date estimated" value={d.estimated_escalation_date} tone={d.estimated_escalation_date ? 'warn' : undefined} />
        <Kpi label="No client" value={d.missing_client} href="/cases?client=none&category=all" tone={d.missing_client ? 'warn' : undefined} />
        <Kpi label="No hub or location" value={d.missing_hub} />
        <Kpi label="AWBs with 2+ open cases" value={d.open_duplicates} />
        <Kpi label="Emails to review" value={d.emails_needing_review} href="/email-escalations" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Tracker statuses nobody has mapped" bodyClass="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Wording</th><th className="text-right">Cases</th></tr></thead>
            <tbody>
              {d.unmapped_statuses.map((u) => (
                <tr key={u.value}><td>{u.value}</td><td className="text-right">{fmtNum(u.cases)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-ink-faint">Map them under <Link href="/imports/mappings">Header and status wording</Link>.</p>
        </Panel>
        <Panel title="Client names not matched" bodyClass="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name in source</th><th className="text-right">Cases</th></tr></thead>
            <tbody>
              {d.unmatched_clients.map((u) => (
                <tr key={u.client_name}><td>{u.client_name}</td><td className="text-right">{fmtNum(u.cases)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-ink-faint">Add them as an alias on the right <Link href="/clients">client</Link>; the next sync links them.</p>
        </Panel>
        <Panel title="Tabs that failed to sync" bodyClass="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Tab</th><th>Problem</th></tr></thead>
            <tbody>
              {d.failed_syncs.map((f) => (
                <tr key={f.id}>
                  <td><Link href={`/imports/${f.id}`}>{f.workbook_name} › {f.sheet_name}</Link><div className="text-xs text-ink-faint">{fmtDateTime(f.last_synced_at)}</div></td>
                  <td className="text-age-5">{f.last_sync_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
