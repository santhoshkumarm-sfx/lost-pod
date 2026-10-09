import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getWorkbook, readTab } from '../google';
import { normalizeSheet, type NormalizedSheet } from '../normalize/sheet';
import type { ColumnOverride } from '../normalize/headers';
import { loadImportConfig, type ImportConfig } from './config';

export interface SheetSource {
  id: string;
  workbook_id: string;
  workbook_name: string | null;
  sheet_name: string;
  default_client_id: string | null;
  mode: 'cases' | 'enrich';
  header_row: number | null;
  date_order: 'auto' | 'DMY' | 'MDY';
  column_map: ColumnOverride[];
  is_active: boolean;
  last_synced_at: string | null;
}

export interface SyncResult {
  sourceId: string;
  label: string;
  status: 'success' | 'partial' | 'failed';
  rowsRead: number;
  created: number;
  updated: number;
  linked: number;
  unchanged: number;
  skipped: number;
  lostRequests: number;
  errors: number;
  message: string;
}

const BATCH = 500;
const SOURCE_COLUMNS =
  'id, workbook_id, workbook_name, sheet_name, default_client_id, mode, header_row, date_order, column_map, is_active, last_synced_at';

export function normalizeFor(values: string[][], source: SheetSource, cfg: ImportConfig): NormalizedSheet {
  return normalizeSheet(values, {
    sourceId: source.id,
    defaultClientId: source.default_client_id,
    clients: cfg.clients,
    aliases: cfg.aliases,
    overrides: Array.isArray(source.column_map) ? source.column_map : [],
    statusRules: cfg.statusRules,
    statuses: cfg.statuses,
    dateOrder: source.date_order,
    headerRow: source.header_row,
    todayIso: cfg.todayIso,
    hubCityCodes: cfg.hubCityCodes,
  });
}

/** A tab name with * or ? (e.g. "??-??-????" for one tab per day) stands for every matching tab. */
export const isPattern = (name: string) => /[*?]/.test(name);

function tabDateKey(name: string): string {
  const m = name.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  return m ? `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}` : name;
}

/** The tabs a source reads, newest first (by the date in the tab name when there is one). */
export async function tabsFor(source: Pick<SheetSource, 'workbook_id' | 'sheet_name'>): Promise<string[]> {
  if (!isPattern(source.sheet_name)) return [source.sheet_name];
  const glob = source.sheet_name.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  const re = new RegExp(`^${glob}$`, 'i');
  const wb = await getWorkbook(source.workbook_id);
  return wb.tabs
    .filter((t) => !t.hidden && re.test(t.title.trim()))
    .map((t) => t.title)
    .sort((a, b) => tabDateKey(b).localeCompare(tabDateKey(a)));
}

/** Read every tab of a source (a few at a time) and normalise each with its own header row; newer tabs win. */
async function readSource(source: SheetSource, cfg: ImportConfig): Promise<NormalizedSheet> {
  const tabs = await tabsFor(source);
  if (!isPattern(source.sheet_name)) return normalizeFor(await readTab(source.workbook_id, source.sheet_name), source, cfg);
  if (!tabs.length) throw new Error(`No tab matches "${source.sheet_name}".`);
  const sheets: { tab: string; n: NormalizedSheet }[] = [];
  for (let i = 0; i < tabs.length; i += 6) {
    const part = await Promise.all(tabs.slice(i, i + 6).map(async (tab) => ({ tab, n: normalizeFor(await readTab(source.workbook_id, tab), source, cfg) })));
    sheets.push(...part);
  }
  const rows = new Map<string, NormalizedSheet['rows'][number]>();
  for (const { tab, n } of sheets) {
    for (const r of n.rows) if (!rows.has(r.source_key)) rows.set(r.source_key, { ...r, extra: { ...r.extra, tab } });
  }
  const newest = sheets[0].n;
  return {
    headerRow: newest.headerRow,
    mapping: newest.mapping,
    dateOrders: newest.dateOrders,
    rows: [...rows.values()],
    rowsRead: sheets.reduce((a, s) => a + s.n.rowsRead, 0),
    skipped: sheets.reduce((a, s) => a + s.n.skipped, 0),
    issues: sheets.flatMap(({ tab, n }) => n.issues.map((x) => ({ row: x.row, message: `${tab}: ${x.message}` }))).slice(0, 50),
  };
}

