import { SubmitButton } from '@/components/buttons';
import { Field, Flash, PageHeader, Panel } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { param, type SearchParams } from '@/lib/flash';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { getClients } from '@/lib/lookups';
import { createClient } from '@/lib/supabase/server';
import { saveOneValue, uploadValues } from './actions';

export const metadata = { title: 'Product value & OTP' };
export const maxDuration = 120;

interface ValueUpload {
  id: string; uploader_name: string | null; filename: string | null; total_rows: number; updated: number; not_in_cases: number;
  problems: { row: number; awb?: string; message: string }[]; drive_url: string | null; created_at: string;
}

export default async function ValuesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const sb = await createClient();
  const uploadId = param(sp, 'upload');
  const pending = () => sb.from('v_cases').select('id', { count: 'exact', head: true }).eq('status_category', 'open').neq('team_status', 'pod_shared').neq('pod_status', 'shared');
  const [clients, recent, current, pendingAll, pendingMissing, values] = await Promise.all([
    getClients(sb),
    sb.from('value_uploads').select('*').order('created_at', { ascending: false }).limit(15),
    /^[0-9a-f-]{36}$/.test(uploadId) ? sb.from('value_uploads').select('*').eq('id', uploadId).maybeSingle() : Promise.resolve({ data: null }),
    pending(),
    pending().is('final_value', null),
    sb.from('awb_values').select('awb', { count: 'exact', head: true }),
  ]);
  const cur = current.data as ValueUpload | null;
  return (
    <>
      <PageHeader
        title="Product value and OTP delivered"
        sub="Stored once per AWB and shown on every case, list, dashboard and export with that AWB. A value set here wins over a value in a tracker."
      />
      <Flash sp={sp} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="panel px-4 py-3"><div className="text-xs text-ink-soft">Pending POD without product value</div><div className="text-2xl font-semibold text-age-4">{fmtNum(pendingMissing.count ?? 0)}</div><div className="text-xs text-ink-faint">of {fmtNum(pendingAll.count ?? 0)} pending</div></div>
        <div className="panel px-4 py-3"><div className="text-xs text-ink-soft">AWBs with a value or OTP set here</div><div className="text-2xl font-semibold">{fmtNum(values.count ?? 0)}</div></div>
        <div className="panel px-4 py-3 text-xs text-ink-soft">Steps: 1. download the AWBs, 2. fill “Product value” and “OTP delivered” (Yes / No) next to each AWB, 3. upload the file. Empty cells change nothing.</div>
      </div>
      {cur && (
        <Panel title={`Result: ${cur.filename ?? 'upload'}`} className="mb-5">
          <p className="mb-2"><strong className="text-age-0">{fmtNum(cur.updated)} AWB(s) updated</strong> of {fmtNum(cur.total_rows)} row(s){cur.not_in_cases ? ` · ${fmtNum(cur.not_in_cases)} not in any case yet` : ''}{cur.drive_url && <> · <a href={cur.drive_url} target="_blank" rel="noreferrer">File in Drive</a></>}</p>
          {cur.problems.length > 0 && (
            <div className="tbl-wrap max-h-80 overflow-y-auto">
              <table className="tbl">
                <thead><tr><th>Row</th><th>AWB</th><th>Note</th></tr></thead>
                <tbody>{cur.problems.map((p, i) => <tr key={i}><td>{p.row || ''}</td><td className="font-mono text-xs">{p.awb ?? ''}</td><td>{p.message}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Panel title="1. Download AWBs">
          <form action="/api/export/values" method="get" className="space-y-3">
            <Field label="Client">
              <select name="client" className="input"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <Field label="Shipments">
              <select name="scope" className="input">
                <option value="pending">Pending POD</option>
                <option value="open">Open, incl. Lost requests</option>
                <option value="lost">Lost requested / accepted</option>
                <option value="all">Everything</option>
              </select>
            </Field>
            <Field label="Which AWBs">
              <select name="which" className="input"><option value="missing">Only those without a product value</option><option value="all">All (to correct values)</option></select>
            </Field>
            <button className="btn btn-primary">Download Excel</button>
          </form>
        </Panel>
        <Panel title="2. Upload the filled file">
          <form action={uploadValues} className="space-y-3">
            <p className="text-xs text-ink-soft">Columns used: <strong>AWB</strong> (required), <strong>Product value</strong>, <strong>OTP delivered</strong> (Yes / No). Date, Client and other columns are ignored. The file is kept in Drive.</p>
            <Field label="Excel file (.xlsx)"><input type="file" name="file" accept=".xlsx" required className="input" /></Field>
            <SubmitButton pending="Saving values…">Upload and save</SubmitButton>
          </form>
        </Panel>
        <Panel title="One AWB">
          <form action={saveOneValue} className="space-y-3">
            <Field label="AWB"><input name="awb" required className="input font-mono" /></Field>
            <Field label="Product value (₹)"><input name="product_value" inputMode="decimal" className="input" /></Field>
            <Field label="OTP delivered">
              <select name="otp_delivered" className="input"><option value="">Leave as it is</option><option value="yes">Yes</option><option value="no">No</option></select>
            </Field>
            <SubmitButton className="btn">Save</SubmitButton>
          </form>
        </Panel>
      </div>
      <Panel title="Recent uploads" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th>By</th><th>File</th><th className="text-right">Rows</th><th className="text-right">Updated</th><th className="text-right">Not in cases yet</th><th className="text-right">Skipped</th></tr></thead>
          <tbody>
            {((recent.data ?? []) as ValueUpload[]).map((u) => (
              <tr key={u.id}>
                <td className="whitespace-nowrap"><a href={`/values?upload=${u.id}`}>{fmtDateTime(u.created_at)}</a></td>
                <td>{u.uploader_name ?? '—'}</td>
                <td>{u.drive_url ? <a href={u.drive_url} target="_blank" rel="noreferrer">{u.filename ?? 'Drive'}</a> : u.filename ?? '—'}</td>
                <td className="text-right">{fmtNum(u.total_rows)}</td>
                <td className="text-right">{fmtNum(u.updated)}</td>
                <td className="text-right">{fmtNum(u.not_in_cases)}</td>
                <td className="text-right">{fmtNum(u.problems.filter((p) => p.row > 0).length)}</td>
              </tr>
            ))}
            {!recent.data?.length && <tr><td colSpan={7} className="py-4 text-center text-ink-soft">No uploads yet.</td></tr>}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
