import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import { buildCriticalAlert } from '@/lib/reports/critical';
import { buildDailyReport } from '@/lib/reports/daily';
import { buildWeeklyReport } from '@/lib/reports/weekly';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** HTML of a report email: ?r=daily (default) | weekly | critical. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isAdminRole(user.role)) return new NextResponse('Not allowed', { status: 403 });
  const sb = await createClient();
  const r = req.nextUrl.searchParams.get('r');
  const html = r === 'weekly' ? (await buildWeeklyReport(sb, { withAttachment: false })).html
    : r === 'critical' ? (await buildCriticalAlert(sb, { withAttachment: false })).html
      : (await buildDailyReport(sb, { withAttachment: false })).html;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
