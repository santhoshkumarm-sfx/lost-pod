import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/cron';
import { runScheduledReports } from '@/lib/reports/weekly';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Runs every hour. Settings → Scheduled reports decides what is sent and when (IST). */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const results = await runScheduledReports(createAdminClient());
    const failed = results.some((r) => r.status === 'failed');
    return NextResponse.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
