import { NextResponse } from 'next/server';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import { buildDailyReport } from '@/lib/reports/daily';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isAdminRole(user.role)) return new NextResponse('Not allowed', { status: 403 });
  const report = await buildDailyReport(await createClient(), { withAttachment: true });
  return new NextResponse(new Uint8Array(report.xlsx!), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
