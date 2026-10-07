import { NextResponse } from 'next/server';
import { getSessionUser, isAdminRole } from '@/lib/auth';
import { buildDailyReport } from '@/lib/reports/daily';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isAdminRole(user.role)) return new NextResponse('Not allowed', { status: 403 });
  const report = await buildDailyReport(await createClient(), { withAttachment: false });
  return new NextResponse(report.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
