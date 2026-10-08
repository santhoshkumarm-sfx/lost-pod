import 'server-only';
import { gmailSubjectQuery, parseAddress } from './email/mime';
import type { EmailMessageInput } from './email/extract';

/*
 * Google access goes through one Apps Script web app that runs as a Shadowfax user (apps-script/Bridge.gs):
 * it reads the trackers, searches/reads Gmail, sends email and keeps uploaded files in Drive.
 * Set GOOGLE_BRIDGE_URL and GOOGLE_BRIDGE_SECRET.
 */

export function bridgeConfigured(): boolean {
  return !!(process.env.GOOGLE_BRIDGE_URL && process.env.GOOGLE_BRIDGE_SECRET);
}

export class BridgeError extends Error {}

export async function callBridge<T>(action: string, params: Record<string, unknown> = {}, timeoutMs = 280_000): Promise<T> {
  const url = process.env.GOOGLE_BRIDGE_URL;
  const secret = process.env.GOOGLE_BRIDGE_SECRET;
  if (!url || !secret) throw new BridgeError('Google bridge is not configured (GOOGLE_BRIDGE_URL / GOOGLE_BRIDGE_SECRET).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    // Apps Script answers a POST with a 302 to a one-time URL that must be fetched with GET;
    // fetch follows it that way by default.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, action, params }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new BridgeError(`Google bridge unreachable: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: { ok: boolean; data?: T; error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    if (/accounts\.google\.com|ServiceLogin|sign in/i.test(text)) {
      throw new BridgeError('Google bridge asked for a sign-in: redeploy it with "Who has access: Anyone" (see README).');
    }
    throw new BridgeError(`Google bridge returned an unexpected page (HTTP ${res.status}). Check GOOGLE_BRIDGE_URL is the /exec web app URL.`);
  }
  if (!body.ok) {
    const err = body.error ?? 'unknown error';
    if (err === 'unauthorized') throw new BridgeError('Google bridge rejected the secret: GOOGLE_BRIDGE_SECRET must equal the BRIDGE_SECRET script property.');
    throw new BridgeError(`Google: ${err}`);
  }
  return body.data as T;
}

export function googleStatus() {
  const on = bridgeConfigured();
  return { sheets: on, gmail: on, method: on ? 'bridge' : 'none' } as const;
}

// ---------- Sheets ----------

/** Accepts a full Google Sheets URL or a bare workbook id. */
export function parseWorkbookId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null;
}

export interface WorkbookInfo {
  title: string;
  tabs: { title: string; rows: number; cols: number; hidden: boolean }[];
}

export function getWorkbook(workbookId: string): Promise<WorkbookInfo> {
  return callBridge<WorkbookInfo>('workbook', { workbookId });
}

/** Values exactly as shown in the sheet ("17 Jul", "#REF!"); normalisation happens in the app. */
export async function readTab(workbookId: string, sheetName: string, maxRows?: number): Promise<string[][]> {
  const rows = await callBridge<unknown[][]>('readTab', { workbookId, sheetName, maxRows: maxRows ?? null });
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
}

// ---------- Gmail ----------

export interface ThreadHit {
  threadId: string;
  subject: string | null;
  from: string | null;
  date: string | null;
  snippet: string | null;
  messageCount: number;
}

/** Threads whose subject matches what the team typed (Re:/Fwd: prefixes ignored). */
export function searchThreads(subject: string, opts: { from?: string | null; newerThanDays?: number | null } = {}): Promise<ThreadHit[]> {
  return callBridge<ThreadHit[]>('searchThreads', { query: gmailSubjectQuery(subject, opts), max: 15 });
}

export interface ThreadContent {
  threadId: string;
  subject: string | null;
  recipients: string | null;
  messages: (EmailMessageInput & { to: string | null; attachments: string[] })[];
}

export async function getThread(threadId: string): Promise<ThreadContent> {
  const t = await callBridge<{ threadId: string; subject: string | null; messages: { id: string; from: string | null; to: string | null; date: string | null; subject: string | null; text: string; html: string; attachments: string[] }[] }>('getThread', { threadId });
  const messages = t.messages.map((m) => ({ ...m, fromEmail: parseAddress(m.from).email, text: m.text ?? '', html: m.html ?? '' }));
  return { threadId: t.threadId, subject: t.subject, recipients: messages[0]?.to ?? null, messages };
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Sent from the mailbox of the account that installed the bridge. */
export async function sendMail(opts: { to: string[]; cc?: string[]; subject: string; html: string; attachments?: MailAttachment[] }): Promise<string> {
  if (!bridgeConfigured()) throw new BridgeError('Gmail is not connected: install the Google bridge (README → Google bridge).');
  await callBridge('sendMail', {
    to: opts.to, cc: opts.cc ?? [], subject: opts.subject, html: opts.html,
    attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, base64: a.content.toString('base64') })),
  });
  return 'sent';
}
