import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, requireEnv } from '../env';

let cached: SupabaseClient | null = null;

/**
 * Service-role client: bypasses Row Level Security. Only for crons, imports and user management,
 * and only after the caller's own permission check. Never send it (or its key) to the browser.
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(publicEnv.supabaseUrl || requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
