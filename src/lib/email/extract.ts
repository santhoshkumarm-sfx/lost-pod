import { parse, type HTMLElement } from 'node-html-parser';
import { cleanAwb, findAwbs, looksLikeAwb, DEFAULT_AWB_PATTERNS } from '../normalize/awb';
import { clientByEmailDomain, clientMentionedIn, type ClientLite } from '../normalize/clients';
import { findDateInText, parseDate } from '../normalize/dates';
import type { TargetField } from '../normalize/fields';
import { mapColumns, type AliasMap } from '../normalize/headers';
import { splitLocationHub } from '../normalize/hub';
import { clean, firstUrl, parseAmount } from '../normalize/text';

export interface EmailMessageInput {
  id: string;
  from: string | null;          // display form
  fromEmail: string | null;
  date: string | null;          // ISO timestamp
  subject: string | null;
  text: string;                 // text/plain body ('' when absent)
  html: string;                 // text/html body ('' when absent)
}

export interface PocLite {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
}

export interface ExtractContext {
  clients: ClientLite[];
  pocs: PocLite[];
  aliases: AliasMap;
  awbPatterns?: string[];
  internalDomains?: string[];   // e.g. ["shadowfax.in"] — used to pick the client's message in a thread
  timezone?: string;            // default Asia/Kolkata
  todayIso: string;
}

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ExtractedRow {
  awb: string;
  location: string | null;
  hub: string | null;
  delivery_date: string | null;
  seller_name: string | null;
  reason: string | null;
  product_name: string | null;
  product_value: number | null;
  order_id: string | null;
  remark: string | null;
  found_in: 'table' | 'text';
}

export interface Extraction {
  source_message_id: string | null;
  subject: string | null;
  sender: string | null;
  sender_email: string | null;
  email_date: string | null;
  common: {
    client_id: string | null;
    client_name: string | null;
    client_poc_id: string | null;
    escalation_date: string | null;
    complaint_type: string | null;
    reason: string | null;
    priority: string | null;
  };
  rows: ExtractedRow[];
  confidence: Record<string, Confidence>;
  missing: string[];
  needs_review: boolean;
  notes: string[];
}

const ROW_FIELDS: TargetField[] = [
  'awb', 'location', 'hub', 'delivery_date', 'seller_name', 'reason', 'product_name', 'product_value', 'order_id',
  'team_remark', 'client_remark',
];

/** HTML → readable text that keeps line structure (for reason / AWB scanning). */
export function htmlToText(html: string): string {
  if (!html) return '';
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  root.querySelectorAll('td, th').forEach((c) => c.insertAdjacentHTML('afterend', ' | '));
  root.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, table, blockquote').forEach((b) => b.insertAdjacentHTML('afterend', '\n'));
  return decodeEntities(root.text)
    .split('\n')
    .map((l) => l.replace(/\s*\|\s*$/, '').replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Cut quoted history ("On … wrote:", "-----Original Message-----", "From: … Sent:") from a plain-text body. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*On .{3,200}wrote:\s*$/i.test(l)) break;
    if (/^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(l)) break;
    if (/^\s*From:\s.+/i.test(l) && lines.slice(i + 1, i + 4).some((n) => /^\s*(Sent|Date):\s/i.test(n))) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

// ---------- Tables ----------

type Grid = string[][];

function htmlTables(html: string): Grid[] {
  if (!html) return [];
  const root = parse(html);
  const grids: Grid[] = [];
  for (const table of root.querySelectorAll('table')) {
    // Skip layout tables that only wrap other tables.
    if (table.querySelector('table')) continue;
    const rows: Grid = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('th, td').map((c: HTMLElement) => decodeEntities(c.text).replace(/\s+/g, ' ').trim());
      if (cells.some((c) => c)) rows.push(cells);
    }
    if (rows.length >= 2) grids.push(rows);
  }
  return grids;
}

/** "AWB | WH" style blocks, tab-separated blocks, or rows separated by 2+ spaces under a header line. */
function textTables(text: string): Grid[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const grids: Grid[] = [];
  let cur: Grid = [];
  let delim: RegExp | null = null;
  const flush = () => {
    if (cur.length >= 2) grids.push(cur);
    cur = [];
    delim = null;
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    const d = line.includes('|') ? /\s*\|\s*/ : line.includes('\t') ? /\t+/ : / {2,}/;
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split(d).map((c) => c.trim());
    if (/^[-:| ]+$/.test(line)) continue; // markdown separator row
    if (cells.length >= 2 && (!delim || String(delim) === String(d))) {
      delim = d;
      cur.push(cells);
    } else {
      flush();
    }
  }
  flush();
  return grids;
}

