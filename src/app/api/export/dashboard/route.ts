import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { parseCaseFilters, statsFilter, type PodStats } from '@/lib/cases/filters';
import { dashboardXlsx } from '@/lib/reports/exports';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The dashboard tables as Excel, with the same filters and the same access as the page (internal team: aligned clients). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.is_active) return new NextResponse('Sign in first', { status: 401 });
  const sb = await createClient();
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseCaseFilters(sp, { category: 'all' });
  let scope: Record<string, unknown> = {};
  if (user.role === 'internal_team') {
    const aligned = ((await sb.from('agent_clients').select('client_id').eq('user_id', user.id)).data ?? []).map((r) => r.client_id as string);
    scope = aligned.length ? { clients: aligned } : { agent: user.id };
  }
  const { data, error } = await sb.rpc('pod_stats', { p: { ...statsFilter(f, { category: 'all' }), ...scope } });
  if (error) return new NextResponse(error.message, { status: 500 });
  const buf = await dashboardXlsx(data as PodStats);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pod-lost-dashboard-${todayIn()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
