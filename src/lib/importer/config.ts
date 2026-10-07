import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAliasMap, type AliasMap } from '../normalize/headers';
import type { ClientLite } from '../normalize/clients';
import type { StatusDef, StatusMappingRule } from '../normalize/status';
import type { PocLite } from '../email/extract';
import { todayIn } from '../time';

export interface ImportConfig {
  clients: ClientLite[];
  pocs: PocLite[];
  aliases: AliasMap;
  statusRules: StatusMappingRule[];
  statuses: StatusDef[];
  hubCityCodes: Record<string, string>;
  awbPatterns: string[];
  internalDomains: string[];
  timezone: string;
  todayIso: string;
}

/** Everything the normalisers need, read from the database so admins can change it without a deploy. */
export async function loadImportConfig(sb: SupabaseClient): Promise<ImportConfig> {
  const [clients, pocs, aliases, rules, statuses, settings] = await Promise.all([
    sb.from('clients').select('id, name, aliases, email_domains').eq('is_active', true),
    sb.from('client_pocs').select('id, client_id, name, email').eq('is_active', true),
    sb.from('column_aliases').select('alias, target_field'),
    sb.from('status_mappings').select('pattern, match_type, status_code, priority'),
    sb.from('status_master').select('code, label, category, sort_order').eq('is_active', true),
    sb.from('app_settings').select('key, value').in('key', ['hub_city_codes', 'awb_patterns', 'internal_email_domains', 'timezone']),
  ]);
  for (const r of [clients, pocs, aliases, rules, statuses, settings]) if (r.error) throw new Error(r.error.message);
  const setting = (k: string) => settings.data?.find((s) => s.key === k)?.value;
  const timezone = (setting('timezone') as string) || 'Asia/Kolkata';
  return {
    clients: (clients.data ?? []) as ClientLite[],
    pocs: (pocs.data ?? []) as PocLite[],
    aliases: buildAliasMap(aliases.data ?? []),
    statusRules: (rules.data ?? []) as StatusMappingRule[],
    statuses: (statuses.data ?? []) as StatusDef[],
    hubCityCodes: (setting('hub_city_codes') as Record<string, string>) ?? {},
    awbPatterns: (setting('awb_patterns') as string[]) ?? [],
    internalDomains: (setting('internal_email_domains') as string[]) ?? ['shadowfax.in'],
    timezone,
    todayIso: todayIn(timezone),
  };
}
