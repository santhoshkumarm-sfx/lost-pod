import 'server-only';
import { createAdminClient } from './supabase/admin';
import { googleStatus } from './google/auth';
import { sendMail } from './google/gmail';
import { publicEnv } from './env';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * In-app notifications are created by the database. When the "notify_admins_by_email" setting is on and
 * Gmail is connected, admins also get an email. Failures here never block the Lost request itself.
 */
export async function notifyAdminsByEmail(caseId: string, reason: string): Promise<void> {
  try {
    if (!googleStatus().gmail) return;
    const sb = createAdminClient();
    const [setting, kase, admins] = await Promise.all([
      sb.from('app_settings').select('value').eq('key', 'notify_admins_by_email').maybeSingle(),
      sb.from('v_cases').select('awb, client_display_name, aging_days, hub, location').eq('id', caseId).maybeSingle(),
      sb.from('profiles').select('email').in('role', ['super_admin', 'admin']).eq('is_active', true),
    ]);
    if (setting.data?.value === false || !kase.data) return;
    const to = (admins.data ?? []).map((a) => a.email).filter(Boolean);
    if (!to.length) return;
    const c = kase.data;
    await sendMail({
      to,
      subject: `Lost approval needed: ${c.awb} (${c.client_display_name ?? 'unknown client'})`,
      html: `<p>A Lost request is waiting for Admin approval.</p>
<p><strong>AWB:</strong> ${esc(c.awb)}<br><strong>Client:</strong> ${esc(c.client_display_name ?? '—')}<br>
<strong>Aging:</strong> ${c.aging_days} days<br><strong>Hub / location:</strong> ${esc(c.hub ?? c.location ?? '—')}<br>
<strong>Reason:</strong> ${esc(reason)}</p>
<p><a href="${publicEnv.siteUrl}/lost-approval">Review Lost requests</a></p>`,
    });
  } catch (e) {
    console.error('Lost request email failed', e);
  }
}
