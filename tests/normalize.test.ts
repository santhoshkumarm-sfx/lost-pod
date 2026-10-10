import { describe, expect, it } from 'vitest';
import { cleanAwb, findAwbs } from '@/lib/normalize/awb';
import { detectColumnOrder, findDateInText, parseDate, plausibleDelivery } from '@/lib/normalize/dates';
import { detectHeaderRow, mapColumns } from '@/lib/normalize/headers';
import { splitLocationHub } from '@/lib/normalize/hub';
import { normalizeSheet, type SheetContext } from '@/lib/normalize/sheet';
import { resolveStatus } from '@/lib/normalize/status';
import { aliases, aliasRows, clients, statusRules, statuses } from './fixtures';

const TODAY = '2026-09-14';

describe('seed fixtures', () => {
  it('loads the seeded configuration', () => {
    expect(aliasRows.length).toBeGreaterThan(100);
    expect(statusRules.length).toBeGreaterThan(20);
    expect(statuses.map((s) => s.code)).toContain('lost_pending_approval');
  });
});

describe('AWBs', () => {
  it('cleans tracker values', () => {
    expect(cleanAwb('  sf3583535088veo ')).toBe('SF3583535088VEO');
    expect(cleanAwb("'R2466544662BDM")).toBe('R2466544662BDM');
    expect(cleanAwb('#N/A')).toBeNull();
    expect(cleanAwb('Pending')).toBeNull();
  });
  it('finds AWBs in free text in order', () => {
    expect(findAwbs('pls check R2466544662BDM and SF16148043612640GOP, also r2460991811bdm')).toEqual([
      'R2466544662BDM', 'SF16148043612640GOP', 'R2460991811BDM',
    ]);
  });
});

describe('dates', () => {
  const iso = (v: string, o: 'DMY' | 'MDY' = 'DMY') => parseDate(v, o, TODAY)?.iso;
  it('reads every tracker format', () => {
    expect(iso('17 Jul')).toBe('2026-07-17');
    expect(iso('3-Jul')).toBe('2026-07-03');
    expect(iso('06 March 2026')).toBe('2026-03-06');
    expect(iso('02-Jan-26')).toBe('2026-01-02');
    expect(iso('1-Apr-2026')).toBe('2026-04-01');
    expect(iso('29-July-2026')).toBe('2026-07-29');
    expect(iso('1 June 26')).toBe('2026-06-01');
    expect(iso('16th July 2026')).toBe('2026-07-16');
    expect(iso('20-06-2026 17:11')).toBe('2026-06-20');
    expect(iso('2026-03-31')).toBe('2026-03-31');
    expect(iso('7/13/2026')).toBe('2026-07-13');
    expect(iso('7/1/2026', 'MDY')).toBe('2026-07-01');
    expect(iso('03-11-2026')).toBe('2026-11-03'); // DMY reading; Prozo's swap is handled by plausibility
  });
  it('infers the year for dates written without one (never more than a week ahead)', () => {
    expect(iso('20 Dec')).toBe('2025-12-20');
    expect(iso('18 Sep')).toBe('2026-09-18');
  });
  it('treats #REF! and blanks as missing', () => {
    expect(parseDate('#REF!', 'DMY', TODAY)).toBeNull();
    expect(parseDate('', 'DMY', TODAY)).toBeNull();
  });
  it('detects M/D/Y columns (Kartrocket)', () => {
    expect(detectColumnOrder(['7/1/2026', '7/13/2026', '7/2/2026'])).toBe('MDY');
    expect(detectColumnOrder(['13-07-2026', '01-07-2026'])).toBe('DMY');
    expect(detectColumnOrder(['7/1/2026', '7/2/2026'])).toBeNull();
  });
  it('swaps an impossible delivery date (Swift 2026-01-07 = 1 July)', () => {
    const p = parseDate('2026-01-07', 'DMY', TODAY)!;
    expect(plausibleDelivery(p, '2026-07-03', TODAY)).toEqual({ iso: '2026-07-01', corrected: true });
  });
  it('finds a date in a mail subject', () => {
    expect(findDateInText('Re: POD needed - Shadowfax - 11-09-26', 'DMY', TODAY)).toBe('2026-09-11');
    expect(findDateInText('Request for POD "SFX-16th July 2026"', 'DMY', TODAY)).toBe('2026-07-16');
  });
});

