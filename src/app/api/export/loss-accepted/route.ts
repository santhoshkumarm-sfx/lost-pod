import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, isInternalRole } from '@/lib/auth';
import { lossAcceptedXlsx } from '@/lib/reports/exports';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Loss accepted (or still requested) — one row per AWB with value, who requested and who accepted. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isInternalRole(user.role)) return new NextResponse('Internal access needed', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) ?? '') ? sp.get(k) : null);
  const status = sp.get('status') === 'pending' ? 'pending' : 'approved';
  try {
    const buf = await lossAcceptedXlsx(await createClient(), { from: date('from'), to: date('to'), status });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="pod-lost-${status === 'approved' ? 'accepted' : 'requested'}-${todayIn()}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 500 });
  }
}
