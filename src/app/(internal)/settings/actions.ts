'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { errorText, must, str, withFlash } from '@/lib/flash';
import { createClient } from '@/lib/supabase/server';

async function done(fn: () => Promise<string>): Promise<never> {
  let dest: string;
  try {
    dest = withFlash('/settings', 'ok', await fn());
  } catch (e) {
    dest = withFlash('/settings', 'error', errorText(e));
  }
  revalidatePath('/', 'layout');
  redirect(dest);
}

const VALIDATORS: Record<string, (v: unknown) => string | null> = {
  report_recipients: (v) => (Array.isArray(v) && v.every((e) => typeof e === 'string' && /^[^@\s]+@[^@\s]+$/.test(e)) ? null : 'A list of email addresses.'),
  report_aging_order: (v) => (v === 'asc' || v === 'desc' ? null : '"asc" or "desc".'),
  default_sla_days: (v) => (Number.isInteger(v) && (v as number) > 0 ? null : 'A whole number of days.'),
  dedupe_window_days: (v) => (Number.isInteger(v) && (v as number) >= 0 ? null : 'A whole number of days.'),
  report_lost_body_days: (v) => (Number.isInteger(v) && (v as number) > 0 ? null : 'A whole number of days.'),
  hub_city_codes: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? null : 'A JSON object such as {"PWL":"Palwal"}.'),
  notify_admins_by_email: (v) => (typeof v === 'boolean' ? null : 'true or false.'),
  timezone: (v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: String(v) });
      return null;
    } catch {
      return 'A timezone such as "Asia/Kolkata".';
    }
  },
  awb_patterns: (v) => {
    if (!Array.isArray(v)) return 'A list of regular expressions.';
    try {
      v.forEach((p) => new RegExp(String(p)));
      return null;
    } catch {
      return 'One of the patterns is not a valid regular expression.';
    }
  },
};

/** Form fields are named setting:<key> and hold JSON-ish text; simple inputs are coerced. */
export async function saveSettings(fd: FormData) {
  const user = await requireAdmin();
  await done(async () => {
    const sb = await createClient();
    let n = 0;
    for (const [name, raw] of fd.entries()) {
      if (!name.startsWith('setting:')) continue;
      const key = name.slice(8);
      const text = String(raw).trim();
      let value: unknown;
      if (key === 'report_recipients' || key === 'internal_email_domains') value = text.split(/[\s,;]+/).filter(Boolean);
      else if (key === 'notify_admins_by_email') value = text === 'true';
      else {
        try {
          value = JSON.parse(text);
        } catch {
          value = text;
        }
      }
      const problem = VALIDATORS[key]?.(value);
      if (problem) throw new Error(`${key}: ${problem}`);
      must(await sb.from('app_settings').update({ value, updated_by: user.id, updated_at: new Date().toISOString() }).eq('key', key).select('key'));
      n++;
    }
    return `${n} setting(s) saved.`;
  });
}

export async function saveStatus(fd: FormData) {
  await requireAdmin();
  await done(async () => {
    const sb = await createClient();
    const code = str(fd, 'code').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = str(fd, 'existing') === '1';
    const row = {
      label: str(fd, 'label'), color: str(fd, 'color') || 'slate', sort_order: Number(str(fd, 'sort_order')) || 100,
      is_active: str(fd, 'is_active') === '1',
    };
    if (!code || !row.label) throw new Error('Code and label are required.');
    if (existing) must(await sb.from('status_master').update(row).eq('code', code).select('code'));
    else {
      const category = str(fd, 'category') === 'closed' ? 'closed' : 'open';
      must(await sb.from('status_master').insert({ code, ...row, category, allow_manual: true, is_system: false }).select('code'));
    }
    return existing ? `Status “${row.label}” saved.` : `Status “${row.label}” added.`;
  });
}

export async function saveBuckets(fd: FormData) {
  await requireAdmin();
  await done(async () => {
    const sb = await createClient();
    const lines = str(fd, 'buckets').split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((l, i) => {
      const m = l.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)?\s*\+?$/) ?? l.match(/^(\d+)\s*\+$/);
      if (!m) throw new Error(`Cannot read “${l}”. Use lines like 0-2, 3-7 … 90+.`);
      const min = Number(m[1]);
      const max = m[2] !== undefined ? Number(m[2]) : null;
      return { label: max === null ? `${min}+` : `${min}–${max}`, min_days: min, max_days: max, sort_order: i + 1 };
    });
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      if (prev.max_days === null || rows[i].min_days !== prev.max_days + 1) throw new Error('Buckets must follow on without gaps (e.g. 0–2, 3–7, 8–15).');
    }
    if (rows[0]?.min_days !== 0 || rows[rows.length - 1].max_days !== null) throw new Error('Start at 0 and end with an open bucket like 90+.');
    must(await sb.from('aging_buckets').delete().gte('id', 0).select('id'));
    must(await sb.from('aging_buckets').insert(rows).select('id'));
    return 'Aging buckets saved. Dashboards and reports use them right away.';
  });
}