describe('headers', () => {
  it('finds a header row that is not the first row (Velocity)', () => {
    const rows = [[''], ['Client name', 'Esc Date', 'AEGING', 'AWB', 'Delivery date'], ['Velocity', '17 Jul', '76', 'SF3583535088VEO', '10-07-2026 14:24']];
    expect(detectHeaderRow(rows, aliases)).toBe(1);
  });
  it('maps typos, blanks and duplicates', () => {
    const headers = ['Client reamrks', 'AEGING', 'lOCATION', '', 'AWB No', 'AWB'];
    const sample = [['ok', '12', 'Delhi', 'DEL_KirtiNagar_RTS', 'R2466544662BDM', 'R2466544662BDM']].concat(
      Array.from({ length: 4 }, () => ['', '', 'Delhi', 'CJB_DC_FMRTS', 'SF3583535088VEO', 'SF3583535088VEO']),
    );
    const m = mapColumns(headers, sample, aliases);
    expect(m.map((x) => x.target)).toEqual(['client_remark', 'ignore', 'location', 'hub', 'awb', null]);
    expect(m[0].via).toBe('fuzzy');
    expect(m[3].via).toBe('content');
  });
  it('applies per-tab overrides first', () => {
    const m = mapColumns(['Status', 'Current status'], [], aliases, [{ index: 1, target: 'status_raw' }]);
    expect(m[1]).toMatchObject({ target: 'status_raw', via: 'override' });
  });
  it('applies overrides by header text wherever the column sits', () => {
    const ov = [{ header: 'PODstatus', target: 'status_raw' }, { header: 'status', target: 'shipment_status' }];
    for (const h of [['AWB', 'status', 'PODstatus'], ['AWB', '', 'Status', 'POD status']]) {
      const m = mapColumns(h, [], aliases, ov);
      expect(m.find((x) => /pod/i.test(x.header))?.target).toBe('status_raw');
      expect(m.find((x) => /^status$/i.test(x.header))?.target).toBe('shipment_status');
    }
  });
});

describe('status resolution', () => {
  const r = (status: string[], extra: Partial<{ clientRemark: string[]; teamRemark: string[]; podStatus: string[] }> = {}) =>
    resolveStatus({ status, clientRemark: [], teamRemark: [], podStatus: [], ...extra }, statusRules, statuses);
  it('maps tracker wording', () => {
    expect(r(['POD shared']).code).toBe('pod_shared');
    expect(r(['working on it']).code).toBe('working_on_it');
    expect(r(['Successfully Closed']).code).toBe('closed');
    expect(r(['IN RTO/RTS Process']).code).toBe('working_on_it');
  });
  it('turns any Lost signal into a request for approval, never final Lost', () => {
    expect(r(['LOST']).code).toBe('lost_pending_approval');
    expect(r(['POD shared'], { clientRemark: ['Need LOST ASAP'] }).code).toBe('lost_pending_approval');
  });
  it('does not read "closed" inside other words', () => {
    expect(r(['enclosed docs']).code).toBe('pending');
  });
  it('keeps shipment wording and unknown values apart', () => {
    const x = r(['RTO Delivered', 'Hold for review']);
    expect(x.shipmentStatus).toBe('RTO Delivered');
    expect(x.unmapped).toEqual(['Hold for review']);
  });
  it('picks the most advanced status across columns', () => {
    expect(r(['working on it'], { teamRemark: ['POD shared'] }).code).toBe('pod_shared');
  });
});

describe('hub / location', () => {
  it('splits hub codes and cities', () => {
    expect(splitLocationHub('DEL_KirtiNagar_RTS', null)).toEqual({ hub: 'DEL_KirtiNagar_RTS', location: 'Delhi' });
    expect(splitLocationHub(null, 'ST_Godadara_RTS')).toEqual({ hub: 'ST_Godadara_RTS', location: 'Surat' });
    expect(splitLocationHub(null, 'Bangalore')).toEqual({ hub: null, location: 'Bangalore' });
  });
});

