'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isAdminRole, requireAdmin, requireInternal } from '@/lib/auth';
import { errorText, must, numOrNull, str, strOrNull, withFlash } from '@/lib/flash';
import { cleanAwb } from '@/lib/normalize/awb';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';
import { notifyAdminsByEmail } from '@/lib/notify';

async function run(back: string, fn: () => Promise<string | void>): Promise<never> {
  let msg: string | void;
  try {
    msg = await fn();
  } catch (e) {
    redirect(withFlash(back, 'error', errorText(e)));
  }
  revalidatePath(back.split('?')[0]);
  redirect(withFlash(back, 'ok', msg || 'Saved.'));
}

/** Status, assignment and remarks. Changing status here stops the tracker from overriding it. */
export async function updateCase(fd: FormData) {
  await requireInternal();
  const id = str(fd, 'id');
  const back = `/cases/${id}`;
  await run(back, async () => {
    const sb = await createClient();
    const current = must(await sb.from('cases').select('team_status, assigned_agent').eq('id', id).single()) as { team_status: string; assigned_agent: string | null };
    const patch: Record<string, unknown> = {
      team_remark: strOrNull(fd, 'team_remark'),
      client_remark: strOrNull(fd, 'client_remark'),
      hub: strOrNull(fd, 'hub'),
      location: strOrNull(fd, 'location'),
      pod_link: strOrNull(fd, 'pod_link'),
      pod_status: str(fd, 'pod_status') || 'pending',
      priority: strOrNull(fd, 'priority'),
      complaint_type: strOrNull(fd, 'complaint_type'),
      reason: strOrNull(fd, 'reason'),
      product_name: strOrNull(fd, 'product_name'),
      product_value: numOrNull(fd, 'product_value'),
      last_change_source: 'app',
    };
    const status = str(fd, 'team_status');
    if (status && status !== current.team_status) {
      patch.team_status = status;
      patch.status_source = 'app';
    }
    if (fd.has('assigned_agent')) {
      const agent = str(fd, 'assigned_agent') || null;
      if (agent !== current.assigned_agent) patch.assigned_agent = agent;
    }
    const { error } = await sb.from('cases').update(patch).eq('id', id);
    if (error) throw error;
    return 'Case updated.';
  });
}

export async function saveInternalNote(fd: FormData) {
  const user = await requireInternal();
  const id = str(fd, 'id');
  await run(`/cases/${id}`, async () => {
    const sb = await createClient();
    const { error } = await sb
      .from('case_private')
      .upsert({ case_id: id, internal_remark: strOrNull(fd, 'internal_remark'), updated_by: user.id, updated_at: new Date().toISOString() });
    if (error) throw error;
    return 'Internal note saved. Clients cannot see it.';
  });
}

export async function addComment(fd: FormData) {
  const user = await requireInternal();
  const id = str(fd, 'id');
  await run(`/cases/${id}`, async () => {
    const body = str(fd, 'body');
    if (!body) throw new Error('Write a comment first.');
    const sb = await createClient();
    const visibility = str(fd, 'visibility') === 'client' ? 'client' : 'internal';
    const { error } = await sb.from('case_comments').insert({ case_id: id, user_id: user.id, body, visibility });
    if (error) throw error;
    return visibility === 'client' ? 'Comment shared with the client.' : 'Internal comment added.';
  });
}

export async function requestLost(fd: FormData) {
  await requireInternal();
  const id = str(fd, 'id');
  await run(`/cases/${id}`, async () => {
    const sb = await createClient();
    const { error } = await sb.rpc('request_lost', { p_case_id: id, p_reason: str(fd, 'reason') });
    if (error) throw error;
    await notifyAdminsByEmail(id, str(fd, 'reason'));
    return 'Lost request sent to Admin for approval.';
  });
}

export async function decideLost(fd: FormData) {
  await requireAdmin();
  const back = str(fd, 'back') || '/lost-approval';
  await run(back, async () => {
    const sb = await createClient();
    const decision = str(fd, 'decision');
    const ids = fd.getAll('approval_id').map(String).filter(Boolean);
    if (!ids.length) throw new Error('Select at least one request.');
    if (decision !== 'approved' && !str(fd, 'note')) throw new Error('Add a note explaining the rejection or what to investigate.');
    const { error } = ids.length === 1
      ? await sb.rpc('decide_lost', { p_approval_id: ids[0], p_decision: decision, p_note: strOrNull(fd, 'note') })
      : await sb.rpc('decide_lost_bulk', { p_approval_ids: ids, p_decision: decision, p_note: strOrNull(fd, 'note') });
    if (error) throw error;
    const verb = decision === 'approved' ? 'approved — marked Lost' : decision === 'rejected' ? 'rejected' : 'sent back for investigation';
    return `${ids.length} request${ids.length === 1 ? '' : 's'} ${verb}.`;
  });
}

export async function reopenLost(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'id');
  await run(`/cases/${id}`, async () => {
    const sb = await createClient();
    const { error } = await sb.rpc('reopen_lost_case', { p_case_id: id, p_status: str(fd, 'status'), p_note: str(fd, 'note') });
    if (error) throw error;
    return 'Case taken out of Lost.';
  });
}

