import 'server-only';
import { JWT, OAuth2Client } from 'google-auth-library';
import { bridgeConfigured } from './bridge';

export const SCOPES = {
  sheets: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  gmailRead: ['https://www.googleapis.com/auth/gmail.readonly'],
  gmailSend: ['https://www.googleapis.com/auth/gmail.send'],
};

export class GoogleNotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not connected. Add the Google credentials described in .env.example and README.`);
    this.name = 'GoogleNotConfiguredError';
  }
}

const sa = () => ({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
});
const oauth = () => ({
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  refresh: process.env.GOOGLE_REFRESH_TOKEN,
});

export function googleStatus() {
  const s = sa();
  const o = oauth();
  const hasSa = !!(s.email && s.key);
  const hasOauth = !!(o.id && o.secret && o.refresh);
  const hasBridge = bridgeConfigured();
  return {
    sheets: hasBridge || hasSa || hasOauth,
    gmail: hasBridge || (hasSa && !!process.env.GMAIL_IMPERSONATE_USER) || hasOauth,
    method: hasBridge ? 'bridge' : hasSa ? 'service_account' : hasOauth ? 'oauth' : 'none',
    mailbox: process.env.GMAIL_IMPERSONATE_USER || process.env.GMAIL_SENDER || null,
  } as const;
}

/**
 * Credentials for Google APIs. Service account first (Sheets shared with it; Gmail through
 * domain-wide delegation impersonating GMAIL_IMPERSONATE_USER), else an OAuth refresh token.
 */
export function googleAuth(scopes: string[], purpose: 'sheets' | 'gmail'): JWT | OAuth2Client {
  const s = sa();
  if (s.email && s.key) {
    const subject = purpose === 'gmail' ? process.env.GMAIL_IMPERSONATE_USER : undefined;
    if (purpose === 'gmail' && !subject) {
      const o = oauth();
      if (!(o.id && o.secret && o.refresh)) throw new GoogleNotConfiguredError('Gmail (set GMAIL_IMPERSONATE_USER)');
    } else {
      return new JWT({ email: s.email, key: s.key, scopes, subject });
    }
  }
  const o = oauth();
  if (o.id && o.secret && o.refresh) {
    const client = new OAuth2Client(o.id, o.secret);
    client.setCredentials({ refresh_token: o.refresh });
    return client;
  }
  throw new GoogleNotConfiguredError(purpose === 'gmail' ? 'Gmail' : 'Google Sheets');
}