describe('sheet normalisation (Velocity sample)', () => {
  const ctx: SheetContext = {
    sourceId: 'src-1', defaultClientId: 'c-velocity', clients, aliases, overrides: [], statusRules, statuses,
    dateOrder: 'auto', headerRow: null, todayIso: TODAY,
  };
  const values = [
    [],
    ['Client name', 'Esc Date', 'AEGING', 'AWB', 'Delivery date', 'Seller name', 'Hub', 'POD links', 'SFX remark', 'Remark', 'Mail subject'],
    ['Velocity', '', '', 'R2111303762VEO', '02-06-2026 17:11', 'Warrior World', 'ST_Godadara_RTS', 'https://drive.google.com/file/d/1Rz/view', 'POD shared', '', 'Re: Urgent – Incorrect Shipment Status / POD Request'],
    ['Velocity', '17 Jul', '76', ' sf3583535088veo', '10-07-2026 14:24', 'Eitheo (Kirti Nagar)', 'DEL_KirtiNagar_RTS', 'will share tomorrow', 'working on it', '', ''],
    ['Velocity', '#REF!', '#REF!', 'R2178493750VEO', '25-06-2026 12:09', 'Warrior World', 'ST_Godadara_RTS', '', 'LOST', 'Need LOST ASAP', 'POD needed - Shadowfax - 11-09-26'],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['Velocity', '18 Jul', '', 'Pending', '', '', '', '', '', '', ''],
  ];
  const out = normalizeSheet(values, ctx);

  it('detects the header row and skips junk', () => {
    expect(out.headerRow).toBe(2);
    expect(out.rows).toHaveLength(3);
    expect(out.skipped).toBe(1);
    expect(out.issues.some((i) => i.message.includes('Pending'))).toBe(true);
  });
  it('never trusts AGEING and computes from escalation date', () => {
    const r = out.rows.find((x) => x.awb === 'SF3583535088VEO')!;
    expect(r.escalation_date).toBe('2026-07-17');
    expect(r.raw.AEGING).toBe('76');
    expect(Object.keys(r)).not.toContain('aging_days');
  });
  it('flags missing escalation dates and falls back to the mail subject', () => {
    const noDate = out.rows.find((x) => x.awb === 'R2111303762VEO')!;
    // No date in the row: aged from the delivery date, still flagged as estimated.
    expect(noDate.escalation_date).toBe(noDate.delivery_date);
    expect(noDate.escalation_date_estimated).toBe(true);
    expect(noDate.extra.escalation_date_from).toBe('delivery_date');
    const fromSubject = out.rows.find((x) => x.awb === 'R2178493750VEO')!;
    expect(fromSubject.escalation_date).toBe('2026-09-11');
    expect(fromSubject.extra.escalation_date_from).toBe('mail_subject');
  });
  it('resolves status, POD and hub', () => {
    const shared = out.rows.find((x) => x.awb === 'R2111303762VEO')!;
    expect(shared.status_code).toBe('pod_shared');
    expect(shared.pod_status).toBe('shared');
    expect(shared.pod_link).toContain('drive.google.com');
    expect(shared.hub).toBe('ST_Godadara_RTS');
    expect(shared.location).toBe('Surat');
    const wip = out.rows.find((x) => x.awb === 'SF3583535088VEO')!;
    expect(wip.status_code).toBe('working_on_it');
    expect(wip.extra.pod_note).toBe('will share tomorrow');
    const lost = out.rows.find((x) => x.awb === 'R2178493750VEO')!;
    expect(lost.status_code).toBe('lost_pending_approval');
  });
  it('produces stable keys and hashes', () => {
    const again = normalizeSheet(values, ctx);
    expect(again.rows.map((r) => r.record_hash)).toEqual(out.rows.map((r) => r.record_hash));
    expect(out.rows[0].source_key).toBe('src-1:R2111303762VEO:na');
  });
});

describe('sheet normalisation (Kartrocket M/D/Y escalation dates with D/M/Y delivery dates)', () => {
  it('reads each column in its own order', () => {
    const values = [
      ['Esc Date', 'AWB', 'Delivery date', 'POC', 'Agent'],
      ['7/1/2026', 'R10017137SFH', '28-06-2026', 'Sanjeev D', 'Assem'],
      ['7/13/2026', 'R10017138SFH', '10-07-2026', 'Sanjeev D', 'Assem'],
    ];
    const out = normalizeSheet(values, {
      sourceId: 'k', defaultClientId: 'c-kart', clients, aliases, overrides: [], statusRules, statuses,
      dateOrder: 'auto', headerRow: null, todayIso: TODAY,
    });
    expect(out.dateOrders.escalation_date).toBe('MDY');
    expect(out.rows[0]).toMatchObject({ escalation_date: '2026-07-01', delivery_date: '2026-06-28', poc_name: 'Sanjeev D', agent_name: 'Assem' });
    expect(out.rows[1]).toMatchObject({ escalation_date: '2026-07-13', delivery_date: '2026-07-10' });
  });
});
