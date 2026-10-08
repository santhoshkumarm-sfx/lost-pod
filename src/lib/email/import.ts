import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getThread } from '../google';
import { loadImportConfig } from '../importer/config';
import { extractFromThread, htmlToText, type EmailMessageInput } from './extract';
import { parseAddress } from './mime';

const MAX_TEXT = 40_000;
const MAX_HTML = 200_000;

export interface StoredMessage {
  id: string;
  from: string | null;
  fromEmail: string | null;
  to?: string | null;
  date: string | null;
  subject: string | null;
  text: string;
  html: string;
  attachments?: string[];
}

function store(m: EmailMessageInput & { to?: string | null; attachments?: string[] }): StoredMessage {
  return {
    id: m.id, from: m.from, fromEmail: m.fromEmail, to: m.to ?? null, date: m.date, subject: m.subject,
    text: (m.text || htmlToText(m.html)).slice(0, MAX_TEXT), html: m.html.slice(0, MAX_HTML), attachments: m.attachments ?? [],
  };
}

/** Run extraction over stored messages and save the result on the email row. */
export async function extractAndSave(sb: SupabaseClient, emailId: string, messages: StoredMessage[]) {
  const cfg = await loadImportConfig(sb);
  const x = extractFromThread(messages, {
    clients: cfg.clients, pocs: cfg.pocs, aliases: cfg.aliases, awbPatterns: cfg.awbPatterns,
    internalDomains: cfg.internalDomains, timezone: cfg.timezone, todayIso: cfg.todayIso,
  });
  const picked = messages.find((m) => m.id === x.source_message_id) ?? messages[0];
  const { error } = await sb
    .from('emails')
    .update({
      extraction: x, client_id: x.common.client_id, gmail_message_id: picked?.id ?? 'unknown',
      sender: x.sender ?? picked?.from ?? null, sender_email: x.sender_email ?? picked?.fromEmail ?? null,
      email_date: x.email_date ?? picked?.date ?? null, body_text: picked?.text ?? null, body_html: picked?.html ?? null,
    })
    .eq('id', emailId);
  if (error) throw new Error(error.message);
  return x;
}

/** Pull a Gmail thread into the review queue. Returns the email row id (existing one if already imported). */
export async function importGmailThread(sb: SupabaseClient, threadId: string, userId: string): Promise<{ id: string; existing: boolean }> {
  const existing = await sb.from('emails').select('id, status').eq('gmail_thread_id', threadId).maybeSingle();
  const thread = await getThread(threadId);
  const messages = thread.messages.map(store);
  if (!messages.length) throw new Error('This thread has no messages.');
  let id = existing.data?.id as string | undefined;
  if (id) {
    const { error } = await sb.from('emails').update({ messages, subject: thread.subject, recipients: thread.recipients }).eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await sb
      .from('emails')
      .insert({
        gmail_thread_id: threadId, gmail_message_id: messages[0].id, subject: thread.subject, recipients: thread.recipients,
        messages, imported_by: userId, status: 'needs_review',
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }
  // Only re-extract while the email is still under review; processed emails keep what was confirmed.
  if (!existing.data || existing.data.status === 'needs_review') await extractAndSave(sb, id!, messages);
  return { id: id!, existing: !!existing.data };
}

/** For escalations forwarded outside Gmail (or when Gmail is not connected): paste the mail. */
export async function importPastedEmail(
  sb: SupabaseClient,
  input: { subject: string; from: string; date: string | null; body: string },
  userId: string,
): Promise<string> {
  const msg: StoredMessage = {
    id: `pasted-${Date.now()}`, from: input.from || null, fromEmail: parseAddress(input.from).email, date: input.date,
    subject: input.subject || null, text: input.body.slice(0, MAX_TEXT), html: '', attachments: [],
  };
  const { data, error } = await sb
    .from('emails')
    .insert({
      gmail_thread_id: `manual:${crypto.randomUUID()}`, gmail_message_id: msg.id, subject: msg.subject, messages: [msg],
      imported_by: userId, status: 'needs_review',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await extractAndSave(sb, data.id as string, [msg]);
  return data.id as string;
}
