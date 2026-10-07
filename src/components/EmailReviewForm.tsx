'use client';
import { useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Extraction } from '@/lib/email/extract';

interface Existing {
  id: string; case_number: number; awb: string; client: string | null; status_label: string; escalation_date: string; status_category: string;
}
interface Row {
  awb: string; include: boolean; link_case_id: string; location: string; hub: string; delivery_date: string; seller_name: string;
  reason: string; product_value: string; order_id: string; remark: string;
}

function Submit({ count, disabled }: { count: number; disabled: boolean }) {
  const s = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={disabled || s.pending}>
      {s.pending ? 'Creating…' : `Create ${count} case${count === 1 ? '' : 's'}`}
    </button>
  );
}

const CONF_LABEL: Record<string, string> = { high: 'Found', medium: 'Check', low: 'Guess', none: 'Missing' };
const CONF_CLASS: Record<string, string> = {
  high: 'text-age-0', medium: 'text-age-2', low: 'text-age-3', none: 'text-age-5',
};

export function EmailReviewForm({ emailId, extraction, clients, pocs, agents, existing, defaultAgent, action, readOnly }: {
  emailId: string;
  extraction: Extraction;
  clients: { id: string; name: string }[];
  pocs: { id: string; client_id: string; name: string }[];
  agents: { id: string; full_name: string | null; email: string }[];
  existing: Existing[];
  defaultAgent: string;
  action: (fd: FormData) => Promise<void>;
  readOnly: boolean;
}) {
  const x = extraction;
  const [common, setCommon] = useState({
    client_id: x.common.client_id ?? '', client_poc_id: x.common.client_poc_id ?? '', escalation_date: x.common.escalation_date ?? '',
    complaint_type: x.common.complaint_type ?? '', reason: x.common.reason ?? '', priority: x.common.priority ?? 'Normal', team_remark: '',
    assigned_agent: defaultAgent,
  });
  const openFor = (awb: string) => existing.find((e) => e.awb === awb && (e.status_category === 'open' || e.status_category === 'lost_pending'));
  const [rows, setRows] = useState<Row[]>(() =>
    x.rows.map((r) => ({
      awb: r.awb, include: true, link_case_id: openFor(r.awb)?.id ?? '', location: r.location ?? '', hub: r.hub ?? '',
      delivery_date: r.delivery_date ?? '', seller_name: r.seller_name ?? '', reason: r.reason ?? '',
      product_value: r.product_value != null ? String(r.product_value) : '', order_id: r.order_id ?? '', remark: r.remark ?? '',
    })),
  );
  const conf = (k: string) => x.confidence[k] ?? 'none';
  const missing = (k: string, v: string) => !v && (x.missing.includes(k) || conf(k) === 'none');
  const set = (k: keyof typeof common) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCommon((c) => ({ ...c, [k]: e.target.value, ...(k === 'client_id' ? { client_poc_id: '' } : {}) }));
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const payload = useMemo(() => JSON.stringify({ common: { ...common, confidence: x.confidence }, rows }), [common, rows, x.confidence]);
  const included = rows.filter((r) => r.include && r.awb.trim());
  const clientPocs = pocs.filter((p) => p.client_id === common.client_id);
  const Conf = ({ k }: { k: string }) => <span className={`ml-1 text-2xs font-semibold ${CONF_CLASS[conf(k)]}`}>{CONF_LABEL[conf(k)]}</span>;

  return (
    <form action={action}>
      <input type="hidden" name="id" value={emailId} />
      <input type="hidden" name="payload" value={payload} />
      <fieldset disabled={readOnly}>
        <section className="panel mb-5">
          <div className="panel-head">
            <h2>Escalation details</h2>
            <span className="text-xs text-ink-faint">Applies to every AWB below</span>
          </div>
          <div className="panel-body grid gap-4 md:grid-cols-2">
            <label>
              <span className="label">Client <Conf k="client" /></span>
              <select value={common.client_id} onChange={set('client_id')} className={`input ${missing('client', common.client_id) ? 'input-missing' : ''}`} required>
                <option value="">Select client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Client POC <Conf k="poc" /></span>
              <select value={common.client_poc_id} onChange={set('client_poc_id')} className="input">
                <option value="">None</option>
                {clientPocs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>
              <span className="label">Escalation date <Conf k="escalation_date" /></span>
              <input type="date" value={common.escalation_date} onChange={set('escalation_date')} required
                className={`input ${missing('escalation_date', common.escalation_date) ? 'input-missing' : ''}`} />
            </label>
            <label>
              <span className="label">Complaint type <Conf k="complaint_type" /></span>
              <input value={common.complaint_type} onChange={set('complaint_type')} list="ctypes"
                className={`input ${missing('complaint_type', common.complaint_type) ? 'input-missing' : ''}`} />
              <datalist id="ctypes">
                {['POD request', 'RTO/RTS POD', 'Reverse pickup POD', 'Fake delivery / not received', 'Incorrect status', 'Damaged / tampered', 'Short / empty shipment', 'Lost'].map((t) => <option key={t} value={t} />)}
              </datalist>
            </label>
            <label className="md:col-span-2">
              <span className="label">Reason <Conf k="reason" /></span>
              <input value={common.reason} onChange={set('reason')} className={`input ${missing('reason', common.reason) ? 'input-missing' : ''}`} />
            </label>
            <label>
              <span className="label">Priority <Conf k="priority" /></span>
              <select value={common.priority} onChange={set('priority')} className="input">
                <option>Normal</option>
                <option>High</option>
              </select>
            </label>
            <label>
              <span className="label">Assign to</span>
              <select value={common.assigned_agent} onChange={set('assigned_agent')} className="input">
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? a.email}</option>)}
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="label">First Shadowfax remark (visible to the client, optional)</span>
              <input value={common.team_remark} onChange={set('team_remark')} className="input" />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>AWBs ({included.length} of {rows.length} selected) <Conf k="awb" /></h2>
            <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => [...rs, { awb: '', include: true, link_case_id: '', location: '', hub: '', delivery_date: '', seller_name: '', reason: '', product_value: '', order_id: '', remark: '' }])}>
              Add AWB
            </button>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Use</th>
                  <th>AWB</th>
                  <th>Location <Conf k="location" /></th>
                  <th>Hub</th>
                  <th>Delivery date</th>
                  <th>Seller</th>
                  <th>Value (₹)</th>
                  <th>Row reason</th>
                  <th>Existing case</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const dups = existing.filter((e) => e.awb === r.awb.trim().toUpperCase());
                  return (
                    <tr key={i} className={r.include ? '' : 'opacity-50'}>
                      <td><input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} aria-label="Use this AWB" /></td>
                      <td><input value={r.awb} onChange={(e) => setRow(i, { awb: e.target.value.toUpperCase(), link_case_id: '' })} className="input input-sm w-48 font-mono" /></td>
                      <td><input value={r.location} onChange={(e) => setRow(i, { location: e.target.value })} className={`input input-sm w-32 ${!r.location && !r.hub ? 'input-missing' : ''}`} /></td>
                      <td><input value={r.hub} onChange={(e) => setRow(i, { hub: e.target.value })} className="input input-sm w-40" /></td>
                      <td><input type="date" value={r.delivery_date} onChange={(e) => setRow(i, { delivery_date: e.target.value })} className="input input-sm" /></td>
                      <td><input value={r.seller_name} onChange={(e) => setRow(i, { seller_name: e.target.value })} className="input input-sm w-32" /></td>
                      <td><input value={r.product_value} onChange={(e) => setRow(i, { product_value: e.target.value })} className="input input-sm w-24" inputMode="decimal" /></td>
                      <td><input value={r.reason} onChange={(e) => setRow(i, { reason: e.target.value })} className="input input-sm w-40" placeholder="Same as above" /></td>
                      <td>
                        {dups.length ? (
                          <select value={r.link_case_id} onChange={(e) => setRow(i, { link_case_id: e.target.value })} className="input input-sm w-56 border-age-2">
                            <option value="">Create a new case</option>
                            {dups.map((d) => (
                              <option key={d.id} value={d.id}>Link to #{d.case_number} ({d.status_label}, {d.escalation_date})</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-ink-faint">New</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <p className="px-4 py-6 text-center text-ink-soft">No AWB was found in the email. Add them with “Add AWB”.</p>}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              <Submit count={included.length} disabled={!included.length || !common.client_id || !common.escalation_date} />
              <span className="text-xs text-ink-faint">Each AWB becomes its own case, linked to this email thread. Highlighted fields were not found in the email.</span>
            </div>
          )}
        </section>
      </fieldset>
    </form>
  );
}
