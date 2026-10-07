import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StatusOption } from './types';

export async function getClients(sb: SupabaseClient, activeOnly = false) {
  let q = sb.from('clients').select('id, name, is_active').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  return ((await q).data ?? []) as { id: string; name: string; is_active: boolean }[];
}

export async function getStatuses(sb: SupabaseClient) {
  return ((await sb.from('status_master').select('*').order('sort_order')).data ?? []) as StatusOption[];
}

export async function getAgents(sb: SupabaseClient) {
  return ((await sb
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['super_admin', 'admin', 'internal_team'])
    .eq('is_active', true)
    .order('full_name')).data ?? []) as { id: string; full_name: string | null; email: string; role: string }[];
}

export async function getBuckets(sb: SupabaseClient) {
  return ((await sb.from('aging_buckets').select('id, label, min_days, max_days, sort_order').order('sort_order')).data ?? []) as {
    id: number; label: string; min_days: number; max_days: number | null; sort_order: number;
  }[];
}

export async function getPocs(sb: SupabaseClient, clientId?: string | null) {
  let q = sb.from('client_pocs').select('id, client_id, name, email, user_id, is_active').order('name');
  if (clientId) q = q.eq('client_id', clientId);
  return ((await q).data ?? []) as { id: string; client_id: string; name: string; email: string | null; user_id: string | null; is_active: boolean }[];
}
