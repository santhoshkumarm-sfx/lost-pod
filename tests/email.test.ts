import { describe, expect, it } from 'vitest';
import { extractFromThread, htmlToText, stripQuoted, type EmailMessageInput } from '@/lib/email/extract';
import { baseSubject, gmailSubjectQuery, parseAddress } from '@/lib/email/mime';
import { aliases, clients } from './fixtures';

const ctx = {
  clients,
  pocs: [{ id: 'poc-1', client_id: 'c-swift', name: 'Ritu', email: 'ritu@goswift.in' }],
  aliases,
  internalDomains: ['shadowfax.in'],
  todayIso: '2026-09-14',
};

const msg = (over: Partial<EmailMessageInput>): EmailMessageInput => ({
  id: 'm1', from: 'Ops <ops@velocity.in>', fromEmail: 'ops@velocity.in', date: '2026-09-11T05:12:00.000Z',
  subject: 'POD needed - Shadowfax - 11-09-26', text: '', html: '', ...over,
});

describe('email helpers', () => {
  it('parses addresses and subjects', () => {
    expect(parseAddress('"Ravi K" <Ravi@Client.com>')).toEqual({ name: 'Ravi K', email: 'ravi@client.com' });
    expect(baseSubject('Re: RE: Fwd: Regarding POD')).toBe('Regarding POD');
    expect(gmailSubjectQuery('Re: POD needed - Shadowfax - 11-09-26')).toBe('subject:"POD needed - Shadowfax - 11-09-26"');
  });
  it('turns HTML into lines', () => {
    expect(htmlToText('<p>Hi team,</p><p>Please provide POD</p>')).toBe('Hi team,\nPlease provide POD');
  });
  it('cuts quoted history', () => {
    expect(stripQuoted('Please check\n\nOn Tue, 9 Sep 2026 at 10:00, Ops <ops@x.in> wrote:\n> old')).toBe('Please check');
  });
});

describe('extraction', () => {
  it('handles the spec example: a text table creates two cases', () => {
    const x = extractFromThread(
      [msg({ text: 'Hi Team,\n\nPlease provide POD\n\nAWB | WH\nR2466544662BDM | Bangalore\nR2460991811BDM | Jaipur\n\nRegards,\nOps' })],
      ctx,
    );
    expect(x.rows.map((r) => [r.awb, r.location])).toEqual([
      ['R2466544662BDM', 'Bangalore'],
      ['R2460991811BDM', 'Jaipur'],
    ]);
    expect(x.common.reason).toBe('Please provide POD');
    expect(x.common.complaint_type).toBe('POD request');
    expect(x.common.client_id).toBe('c-velocity');
    expect(x.common.escalation_date).toBe('2026-09-11');
    expect(x.confidence.awb).toBe('high');
    expect(x.missing).not.toContain('awb');
  });

  it('reads HTML tables with hub codes and delivery dates', () => {
    const html = `<div>Dear team,</div><div>Customer claims not received, kindly share POD urgently.</div>
      <table><tr><th>AWB No</th><th>Hub</th><th>Delivery Date</th><th>Seller Name</th></tr>
      <tr><td>SF3583535088VEO</td><td>DEL_KirtiNagar_RTS</td><td>10-07-2026</td><td>Eitheo</td></tr>
      <tr><td>sf16148043612640gop</td><td>CJB_DC_FMRTS</td><td>12-07-2026</td><td>Acme</td></tr></table>`;
    const x = extractFromThread([msg({ html, fromEmail: 'ritu@goswift.in', from: 'Ritu <ritu@goswift.in>' })], ctx);
    expect(x.rows).toHaveLength(2);
    expect(x.rows[0]).toMatchObject({ awb: 'SF3583535088VEO', hub: 'DEL_KirtiNagar_RTS', location: 'Delhi', delivery_date: '2026-07-10', seller_name: 'Eitheo' });
    expect(x.rows[1].awb).toBe('SF16148043612640GOP');
    expect(x.common.client_id).toBe('c-swift');
    expect(x.common.client_poc_id).toBe('poc-1');
    expect(x.common.priority).toBe('High');
    expect(x.common.complaint_type).toBe('Fake delivery / not received');
    expect(x.needs_review).toBe(false);
  });

  it('falls back to AWBs in plain sentences and flags what is missing', () => {
    const x = extractFromThread(
      [msg({ fromEmail: 'someone@unknown.com', from: 'someone@unknown.com', subject: 'Regarding POD', text: 'Hello,\nkindly check R10017137SFH asap\nThanks' })],
      ctx,
    );
    expect(x.rows.map((r) => r.awb)).toEqual(['R10017137SFH']);
    expect(x.common.client_id).toBeNull();
    expect(x.missing).toEqual(expect.arrayContaining(['client', 'location']));
    expect(x.needs_review).toBe(true);
  });

  it('takes AWBs from the client message, not from our reply', () => {
    const x = extractFromThread(
      [
        msg({ id: 'a', text: 'Please provide POD for R2466544662BDM - Bangalore' }),
        msg({ id: 'b', from: 'SFX <tns@shadowfax.in>', fromEmail: 'tns@shadowfax.in', date: '2026-09-12T05:00:00Z', text: 'Checking R2466544662BDM' }),
      ],
      ctx,
    );
    expect(x.source_message_id).toBe('a');
    expect(x.rows[0]).toMatchObject({ awb: 'R2466544662BDM', location: 'Bangalore' });
  });
});