export async function setDeleted(fd: FormData) {
  await requireAdmin();
  const id = str(fd, 'id');
  const del = str(fd, 'deleted') === '1';
  await run(del ? '/cases' : `/cases/${id}`, async () => {
    const sb = await createClient();
    const { error } = await sb.from('cases').update({ is_deleted: del, last_change_source: 'app' }).eq('id', id);
    if (error) throw error;
    return del ? 'Case removed. An admin can restore it from the audit log.' : 'Case restored.';
  });
}

export async function bulkUpdate(fd: FormData) {
  const user = await requireInternal();
  const back = str(fd, 'back') || '/cases';
  await run(back, async () => {
    const ids = fd.getAll('ids').map(String).filter(Boolean);
    if (!ids.length) throw new Error('Select at least one case.');
    const action = str(fd, 'bulk_action');
    const sb = await createClient();
    if (action === 'assign') {
      if (!isAdminRole(user.role) && str(fd, 'bulk_agent') && str(fd, 'bulk_agent') !== user.id) throw new Error('Only an admin can assign cases to someone else.');
      const { error, count } = await sb.from('cases').update({ assigned_agent: str(fd, 'bulk_agent') || null }, { count: 'exact' }).in('id', ids);
      if (error) throw error;
      return `${count ?? ids.length} case(s) assigned.`;
    }
    if (action === 'status') {
      const status = str(fd, 'bulk_status');
      if (!status) throw new Error('Choose a status.');
      const codes = (must(await sb.from('status_master').select('code').in('category', ['open', 'closed'])) as { code: string }[]).map((r) => r.code);
      const { error, count } = await sb
        .from('cases')
        .update({ team_status: status, status_source: 'app', last_change_source: 'app' }, { count: 'exact' })
        .in('id', ids)
        .in('team_status', codes);
      if (error) throw error;
      return `${count ?? 0} case(s) updated. Cases in the Lost workflow were skipped.`;
    }
    throw new Error('Choose a bulk action.');
  });
}

/** Manual case entry: one case per AWB. Warns about open cases with the same AWB unless confirmed. */
export async function createCases(fd: FormData) {
  const user = await requireInternal();
  const awbs = [...new Set(str(fd, 'awbs').split(/[\s,;]+/).map((a) => cleanAwb(a)).filter((a): a is string => !!a))];
  const esc = str(fd, 'escalation_date');
  const qs = new URLSearchParams();
  for (const k of ['awbs', 'client_id', 'escalation_date', 'location', 'hub', 'reason', 'complaint_type', 'priority', 'team_remark', 'seller_name']) qs.set(k, str(fd, k));
  const back = `/cases/new?${qs.toString()}`;
  let target = '/cases';
  try {
    if (!awbs.length) throw new Error('Enter at least one valid AWB.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(esc)) throw new Error('Escalation date is required.');
    if (esc > todayIn()) throw new Error('Escalation date cannot be in the future.');
    const sb = await createClient();
    if (str(fd, 'confirm_duplicates') !== '1') {
      const dup = must(await sb.rpc('find_existing_cases', { p_awbs: awbs })) as { awb: string; status_category: string }[];
      const open = dup.filter((d) => d.status_category === 'open' || d.status_category === 'lost_pending');
      if (open.length) throw new Error(`Open cases already exist for ${[...new Set(open.map((d) => d.awb))].join(', ')}. Tick "Create anyway" to add new escalations.`);
    }
    const rows = awbs.map((awb) => ({
      awb, client_id: strOrNull(fd, 'client_id'), client_poc_id: strOrNull(fd, 'client_poc_id'), escalation_date: esc,
      location: strOrNull(fd, 'location'), hub: strOrNull(fd, 'hub'), delivery_date: strOrNull(fd, 'delivery_date'),
      seller_name: strOrNull(fd, 'seller_name'), complaint_type: strOrNull(fd, 'complaint_type'), reason: strOrNull(fd, 'reason'),
      priority: strOrNull(fd, 'priority'), team_remark: strOrNull(fd, 'team_remark'), product_value: numOrNull(fd, 'product_value'),
      assigned_agent: strOrNull(fd, 'assigned_agent') ?? user.id, email_subject: strOrNull(fd, 'email_subject'),
      source_type: 'manual', team_status: 'pending', status_source: 'app', created_by: user.id, last_change_source: 'app',
    }));
    const created = must(await sb.from('cases').insert(rows).select('id')) as { id: string }[];
    target = created.length === 1 ? `/cases/${created[0].id}` : `/cases?q=${encodeURIComponent(awbs.join(' '))}&category=all`;
  } catch (e) {
    redirect(withFlash(back, 'error', errorText(e)));
  }
  redirect(withFlash(target, 'ok', `${awbs.length} case${awbs.length === 1 ? '' : 's'} created.`));
}

/** Used by the cases list to give the internal team its own queue quickly. */
export async function assignToMe(fd: FormData) {
  const user = await requireInternal();
  const id = str(fd, 'id');
  await run(`/cases/${id}`, async () => {
    const sb = await createClient();
    const { error } = await sb.from('cases').update({ assigned_agent: user.id }).eq('id', id).is('assigned_agent', null);
    if (error) throw error;
    return 'Assigned to you.';
  });
}

