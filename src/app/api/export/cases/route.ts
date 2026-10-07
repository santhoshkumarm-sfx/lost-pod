import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { applyCaseFilters, parseCaseFilters } from '@/lib/cases/filters';
import { fetchAllCases } from '@/lib/reports/daily';
import { buildCasesCsv, buildCasesWorkbook, CASE_SHEET_COLUMNS, PORTAL_SHEET_COLUMNS } from '@/lib/reports/xlsx';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Exports run as the signed-in user, so Row Level Security limits a POC to their own client's cases. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.is_active) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseCaseFilters(sp);
  const dateField = sp.datefield === 'lost_approved_at' ? 'lost_approved_at' : 'escalation_date';
  const supabase = await createClient();
  const rows = await fetchAllCases(supabase, undefined, (q) => applyCaseFilters(q, f, { dateField }));
  const columns = user.role === 'client_poc' ? PORTAL_SHEET_COLUMNS : CASE_SHEET_COLUMNS;
  const name = `${f.category === 'lost' ? 'lost-shipments' : 'cases'}-${todayIn()}`;
  if (sp.format === 'xlsx') {
    const buf = await buildCasesWorkbook(f.category === 'lost' ? 'Lost shipments' : 'Cases', rows, columns);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return new NextResponse(buildCasesCsv(rows, columns), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' },
  });
}
