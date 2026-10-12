import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/cron';
import { googleStatus } from '@/lib/google';
import { syncSources } from '@/lib/importer/sheets-sync';
import { syncPodIndex } from '@/lib/pod/sheets';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!googleStatus().sheets) return NextResponse.json({ ok: false, error: 'Google Sheets is not configured' }, { status: 503 });
  try {
    const started = Date.now();
    const sb = createAdminClient();
    const { results, remaining } = await syncSources(sb, { actor: null, trigger: 'cron', timeBudgetMs: 200_000 });
    // Then the POD sheets (new rows only), in the time that is left.
    const pods = await syncPodIndex(sb, { deadline: started + 280_000 }).catch((e) => [{ tab: '', message: String(e) }]);
    return NextResponse.json({
      ok: results.every((r) => r.status !== 'failed'),
      remaining,
      pod_sheets: pods,
      results: results.map((r) => ({ tab: r.label, status: r.status, message: r.message, created: r.created, updated: r.updated, lost_requests: r.lostRequests })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
