import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from './auth';
import { awbList } from './cases/filters';
import { requestNumber } from './cases/lost-filters';
import { cleanAwb } from './normalize/awb';
import { emailNewLostRequests } from './notify';
import { createClient } from './supabase/server';

export interface LostBulkResult { done: number; done_ids: string[]; skipped: number; first_error: string | null }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Lost request for one or many cases. Emails the routing list + that client's approvers. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function requestLostForCases(_user: SessionUser, ids: string[], reason: string, _via?: string): Promise<string> {
  if (!ids.length) throw new Error('Select at least one case.');
  if (reason.length < 5) throw new Error('Give a reason for the Lost request (at least a few words).');
  const sb = await createClient();
  const { data, error } = await sb.rpc('request_lost_bulk', { p_case_ids: ids, p_reason: reason });
  if (error) throw error;
  const r = data as LostBulkResult;
  if (!r.done) throw new Error(r.first_error ?? 'No Lost request was created.');
  await emailNewLostRequests();
  return `${ids.length === 1 ? 'Lost request' : plural(r.done, 'Lost request')} sent for approval.${r.skipped ? ` ${r.skipped} skipped: ${r.first_error}` : ''}`;
}

/** When the search looks like AWB(s), the ids of the requests that contain them; otherwise null. */
export async function requestIdsForAwbSearch(sb: SupabaseClient, q: string): Promise<string[] | null> {
  if (!q || requestNumber(q)) return null;
  const list = awbList(q) ?? (cleanAwb(q) && /[A-Z]/i.test(q) && /\d{5}/.test(q) && !/\s/.test(q.trim()) ? [cleanAwb(q)!] : null);
  if (!list) return null;
  const { data } = await sb.from('v_lost_requests').select('request_id').in('awb', list).not('request_id', 'is', null).limit(1000);
  return [...new Set(((data ?? []) as { request_id: string }[]).map((r) => r.request_id))];
}
