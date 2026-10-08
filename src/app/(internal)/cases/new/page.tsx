import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireInternal } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { getAgents, getClients, getPocs } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';
import { createCases } from '../actions';

export const metadata = { title: 'Add case' };

export default async function NewCasePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireInternal();
  const sp = await searchParams;
  const supabase = await createClient();
  const [clients, pocs, agents] = await Promise.all([getClients(supabase, true), getPocs(supabase), getAgents(supabase)]);
  const v = (k: string) => param(sp, k);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader
        title="Add case"
        sub="For escalations that arrive by phone, chat or any channel without a tracker row or email. One case is created per AWB."
        actions={<a href="/cases/upload" className="btn">Upload many from Excel</a>}
      />
      <Flash sp={sp} />
      <form action={createCases}>
        <Panel title="Shipment and escalation">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="AWB(s)" hint="One or more, separated by spaces, commas or new lines." className="md:col-span-3">
              <textarea name="awbs" required defaultValue={v('awbs')} className="input font-mono" rows={3} />
            </Field>
            <Field label="Client">
              <select name="client_id" defaultValue={v('client_id')} className="input">
                <option value="">Select client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Client POC">
              <select name="client_poc_id" className="input" defaultValue="">
                <option value="">None</option>
                {pocs.filter((p) => p.is_active).map((p) => (
                  <option key={p.id} value={p.id}>{clientName.get(p.client_id) ?? '?'} — {p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Escalation date">
              <input type="date" name="escalation_date" required max={todayIn()} defaultValue={v('escalation_date') || todayIn()} className="input" />
            </Field>
            <Field label="Hub"><input name="hub" defaultValue={v('hub')} className="input" placeholder="DEL_KirtiNagar_RTS" /></Field>
            <Field label="Location"><input name="location" defaultValue={v('location')} className="input" /></Field>
            <Field label="Delivery date"><input type="date" name="delivery_date" className="input" /></Field>
            <Field label="Seller name"><input name="seller_name" defaultValue={v('seller_name')} className="input" /></Field>
            <Field label="Complaint type">
              <input name="complaint_type" list="complaint-types" defaultValue={v('complaint_type')} className="input" />
              <datalist id="complaint-types">
                {['POD request', 'RTO/RTS POD', 'Reverse pickup POD', 'Fake delivery / not received', 'Incorrect status', 'Damaged / tampered', 'Short / empty shipment', 'Lost'].map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label="Priority">
              <select name="priority" defaultValue={v('priority') || 'Normal'} className="input">
                <option>Normal</option>
                <option>High</option>
              </select>
            </Field>
            <Field label="Product value (₹)"><input name="product_value" inputMode="decimal" className="input" /></Field>
            <Field label="Mail subject (if any)"><input name="email_subject" className="input" /></Field>
            <Field label="Reason" className="md:col-span-3"><input name="reason" defaultValue={v('reason')} className="input" /></Field>
            <Field label="Shadowfax remark (visible to the client)" className="md:col-span-2">
              <textarea name="team_remark" defaultValue={v('team_remark')} className="input" />
            </Field>
            <Field label="Assigned agent">
              <select name="assigned_agent" defaultValue={user.id} className="input">
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <SubmitButton pending="Creating…">Create case</SubmitButton>
            <label className="flex items-center gap-2 text-ink-soft">
              <input type="checkbox" name="confirm_duplicates" value="1" /> Create anyway if an open case exists for the AWB
            </label>
          </div>
        </Panel>
      </form>
    </>
  );
}
