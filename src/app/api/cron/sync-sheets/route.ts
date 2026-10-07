import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/cron';
import { googleStatus } from '@/lib/google/auth';
import { syncSources } from '@/lib/importer/sheets-sync';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!googleStatus().sheets) return NextResponse.json({ ok: false, error: 'Google Sheets is not configured' }, { status: 503 });
  try {
    const { results, remaining } = await syncSources(createAdminClient(), { actor: null, trigger: 'cron', timeBudgetMs: 250_000 });
    return NextResponse.json({
      ok: results.every((r) => r.status !== 'failed'),
      remaining,
      results: results.map((r) => ({ tab: r.label, status: r.status, message: r.message, created: r.created, updated: r.updated, lost_requests: r.lostRequests })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