function rowsFromGrid(grid: Grid, ctx: ExtractContext, patterns: string[]): ExtractedRow[] {
  // Header = first row (within the first 3) with no AWB in it; else no header and sniff columns.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(3, grid.length); i++) {
    if (!grid[i].some((c) => looksLikeAwb(c, patterns))) {
      headerIdx = i;
      break;
    }
  }
  const headers = headerIdx >= 0 ? grid[headerIdx] : [];
  const body = grid.slice(headerIdx + 1);
  const mapping = mapColumns(headers, body, ctx.aliases);
  let awbCol = mapping.find((m) => m.target === 'awb')?.index;
  if (awbCol === undefined) {
    // No AWB header: use the column where most cells look like AWBs.
    const width = Math.max(...grid.map((r) => r.length));
    let best = -1, bestHits = 0;
    for (let c = 0; c < width; c++) {
      const hits = body.filter((r) => r[c] && looksLikeAwb(r[c], patterns)).length;
      if (hits > bestHits) [best, bestHits] = [c, hits];
    }
    if (bestHits === 0) return [];
    awbCol = best;
  }
  const col = (t: TargetField) => mapping.filter((m) => m.target === t && m.index !== awbCol).map((m) => m.index);
  const firstVal = (row: string[], t: TargetField) => col(t).map((i) => clean(row[i])).find((v) => !!v) ?? null;

  const out: ExtractedRow[] = [];
  for (const row of body) {
    const cell = row[awbCol] ?? '';
    const awb = findAwbs(cell, patterns)[0] ?? cleanAwb(cell);
    if (!awb) continue;
    const { hub, location } = splitLocationHub(firstVal(row, 'hub'), firstVal(row, 'location'));
    const del = firstVal(row, 'delivery_date');
    const remarks = [firstVal(row, 'team_remark'), firstVal(row, 'client_remark')].filter(Boolean).join(' | ');
    out.push({
      awb,
      location,
      hub,
      delivery_date: del ? parseDate(del, 'DMY', ctx.todayIso)?.iso ?? null : null,
      seller_name: firstVal(row, 'seller_name'),
      reason: firstVal(row, 'reason'),
      product_name: firstVal(row, 'product_name'),
      product_value: parseAmount(firstVal(row, 'product_value')),
      order_id: firstVal(row, 'order_id'),
      remark: remarks || null,
      found_in: 'table',
    });
  }
  return out;
}

// ---------- Field heuristics ----------

const GREETING = /^(hi|hello|hey|dear|greetings|good (morning|afternoon|evening)|team|all|sir|madam)\b[\s\w,.!-]{0,40}$/i;
const SIGNOFF = /^(thanks|thank you|regards|best regards|warm regards|thanks & regards|thanks and regards|br|cheers)\b/i;

function firstMeaningfulLine(text: string, patterns: string[]): string | null {
  const lines = text.split(/\r?\n/).map((raw) => raw.replace(/\s+/g, ' ').trim());
  const usable = (l: string) =>
    l.length >= 4 && !GREETING.test(l) && !l.includes('|') && !/^(awb|tracking)\b/i.test(l) && !/^(from|to|cc|sent|date|subject):/i.test(l);
  const cut = (l: string) => (l.length > 300 ? `${l.slice(0, 297)}…` : l);
  const body: string[] = [];
  for (const l of lines) {
    if (SIGNOFF.test(l)) break;
    body.push(l);
  }
  // Prefer a sentence without AWBs ("Please provide POD"); else the AWB sentence with the AWBs removed.
  const plain = body.find((l) => usable(l) && !findAwbs(l, patterns).length);
  if (plain) return cut(plain);
  for (const l of body) {
    if (!usable(l)) continue;
    const stripped = findAwbs(l, patterns).reduce((acc, a) => acc.replace(new RegExp(a, 'ig'), ' '), l)
      .replace(/[\s,;:\-–]+/g, ' ').trim();
    if (stripped.length >= 8 && /[a-z]{3,}/i.test(stripped)) return cut(stripped);
  }
  return null;
}

