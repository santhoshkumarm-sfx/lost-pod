'use client';
import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { sharePods } from '@/app/(internal)/client-mail/actions';

export interface ShareRow { case_id: string; awb: string; note?: string | null }

const BUCKET = 'pod-files';
const MAX_FILE = 20 * 1024 * 1024;
const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);

/**
 * Team: share PODs for several AWBs at once — a link and/or files (PDF, images, anything) per AWB, or a batch of
 * files whose names contain the AWB. Files go straight to storage from the browser; then everything is saved in one
 * step and the client gets ONE email with all the AWBs (now, or with "Send to client" later).
 */
export function PodShare({ rows, back, compact }: { rows: ShareRow[]; back: string; compact?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemsInput = useRef<HTMLInputElement>(null);
  const sendInput = useRef<HTMLInputElement>(null);

  const addFiles = (caseId: string, list: FileList | null) => {
    if (!list) return;
    setFiles((f) => ({ ...f, [caseId]: [...(f[caseId] ?? []), ...Array.from(list)] }));
  };
  const addByName = (list: FileList | null) => {
    if (!list) return;
    const miss: string[] = [];
    const next = { ...files };
    for (const file of Array.from(list)) {
      const name = file.name.toUpperCase();
      const row = rows.find((r) => name.includes(r.awb.toUpperCase()));
      if (row) next[row.case_id] = [...(next[row.case_id] ?? []), file];
      else miss.push(file.name);
    }
    setFiles(next);
    setUnmatched(miss);
  };
  const removeFile = (caseId: string, i: number) => setFiles((f) => ({ ...f, [caseId]: (f[caseId] ?? []).filter((_, k) => k !== i) }));

  async function go(sendNow: boolean) {
    setError(null);
    const used = rows.filter((r) => (links[r.case_id] ?? '').trim() || (files[r.case_id] ?? []).length);
    if (!used.length) return setError('Add a POD link or file for at least one AWB.');
    const big = used.flatMap((r) => files[r.case_id] ?? []).find((f) => f.size > MAX_FILE);
    if (big) return setError(`${big.name} is larger than 20 MB.`);
    const bad = used.find((r) => (links[r.case_id] ?? '').trim() && !/^https?:\/\//i.test(links[r.case_id].trim()));
    if (bad) return setError(`AWB ${bad.awb}: the link must start with http.`);
    const sb = createClient();
    const items = [];
    let n = 0;
    const total = used.reduce((t, r) => t + (files[r.case_id] ?? []).length, 0);
    for (const r of used) {
      const up = [];
      for (const f of files[r.case_id] ?? []) {
        n++;
        setBusy(`Uploading ${n} of ${total}: ${f.name}`);
        const path = `${r.case_id}/${Date.now()}-${n}-${clean(f.name)}`;
        const { error: e } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if (e) {
          setBusy(null);
          return setError(`${f.name}: ${e.message}`);
        }
        up.push({ path, name: f.name, type: f.type || 'application/octet-stream', size: f.size });
      }
      items.push({ case_id: r.case_id, link: (links[r.case_id] ?? '').trim(), files: up });
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
          <label className="block text-sm font-medium">Files for many AWBs at once</label>
          <p className="mb-2 text-xs text-ink-soft">Choose files whose names contain the AWB (e.g. SF3187410063GOP.pdf) — each file goes to its AWB.</p>
          <input type="file" multiple onChange={(e) => addByName(e.target.files)} className="input" />
          {unmatched.length > 0 && <p className="mt-1 text-xs text-age-5">No AWB in these file names, so they were not added: {unmatched.join(', ')}</p>}
        </div>
      )}
      <div className="tbl-wrap max-h-[480px] overflow-y-auto">
        <table className="tbl w-full table-fixed">
          <colgroup><col style={{ width: 190 }} /><col /><col style={{ width: 260 }} /></colgroup>
          <thead><tr><th>AWB</th><th>POD link</th><th>POD files</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.case_id}>
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
      <p className="text-xs text-ink-soft">All AWBs go to the client in one email, with the files attached and named by AWB.</p>
    </form>
  );
}
