import { createHash } from 'node:crypto';
import { cleanAwb } from './awb';
import { resolveClient, type ClientLite } from './clients';
import {
  detectColumnOrder, findDateInText, parseDate, plausibleDelivery, voteOrderAgainst, type DateOrder,
} from './dates';
import type { TargetField } from './fields';
import { detectHeaderRow, mapColumns, mappingSignature, type AliasMap, type ColumnMapping, type ColumnOverride } from './headers';
import { splitLocationHub } from './hub';
import { resolveStatus, type StatusDef, type StatusMappingRule } from './status';
import { clean, firstUrl, isUrl, parseAmount, uniqueNonEmpty } from './text';

export interface SheetContext {
  sourceId: string;
  defaultClientId: string | null;
  clients: ClientLite[];
  aliases: AliasMap;
  overrides: ColumnOverride[];
  statusRules: StatusMappingRule[];
  statuses: StatusDef[];
  dateOrder: 'auto' | DateOrder;
  headerRow: number | null;     // 1-based, null = detect
  todayIso: string;
  hubCityCodes?: Record<string, string>;
}

/** One tracker row in the standard shape, ready for public.import_sheet_rows(). */
export interface NormalizedRow {
  source_key: string;
  record_hash: string;
  row_number: number;
  awb: string;
  client_id: string | null;
  client_name: string | null;
  poc_name: string | null;
  escalation_date: string | null;
  escalation_date_estimated: boolean;
  location: string | null;
  hub: string | null;
  delivery_date: string | null;
  seller_name: string | null;
  complaint_type: string | null;
  reason: string | null;
  priority: string | null;
  shipment_status: string | null;
  pod_status: 'shared' | null;
  pod_link: string | null;
  product_name: string | null;
  product_value: number | null;
  order_id: string | null;
  rider_name: string | null;
  rider_id: string | null;
  team_remark: string | null;
  client_remark: string | null;
  status_code: string;
  status_raw: string | null;
  agent_name: string | null;
  closure_date: string | null;
  email_subject: string | null;
  extra: Record<string, unknown>;
  raw: Record<string, string>;
}

export interface SheetIssue {
  row: number;
  message: string;
}

export interface NormalizedSheet {
  headerRow: number;                 // 1-based
  mapping: ColumnMapping[];
  dateOrders: Partial<Record<'escalation_date' | 'delivery_date' | 'closure_date', DateOrder>>;
  rows: NormalizedRow[];
  rowsRead: number;
  skipped: number;
  issues: SheetIssue[];
}

const MAX_ISSUES = 50;