const COMPLAINT_TYPES: [RegExp, string][] = [
  [/\b(fake|false)\s+(delivery|attempt|status)|not\s+received|customer\s+(denied|denies|claims)|didn'?t\s+receive/i, 'Fake delivery / not received'],
  [/\b(incorrect|wrong)\s+(shipment\s+)?status|wrongly\s+marked|wrong\s+closure/i, 'Incorrect status'],
  [/\b(mark(ed)?\s+(as\s+)?lost|declare\s+lost|lost\s+shipment|shipment\s+lost|need\s+lost)\b/i, 'Lost'],
  [/\b(damage|damaged|tamper|tampered)\b/i, 'Damaged / tampered'],
  [/\b(short\s+shipment|missing\s+item|empty\s+(box|package))\b/i, 'Short / empty shipment'],
  [/\b(rto|rts)\b.{0,30}\bpod\b|\bpod\b.{0,30}\b(rto|rts)\b/i, 'RTO/RTS POD'],
  [/\b(rvp|reverse\s+pick ?up)\b/i, 'Reverse pickup POD'],
  [/\bpod\b|proof\s+of\s+delivery/i, 'POD request'],
];

const PRIORITY_HIGH = /\b(urgent|urgently|asap|critical|top\s+priority|high\s+priority|escalat(e|ion)|immediate(ly)?)\b/i;

function inTimezone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/**
 * Extract escalation details from a Gmail thread. Reads the real message bodies (HTML tables first,
 * then text tables, then AWBs anywhere in the text) — never Gmail's generated summary.
 */
export function extractFromThread(messages: EmailMessageInput[], ctx: ExtractContext): Extraction {
  const patterns = ctx.awbPatterns?.length ? ctx.awbPatterns : DEFAULT_AWB_PATTERNS;
  const tz = ctx.timezone ?? 'Asia/Kolkata';
  const internal = (ctx.internalDomains ?? []).map((d) => d.toLowerCase().replace(/^@/, ''));
  const isInternal = (email: string | null) => !!email && internal.some((d) => email.toLowerCase().endsWith(`@${d}`) || email.toLowerCase().endsWith(`.${d}`));
  const notes: string[] = [];

  const sorted = [...messages].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const bodies = sorted.map((m) => ({ m, text: m.text || htmlToText(m.html) }));
  const hasAwb = (b: { m: EmailMessageInput; text: string }) => findAwbs(`${b.text}\n${htmlToText(b.m.html)}`, patterns).length > 0;

  // The escalation message: the first client (non-internal) message with AWBs, else the first with AWBs, else the first.
  const pick =
    bodies.find((b) => !isInternal(b.m.fromEmail) && hasAwb(b)) ??
    bodies.find(hasAwb) ??
    bodies.find((b) => !isInternal(b.m.fromEmail)) ??
    bodies[0];
  const first = bodies[0];
  if (!pick) {
    return emptyExtraction(notes.concat('The thread has no messages.'));
  }
  if (pick !== first) notes.push('AWBs were taken from a later message in the thread.');

  const ownText = stripQuoted(pick.text);
  const fullText = `${pick.text}\n${htmlToText(pick.m.html)}`;

  // Rows: HTML tables → text tables → AWBs anywhere (with the rest of their line as context).
  const rows = new Map<string, ExtractedRow>();
  const addRows = (list: ExtractedRow[]) => {
    for (const r of list) {
      const prev = rows.get(r.awb);
      if (!prev) rows.set(r.awb, r);
      else for (const k of Object.keys(r) as (keyof ExtractedRow)[]) if (prev[k] == null && r[k] != null) (prev as any)[k] = r[k];
    }
  };
  for (const g of htmlTables(pick.m.html)) addRows(rowsFromGrid(g, ctx, patterns));
  for (const g of textTables(pick.text || htmlToText(pick.m.html))) addRows(rowsFromGrid(g, ctx, patterns));
  const NOT_PLACE = /\b(asap|please|pls|plz|kindly|urgent|check|pod|share|provide|need|needed|status|update|lost|delivered|thanks)\b/i;
  for (const line of fullText.split(/\r?\n/)) {
    for (const awb of findAwbs(line, patterns)) {
      if (rows.has(awb)) continue;
      // "R2466544662BDM - Bangalore": a short place name right after the AWB is its location / hub.
      const after = line.slice(line.toUpperCase().indexOf(awb) + awb.length).split(/[,;]|\s{2,}/)[0]
        .replace(/^[\s|:\-–\t]+/, '').trim();
      const words = after.split(/\s+/).filter(Boolean);
      const isPlace = !!after && words.length <= 3 && !findAwbs(after, patterns).length && !NOT_PLACE.test(after)
        && /^[A-Za-z][A-Za-z0-9 _.()-]*$/.test(after);
      const split = isPlace ? splitLocationHub(null, after) : { hub: null, location: null };
      rows.set(awb, {
        awb, location: split.location, hub: split.hub,
        delivery_date: null, seller_name: null, reason: null, product_name: null, product_value: null,
        order_id: null, remark: null, found_in: 'text',
      });
    }
  }
  // Fix: when a plain place name lands in hub (non hub-code), keep it as location instead.
  for (const r of rows.values()) {
    if (r.hub && !/_/.test(r.hub) && !r.location) {
      r.location = r.hub;
      r.hub = null;
    }
  }

  // Client: known POC email → sender domain → any other client sender in the thread → client named in subject/body.
  const subject = pick.m.subject ?? first.m.subject ?? null;
  const senderEmail = pick.m.fromEmail;
  const confidence: Record<string, Confidence> = {};
  const pocFor = (email: string | null) =>
    email ? ctx.pocs.find((p) => p.email && p.email.toLowerCase() === email.toLowerCase()) ?? null : null;
  const clientForSender = (email: string | null): ClientLite | null => {
    const p = pocFor(email);
    if (p) return ctx.clients.find((c) => c.id === p.client_id) ?? null;
    return clientByEmailDomain(email, ctx.clients);
  };
  const poc: PocLite | null = pocFor(senderEmail);
  let client: ClientLite | null = clientForSender(senderEmail);
  if (client) confidence.client = 'high';
  if (poc) confidence.poc = 'high';
  if (!client) {
    for (const b of bodies) {
      if (isInternal(b.m.fromEmail)) continue;
      client = clientForSender(b.m.fromEmail);
      if (client) {
        confidence.client = 'medium';
        break;
      }
    }
  }
  if (!client) {
    client = clientMentionedIn(`${subject ?? ''} ${pick.m.from ?? ''}`, ctx.clients) ?? clientMentionedIn(ownText, ctx.clients);
    if (client) confidence.client = 'medium';
  }
  if (!client) confidence.client = 'none';
  if (!poc) confidence.poc = 'none';

  // Escalation date: the day the escalation mail was sent (IST); fall back to a date written in the subject.
  let escalationDate: string | null = null;
  if (pick.m.date) {
    escalationDate = inTimezone(first.m.date && !isInternal(first.m.fromEmail) ? first.m.date : pick.m.date, tz);
    confidence.escalation_date = 'high';
  } else if (subject) {
    escalationDate = findDateInText(subject, 'DMY', ctx.todayIso);
    confidence.escalation_date = escalationDate ? 'medium' : 'none';
  } else confidence.escalation_date = 'none';

  const reason = firstMeaningfulLine(ownText || pick.text, patterns);
  confidence.reason = reason ? 'medium' : 'none';

  const haystack = `${subject ?? ''}\n${ownText}`;
  const complaint = COMPLAINT_TYPES.find(([re]) => re.test(haystack))?.[1] ?? null;
  confidence.complaint_type = complaint ? 'medium' : 'none';

  const priority = PRIORITY_HIGH.test(haystack) ? 'High' : 'Normal';
  confidence.priority = PRIORITY_HIGH.test(haystack) ? 'medium' : 'low';

  const rowList = [...rows.values()];
  confidence.awb = rowList.some((r) => r.found_in === 'table') ? 'high' : rowList.length ? 'medium' : 'none';
  const withPlace = rowList.filter((r) => r.hub || r.location).length;
  confidence.location = !rowList.length ? 'none' : withPlace === rowList.length ? 'high' : withPlace ? 'low' : 'none';

  // POD link mentioned in a reply is useful context for the team.
  const podLink = bodies.map((b) => firstUrl(b.text)).find((u) => !!u && /drive\.google|docs\.google|pod/i.test(u));
  if (podLink) notes.push(`A link was found in the thread: ${podLink}`);

  const missing: string[] = [];
  if (!rowList.length) missing.push('awb');
  if (!client) missing.push('client');
  if (!escalationDate) missing.push('escalation_date');
  if (!reason) missing.push('reason');
  if (!complaint) missing.push('complaint_type');
  if (rowList.length && withPlace < rowList.length) missing.push('location');

  return {
    source_message_id: pick.m.id,
    subject,
    sender: pick.m.from,
    sender_email: senderEmail,
    email_date: pick.m.date,
    common: {
      client_id: client?.id ?? null,
      client_name: client?.name ?? null,
      client_poc_id: poc?.id ?? null,
      escalation_date: escalationDate,
      complaint_type: complaint,
      reason,
      priority,
    },
    rows: rowList,
    confidence,
    missing,
    needs_review: missing.some((m) => ['awb', 'client', 'escalation_date'].includes(m)) || confidence.client !== 'high',
    notes,
  };
}

function emptyExtraction(notes: string[]): Extraction {
  return {
    source_message_id: null, subject: null, sender: null, sender_email: null, email_date: null,
    common: { client_id: null, client_name: null, client_poc_id: null, escalation_date: null, complaint_type: null, reason: null, priority: null },
    rows: [], confidence: {}, missing: ['awb', 'client', 'escalation_date', 'reason', 'complaint_type'], needs_review: true, notes,
  };
}

export const ROW_TARGETS = ROW_FIELDS;
