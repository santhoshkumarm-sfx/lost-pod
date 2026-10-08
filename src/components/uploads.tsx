import { Panel } from './ui';
import { fmtDateTime, fmtNum } from '@/lib/format';

export interface UploadLog {
  id: string; uploader_name: string | null; method: string; filename: string | null; total_rows: number; created: number; skipped: number;
  problems: { row: number; awb?: string; message: string }[]; drive_url: string | null; drive_error: string | null; created_at: string;
  clients?: { name: string } | null;
}

export const UPLOAD_COLUMNS_SQL = 'id, uploader_name, method, filename, total_rows, created, skipped, problems, drive_url, drive_error, created_at, clients(name)';

/** What happened to one upload: created, skipped and why, where the file is kept. */
export function UploadResult({ u, casesHref }: { u: UploadLog; casesHref: string }) {
  return (
    <Panel title={`Result: ${u.filename ?? 'added by hand'}`} className="mb-5">
      <p className="mb-2">
        <strong className="text-age-0">{fmtNum(u.created)} created</strong>
        {u.skipped > 0 && <> · <strong className="text-age-4">{fmtNum(u.skipped)} not added</strong> (listed below)</>}
        {' · '}<a href={casesHref}>See the new pending cases</a>
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
    <Panel title="Recent additions" bodyClass="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr><th>When</th><th>By</th>{showClient && <th>Client</th>}<th>How</th><th className="text-right">Rows</th><th className="text-right">Created</th><th className="text-right">Not added</th><th>File</th></tr>
        </thead>
        <tbody>
          {uploads.map((u) => (
            <tr key={u.id}>
              <td className="whitespace-nowrap"><a href={hrefFor(u.id)}>{fmtDateTime(u.created_at)}</a></td>
              <td>{u.uploader_name ?? '—'}</td>
              {showClient && <td>{u.clients?.name ?? 'Several'}</td>}
              <td>{u.method === 'excel' ? 'Excel' : 'By hand'}</td>
              <td className="text-right">{fmtNum(u.total_rows)}</td>
              <td className="text-right">{fmtNum(u.created)}</td>
              <td className={`text-right ${u.skipped ? 'text-age-4' : ''}`}>{fmtNum(u.skipped)}</td>
              <td>{u.drive_url ? <a href={u.drive_url} target="_blank" rel="noreferrer">Drive</a> : u.filename ?? '—'}</td>
            </tr>
          ))}
          {!uploads.length && <tr><td colSpan={showClient ? 8 : 7} className="py-4 text-center text-ink-soft">Nothing added yet.</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}