/** Turn a raw sheet (values as displayed) into standard rows. Never trusts the sheet's AGEING column. */
export function normalizeSheet(values: string[][], ctx: SheetContext): NormalizedSheet {
  const headerIdx = ctx.headerRow ? ctx.headerRow - 1 : detectHeaderRow(values, ctx.aliases);
  const headers = (values[headerIdx] ?? []).map((h) => String(h ?? ''));
  const body = values.slice(headerIdx + 1);
  const mapping = mapColumns(headers, body.slice(0, 60), ctx.aliases, ctx.overrides);
  const sig = mappingSignature(mapping);
  const issues: SheetIssue[] = [];
  const addIssue = (row: number, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ row, message });
  };

  if (!mapping.some((m) => m.target === 'awb')) {
    return {
      headerRow: headerIdx + 1, mapping, dateOrders: {}, rows: [], rowsRead: body.length, skipped: body.length,
      issues: [{ row: headerIdx + 1, message: 'No AWB column found. Map one on the tab’s mapping screen.' }],
    };
  }

  const colsFor = (t: TargetField) => mapping.filter((m) => m.target === t).map((m) => m.index);
  const cells = (row: string[], t: TargetField) =>
    colsFor(t).map((i) => clean(row[i])).filter((v): v is string => !!v);
  const first = (row: string[], t: TargetField) => cells(row, t)[0] ?? null;

  // Column-level date order: explicit setting > evidence in the column > relation to delivery dates > DMY.
  const dateOrders: NormalizedSheet['dateOrders'] = {};
  const colValues = (t: TargetField) => body.map((r) => first(r, t));
  const delOrder = detectColumnOrder(colValues('delivery_date')) ?? 'DMY';
  dateOrders.delivery_date = delOrder;
  const deliveryIsos = colValues('delivery_date').map((v) => parseDate(v, delOrder, ctx.todayIso)?.iso ?? null);
  dateOrders.escalation_date =
    ctx.dateOrder !== 'auto'
      ? ctx.dateOrder
      : detectColumnOrder(colValues('escalation_date')) ??
        voteOrderAgainst(colValues('escalation_date'), deliveryIsos, ctx.todayIso) ?? 'DMY';
  dateOrders.closure_date = detectColumnOrder(colValues('closure_date')) ?? dateOrders.escalation_date;

  const byKey = new Map<string, { row: NormalizedRow; cells: string[]; count: number }>();
  let skipped = 0;

  body.forEach((row, i) => {
    const rowNumber = headerIdx + 2 + i;
    if (!row || row.every((c) => !clean(c))) return;
    const awbRaw = first(row, 'awb');
    const awb = cleanAwb(awbRaw);
    if (!awb) {
      skipped++;
      if (awbRaw) addIssue(rowNumber, `Skipped: "${awbRaw}" is not a valid AWB`);
      return;
    }

    const extra: Record<string, unknown> = {};
    const today = ctx.todayIso;

    // Client
    const clientName = first(row, 'client_name');
    const matched = resolveClient(clientName, ctx.clients);
    const clientId = matched?.id ?? ctx.defaultClientId;
    if (clientName && !matched) extra.unmatched_client = clientName;

    // Escalation date (+ fallback to a date inside the mail subject)
    const subject = first(row, 'email_subject');
    const escRaw = first(row, 'escalation_date');
    let escIso = escRaw ? parseDate(escRaw, dateOrders.escalation_date!, today)?.iso ?? null : null;
    if (escRaw && !escIso) addIssue(rowNumber, `Could not read escalation date "${escRaw}"`);
    if (escIso && escIso > today) {
      addIssue(rowNumber, `Escalation date ${escIso} is in the future; treated as missing`);
      escIso = null;
    }
    let estimated = false;
    if (!escIso && subject) {
      escIso = findDateInText(subject, dateOrders.escalation_date!, today);
      if (escIso) extra.escalation_date_from = 'mail_subject';
    }
    if (!escIso) estimated = true;

    // Delivery date, with day/month swap when the reading is impossible
    let deliveryIso: string | null = null;
    const delRaw = first(row, 'delivery_date');
    if (delRaw) {
      const p = parseDate(delRaw, delOrder, today);
      if (p) {
        const fixed = plausibleDelivery(p, escIso, today);
        deliveryIso = fixed.iso;
        if (fixed.corrected) extra.delivery_date_corrected_from = delRaw;
      }
    }
    const closureRaw = first(row, 'closure_date');
    const closureIso = closureRaw ? parseDate(closureRaw, dateOrders.closure_date!, today)?.iso ?? null : null;

    // POD link: keep URLs; text in the POD column ("will share tomorrow", a mail subject) is kept as a note
    let podLink: string | null = null;
    const podNotes: string[] = [];
    for (const v of cells(row, 'pod_link')) {
      const url = isUrl(v) ? v : firstUrl(v);
      if (url && !podLink) podLink = url;
      if (!isUrl(v)) podNotes.push(v);
    }
    if (podNotes.length) extra.pod_note = podNotes.join(' | ');

    const teamRemarks = cells(row, 'team_remark');
    const clientRemarks = cells(row, 'client_remark');
    const status = resolveStatus(
      { status: cells(row, 'status_raw'), clientRemark: clientRemarks, teamRemark: teamRemarks, podStatus: cells(row, 'pod_status') },
      ctx.statusRules,
      ctx.statuses,
    );
    if (status.unmapped.length) extra.unmapped_status = status.unmapped;

    const { hub, location } = splitLocationHub(first(row, 'hub'), first(row, 'location'), ctx.hubCityCodes);

    const raw: Record<string, string> = {};
    row.forEach((c, idx) => {
      const v = clean(c);
      if (v) raw[headers[idx]?.trim() || `Column ${idx + 1}`] = v;
    });

    const normalized: NormalizedRow = {
      source_key: `${ctx.sourceId}:${awb}:${escIso ?? 'na'}`,
      record_hash: '',
      row_number: rowNumber,
      awb,
      client_id: clientId,
      client_name: clientName,
      poc_name: first(row, 'poc_name'),
      escalation_date: escIso,
      escalation_date_estimated: estimated,
      location,
      hub,
      delivery_date: deliveryIso,
      seller_name: first(row, 'seller_name'),
      complaint_type: first(row, 'complaint_type'),
      reason: first(row, 'reason'),
      priority: first(row, 'priority'),
      shipment_status: first(row, 'shipment_status') ?? status.shipmentStatus,
      pod_status: status.podShared || (podLink && ['pod_shared', 'closed'].includes(status.code)) ? 'shared' : null,
      pod_link: podLink,
      product_name: first(row, 'product_name'),
      product_value: parseAmount(first(row, 'product_value')),
      order_id: first(row, 'order_id'),
      rider_name: first(row, 'rider_name'),
      rider_id: first(row, 'rider_id'),
      team_remark: uniqueNonEmpty(teamRemarks).join(' | ') || null,
      client_remark: uniqueNonEmpty(clientRemarks).join(' | ') || null,
      status_code: status.code,
      status_raw: status.raw,
      agent_name: first(row, 'agent_name'),
      closure_date: closureIso,
      email_subject: subject,
      extra,
      raw,
    };

    // The same AWB + escalation date twice in one tab is one escalation: later rows fill/override earlier ones.
    const prev = byKey.get(normalized.source_key);
    if (prev) {
      const merged = { ...prev.row } as Record<string, unknown>;
      for (const [k, v] of Object.entries(normalized)) if (v !== null && v !== '' && k !== 'extra') merged[k] = v;
      merged.extra = { ...prev.row.extra, ...normalized.extra, duplicate_rows: prev.count + 1 };
      byKey.set(normalized.source_key, { row: merged as unknown as NormalizedRow, cells: [...prev.cells, ...row], count: prev.count + 1 });
    } else {
      byKey.set(normalized.source_key, { row: normalized, cells: row.map((c) => String(c ?? '')), count: 1 });
    }
  });

  const rows = [...byKey.values()].map(({ row, cells: c }) => ({
    ...row,
    record_hash: createHash('sha256').update(sig).update('\u0001').update(JSON.stringify(c)).digest('hex'),
  }));

  return { headerRow: headerIdx + 1, mapping, dateOrders, rows, rowsRead: body.length, skipped, issues };
}
