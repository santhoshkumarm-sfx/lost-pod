'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { saveToDrive } from '@/lib/cases/add';
import { errorText, str, withFlash } from '@/lib/flash';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { parseOtp, parseValueUpload } from '@/lib/values';

/** Filled-in Excel → product value / OTP delivered per AWB (applies to every case with that AWB). */
export async function uploadValues(fd: FormData) {
  const user = await requireAdmin();
  let dest: string;
  try {
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Choose the filled-in Excel file.');
    if (file.size > 8 * 1024 * 1024) throw new Error('The file is larger than 8 MB. Split it into smaller files.');
    const parsed = await parseValueUpload(await file.arrayBuffer());
    if (!parsed.rows.length) throw new Error(`Nothing to save: no row has a product value or OTP filled in.${parsed.problems.length ? ` ${parsed.problems.length} row(s) had problems, e.g. row ${parsed.problems[0].row}: ${parsed.problems[0].message}.` : ''}`);
    const sb = await createClient();
    let updated = 0;
    const missing: string[] = [];
    for (let i = 0; i < parsed.rows.length; i += 5000) {
      const { data, error } = await sb.rpc('set_awb_values', { p_rows: parsed.rows.slice(i, i + 5000), p_source: 'upload' });
      if (error) throw error;
      const r = data as { updated: number; not_in_cases: string[] };
      updated += r.updated;
      missing.push(...r.not_in_cases);
    }
    const drive = await saveToDrive(file, 'Product value', user.full_name ?? user.email);
    const { data: log } = await createAdminClient().from('value_uploads').insert({
      uploaded_by: user.id, uploader_name: user.full_name ?? user.email, filename: file.name, total_rows: parsed.total, updated,
      not_in_cases: missing.length,
      problems: [...parsed.problems, ...missing.slice(0, 500).map((awb) => ({ row: 0, awb, message: 'Saved, but no case has this AWB yet (it applies when one comes in)' }))].slice(0, 2000),
      drive_url: drive.url,
    }).select('id').single();
    dest = withFlash(`/values?upload=${(log as { id: string } | null)?.id ?? ''}`, 'ok',
      `${updated} AWB(s) updated${parsed.problems.length ? `, ${parsed.problems.length} row(s) skipped — see below` : ''}${missing.length ? `; ${missing.length} AWB(s) are not in any case yet` : ''}.`);
  } catch (e) {
    dest = withFlash('/values', 'error', errorText(e));
  }
  revalidatePath('/values');
  redirect(dest);
}

/** One AWB by hand. */
export async function saveOneValue(fd: FormData) {
  await requireAdmin();
  let dest: string;
  try {
    const awb = str(fd, 'awb').toUpperCase().replace(/\s+/g, '');
    if (!awb) throw new Error('Enter the AWB.');
    const value = str(fd, 'product_value').replace(/[,₹\s]/g, '');
    if (value && !/^\d+(\.\d+)?$/.test(value)) throw new Error('Product value must be a number.');
    const otp = parseOtp(str(fd, 'otp_delivered'));
    if (!value && otp === undefined) throw new Error('Enter a product value or choose OTP delivered.');
    const sb = await createClient();
    const { data, error } = await sb.rpc('set_awb_values', { p_rows: [{ awb, product_value: value || null, otp_delivered: otp ?? null }], p_source: 'manual' });
    if (error) throw error;
    const r = data as { not_in_cases: string[] };
    dest = withFlash('/values', 'ok', `Saved for ${awb}.${r.not_in_cases.length ? ' No case has this AWB yet; it applies when one comes in.' : ''}`);
  } catch (e) {
    dest = withFlash('/values', 'error', errorText(e));
  }
  revalidatePath('/values');
  redirect(dest);
}
