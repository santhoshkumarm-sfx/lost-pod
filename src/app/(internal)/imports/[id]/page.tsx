import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import { errorText, type SearchParams } from '@/lib/flash';
import { fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { googleStatus } from '@/lib/google';
import { readTab } from '@/lib/google';
import { loadImportConfig } from '@/lib/importer/config';
import { getSource, normalizeFor } from '@/lib/importer/sheets-sync';
import { getClients, getStatuses } from '@/lib/lookups';
import { FIELD_LABELS, TARGET_FIELDS } from '@/lib/normalize/fields';
import type { NormalizedSheet } from '@/lib/normalize/sheet';
import { createClient } from '@/lib/supabase/server';
import { saveMapping, syncNow, updateSource } from '../actions';

export const metadata = { title: 'Sheet tab' };
export const maxDuration = 300;

function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const VIA: Record<string, string> = { override: 'Set by admin', alias: 'Header name', fuzzy: 'Header (typo match)', content: 'Detected from values' };

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const source = await getSource(supabase, id);
  if (!source) notFound();
  const [clients, statuses, runs] = await Promise.all([
    getClients(supabase),
    getStatuses(supabase),
    supabase.from('sync_runs').select('*').eq('sheet_source_id', id).order('started_at', { ascending: false }).limit(10),
  ]);
  const g = googleStatus();

  let preview: NormalizedSheet | null = null;
  let auto: NormalizedSheet | null = null;
  let raw: string[][] = [];
  let previewError: string | null = null;
  if (g.sheets) {
    try {
      raw = await readTab(source.workbook_id, source.sheet_name, 80);
      const cfg = await loadImportConfig(supabase);
      preview = normalizeFor(raw, source, cfg);
      auto = normalizeFor(raw, { ...source, column_map: [] }, cfg);
    } catch (e) {
      previewError = errorText(e);
    }
  }
  const statusLabel = (c: string) => statuses.find((s) => s.code === c)?.label ?? c;
  const lastIssues = (runs.data?.[0]?.issues ?? []) as { row: number | null; message: string }[];

  return (
    <>
      <div className="mb-1 text-xs text-ink-faint">
        <Link href="/imports">Google Sheet imports</Link> / {source.workbook_name}
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{source.sheet_name.trim() || '(blank tab name)'}</h1>
          <p className="mt-1 text-ink-soft">
            {source.workbook_name} — <a href={`https://docs.google.com/spreadsheets/d/${source.workbook_id}`} target="_blank" rel="noreferrer">open workbook</a>
          </p>
        </div>
        <form action={syncNow}>
          <input type="hidden" name="source_id" value={source.id} />
          <input type="hidden" name="back" value={`/imports/${source.id}`} />
          <SubmitButton pending="Syncing…" disabled={!g.sheets}>Sync this tab now</SubmitButton>
        </form>
      </div>
      <Flash sp={sp} />

      <div className="mb-5 grid gap-5 xl:grid-cols-[360px_1fr]">
        <Panel title="Tab settings">
          <form action={updateSource} className="space-y-3">
            <input type="hidden" name="id" value={source.id} />
            <fieldset disabled={!admin} className="space-y-3">
              <Field label="Workbook name"><input name="workbook_name" defaultValue={source.workbook_name ?? ''} className="input" /></Field>
              <Field label="Default client" hint="Used when the tab has no Client column, or the value does not match a client.">
                <select name="default_client_id" defaultValue={source.default_client_id ?? ''} className="input">
                  <option value="">None</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="How to use this tab">
                <select name="mode" defaultValue={source.mode} className="input">
                  <option value="cases">Escalations — create and update cases</option>
                  <option value="enrich">Lookup — only fill gaps (price, POD link, hub) on existing cases</option>
                </select>
              </Field>
              <Field label="Header row" hint="Leave empty to detect it.">
                <input name="header_row" type="number" min={1} defaultValue={source.header_row ?? ''} className="input" />
              </Field>
              <Field label="Escalation date format" hint="Automatic works for most tabs; set it when a tab only has ambiguous dates like 7/1/2026.">
                <select name="date_order" defaultValue={source.date_order} className="input">
                  <option value="auto">Automatic</option>
                  <option value="DMY">Day first (01-07-2026 = 1 July)</option>
                  <option value="MDY">Month first (7/1/2026 = 1 July)</option>
                </select>
              </Field>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_active" value="1" defaultChecked={source.is_active} /> Include in scheduled syncs
              </label>
              {admin && <SubmitButton>Save settings</SubmitButton>}
            </fieldset>
          </form>
        </Panel>

        <Panel title="Column mapping" bodyClass="tbl-wrap">
          {!g.sheets ? (
            <p className="p-4 text-ink-soft">Connect Google Sheets to preview this tab.</p>
          ) : previewError ? (
            <p className="p-4 text-age-5">Could not read the tab: {previewError}</p>
          ) : preview && auto ? (
            <form action={saveMapping}>
              <input type="hidden" name="id" value={source.id} />
              <input type="hidden" name="width" value={preview.mapping.length} />
              <p className="px-4 pt-3 text-ink-soft">
                Header found on row {preview.headerRow}. Columns are matched by header name (typos included) or by their values. Change any column below.
              </p>
              <table className="tbl mt-2">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Header in sheet</th>
                    <th>Sample values</th>
                    <th>Maps to</th>
                    <th>Matched by</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.mapping.map((m) => {
                    const body = raw.slice(preview!.headerRow).map((r) => r[m.index]).filter((v) => v && v.trim()).slice(0, 3);
                    return (
                      <tr key={m.index}>
                        <td className="text-ink-faint">{colLetter(m.index)}</td>
                        <td>{m.header || <span className="muted">(blank)</span>}</td>
                        <td className="max-w-[260px] truncate text-xs text-ink-soft" title={body.join(' | ')}>{body.join(' | ')}</td>
                        <td>
                          <input type="hidden" name={`auto_${m.index}`} value={auto!.mapping[m.index]?.target ?? ''} />
                          <select name={`col_${m.index}`} defaultValue={m.target ?? ''} className="input input-sm w-52" disabled={!admin}>
                            <option value="">Not used</option>
                            {TARGET_FIELDS.filter((t) => t !== 'ignore').map((t) => <option key={t} value={t}>{FIELD_LABELS[t]}</option>)}
                            <option value="ignore">{FIELD_LABELS.ignore}</option>
                          </select>
                        </td>
                        <td className="text-xs text-ink-soft">{m.via ? VIA[m.via] : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {admin && (
                <div className="border-t border-line px-4 py-3">
                  <SubmitButton>Save mapping</SubmitButton>
                </div>
              )}
            </form>
          ) : null}
        </Panel>
      </div>

      {preview && (
        <Panel title={`Preview — first ${preview.rows.length} rows as they will be imported`} className="mb-5" bodyClass="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Row</th>
                <th>AWB</th>
                <th>Escalated</th>
                <th>Delivery</th>
                <th>Status</th>
                <th>Hub</th>
                <th>Location</th>
                <th>POD</th>
                <th>Shadowfax remark</th>
                <th>Client remark</th>
                <th>Agent / POC</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 25).map((r) => (
                <tr key={r.source_key}>
                  <td className="text-ink-faint">{r.row_number}</td>
                  <td className="awb">{r.awb}</td>
                  <td className="whitespace-nowrap">{r.escalation_date ? fmtDate(r.escalation_date) : <span className="text-age-3">missing</span>}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.delivery_date)}</td>
                  <td>{statusLabel(r.status_code)}{r.status_raw && <span className="block text-2xs text-ink-faint">“{r.status_raw}”</span>}</td>
                  <td>{r.hub ?? '—'}</td>
                  <td>{r.location ?? '—'}</td>
                  <td>{r.pod_link ? <a href={r.pod_link} target="_blank" rel="noreferrer">link</a> : (r.extra.pod_note as string) ?? '—'}</td>
                  <td className="max-w-[180px] truncate">{r.team_remark ?? ''}</td>
                  <td className="max-w-[180px] truncate">{r.client_remark ?? ''}</td>
                  <td>{[r.agent_name, r.poc_name].filter(Boolean).join(' / ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!!preview.issues.length && (
            <ul className="border-t border-line px-4 py-3 text-xs text-age-4">
              {preview.issues.slice(0, 15).map((i, k) => <li key={k}>Row {i.row}: {i.message}</li>)}
            </ul>
          )}
        </Panel>
      )}

      <Panel title="Sync history" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Started</th>
              <th>Result</th>
              <th className="text-right">Rows</th>
              <th className="text-right">New</th>
              <th className="text-right">Updated</th>
              <th className="text-right">Linked</th>
              <th className="text-right">Skipped</th>
              <th className="text-right">Lost requests</th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                <td>{r.status}</td>
                <td className="text-right">{fmtNum(r.rows_read)}</td>
                <td className="text-right">{fmtNum(r.cases_created)}</td>
                <td className="text-right">{fmtNum(r.cases_updated)}</td>
                <td className="text-right">{fmtNum(r.cases_linked)}</td>
                <td className="text-right">{fmtNum(r.rows_skipped)}</td>
                <td className="text-right">{fmtNum(r.lost_requests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!!lastIssues.length && (
          <details className="border-t border-line px-4 py-3">
            <summary className="cursor-pointer text-signal">Issues in the last sync ({lastIssues.length})</summary>
            <ul className="mt-2 text-xs text-ink-soft">
              {lastIssues.map((i, k) => <li key={k}>{i.row ? `Row ${i.row}: ` : ''}{i.message}</li>)}
            </ul>
          </details>
        )}
      </Panel>
    </>
  );
}
