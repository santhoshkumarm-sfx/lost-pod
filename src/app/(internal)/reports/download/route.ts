import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isAdminRole, isInternalRole } from '@/lib/auth';
import { buildCriticalAlert } from '@/lib/reports/critical';
import { buildDailyReport } from '@/lib/reports/daily';
import { buildWeeklyReport } from '@/lib/reports/weekly';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Excel of a report: ?r=daily (default) | weekly | critical. The critical list is open to the whole team. */
export async function GET(req: NextRequest) {
  const r = req.nextUrl.searchParams.get('r');
  const user = await getSessionUser();
  const allowed = user?.is_active && (r === 'critical' ? isInternalRole(user.role) : isAdminRole(user.role));
  if (!allowed) return new NextResponse('Not allowed', { status: 403 });
  const sb = await createClient();
  const out = r === 'weekly' ? await buildWeeklyReport(sb, { withAttachment: true })
    : r === 'critical' ? await buildCriticalAlert(sb, { withAttachment: true })
      : await buildDailyReport(sb, { withAttachment: true });
  return new NextResponse(new Uint8Array(out.xlsx!), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
