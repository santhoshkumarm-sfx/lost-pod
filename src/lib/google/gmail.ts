import 'server-only';
import { gmail as gmailApi } from '@googleapis/gmail';
import { googleAuth, SCOPES } from './auth';
import { bridgeConfigured, callBridge } from './bridge';
import { collectBodies, gmailSubjectQuery, header, parseAddress, type GmailPart } from '../email/mime';
import type { EmailMessageInput } from '../email/extract';

const reader = () => gmailApi({ version: 'v1', auth: googleAuth(SCOPES.gmailRead, 'gmail') });
const sender = () => gmailApi({ version: 'v1', auth: googleAuth(SCOPES.gmailSend, 'gmail') });

export interface ThreadHit {
  threadId: string;
  subject: string | null;
  from: string | null;
  date: string | null;
  snippet: string | null;
  messageCount: number;
}

/** Threads whose subject matches what the team typed (Re:/Fwd: prefixes ignored). */
export async function searchThreads(subject: string, opts: { from?: string | null; newerThanDays?: number | null } = {}): Promise<ThreadHit[]> {
  const q = gmailSubjectQuery(subject, opts);
  if (bridgeConfigured()) return callBridge<ThreadHit[]>('searchThreads', { query: q, max: 15 });
  const g = reader();
  const list = await g.users.threads.list({ userId: 'me', q, maxResults: 15 });
  const threads = list.data.threads ?? [];
  const out: ThreadHit[] = [];
  for (const t of threads) {
    if (!t.id) continue;
    const full = await g.users.threads.get({ userId: 'me', id: t.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
    const msgs = full.data.messages ?? [];
    const firstMsg = msgs[0];
    const lastMsg = msgs[msgs.length - 1];
    out.push({
      threadId: t.id,
      subject: header(firstMsg?.payload as GmailPart, 'Subject'),
      from: header(firstMsg?.payload as GmailPart, 'From'),
      date: firstMsg?.internalDate ? new Date(Number(firstMsg.internalDate)).toISOString() : null,
      snippet: lastMsg?.snippet ?? t.snippet ?? null,
      messageCount: msgs.length,
    });
  }
  return out;
}

export interface ThreadContent {
  threadId: string;
  subject: string | null;
  recipients: string | null;
  messages: (EmailMessageInput & { to: string | null; attachments: string[] })[];
}

/** Full thread with every message body (text and HTML) decoded from the MIME parts. */
export async function getThread(threadId: string): Promise<ThreadContent> {
  if (bridgeConfigured()) {
    const t = await callBridge<{ threadId: string; subject: string | null; messages: { id: string; from: string | null; to: string | null; date: string | null; subject: string | null; text: string; html: string; attachments: string[] }[] }>('getThread', { threadId });
    const messages = t.messages.map((m) => ({ ...m, fromEmail: parseAddress(m.from).email, text: m.text ?? '', html: m.html ?? '' }));
    return { threadId: t.threadId, subject: t.subject, recipients: messages[0]?.to ?? null, messages };
  }
  const res = await reader().users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const messages = (res.data.messages ?? []).map((m) => {
    const payload = m.payload as GmailPart;
    const bodies = collectBodies(payload);
    const from = header(payload, 'From');
    return {
      id: m.id ?? '',
      from,
      fromEmail: parseAddress(from).email,
      to: header(payload, 'To'),
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      subject: header(payload, 'Subject'),
      text: bodies.text,
      html: bodies.html,
      attachments: bodies.attachments,
    };
  });
  return { threadId, subject: messages[0]?.subject ?? null, recipients: messages[0]?.to ?? null, messages };
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

function encodeHeader(v: string): string {
  return /[^\x20-\x7e]/.test(v) ? `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=` : v;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/** Build an RFC 2822 message (HTML body + attachments). Exported for tests. */
export function buildMime(opts: { from?: string | null; to: string[]; cc?: string[]; subject: string; html: string; attachments?: MailAttachment[] }): string {
  const boundary = `lostpod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    ...(opts.from ? [`From: ${opts.from}`] : []),
    `To: ${opts.to.join(', ')}`,
    ...(opts.cc?.length ? [`Cc: ${opts.cc.join(', ')}`] : []),
    `Subject: ${encodeHeader(opts.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(opts.html, 'utf8').toString('base64')),
  ];
  for (const a of opts.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(a.content.toString('base64')),
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

export async function sendMail(opts: { to: string[]; cc?: string[]; subject: string; html: string; attachments?: MailAttachment[] }): Promise<string | null> {
  if (bridgeConfigured()) {
    await callBridge('sendMail', {
      to: opts.to, cc: opts.cc ?? [], subject: opts.subject, html: opts.html,
      attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, base64: a.content.toString('base64') })),
    });
    return 'sent-via-bridge';
  }
  const raw = buildMime({ ...opts, from: process.env.GMAIL_SENDER || null });
  const res = await sender().users.messages.send({
    userId: 'me',
    requestBody: { raw: Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
  });
  return res.data.id ?? null;
}
