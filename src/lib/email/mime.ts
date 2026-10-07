/** Minimal shape of a Gmail API message part (format=full). */
export interface GmailPart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; size?: number | null; attachmentId?: string | null } | null;
  parts?: GmailPart[] | null;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function header(part: GmailPart | undefined | null, name: string): string | null {
  const h = part?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** Walk the MIME tree and collect the text/plain and text/html bodies (attachments are ignored). */
export function collectBodies(part: GmailPart | undefined | null): { text: string; html: string; attachments: string[] } {
  const out = { text: '', html: '', attachments: [] as string[] };
  const walk = (p: GmailPart | undefined | null) => {
    if (!p) return;
    if (p.filename) {
      out.attachments.push(p.filename);
      return;
    }
    const type = (p.mimeType ?? '').toLowerCase();
    if (p.body?.data && type === 'text/plain') out.text += (out.text ? '\n' : '') + decodeBase64Url(p.body.data);
    else if (p.body?.data && type === 'text/html') out.html += (out.html ? '\n' : '') + decodeBase64Url(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(part);
  return out;
}

/** "Ravi Kumar <ravi@client.com>" -> { name: "Ravi Kumar", email: "ravi@client.com" } */
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
