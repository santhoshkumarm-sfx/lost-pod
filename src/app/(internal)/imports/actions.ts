'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin, requireInternal } from '@/lib/auth';
import { errorText, must, str, strOrNull, withFlash } from '@/lib/flash';
import { getWorkbook, parseWorkbookId } from '@/lib/google/sheets';
import { syncSources } from '@/lib/importer/sheets-sync';
import { isTargetField } from '@/lib/normalize/fields';
import { normHeader, normText } from '@/lib/normalize/text';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

async function done(back: string, fn: () => Promise<string>): Promise<never> {
  let dest: string;
  try {
    dest = withFlash(back, 'ok', await fn());
  } catch (e) {
    dest = withFlash(back, 'error', errorText(e));
  }
  revalidatePath(back.split('?')[0]);
  redirect(dest);
}

/** Imports run with the service role (import_sheet_rows is not callable by users), after the role check. */
export async function syncNow(fd: FormData) {
  const user = await requireInternal();
  const ids = fd.getAll('source_id').map(String).filter(Boolean);
  const back = str(fd, 'back') || '/imports';
  await done(back, async () => {
    const { results, remaining } = await syncSources(createAdminClient(), {
      actor: user.id, trigger: 'manual', sourceIds: ids.length ? ids : undefined, timeBudgetMs: 240_000,
    });
    if (!results.length) return 'No active tabs to sync.';
    const failed = results.filter((r) => r.status === 'failed');
    const sum = (k: 'created' | 'updated' | 'linked' | 'lostRequests') => results.reduce((n, r) => n + r[k], 0);
    let msg = `Synced ${results.length} tab(s): ${sum('created')} new, ${sum('updated')} updated, ${sum('linked')} linked to existing cases`;
    if (sum('lostRequests')) msg += `, ${sum('lostRequests')} Lost request(s) raised for approval`;
    msg += '.';
    if (failed.length) msg += ` ${failed.length} failed: ${failed.map((f) => `${f.label} (${f.message})`).join('; ')}`;
    if (remaining) msg += ` ${remaining} tab(s) left for the next run.`;
    return msg;
  });
}

export async function addWorkbook(fd: FormData) {
  await requireAdmin();
  await done('/imports', async () => {
    const id = parseWorkbookId(str(fd, 'workbook'));
    if (!id) throw new Error('Paste the Google Sheets link or its ID.');
    const wb = await getWorkbook(id);
    const sb = await createClient();
    const rows = wb.tabs.filter((t) => !t.hidden).map((t) => ({
      workbook_id: id, workbook_name: wb.title, sheet_name: t.title, default_client_id: strOrNull(fd, 'client_id'),
      mode: /rough|sheet\d+|lookup|dump/i.test(t.title) ? 'enrich' : 'cases', is_active: false,
    }));
    const { error } = await sb.from('sheet_sources').upsert(rows, { onConflict: 'workbook_id,sheet_name', ignoreDuplicates: true });
    if (error) throw error;
    return `Added ${rows.length} tab(s) from “${wb.title}”. They start switched off: check each tab’s mapping, then turn it on. Remember to share the workbook with the service account.`;
  });
}

export async function updateSource(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'id');
  await done(`/imports/${id}`, async () => {
    const sb = await createClient();
    const headerRow = Number(str(fd, 'header_row'));
    const { error } = await sb.from('sheet_sources').update({
      default_client_id: strOrNull(fd, 'default_client_id'),
      mode: str(fd, 'mode') === 'enrich' ? 'enrich' : 'cases',
      header_row: headerRow >= 1 ? headerRow : null,
      date_order: ['DMY', 'MDY'].includes(str(fd, 'date_order')) ? str(fd, 'date_order') : 'auto',
      is_active: str(fd, 'is_active') === '1',
      workbook_name: strOrNull(fd, 'workbook_name'),
    }).eq('id', id);
    if (error) throw error;
    return 'Tab settings saved.';
  });
}

export async function toggleSource(fd: FormData) {
  await requireAdmin();
  await done('/imports', async () => {
    const sb = await createClient();
    const on = str(fd, 'on') === '1';
    must(await sb.from('sheet_sources').update({ is_active: on }).eq('id', str(fd, 'id')).select('id'));
    return on ? 'Tab switched on. It will be included in the next sync.' : 'Tab switched off. Its cases stay in the database.';
  });
}

/** Save the column mapping: only columns where the admin's choice differs from automatic detection become overrides. */
export async function saveMapping(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'id');
  await done(`/imports/${id}`, async () => {
    const width = Number(str(fd, 'width')) || 0;
    const overrides: { index: number; target: string }[] = [];
    for (let i = 0; i < width; i++) {
      const chosen = str(fd, `col_${i}`);
      const auto = str(fd, `auto_${i}`);
      if (chosen !== auto && (chosen === '' ? true : isTargetField(chosen))) overrides.push({ index: i, target: chosen || 'ignore' });
    }
    const sb = await createClient();
    const { error } = await sb.from('sheet_sources').update({ column_map: overrides }).eq('id', id);
    if (error) throw error;
    return overrides.length ? `Mapping saved with ${overrides.length} manual column choice(s). Sync the tab to apply it.` : 'Mapping reset to automatic detection.';
  });
}

export async function addAlias(fd: FormData) {
  await requireAdmin();
  await done('/imports/mappings', async () => {
    const alias = normHeader(str(fd, 'alias'));
    const target = str(fd, 'target_field');
    if (!alias || !isTargetField(target)) throw new Error('Enter a header and choose a field.');
    const sb = await createClient();
    const { error } = await sb.from('column_aliases').upsert({ alias, target_field: target }, { onConflict: 'alias' });
    if (error) throw error;
    return `Header “${str(fd, 'alias')}” now maps to ${target}.`;
  });
}

export async function deleteAlias(fd: FormData) {
  await requireAdmin();
  await done('/imports/mappings', async () => {
    const sb = await createClient();
    const { error } = await sb.from('column_aliases').delete().eq('id', str(fd, 'id'));
    if (error) throw error;
    return 'Header alias removed.';
  });
}

export async function addStatusMapping(fd: FormData) {
  await requireAdmin();
  await done('/imports/mappings', async () => {
    const matchType = ['exact', 'contains', 'regex'].includes(str(fd, 'match_type')) ? str(fd, 'match_type') : 'exact';
    const pattern = matchType === 'regex' ? str(fd, 'pattern') : normText(str(fd, 'pattern'));
    if (!pattern) throw new Error('Enter the tracker wording.');
    if (matchType === 'regex') new RegExp(pattern);
    const sb = await createClient();
    const { error } = await sb.from('status_mappings').upsert(
      { pattern, match_type: matchType, status_code: str(fd, 'status_code'), priority: Number(str(fd, 'priority')) || 50 },
      { onConflict: 'pattern,match_type' },
    );
    if (error) throw error;
    return `“${pattern}” mapped. It applies from the next sync.`;
  });
}

export async function deleteStatusMapping(fd: FormData) {
  await requireAdmin();
  await done('/imports/mappings', async () => {
    const sb = await createClient();
    const { error } = await sb.from('status_mappings').delete().eq('id', str(fd, 'id'));
    if (error) throw error;
    return 'Status mapping removed.';
  });
}
