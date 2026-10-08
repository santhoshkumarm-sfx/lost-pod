import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { buildUploadTemplate } from '@/lib/cases/upload';
import { todayIn } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSessionUser();
  if (!user || !user.is_active) return new NextResponse('Sign in first', { status: 401 });
  const forClient = user.role === 'client_poc';
  const buf = await buildUploadTemplate(forClient, todayIn());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pending-cases-template${forClient ? '' : '-internal'}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
