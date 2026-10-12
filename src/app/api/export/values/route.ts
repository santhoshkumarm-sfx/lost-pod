import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';
import { buildValuesXlsx, type MissingValueRow } from '@/lib/values';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Admin: every client's AWBs (one row per AWB) to fill in product value / OTP delivered. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isAdminRole(user.role)) return new NextResponse('Admin access needed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const which = sp.get('which') === 'all' ? 'all' : 'missing';
  const scope = sp.get('scope') ?? 'pending';
  const client = sp.get('client') ?? '';
  const sb = await createClient();
  const byAwb = new Map<string, MissingValueRow>();
  for (let from = 0; ; from += 1000) {
    let q = sb.from('v_cases')
      .select('escalation_date, client_display_name, awb, final_value, otp_delivered, status_label, hub, location, aging_days, status_category, team_status, pod_status')
      .order('escalation_date', { ascending: false }).order('case_number');
    if (which === 'missing') q = q.is('final_value', null);
    if (client) q = q.eq('client_id', client);
    if (scope === 'pending') q = q.eq('status_category', 'open').neq('team_status', 'pod_shared').neq('pod_status', 'shared');
    else if (scope === 'lost') q = q.in('status_category', ['lost', 'lost_pending']);
    else if (scope === 'open') q = q.in('status_category', ['open', 'lost_pending']);
    const { data, error } = await q.range(from, from + 999);
    if (error) return new NextResponse(error.message, { status: 500 });
    for (const r of (data ?? []) as MissingValueRow[]) if (!byAwb.has(r.awb)) byAwb.set(r.awb, r);
    if (!data || data.length < 1000) break;
  }
  const buf = await buildValuesXlsx([...byAwb.values()]);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="product-value-${which === 'missing' ? 'to-fill' : 'all'}-${todayIn()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
