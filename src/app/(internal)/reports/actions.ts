'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { errorText, must, str, withFlash } from '@/lib/flash';
import { sendDailyReport } from '@/lib/reports/daily';
import { sendWeeklyReport } from '@/lib/reports/weekly';
import { sendCriticalAlert } from '@/lib/reports/critical';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { RECIPIENT_KEYS, type RecipientKind as Kind } from '@/lib/reports/recipients';


const NEEDS_TO = new Set(['critical_alert_email_to', 'report_recipients', 'weekly_report_recipients']);

const parse = (v: string) => [...new Set(v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
function checked(list: string[], label: string): string[] {
  const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (bad.length) throw new Error(`${label}: not an email address: ${bad.join(', ')}`);
  return list;
}

async function saveLists(userId: string, values: Record<string, string[]>) {
  const sb = await createClient();
  for (const [key, value] of Object.entries(values)) {
    if (NEEDS_TO.has(key) && !value.length) throw new Error('Add at least one address in To.');
    must(await sb.from('app_settings').update({ value, updated_by: userId, updated_at: new Date().toISOString() }).eq('key', key).select('key'));
  }
}

async function usual(keys: readonly [string, string]): Promise<[string[], string[]]> {
  const { data } = await createAdminClient().from('app_settings').select('key, value').in('key', [...keys]);
  const get = (k: string) => ((data?.find((r) => r.key === k)?.value ?? []) as string[]).map((e) => e.toLowerCase());
  return [get(keys[0]), get(keys[1])];
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** "Send now" with the To / CC typed on the page; "save" also makes them the usual lists (Super Admin). */
export async function sendNow(fd: FormData) {
  const user = await requireAdmin();
  const kind = (['critical', 'weekly'].includes(str(fd, 'kind')) ? str(fd, 'kind') : 'daily') as 'critical' | 'daily' | 'weekly';
  const back = kind === 'daily' ? '/reports' : `/reports?r=${kind}`;
  let dest: string;
  try {
    const to = checked(parse(str(fd, 'to')), 'To');
    const cc = checked(parse(str(fd, 'cc')), 'CC').filter((e) => !to.includes(e));
    if (!to.length) throw new Error('Add at least one address in To.');
    const keys = RECIPIENT_KEYS[kind];
    if (str(fd, 'save') === '1') {
      if (user.role !== 'super_admin') throw new Error('Only a Super Admin can change the usual To / CC.');
      await saveLists(user.id, { [keys[0]]: to, [keys[1]]: cc });
    }
    const [uTo, uCc] = await usual(keys);
    // Same as the usual lists → a normal send (the critical alert then also goes to each agent).
    const override = same(to, uTo) && same(cc, uCc.filter((e) => !uTo.includes(e))) ? {} : { to, cc };
    const sb = createAdminClient();
    const base = { trigger: 'manual' as const, triggeredBy: user.id, ...override };
    const label = kind === 'critical' ? 'Critical alert' : kind === 'weekly' ? 'Weekly report' : 'Daily report';
    if (kind === 'critical') await sendCriticalAlert(sb, base);
    else if (kind === 'weekly') await sendWeeklyReport(sb, base);
    else await sendDailyReport(sb, base);
    dest = withFlash(back, 'ok', `${label} sent to ${to.join(', ')}${cc.length ? `, CC ${cc.join(', ')}` : ''}.`);
  } catch (e) {
    dest = withFlash(back, 'error', `Not sent: ${errorText(e)}`);
  }
  revalidatePath('/reports');
  redirect(dest);
}

/** Save To / CC of the other emails (Lost requested, Loss accepted, rejected / sent back, POD request). */
export async function saveRecipients(fd: FormData) {
  const user = await requireAdmin();
  let dest: string;
  try {
    if (user.role !== 'super_admin') throw new Error('Only a Super Admin can change To / CC.');
    const values: Record<string, string[]> = {};
    for (const kind of Object.keys(RECIPIENT_KEYS) as Kind[]) {
      for (const key of RECIPIENT_KEYS[kind]) {
        if (fd.has(key)) values[key] = checked(parse(str(fd, key)), key.endsWith('cc') ? 'CC' : 'To');
      }
    }
    await saveLists(user.id, values);
    dest = withFlash('/reports?r=other', 'ok', 'To / CC saved.');
  } catch (e) {
    dest = withFlash('/reports?r=other', 'error', errorText(e));
  }
  revalidatePath('/reports');
  redirect(dest);
}