/** Read one tab, normalise it and upsert through public.import_sheet_rows (service-role client). */
export async function syncSource(
  sb: SupabaseClient,
  source: SheetSource,
  cfg: ImportConfig,
  opts: { actor: string | null; trigger: 'manual' | 'cron' | 'cli' },
  deadline?: number,
): Promise<SyncResult> {
  const label = `${source.workbook_name ?? source.workbook_id} › ${source.sheet_name}`;
  const result: SyncResult = {
    sourceId: source.id, label, status: 'success', rowsRead: 0, created: 0, updated: 0, linked: 0, unchanged: 0,
    skipped: 0, lostRequests: 0, errors: 0, message: '',
  };
  const run = await sb
    .from('sync_runs')
    .insert({ sheet_source_id: source.id, triggered_by: opts.actor, trigger_type: opts.trigger })
    .select('id')
    .single();
  const runId = run.data?.id as string | undefined;
  // Move this tab to the back of the queue now, so a run that is cut off cannot block the other tabs forever.
  await sb.from('sheet_sources').update({ last_synced_at: new Date().toISOString(), last_sync_status: 'running', last_sync_message: 'Sync started — if this stays, the run was cut off and continues next time.' }).eq('id', source.id);
  let stoppedAt: number | null = null;
  const rowErrors: { row: unknown; awb: unknown; error: unknown }[] = [];
  let normalized: NormalizedSheet | null = null;

  try {
    normalized = await readSource(source, cfg);
    result.rowsRead = normalized.rowsRead;
    result.skipped = normalized.skipped;
    for (let i = 0; i < normalized.rows.length; i += BATCH) {
      if (deadline && Date.now() > deadline) {
        stoppedAt = i;
        break;
      }
      const batch = normalized.rows.slice(i, i + BATCH);
      const { data, error } = await sb.rpc('import_sheet_rows', { p_source_id: source.id, p_rows: batch, p_actor: opts.actor });
      if (error) throw new Error(`Import failed at row ${batch[0]?.row_number}: ${error.message}`);
      const r = data as { created: number; updated: number; linked: number; unchanged: number; skipped: number; lost_requests: number; errors: typeof rowErrors };
      result.created += r.created;
      result.updated += r.updated;
      result.linked += r.linked;
      result.unchanged += r.unchanged;
      result.skipped += r.skipped;
      result.lostRequests += r.lost_requests;
      rowErrors.push(...(r.errors ?? []));
    }
    result.errors = rowErrors.length;
    if (!normalized.mapping.some((m) => m.target === 'awb')) {
      result.status = 'failed';
      result.message = 'No AWB column found — map one on this tab’s mapping screen.';
    } else if (stoppedAt !== null) {
      result.status = 'partial';
      result.message = `Time limit: ${stoppedAt} of ${normalized.rows.length} rows done (${result.created} new, ${result.updated} updated). The rest continues on the next sync.`;
    } else if (rowErrors.length) {
      result.status = 'partial';
      result.message = `${rowErrors.length} row(s) could not be imported.`;
    } else {
      result.message = `${result.created} new, ${result.updated} updated, ${result.linked} linked, ${result.unchanged} unchanged.`;
    }
  } catch (e) {
    result.status = 'failed';
    result.message = e instanceof Error ? e.message : String(e);
  }

  const issues = [
    ...(normalized?.issues ?? []).map((i) => ({ row: i.row, message: i.message })),
    ...rowErrors.slice(0, 100).map((e) => ({ row: e.row, message: `${e.awb}: ${e.error}` })),
  ];
  if (runId) {
    await sb
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(), status: result.status, rows_read: result.rowsRead, rows_skipped: result.skipped,
        cases_created: result.created, cases_updated: result.updated, cases_linked: result.linked,
        rows_unchanged: result.unchanged, lost_requests: result.lostRequests, header_row: normalized?.headerRow ?? null,
        mapping: normalized?.mapping ?? null, issues: result.status === 'failed' ? [{ row: null, message: result.message }, ...issues] : issues,
      })
      .eq('id', runId);
  }
  await sb
    .from('sheet_sources')
    .update({
      last_synced_at: new Date().toISOString(), last_sync_status: result.status, last_sync_message: result.message,
      last_row_count: normalized?.rows.length ?? null,
    })
    .eq('id', source.id);
  return result;
}

/**
 * Sync active tabs, least recently synced first, within a time budget (Vercel functions stop at 300 s).
 * Tabs that do not fit are picked up first by the next run.
 */
export async function syncSources(
  sb: SupabaseClient,
  opts: { actor: string | null; trigger: 'manual' | 'cron' | 'cli'; sourceIds?: string[]; timeBudgetMs?: number },
): Promise<{ results: SyncResult[]; remaining: number }> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 240_000;
  let q = sb.from('sheet_sources').select(SOURCE_COLUMNS).order('last_synced_at', { ascending: true, nullsFirst: true });
  q = opts.sourceIds?.length ? q.in('id', opts.sourceIds) : q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const sources = (data ?? []) as SheetSource[];
  const cfg = await loadImportConfig(sb);
  const results: SyncResult[] = [];
  for (const s of sources) {
    if (Date.now() - started > budget) break;
    results.push(await syncSource(sb, s, cfg, opts, started + budget));
  }
  const lost = results.reduce((n, r) => n + r.lostRequests, 0);
  if (lost > 0) {
    // In-app notifications are created per request by the database.
    // One email per Lost request (per tracker tab and client) created by this run.
    const { emailNewLostRequests } = await import('../notify');
    await emailNewLostRequests();
  }
  return { results, remaining: sources.length - results.length };
}

export async function getSource(sb: SupabaseClient, id: string): Promise<SheetSource | null> {
  const { data } = await sb.from('sheet_sources').select(SOURCE_COLUMNS).eq('id', id).maybeSingle();
  return (data as SheetSource | null) ?? null;
}
