import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { googleStatus } from '@/lib/google';
import { getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { addWorkbook, savePodWorkbooks, syncNow, syncPodSheets, toggleSource } from './actions';

export const metadata = { title: 'Google Sheet imports' };
export const maxDuration = 300;

const STATUS_TONE: Record<string, string> = { success: 'text-age-0', partial: 'text-age-3', failed: 'text-age-5' };

export default async function ImportsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const supabase = await createClient();
  const [sourcesRes, runsRes, clients, statsRes, podState, podBooks] = await Promise.all([
    supabase.from('sheet_sources').select('*, clients(name)').order('workbook_name').order('sheet_name'),
    supabase.from('sync_runs').select('*, sheet_sources(workbook_name, sheet_name)').order('started_at', { ascending: false }).limit(15),
    getClients(supabase),
    supabase.rpc('case_stats_f', { p: { category: 'all' } }),
    supabase.from('pod_sync_state').select('*').order('workbook_name').order('sheet_name'),
    supabase.from('app_settings').select('value').eq('key', 'pod_workbooks').maybeSingle(),
  ]);
  const books = (Array.isArray(podBooks.data?.value) ? podBooks.data!.value : []) as { id: string; name: string }[];
  const podTabs = (podState.data ?? []) as { workbook_id: string; workbook_name: string | null; sheet_name: string; links: number; awb_column: string | null; link_column: string | null; last_synced_at: string | null; last_message: string | null }[];
  const caseCount = new Map(((statsRes.data?.by_client ?? []) as { client_id: string | null; total: number }[]).map((c) => [c.client_id ?? 'none', c.total]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sources = (sourcesRes.data ?? []) as any[];
  const byWorkbook = new Map<string, typeof sources>();
  sources.forEach((s) => byWorkbook.set(s.workbook_id, [...(byWorkbook.get(s.workbook_id) ?? []), s]));
  const g = googleStatus();

  return (
    <>
      <PageHeader
        title="Google Sheet imports"
        sub="Trackers are read on a schedule (every 30 minutes) and on demand. Sheets are only an input: every row is normalised into the case database, and tracker AGEING columns are ignored."
        actions={
          <form action={syncNow}>
            <SubmitButton pending="Syncing… this can take a few minutes" disabled={!g.sheets}>Sync all active tabs</SubmitButton>
          </form>
        }
      />
      <Flash sp={sp} />
      {!g.sheets && (
        <div className="mb-4 rounded border border-age-3/40 bg-[#FFF8EC] px-3 py-2">
          Google Sheets is not connected. Install the Google bridge (README → Google bridge) and run setup again.
        </div>
      )}
      <Panel title="POD sheets (read only)" className="mb-5" bodyClass="p-0">
        <div id="pod-sheets" className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="text-ink-soft">
            Every tab with an AWB column and a POD / image link column is copied into the POD index ({fmtNum(podTabs.reduce((n, t) => n + t.links, 0))} AWB links). Client POD requests are checked against it. The sheets are never changed.
          </p>
          <div className="flex gap-2">
            <form action={syncPodSheets}><SubmitButton pending="Reading new rows…" disabled={!g.sheets}>Check POD sheets now</SubmitButton></form>
            {admin && <form action={syncPodSheets}><input type="hidden" name="full" value="1" /><SubmitButton className="btn btn-ghost" pending="Reading everything…" disabled={!g.sheets} confirm="Read every POD tab again from the top? This can take several minutes.">Read all again</SubmitButton></form>}
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Workbook</th><th>Tab</th><th>AWB column</th><th>Link column</th><th className="text-right">AWB links</th><th>Last read</th><th>Result</th></tr></thead>
            <tbody>
              {podTabs.map((t) => (
                <tr key={`${t.workbook_id}/${t.sheet_name}`} className={t.links ? '' : 'text-ink-faint'}>
                  <td><a href={`https://docs.google.com/spreadsheets/d/${t.workbook_id}`} target="_blank" rel="noreferrer">{t.workbook_name}</a></td>
                  <td>{t.sheet_name}</td><td>{t.awb_column ?? '—'}</td><td>{t.link_column ?? '—'}</td>
                  <td className="text-right">{fmtNum(t.links)}</td>
                  <td className="whitespace-nowrap">{t.last_synced_at ? fmtDateTime(t.last_synced_at) : '—'}</td>
                  <td className={/^(Failed|Cannot)/.test(t.last_message ?? '') ? 'text-age-5' : ''}>{t.last_message}</td>
                </tr>
              ))}
              {!podTabs.length && <tr><td colSpan={7} className="py-4 text-center text-ink-soft">Not read yet — click “Check POD sheets now”.</td></tr>}
            </tbody>
          </table>
        </div>
        {admin && (
          <form action={savePodWorkbooks} className="space-y-2 border-t border-line px-4 py-3">
            <Field label="POD workbooks" hint="One per line: link | name. The Google account of the bridge must be able to open them.">
              <textarea name="workbooks" rows={Math.max(2, books.length + 1)} className="input font-mono text-xs"
                defaultValue={books.map((b) => `https://docs.google.com/spreadsheets/d/${b.id} | ${b.name}`).join('\n')} />
            </Field>
            <SubmitButton className="btn btn-sm">Save POD workbooks</SubmitButton>
          </form>
        )}
      </Panel>
      <Panel title="Is every client coming in?" className="mb-5" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Client</th><th className="text-right">Cases in the dashboard</th><th className="text-right">Tabs on</th><th className="text-right">Synced OK</th><th className="text-right">Failed</th><th className="text-right">Not finished yet</th><th>Last problem</th></tr>
          </thead>
          <tbody>
            {[...clients.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: 'Client read from a column' }].map((c) => {
              const tabs = sources.filter((t) => t.is_active && t.mode === 'cases' && (t.default_client_id ?? null) === c.id);
              const ok = tabs.filter((t) => t.last_sync_status === 'success' || t.last_sync_status === 'partial').length;
              const failed = tabs.filter((t) => t.last_sync_status === 'failed');
              const never = tabs.filter((t) => !t.last_synced_at || t.last_sync_status === 'running').length;
              const cases = caseCount.get(c.id ?? 'none') ?? 0;
              if (!c.id && !tabs.length && !cases) return null;
              const bad = (tabs.length > 0 && cases === 0) || failed.length > 0 || never > 0;
              return (
                <tr key={c.id ?? 'none'} className={bad ? 'bg-[#FFF8EC]' : ''}>
                  <td>{c.name}</td>
                  <td className={`text-right ${tabs.length && !cases ? 'font-semibold text-age-5' : ''}`}>{fmtNum(cases)}</td>
                  <td className="text-right">{tabs.length}</td>
                  <td className="text-right">{ok}</td>
                  <td className={`text-right ${failed.length ? 'font-semibold text-age-5' : ''}`}>{failed.length}</td>
                  <td className={`text-right ${never ? 'font-semibold text-age-3' : ''}`}>{never}</td>
                  <td className="max-w-[420px] text-xs text-ink-soft">{failed[0] ? `${failed[0].sheet_name}: ${failed[0].last_sync_message ?? ''}` : !tabs.length ? 'No tracker tab switched on for this client' : never ? 'Not reached yet — press “Sync all active tabs” again' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-ink-soft">
          Each sync works for about 4 minutes and continues with the oldest tabs next time. For the first full import, run <code>npm run sync:sheets</code> in the Codespace terminal (no time limit).
          “Failed” usually means the tracker is not shared with the Google account that runs the bridge.
        </p>
      </Panel>
      <div className="mb-4 flex justify-end">
        <Link href="/imports/mappings" className="btn btn-sm">Header and status wording</Link>
      </div>

      {[...byWorkbook.entries()].map(([wbId, tabs]) => (
        <Panel
          key={wbId}
          className="mb-5"
          title={
            <div>
              <h2>{tabs[0].workbook_name ?? wbId}</h2>
              <a href={`https://docs.google.com/spreadsheets/d/${wbId}`} target="_blank" rel="noreferrer" className="text-xs">Open in Google Sheets</a>
            </div>
          }
          actions={
            <form action={syncNow}>
              {tabs.filter((t) => t.is_active).map((t) => <input key={t.id} type="hidden" name="source_id" value={t.id} />)}
              <SubmitButton className="btn btn-sm" pending="Syncing…" disabled={!g.sheets || !tabs.some((t) => t.is_active)}>Sync this workbook</SubmitButton>
            </form>
          }
          bodyClass="tbl-wrap"
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>Tab</th>
                <th>Use</th>
                <th>Default client</th>
                <th>On</th>
                <th>Last sync</th>
                <th className="text-right">Rows</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tabs.map((t) => (
                <tr key={t.id} className={t.is_active ? '' : 'text-ink-faint'}>
                  <td><Link href={`/imports/${t.id}`}>{t.sheet_name.trim() || '(blank name)'}</Link></td>
                  <td>{t.mode === 'enrich' ? 'Fill gaps only' : 'Cases'}</td>
                  <td>{t.clients?.name ?? '—'}</td>
                  <td>
                    {admin ? (
                      <form action={toggleSource}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="on" value={t.is_active ? '0' : '1'} />
                        <SubmitButton className="btn btn-sm">{t.is_active ? 'On' : 'Off'}</SubmitButton>
                      </form>
                    ) : t.is_active ? 'On' : 'Off'}
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(t.last_synced_at)}</td>
                  <td className="text-right">{fmtNum(t.last_row_count)}</td>
                  <td className={`max-w-[360px] ${STATUS_TONE[t.last_sync_status] ?? ''}`}>{t.last_sync_message ?? '—'}</td>
                  <td>
                    <form action={syncNow}>
                      <input type="hidden" name="source_id" value={t.id} />
                      <SubmitButton className="btn btn-sm" pending="Syncing…" disabled={!g.sheets}>Sync</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}

      {admin && (
        <Panel title="Add a workbook" className="mb-5">
          <form action={addWorkbook} className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
            <Field label="Google Sheets link or ID" hint="Every visible tab is added, switched off, so you can check its mapping first.">
              <input name="workbook" required className="input" placeholder="https://docs.google.com/spreadsheets/d/…" />
            </Field>
            <Field label="Default client">
              <select name="client_id" className="input">
                <option value="">None (read from a Client column)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <SubmitButton pending="Reading workbook…" disabled={!g.sheets}>Add workbook</SubmitButton>
          </form>
        </Panel>
      )}

      <Panel title="Recent syncs" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Started</th>
              <th>Tab</th>
              <th>Result</th>
              <th className="text-right">Rows</th>
              <th className="text-right">New</th>
              <th className="text-right">Updated</th>
              <th className="text-right">Linked</th>
              <th className="text-right">Unchanged</th>
              <th className="text-right">Lost requests</th>
              <th>How</th>
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(runsRes.data ?? []).map((r: any) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                <td>{r.sheet_sources ? `${r.sheet_sources.workbook_name} › ${r.sheet_sources.sheet_name}` : '—'}</td>
                <td className={STATUS_TONE[r.status] ?? ''}>{r.status}</td>
                <td className="text-right">{fmtNum(r.rows_read)}</td>
                <td className="text-right">{fmtNum(r.cases_created)}</td>
                <td className="text-right">{fmtNum(r.cases_updated)}</td>
                <td className="text-right">{fmtNum(r.cases_linked)}</td>
                <td className="text-right">{fmtNum(r.rows_unchanged)}</td>
                <td className="text-right">{fmtNum(r.lost_requests)}</td>
                <td>{r.trigger_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
