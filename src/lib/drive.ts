import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BridgeError, callBridge } from './google';

/*
 * POD files live in YOUR Google Drive, folder "POD connect files" (and a log sheet "POD connect — POD files" next to it).
 * The bridge only hands out a short-lived token of the bridge account (cached ~50 minutes); uploads and downloads
 * then go straight to the Google Drive / Sheets APIs, which is much faster than passing files through Apps Script.
 */

const API = () => (process.env.GOOGLE_API_BASE ?? 'https://www.googleapis.com').replace(/\/$/, '');
const SHEETS = () => (process.env.GOOGLE_SHEETS_API_BASE ?? 'https://sheets.googleapis.com').replace(/\/$/, '');
const FOLDER = 'POD connect files';
const LOG_NAME = 'POD connect — POD files';
export const CHUNK = 2 * 1024 * 1024;   // multiple of 256 KB, well under the 4.5 MB request limit

let memo: { token: string; exp: number } | null = null;

/** Drive token of the bridge account: memory → database → bridge. */
export async function driveToken(sb: SupabaseClient): Promise<string> {
  const now = Date.now();
  if (memo && memo.exp > now + 60_000) return memo.token;
  const { data } = await sb.from('google_tokens').select('token, expires_at').eq('key', 'drive').maybeSingle();
  if (data && Date.parse(data.expires_at) > now + 60_000) {
    memo = { token: data.token, exp: Date.parse(data.expires_at) };
    return data.token;
  }
  let r: { token: string; expiresInSeconds: number };
  try {
    r = await callBridge<{ token: string; expiresInSeconds: number }>('driveToken', {}, 60_000);
  } catch (e) {
    if (/Unknown action/i.test((e as Error).message)) {
      throw new BridgeError('Update the Google bridge: paste the new apps-script/Bridge.gs and deploy a new version (README → Google bridge).');
    }
    throw e;
  }
  const exp = now + Math.max(300, r.expiresInSeconds) * 1000;
  memo = { token: r.token, exp };
  await sb.from('google_tokens').upsert({ key: 'drive', token: r.token, expires_at: new Date(exp).toISOString() });
  return r.token;
}

async function g(sb: SupabaseClient, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await driveToken(sb);
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    memo = null;
    await sb.from('google_tokens').delete().eq('key', 'drive');
  }
  return res;
}

async function setting(sb: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
  return typeof data?.value === 'string' ? data.value : null;
}
async function saveSetting(sb: SupabaseClient, key: string, value: string, description: string) {
  await sb.from('app_settings').upsert({ key, value, description }, { onConflict: 'key' });
}

/** The "POD connect files" folder in the bridge account's Drive (created once). */
export async function podFolder(sb: SupabaseClient): Promise<string> {
  const known = await setting(sb, 'drive_pod_folder_id');
  if (known) return known;
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`);
  const found = await (await g(sb, `${API()}/drive/v3/files?q=${q}&fields=files(id)`)).json() as { files?: { id: string }[] };
  let id = found.files?.[0]?.id;
  if (!id) {
    const res = await g(sb, `${API()}/drive/v3/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!res.ok) throw new Error(`Drive folder: ${res.status} ${await res.text()}`);
    id = ((await res.json()) as { id: string }).id;
  }
  await saveSetting(sb, 'drive_pod_folder_id', id, 'Google Drive folder that keeps the POD files');
  return id;
}

/** Starts a resumable upload in the POD folder; returns Google's session URL (kept on the server). */
export async function startUpload(sb: SupabaseClient, name: string, type: string, size: number): Promise<string> {
  const folder = await podFolder(sb);
  const res = await g(sb, `${API()}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type || 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  const url = res.headers.get('location');
  if (!res.ok || !url) throw new Error(`Drive upload could not start: ${res.status} ${await res.text()}`);
  return url;
}

/** Sends one chunk. Returns the Drive file id when the file is complete, else null. */
export async function putChunk(sessionUrl: string, chunk: Buffer, offset: number, total: number): Promise<string | null> {
  const end = offset + chunk.length - 1;
  const res = await fetch(sessionUrl, {
    method: 'PUT', headers: { 'Content-Range': total === 0 ? 'bytes */0' : `bytes ${offset}-${end}/${total}` }, body: new Uint8Array(chunk),
  });
  if (res.status === 308) return null;
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** A Drive file's bytes (for the app's download link and email attachments). */
export async function downloadDriveFile(sb: SupabaseClient, fileId: string): Promise<Buffer | null> {
  const res = await g(sb, `${API()}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export const driveViewLink = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

/** Appends rows to the "POD connect — POD files" sheet in the POD folder (created once with a header row). */
export async function logPodFiles(sb: SupabaseClient, rows: (string | number)[][]): Promise<void> {
  if (!rows.length) return;
  let id = await setting(sb, 'drive_pod_log_sheet_id');
  if (!id) {
    const folder = await podFolder(sb);
    const res = await g(sb, `${API()}/drive/v3/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: LOG_NAME, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folder] }),
    });
    if (!res.ok) throw new Error(`Log sheet: ${res.status} ${await res.text()}`);
    id = ((await res.json()) as { id: string }).id;
    await saveSetting(sb, 'drive_pod_log_sheet_id', id, 'Google Sheet that lists every POD file shared');
    rows = [['Shared on (IST)', 'Client', 'AWB', 'File', 'Drive link', 'Shared by'], ...rows];
  }
  const res = await g(sb, `${SHEETS()}/v4/spreadsheets/${id}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Log sheet: ${res.status} ${await res.text()}`);
}

/** Bytes of a stored POD file: "drive:<id>" in Drive, anything else in Supabase Storage (older files). */
export async function readPodFile(sb: SupabaseClient, path: string): Promise<Buffer | null> {
  if (path.startsWith('drive:')) return downloadDriveFile(sb, path.slice(6));
  const dl = await sb.storage.from('pod-files').download(path);
  return dl.error || !dl.data ? null : Buffer.from(await dl.data.arrayBuffer());
}
