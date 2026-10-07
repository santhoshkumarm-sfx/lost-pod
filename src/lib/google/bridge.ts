import 'server-only';

/**
 * Google access through an Apps Script web app that runs as a Shadowfax user (apps-script/Bridge.gs).
 * Used when no Google Cloud service account is available. Set GOOGLE_BRIDGE_URL and GOOGLE_BRIDGE_SECRET.
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
      throw new BridgeError('Google bridge asked for a sign-in: redeploy it with "Who has access: Anyone" (see SETUP.md).');
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
