import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getWorkbook, readRows } from '../google';
import { cleanAwb } from '../normalize/awb';
import { parseDate } from '../normalize/dates';
import { isUrl, normHeader } from '../normalize/text';
import { todayIn } from '../time';

/*
 * The POD sheets (POD, POD CPC …) are only READ. Every tab that has an AWB column and a POD / image link
 * column is copied into pod_index (AWB → link). Tabs only grow, so each run reads the rows added since the
 * last run; a tab that got shorter (rows deleted or re-sorted) is read again from the top.
 */

export interface PodWorkbook { id: string; name: string }

const AWB_HEADERS = ['awb', 'awbno', 'awbnumber', 'trackingid', 'trackingnumber', 'trackingno', 'waybill', 'matchedawbs'];
const LINK_HEADERS = ['imagelink', 'podimagelink', 'podlink', 'podlinks', 'podurl', 'podimageurl', 'link', 'imageurl', 'pod'];
const DATE_HEADERS = ['scandate', 'delivereddate', 'deliverydate', 'timestamp', 'date'];
const HUB_HEADERS = ['hub', 'hubname'];
const CHUNK = 20_000;

export interface PodTabResult { workbook: string; tab: string; added: number; links: number; message: string }

function findCol(header: string[], names: string[]): number {
  const keys = header.map((h) => normHeader(h ?? ''));
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** Header row = first of the top 5 rows that has both an AWB column and a link column. */
function detect(top: string[][]) {
  for (let r = 0; r < top.length; r++) {
    const awb = findCol(top[r], AWB_HEADERS);
    const link = findCol(top[r], LINK_HEADERS);
    if (awb >= 0 && link >= 0) {
      return { headerRow: r + 1, awb, link, date: findCol(top[r], DATE_HEADERS), hub: findCol(top[r], HUB_HEADERS), header: top[r] };
    }
  }
  return null;
}

export async function podWorkbooks(sb: SupabaseClient): Promise<PodWorkbook[]> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'pod_workbooks').maybeSingle();
  const list = Array.isArray(data?.value) ? (data!.value as PodWorkbook[]) : [];
  return list.filter((w) => w && typeof w.id === 'string' && w.id.length > 20);
}

/** One AWB cell can hold several AWBs ("SF1…, SF2…"). */
export function splitAwbCell(v: string): string[] {
  return [...new Set(String(v ?? '').split(/[\s,;|/]+/).map((x) => cleanAwb(x)).filter((x): x is string => !!x))];
}

/**
 * Refresh pod_index from every POD workbook. Service-role client. Stops cleanly at the deadline;
 * the next run continues where this one stopped.
 */
export async function syncPodIndex(sb: SupabaseClient, opts: { deadline?: number; full?: boolean } = {}): Promise<PodTabResult[]> {
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const today = todayIn();
  const results: PodTabResult[] = [];
  for (const wb of await podWorkbooks(sb)) {
    let tabs: string[];
    try {
      tabs = (await getWorkbook(wb.id)).tabs.map((t) => t.title);
    } catch (e) {
      results.push({ workbook: wb.name, tab: '', added: 0, links: 0, message: `Cannot open: ${(e as Error).message}` });
      continue;
    }
    const { data: states } = await sb.from('pod_sync_state').select('*').eq('workbook_id', wb.id);
    for (const tab of tabs) {
      if (Date.now() > deadline) return results;
      const state = (states ?? []).find((s) => s.sheet_name === tab) as { rows_done: number; awb_column: string | null } | undefined;
      const res: PodTabResult = { workbook: wb.name, tab, added: 0, links: 0, message: '' };
      try {
        const head = await readRows(wb.id, tab, { startRow: 1, maxRows: 5 });
        const d = detect(head.rows);
        if (!d) {
          res.message = 'No AWB and POD link columns — skipped';
          await saveState(sb, wb, tab, { rows_done: 0, awb_column: null, link_column: null, links: 0, last_message: res.message });
          continue;
        }
        let done = opts.full || !state || state.awb_column !== d.header[d.awb] ? 0 : state.rows_done;
        let dataRows = Math.max(head.lastRow - d.headerRow, 0);
        if (done > dataRows) done = 0;   // tab got shorter: read again from the top
        const cols = [d.awb, d.link, d.date, d.hub].filter((c) => c >= 0).map((c) => c + 1);
        const at = (row: string[], c: number) => (c >= 0 ? row[cols.indexOf(c + 1)] ?? '' : '');
        while (done < dataRows && Date.now() < deadline) {
          const part = await readRows(wb.id, tab, { startRow: d.headerRow + 1 + done, maxRows: CHUNK, columns: cols, linkColumns: [d.link + 1] });
          if (!part.rows.length) { dataRows = done; break; }
          const out = new Map<string, Record<string, unknown>>();
          for (const row of part.rows) {
            const link = at(row, d.link).trim();
            if (!isUrl(link)) continue;
            const scan = at(row, d.date) ? parseDate(at(row, d.date).slice(0, 19), 'DMY', today)?.iso ?? null : null;
            for (const awb of splitAwbCell(at(row, d.awb))) {
              out.set(`${awb}\u0001${link}`, { awb, pod_link: link, workbook_id: wb.id, sheet_name: tab, scan_date: scan, hub: at(row, d.hub) || null });
            }
          }
          const rows = [...out.values()];
          for (let i = 0; i < rows.length; i += 5000) {
            const { error } = await sb.from('pod_index').upsert(rows.slice(i, i + 5000), { onConflict: 'awb,pod_link', ignoreDuplicates: true });
            if (error) throw new Error(error.message);
          }
          res.added += rows.length;
          done += part.rows.length;
          if (part.rows.length < CHUNK) dataRows = Math.min(dataRows, done);   // reached the end
        }
        const { count } = await sb.from('pod_index').select('awb', { count: 'exact', head: true }).eq('workbook_id', wb.id).eq('sheet_name', tab);
        res.links = count ?? 0;
        res.message = done < dataRows ? `${done} of ${dataRows} rows read — continues next time` : `${dataRows} rows read`;
        await saveState(sb, wb, tab, { rows_done: done, awb_column: d.header[d.awb], link_column: d.header[d.link], links: res.links, last_message: res.message });
      } catch (e) {
        res.message = `Failed: ${(e as Error).message}`.slice(0, 300);
        await saveState(sb, wb, tab, { last_message: res.message });
      }
      results.push(res);
    }
  }
  return results;
}

async function saveState(sb: SupabaseClient, wb: PodWorkbook, tab: string, v: Record<string, unknown>) {
  await sb.from('pod_sync_state').upsert(
    { workbook_id: wb.id, sheet_name: tab, workbook_name: wb.name, last_synced_at: new Date().toISOString(), ...v },
    { onConflict: 'workbook_id,sheet_name' },
  );
}
