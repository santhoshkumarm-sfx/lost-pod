import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/cron';
import { sendDailyReport } from '@/lib/reports/daily';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const r = await sendDailyReport(createAdminClient(), { trigger: 'cron' });
    return NextResponse.json({ ok: true, recipients: r.recipients, messageId: r.messageId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
