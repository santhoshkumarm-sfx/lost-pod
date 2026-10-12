import { Panel } from './ui';
import { fmtDateTime, fmtNum } from '@/lib/format';

export interface UploadLog {
  id: string; uploader_name: string | null; method: string; filename: string | null; total_rows: number; created: number; skipped: number;
  problems: { row: number; awb?: string; message: string }[]; drive_url: string | null; drive_error: string | null; created_at: string;
  clients?: { name: string } | null;
  request_no?: number | null; pod_requested?: number; pod_found?: number; pod_checked_at?: string | null;
  pod_email_to?: string | null; pod_email_error?: string | null;
}

export interface PodItemRow { awb: string; result: string; pod_link: string | null; other_links: number; case_id: string | null }

export const UPLOAD_COLUMNS_SQL =
  'id, uploader_name, method, filename, total_rows, created, skipped, problems, drive_url, drive_error, created_at, clients(name), request_no, pod_requested, pod_found, pod_checked_at, pod_email_to, pod_email_error';

const RESULT: Record<string, string> = {
  shared: 'POD shared', already_shared: 'POD shared (earlier)', not_found: 'Not found yet', not_open: 'POD found — case already closed / Lost',
};

/** The POD check of one submission: one consolidated list, with links and an Excel download. */
function PodResults({ u, items, caseHref }: { u: UploadLog; items: PodItemRow[]; caseHref: (id: string) => string }) {
  const sorted = [...items].sort((a, b) => Number(!a.pod_link) - Number(!b.pod_link) || a.awb.localeCompare(b.awb));
  return (
    <div className="mb-4 rounded-md border border-line bg-canvas p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p>
          <strong>POD request PR-{u.request_no}</strong>: <strong className="text-age-0">{fmtNum(u.pod_found ?? 0)} of {fmtNum(u.pod_requested ?? 0)}</strong> POD(s) found in the POD sheets and shared.
          {u.pod_email_to && <span className="text-ink-soft"> {u.pod_email_error ? `Email not sent: ${u.pod_email_error}` : `Emailed to ${u.pod_email_to}.`}</span>}
        </p>
        <a href={`/api/requests/${u.id}`} className="btn btn-sm">Download Excel</a>
      </div>
      <div className="tbl-wrap max-h-96 overflow-y-auto">
        <table className="tbl">
          <thead><tr><th>AWB</th><th>Result</th><th>POD</th></tr></thead>
          <tbody>
            {sorted.map((i) => (
              <tr key={i.awb}>
                <td className="font-mono text-xs">{i.case_id ? <a href={caseHref(i.case_id)}>{i.awb}</a> : i.awb}</td>
                <td className={i.pod_link ? 'text-age-0' : 'text-age-4'}>{RESULT[i.result] ?? i.result}</td>
                <td>{i.pod_link ? <a href={i.pod_link} target="_blank" rel="noreferrer">Open POD</a> : '—'}{i.other_links > 0 && <span className="text-xs text-ink-soft"> (+{i.other_links} more)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What happened to one upload: created, skipped and why, where the file is kept. */
export function UploadResult({ u, casesHref, items = [], caseHref }: { u: UploadLog; casesHref: string; items?: PodItemRow[]; caseHref: (id: string) => string }) {
  return (
    <Panel title={`Result: ${u.request_no ? `PR-${u.request_no} · ` : ''}${u.filename ?? 'added by hand'}`} className="mb-5">
      {u.pod_checked_at && <PodResults u={u} items={items} caseHref={caseHref} />}
      <p className="mb-2">
        <strong className="text-age-0">{fmtNum(u.created)} created</strong>
        {u.skipped > 0 && <> · <strong className="text-age-4">{fmtNum(u.skipped)} not added</strong> (listed below)</>}
        {' · '}<a href={casesHref}>See the pending cases</a>
      </p>
      {u.method === 'excel' && (
        <p className="mb-3 text-xs text-ink-soft">
          {u.drive_url ? <>File kept in Google Drive: <a href={u.drive_url} target="_blank" rel="noreferrer">open</a></> : `File not kept in Drive: ${u.drive_error ?? 'unknown reason'}`}
        </p>
      )}
      {u.problems.length > 0 && (
        <div className="tbl-wrap max-h-80 overflow-y-auto">
          <table className="tbl">
            <thead><tr><th>Row</th><th>AWB</th><th>Why it was not added</th></tr></thead>
            <tbody>
              {u.problems.map((p, i) => (
                <tr key={i}><td>{p.row}</td><td className="font-mono text-xs">{p.awb ?? ''}</td><td>{p.message}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function UploadHistory({ uploads, showClient, hrefFor }: { uploads: UploadLog[]; showClient?: boolean; hrefFor: (id: string) => string }) {
  return (
    <Panel title="Recent requests and uploads" bodyClass="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr><th>When</th><th>Request</th><th>By</th>{showClient && <th>Client</th>}<th>How</th><th className="text-right">Rows</th><th className="text-right">Created</th><th className="text-right">Not added</th><th className="text-right">PODs found</th><th>File</th></tr>
        </thead>
        <tbody>
          {uploads.map((u) => (
            <tr key={u.id}>
              <td className="whitespace-nowrap"><a href={hrefFor(u.id)}>{fmtDateTime(u.created_at)}</a></td>
              <td>{u.request_no ? <a href={hrefFor(u.id)}>PR-{u.request_no}</a> : '—'}</td>
              <td>{u.uploader_name ?? '—'}</td>
              {showClient && <td>{u.clients?.name ?? 'Several'}</td>}
              <td>{u.method === 'excel' ? 'Excel' : 'By hand'}</td>
              <td className="text-right">{fmtNum(u.total_rows)}</td>
              <td className="text-right">{fmtNum(u.created)}</td>
              <td className={`text-right ${u.skipped ? 'text-age-4' : ''}`}>{fmtNum(u.skipped)}</td>
              <td className="text-right">{u.pod_checked_at ? `${fmtNum(u.pod_found ?? 0)} / ${fmtNum(u.pod_requested ?? 0)}` : '—'}</td>
              <td>{u.drive_url ? <a href={u.drive_url} target="_blank" rel="noreferrer">Drive</a> : u.filename ?? '—'}</td>
            </tr>
          ))}
          {!uploads.length && <tr><td colSpan={showClient ? 10 : 9} className="py-4 text-center text-ink-soft">Nothing added yet.</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}
