'use client';
import { useRef, useState } from 'react';
import { sharePods } from '@/app/(internal)/client-mail/actions';

export interface ShareRow { case_id: string; awb: string; note?: string | null }

const MAX_FILE = 50 * 1024 * 1024;
const CHUNK = 2 * 1024 * 1024;   // same as the server

/**
 * Team: share PODs for several AWBs at once — a link and/or files (PDF, images, anything) per AWB, and files that
 * cover several AWBs (one PDF with many PODs): pick the files once and tick the AWBs they are for. File names do
 * not matter. Files go to your Google Drive (folder "POD connect files"); then everything is saved in one step and the client
 * gets ONE email with all the AWBs (now, or with "Send to client" later).
 */
export function PodShare({ rows, back, compact }: { rows: ShareRow[]; back: string; compact?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [common, setCommon] = useState<File[]>([]);
  const [commonFor, setCommonFor] = useState<Set<string>>(() => new Set(rows.map((r) => r.case_id)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemsInput = useRef<HTMLInputElement>(null);
  const sendInput = useRef<HTMLInputElement>(null);

  const addFiles = (caseId: string, list: FileList | null) => {
    if (!list) return;
    setFiles((f) => ({ ...f, [caseId]: [...(f[caseId] ?? []), ...Array.from(list)] }));
  };
  const toggle = (caseId: string) => setCommonFor((s0) => {
    const n = new Set(s0);
    if (n.has(caseId)) n.delete(caseId); else n.add(caseId);
    return n;
  });
  const removeFile = (caseId: string, i: number) => setFiles((f) => ({ ...f, [caseId]: (f[caseId] ?? []).filter((_, k) => k !== i) }));

  async function go(sendNow: boolean) {
    setError(null);
    const withCommon = (id: string) => common.length > 0 && commonFor.has(id);
    const used = rows.filter((r) => (links[r.case_id] ?? '').trim() || (files[r.case_id] ?? []).length || withCommon(r.case_id));
    if (!used.length) return setError(common.length ? 'Tick the AWBs the shared files are for.' : 'Add a POD link or file for at least one AWB.');
    const big = [...common, ...used.flatMap((r) => files[r.case_id] ?? [])].find((f) => f.size > MAX_FILE);
    if (big) return setError(`${big.name} is larger than 50 MB.`);
    const bad = used.find((r) => (links[r.case_id] ?? '').trim() && !/^https?:\/\//i.test(links[r.case_id].trim()));
    if (bad) return setError(`AWB ${bad.awb}: the link must start with http.`);
    const total = common.length + used.reduce((t, r) => t + (files[r.case_id] ?? []).length, 0);
    let n = 0;
    type Up = { path: string; name: string; type: string; size: number };
    // Straight into the POD folder of your Google Drive, in 2 MB pieces (fast, and any file size up to 50 MB).
    const upload = async (f: File): Promise<Up | null> => {
      n++;
      const fail = (m: string) => {
        setBusy(null);
        setError(`${f.name}: ${m}`);
        return null;
      };
      if (!f.size) return fail('the file is empty.');
      setBusy(`Uploading ${n} of ${total}: ${f.name}`);
      const start = await fetch('/api/pod-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, type: f.type, size: f.size }) });
      const s0 = (await start.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!start.ok || !s0.id) return fail(s0.error ?? `upload could not start (${start.status})`);
      for (let off = 0; off < f.size; off += CHUNK) {
        setBusy(`Uploading ${n} of ${total}: ${f.name} (${Math.min(100, Math.round(((off + CHUNK) / f.size) * 100))}%)`);
        const res = await fetch(`/api/pod-upload/${s0.id}?offset=${off}`, { method: 'PUT', body: f.slice(off, Math.min(off + CHUNK, f.size)) });
        const r = (await res.json().catch(() => ({}))) as { done?: boolean; path?: string; error?: string };
        if (!res.ok) return fail(r.error ?? `upload failed (${res.status})`);
        if (r.done && r.path) return { path: r.path, name: f.name, type: f.type || 'application/octet-stream', size: f.size };
      }
      return fail('upload did not finish');
    };
    // Files for several AWBs are uploaded once and linked to every ticked AWB.
    const shared: Up[] = [];
    for (const f of common) {
      const u = await upload(f);
      if (!u) return;
      shared.push(u);
    }
    const items = [];
    for (const r of used) {
      const up: Up[] = [];
      for (const f of files[r.case_id] ?? []) {
        const u = await upload(f);
        if (!u) return;
        up.push(u);
      }
      items.push({ case_id: r.case_id, link: (links[r.case_id] ?? '').trim(), files: [...up, ...(withCommon(r.case_id) ? shared : [])] });
    }
    setBusy(sendNow ? 'Saving and emailing the client…' : 'Saving…');
    // Written straight into the form (not through state) so the submit carries them for sure.
    itemsInput.current!.value = JSON.stringify(items);
    sendInput.current!.value = sendNow ? '1' : '0';
    form.current?.requestSubmit();
  }

  return (
    <form ref={form} action={sharePods} className="space-y-3">
      <input ref={itemsInput} type="hidden" name="items" defaultValue="" />
      <input ref={sendInput} type="hidden" name="send" defaultValue="0" />
      <input type="hidden" name="back" value={back} />
      {!compact && (
        <div className="rounded border border-dashed border-line bg-canvas p-3">
          <label className="block text-sm font-medium">Files that cover several AWBs</label>
          <p className="mb-2 text-xs text-ink-soft">One PDF or image can hold the PODs of many AWBs — choose it here, then tick the AWBs it is for (all are ticked to start). The file name does not matter.</p>
          <input type="file" multiple onChange={(e) => e.target.files && setCommon((c) => [...c, ...Array.from(e.target.files!)])} className="input" />
          {common.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {common.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 shadow-sm">
                  {f.name}<button type="button" className="text-age-5" onClick={() => setCommon((c) => c.filter((_, k) => k !== i))} aria-label="Remove">×</button>
                </span>
              ))}
              <span className="text-ink-soft">for {commonFor.size} of {rows.length} AWBs ·</span>
              <button type="button" className="underline" onClick={() => setCommonFor(new Set(rows.map((r) => r.case_id)))}>tick all</button>
              <button type="button" className="underline" onClick={() => setCommonFor(new Set())}>untick all</button>
            </div>
          )}
        </div>
      )}
      <div className="tbl-wrap max-h-[480px] overflow-y-auto">
        <table className="tbl w-full table-fixed">
          <colgroup>{common.length > 0 && <col style={{ width: 70 }} />}<col style={{ width: 170 }} /><col /><col style={{ width: 230 }} /></colgroup>
          <thead><tr>{common.length > 0 && <th title="Uses the files that cover several AWBs">Shared file</th>}<th>AWB</th><th>POD link</th><th>Own POD files</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.case_id}>
                {common.length > 0 && <td className="text-center"><input type="checkbox" checked={commonFor.has(r.case_id)} onChange={() => toggle(r.case_id)} aria-label={`Shared file for ${r.awb}`} /></td>}
                <td className="font-mono text-xs">{r.awb}{r.note && <div className="font-sans text-ink-soft">{r.note}</div>}</td>
                <td><input className="input" placeholder="https://…" value={links[r.case_id] ?? ''} onChange={(e) => setLinks((l) => ({ ...l, [r.case_id]: e.target.value }))} /></td>
                <td>
                  <input type="file" multiple onChange={(e) => addFiles(r.case_id, e.target.files)} className="text-xs" />
                  {(files[r.case_id] ?? []).map((f, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs">
                      <span className="truncate">{f.name}</span>
                      <button type="button" className="text-age-5" onClick={() => removeFile(r.case_id, i)} aria-label="Remove">×</button>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-age-5">{error}</p>}
      {busy ? <p className="text-ink-soft">{busy}</p> : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => go(true)}>Save and send to client</button>
          <button type="button" className="btn" onClick={() => go(false)}>Save, send later</button>
        </div>
      )}
      <p className="text-xs text-ink-soft">All AWBs go to the client in one email. The email lists each AWB with its POD; files are attached once (a file for one AWB is named by the AWB).</p>
    </form>
  );
}
