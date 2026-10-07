import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { isAdminRole, requireInternal } from '@/lib/auth';
import type { SearchParams } from '@/lib/flash';
import { getStatuses } from '@/lib/lookups';
import { FIELD_LABELS, TARGET_FIELDS, type TargetField } from '@/lib/normalize/fields';
import { createClient } from '@/lib/supabase/server';
import { addAlias, addStatusMapping, deleteAlias, deleteStatusMapping } from '../actions';

export const metadata = { title: 'Header and status wording' };

export default async function MappingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const sp = await searchParams;
  const supabase = await createClient();
  const [aliasesRes, mapsRes, statuses] = await Promise.all([
    supabase.from('column_aliases').select('*').order('target_field').order('alias'),
    supabase.from('status_mappings').select('*').order('priority').order('pattern'),
    getStatuses(supabase),
  ]);
  const aliases = (aliasesRes.data ?? []) as { id: string; alias: string; target_field: TargetField }[];
  const grouped = TARGET_FIELDS.map((t) => ({ t, list: aliases.filter((a) => a.target_field === t) })).filter((g) => g.list.length);
  const label = (code: string) => statuses.find((s) => s.code === code)?.label ?? code;

  return (
    <>
      <div className="mb-1 text-xs text-ink-faint"><Link href="/imports">Google Sheet imports</Link> / wording</div>
      <PageHeader
        title="Header and status wording"
        sub="How tracker headers and free-text statuses are understood. Changes apply from the next sync; no deploy needed."
      />
      <Flash sp={sp} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Column headers">
          {admin && (
            <form action={addAlias} className="mb-4 grid gap-2 md:grid-cols-[1fr_200px_auto] md:items-end">
              <Field label="Header as written in a sheet"><input name="alias" required className="input" placeholder="e.g. Shadowfax remarks" /></Field>
              <Field label="Means">
                <select name="target_field" className="input">
                  {TARGET_FIELDS.map((t) => <option key={t} value={t}>{FIELD_LABELS[t]}</option>)}
                </select>
              </Field>
              <SubmitButton className="btn">Add</SubmitButton>
            </form>
          )}
          <p className="mb-3 text-xs text-ink-faint">Headers are compared without spaces, case or punctuation, and small typos are tolerated.</p>
          <dl className="space-y-2">
            {grouped.map((g) => (
              <div key={g.t} className="grid grid-cols-[140px_1fr] gap-2">
                <dt className="font-medium">{FIELD_LABELS[g.t]}</dt>
                <dd className="flex flex-wrap gap-1">
                  {g.list.map((a) => (
                    <form key={a.id} action={deleteAlias} className="inline-flex">
                      <input type="hidden" name="id" value={a.id} />
                      <span className="chip border border-line bg-canvas font-mono text-ink-soft">
                        {a.alias}
                        {admin && <button className="ml-1 text-ink-faint hover:text-age-5" aria-label={`Remove ${a.alias}`}>×</button>}
                      </span>
                    </form>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Status wording" bodyClass="">
          {admin && (
            <form action={addStatusMapping} className="grid gap-2 border-b border-line p-4 md:grid-cols-[1fr_110px_170px_70px_auto] md:items-end">
              <Field label="Tracker wording"><input name="pattern" required className="input" placeholder="e.g. pod uploaded" /></Field>
              <Field label="Match">
                <select name="match_type" className="input">
                  <option value="exact">Exactly</option>
                  <option value="contains">Contains</option>
                  <option value="regex">Regex</option>
                </select>
              </Field>
              <Field label="Status">
                <select name="status_code" className="input">
                  {statuses.filter((s) => s.is_active).map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Order"><input name="priority" type="number" defaultValue={50} className="input" /></Field>
              <SubmitButton className="btn">Add</SubmitButton>
            </form>
          )}
          <p className="px-4 pt-3 text-xs text-ink-faint">
            Lower order is checked first. Any wording mapped to a Lost status only creates a Lost request for Admin approval.
          </p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Wording</th>
                  <th>Match</th>
                  <th>Status</th>
                  <th className="text-right">Order</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {(mapsRes.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs">{m.pattern}</td>
                    <td>{m.match_type}</td>
                    <td>{label(m.status_code)}</td>
                    <td className="text-right">{m.priority}</td>
                    {admin && (
                      <td>
                        <form action={deleteStatusMapping}>
                          <input type="hidden" name="id" value={m.id} />
                          <SubmitButton className="btn btn-ghost btn-sm" confirm="Remove this wording?">Remove</SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
