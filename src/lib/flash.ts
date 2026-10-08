/** Server actions report results through the URL (?ok= / ?error=) so pages stay plain server components. */
export function withFlash(path: string, kind: 'ok' | 'error', message: string): string {
  const [p, q = ''] = path.split('?');
  const sp = new URLSearchParams(q);
  sp.delete('ok');
  sp.delete('error');
  sp.set(kind, message.slice(0, 400));
  return `${p}?${sp.toString()}`;
}

/** Readable message from a thrown value or a PostgREST error. */
export function errorText(e: unknown): string {
  const raw =
    e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return raw.replace(/^(LOST_WORKFLOW|NOT_APPROVER):\s*/, '').replace(/^new row violates row-level security policy.*$/i, 'You do not have permission to change this record.');
}

/** Unwrap a Supabase response, throwing its error. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

export function strOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === '' ? null : v;
}

export function numOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key).replace(/[,₹\s]/g, '');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}
