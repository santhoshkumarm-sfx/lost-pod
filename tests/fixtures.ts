import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildAliasMap } from '@/lib/normalize/headers';
import type { StatusDef, StatusMappingRule } from '@/lib/normalize/status';
import type { ClientLite } from '@/lib/normalize/clients';

// Tests use the same configuration that the database is seeded with.
const seed = readFileSync(path.join(__dirname, '..', 'supabase', 'seed.sql'), 'utf8');

function block(start: string): string {
  const i = seed.indexOf(start);
  return seed.slice(i, seed.indexOf('on conflict', i));
}

export const aliasRows = [...block('insert into public.column_aliases').matchAll(/\('([^']+)','([a-z_]+)'\)/g)].map((m) => ({
  alias: m[1],
  target_field: m[2],
}));
export const aliases = buildAliasMap(aliasRows);

export const statusRules: StatusMappingRule[] = [
  ...block('insert into public.status_mappings').matchAll(/\('([^']+)', '(exact|contains|regex)', '([a-z_]+)', (\d+)\)/g),
].map((m) => ({ pattern: m[1], match_type: m[2] as StatusMappingRule['match_type'], status_code: m[3], priority: Number(m[4]) }));

export const statuses: StatusDef[] = [
  ...block('insert into public.status_master').matchAll(/\('([a-z_]+)',\s+'([^']+)',\s+'([a-z_]+)',\s+(\d+)/g),
].map((m) => ({ code: m[1], label: m[2], category: m[3] as StatusDef['category'], sort_order: Number(m[4]) }));

export const clients: ClientLite[] = [
  { id: 'c-velocity', name: 'Velocity', aliases: ['Velocity Prime'], email_domains: ['velocity.in'] },
  { id: 'c-prozo', name: 'Prozo', aliases: ['Prozo Express'], email_domains: [] },
  { id: 'c-kart', name: 'Kartrocket', aliases: ['Kart Rocket'], email_domains: [] },
  { id: 'c-swift', name: 'Swift', aliases: ['Swift Premium', 'Swift Prime'], email_domains: ['goswift.in'] },
];
