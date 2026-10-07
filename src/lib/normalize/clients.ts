import { normHeader } from './text';

export interface ClientLite {
  id: string;
  name: string;
  aliases: string[];
  email_domains: string[];
}

/** Match a client by name or alias, ignoring case, spaces and punctuation ("Swift Premium" -> Swift). */
export function resolveClient(name: string | null, clients: ClientLite[]): ClientLite | null {
  if (!name) return null;
  const key = normHeader(name);
  if (!key) return null;
  for (const c of clients) {
    if (normHeader(c.name) === key || c.aliases.some((a) => normHeader(a) === key)) return c;
  }
  return null;
}

export function clientByEmailDomain(email: string | null, clients: ClientLite[]): ClientLite | null {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase().trim();
  return (
    clients.find((c) => c.email_domains.some((d) => {
      const dd = d.toLowerCase().replace(/^@/, '');
      return domain === dd || domain.endsWith('.' + dd);
    })) ?? null
  );
}

/** Client mentioned by name/alias as a whole word in free text (subject, sender name, body). */
export function clientMentionedIn(text: string, clients: ClientLite[]): ClientLite | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best: { c: ClientLite; len: number } | null = null;
  for (const c of clients) {
    for (const n of [c.name, ...c.aliases]) {
      const k = n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (k.length >= 3 && t.includes(` ${k} `) && (!best || k.length > best.len)) best = { c, len: k.length };
    }
  }
  return best?.c ?? null;
}
