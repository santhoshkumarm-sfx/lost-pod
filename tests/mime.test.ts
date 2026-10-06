import { describe, expect, it } from 'vitest';
import { collectBodies, decodeBase64Url, type GmailPart } from '@/lib/email/mime';
import { buildMime } from '@/lib/google/gmail';

const b64u = (s: string) => Buffer.from(s).toString('base64url');

describe('MIME', () => {
  it('walks nested multipart bodies and skips attachments', () => {
    const msg: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', body: { data: b64u('AWB | WH\nR2466544662BDM | Bangalore') } },
          { mimeType: 'text/html', body: { data: b64u('<table><tr><td>AWB</td></tr></table>') } },
        ] },
        { mimeType: 'application/pdf', filename: 'pod.pdf', body: { attachmentId: 'x' } },
      ],
    };
    const b = collectBodies(msg);
    expect(b.text).toContain('R2466544662BDM');
    expect(b.html).toContain('<table>');
    expect(b.attachments).toEqual(['pod.pdf']);
    expect(decodeBase64Url(b64u('₹ ok'))).toBe('₹ ok');
  });
  it('builds a report email with an attachment', () => {
    const raw = buildMime({ to: ['a@x.in', 'b@x.in'], subject: 'Lost / POD daily report — 03 Oct', html: '<p>hi</p>', attachments: [{ filename: 'r.xlsx', contentType: 'application/octet-stream', content: Buffer.from('xlsx') }] });
    expect(raw).toContain('To: a@x.in, b@x.in');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('filename="r.xlsx"');
  });
});
