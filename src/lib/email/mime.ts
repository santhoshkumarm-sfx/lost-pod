/** Email address and subject helpers for the Gmail search. */
export function parseAddress(v: string | null): { name: string | null; email: string | null } {
  if (!v) return { name: null, email: null };
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const e = v.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return { name: null, email: e ? e[0].toLowerCase() : null };
}

/** Strip "Re:", "Fwd:", "FW:" prefixes so a pasted subject finds the whole thread. */
export function baseSubject(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 5; i++) {
    const n = s.replace(/^\s*(re|fw|fwd|aw|tr)\s*(\[\d+\])?\s*:\s*/i, '');
    if (n === s) break;
    s = n;
  }
  return s.trim();
}

/** Build a Gmail search query for a subject typed by the team. */
export function gmailSubjectQuery(subject: string, opts: { from?: string | null; newerThanDays?: number | null } = {}): string {
  const base = baseSubject(subject).replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [`subject:"${base}"`];
  if (opts.from) parts.push(`from:${opts.from.replace(/\s/g, '')}`);
  if (opts.newerThanDays && opts.newerThanDays > 0) parts.push(`newer_than:${Math.round(opts.newerThanDays)}d`);
  return parts.join(' ');
}
